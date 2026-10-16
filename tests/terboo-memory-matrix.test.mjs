// مصفوفة عزل الذاكرة (§6–§11 §37 §38)
//
//   User A خاص · User B خاص · A في Group A · A في Group B · B في Group A
//
// لكل خلية: حقائق · ملخّص · متابعة · هدف · تفضيلات · معلّق — ثم التأكد أن
// لا شيء ينتقل لأي خلية أخرى، وأن ذاكرة المجموعة المشتركة لا تستقبل الخاص،
// وأن الحذف/النسيان/TTL/إذن المالك تعمل كما ينبغي، وأن الترحيل القديم سليم.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-matrix-"));
const M = await import("../src/lib/terboo-ai-memory.js");
M.initMemory(tmp);
M.resetAll();
const ctx = await import("../src/lib/terboo-ai-context.js");

const A = "201000000101@s.whatsapp.net";
const B = "201000000102@s.whatsapp.net";
const GA = "120000000101@g.us";
const GB = "120000000102@g.us";

function msg(sender, chat, body = "", extra = {}) {
  const isGroup = String(chat).endsWith("@g.us");
  return {
    sender, chat, body, isGroup, key: { id: `M${Math.random()}` },
    type: "conversation", isCommand: false, mentionedJid: [], quoted: null,
    isOwner: false, isPremium: false, isPartner: false, isAdmin: false, isBotAdmin: true, ...extra,
  };
}

// الخلايا الخمس وكلمة سرية فريدة لكل خلية
const CELLS = [
  { name: "A-private", m: () => msg(A, A), secret: "زمرد" },
  { name: "B-private", m: () => msg(B, B), secret: "ياقوت" },
  { name: "A-in-GA", m: () => msg(A, GA), secret: "مرجان" },
  { name: "A-in-GB", m: () => msg(A, GB), secret: "فيروز" },
  { name: "B-in-GA", m: () => msg(B, GA), secret: "عقيق" },
];

// ═══ 1. كتابة محتوى مميّز في كل خلية ═══
for (const cell of CELLS) {
  const m = { ...cell.m(), body: `مشروعي اسمه ${cell.secret} وأنا شغال عليه` };
  M.recordTurn(m, "user", m.body);
  M.recordTurn(m, "assistant", `تمام، مشروع ${cell.secret} مسجّل`);
  M.remember(M.conversationScope(m), { text: `كلمة الخلية ${cell.secret}`, type: "fact", confidence: 0.9 });
  M.learnPreference(M.conversationScope(m), "tone", cell.secret, 0.8);
  M.recordCommand(m, { command: "kick", args: `@2010000${cell.secret.length}0000` });
  M.recordTarget(m, { jid: `20100000${CELLS.indexOf(cell) + 10}00@s.whatsapp.net` });
  M.setPending(m, { kind: "command", command: "promote", args: cell.secret });
}

// ═══ 2. كل خلية ترى نفسها فقط — في الذاكرة وفي حزمة السياق المرسلة للنموذج ═══
for (const cell of CELLS) {
  const m = { ...cell.m(), body: "ايش كلمة الخلية ومشروعي؟" };
  const scope = M.conversationScope(m);
  const snap = M.snapshot(scope);
  const pkg = ctx.buildContextPackage({ m, text: m.body, lang: "ar" });
  const rendered = JSON.stringify({ history: ctx.toHistory(pkg), context: ctx.renderContextForModel(pkg), snap });

  assert.ok(rendered.includes(cell.secret), `${cell.name}: يرى محتواه`);
  for (const other of CELLS) {
    if (other === cell) continue;
    assert.ok(!rendered.includes(other.secret), `${cell.name}: تسريب من ${other.name}`);
  }
  assert.equal(snap.preferences.tone.value, cell.secret, `${cell.name}: التفضيل خاص بالخلية`);
  assert.equal(M.peekPending(m)?.args, cell.secret, `${cell.name}: المعلّق خاص بالخلية`);
  assert.equal(M.conversationState(m).lastTarget.number, `20100000${CELLS.indexOf(cell) + 10}00`, `${cell.name}: الهدف خاص بالخلية`);
}

// ═══ 3. ذاكرة المجموعة المشتركة: رسائل المجموعة العامة فقط، لا الخاص ═══
{
  M.recordGroupMessage({ ...msg(A, GA), body: "إعلان عام: الاجتماع الساعة 9", pushName: "A" });
  M.recordGroupMessage({ ...msg(B, B), body: "رسالة خاصة جداً" }); // خاص ⇒ تُرفض
  const shared = M.groupContext(GA);
  assert.ok(shared.some((e) => e.text.includes("الاجتماع")), "الرسالة العامة في سياق المجموعة");
  assert.ok(!JSON.stringify(shared).includes("رسالة خاصة جداً"), "الخاص لا يدخل ذاكرة المجموعة");
  assert.equal(M.groupContext(GB).length, 0, "سياق مجموعة A لا يظهر في B");
  // المجموعة المشتركة لا تحوي محادثات أعضائها الخاصة بالمساعد
  const groupScope = M.scopeOf("group", { chatJid: GA, isGroup: true });
  const groupSnap = JSON.stringify(M.snapshot(groupScope));
  for (const cell of CELLS) assert.ok(!groupSnap.includes(cell.secret), `ذاكرة المجموعة لا تحوي ${cell.name}`);
}

// ═══ 4. الذاكرة الدلالية تربط الموضوع عبر الرسائل (§9) ═══
{
  const m = msg(A, A);
  M.recordTurn({ ...m, body: "أنا شغال على مشروع استضافة للعملاء" }, "user", "أنا شغال على مشروع استضافة للعملاء");
  const topic = M.activeTopic(M.conversationScope(m), "خلصت السيرفرات");
  assert.ok(topic, "«خلصت السيرفرات» مربوطة بموضوع الاستضافة");
  const pkg = ctx.buildContextPackage({ m: { ...m, body: "خلصت السيرفرات" }, text: "خلصت السيرفرات", lang: "ar" });
  assert.match(ctx.renderContextForModel(pkg), /استضافة/, "الموضوع يصل للنموذج مع الرسالة الجديدة");
  const other = ctx.buildContextPackage({ m: msg(B, B, "خلصت السيرفرات"), text: "خلصت السيرفرات", lang: "ar" });
  assert.doesNotMatch(ctx.renderContextForModel(other), /استضافة/, "موضوع A لا يظهر لـ B");
}

// ═══ 5. الملخّص لكل خلية على حدة ═══
{
  const m = msg(B, GA);
  for (let i = 0; i < M.LIMITS.shortTerm + 4; i += 1) M.recordTurn({ ...m, body: `رسالة ب رقم ${i}` }, "user", `رسالة ب رقم ${i}`);
  assert.ok(M.snapshot(M.conversationScope(m)).summaryChars > 0, "ملخّص B في GA");
  assert.equal(M.snapshot(M.conversationScope(msg(A, GA))).summaryChars, 0, "لا ملخّص منقول إلى A في GA");
  const summarized = await M.refreshSummary(M.conversationScope(m), async () => "ملخص ذكي لرسائل ب");
  assert.equal(summarized, "ملخص ذكي لرسائل ب", "الملخّص الذكي يُكتب للخلية نفسها");
  assert.doesNotMatch(JSON.stringify(M.snapshot(M.conversationScope(msg(A, GA)))), /ملخص ذكي/);
}

// ═══ 6. النسيان والحذف (§37) ═══
{
  const aPriv = M.conversationScope(msg(A, A));
  const last = M.forgetLast(aPriv);
  assert.ok(last?.text, "نسيان آخر معلومة");
  M.forget(M.conversationScope(msg(A, GB)));
  assert.equal(M.snapshot(M.conversationScope(msg(A, GB))), null, "حذف خلية واحدة");
  assert.ok(M.snapshot(M.conversationScope(msg(A, GA))), "باقي خلايا A سليمة");
  const removed = M.forgetUserEverywhere(A);
  assert.ok(removed >= 2, "نسيان A في كل مكان");
  assert.equal(M.snapshot(M.conversationScope(msg(A, A))), null);
  assert.equal(M.snapshot(M.conversationScope(msg(A, GA))), null);
  assert.ok(M.snapshot(M.conversationScope(msg(B, B))).facts.length > 0, "ذاكرة B لم تُمس");
  assert.ok(M.snapshot(M.conversationScope(msg(B, GA))).facts.length > 0, "ذاكرة B في المجموعة لم تُمس");
}

// ═══ 7. الإيقاف و TTL ═══
{
  const scope = M.conversationScope(msg(B, B));
  M.setEnabled(scope, false);
  M.recordTurn(msg(B, B, "لا تحفظ هذا"), "user", "لا تحفظ هذا");
  assert.ok(!JSON.stringify(M.history(scope)).includes("لا تحفظ هذا"), "الذاكرة المتوقفة لا تحفظ");
  M.setEnabled(scope, true);
  M.remember(scope, { text: "حقيقة قصيرة العمر جداً", type: "fact", ttl: 1 });
  await new Promise((r) => setTimeout(r, 15));
  assert.ok(!M.snapshot(scope).facts.some((f) => f.text === "حقيقة قصيرة العمر جداً"), "انتهت صلاحيتها وحُذفت");
}

// ═══ 8. اطلاع المالك: إذن صريح + سبب + سجل تدقيق ═══
{
  const target = M.conversationScope(msg(B, B));
  assert.equal(M.inspectForOwner(target, { ownerJid: A, reason: "دعم فني" }).reason, "no-consent", "بلا إذن: مرفوض");
  M.setOwnerInspection(B, true);
  assert.equal(M.inspectForOwner(target, { ownerJid: A, reason: "" }).reason, "reason-required", "بلا سبب: مرفوض");
  const ok = M.inspectForOwner(target, { ownerJid: A, reason: "دعم فني بطلب المستخدم" });
  assert.equal(ok.ok, true);
  assert.ok(M.eventsOf(M.scopeOf("system", { name: "audit" })).some((e) => /inspected/.test(e.text)), "مسجّل في التدقيق");
  M.setOwnerInspection(B, false);
  assert.equal(M.inspectForOwner(target, { ownerJid: A, reason: "دعم فني" }).reason, "no-consent", "سحب الإذن فوري");
}

// ═══ 9. الترحيل القديم لمرة واحدة، إلى النطاقات الصحيحة، بلا أسرار ═══
{
  const dbData = {
    autoai: { [GA]: { sessions: { "201000000103": { history: [{ role: "user", content: "جلسة قديمة في المجموعة", timestamp: 1 }, { role: "assistant", content: "رد قديم", timestamp: 2 }] } } } },
    longTermMemory: { "201000000103": [{ topic: "x", content: "اسمي سالم", timestamp: 1 }] },
    aiGroupMemory: { [GA]: [{ id: "MEM-1", content: "قاعدة المجموعة: الاحترام أولاً", label: "قواعد", author: A }] },
  };
  const agentMemory = { preferences: { global: { style: { value: "short token=abcdefghijklmnopqrstuvwxyz", confidence: 1 } } }, facts: {}, capabilities: {}, decisions: [], lessons: [{ operation: "test", success: true, summary: "ok" }] };
  const report = M.migrateLegacyStores({ dbData, agentMemory });
  assert.equal(report.sessions, 1);
  assert.ok(report.longTerm >= 1);
  assert.equal(report.groupMemory, 1);
  assert.ok(report.agent >= 1);
  const migrated = M.history(M.scopeOf("group:user", { userJid: "201000000103", chatJid: GA, isGroup: true }));
  assert.ok(migrated.some((t) => t.content.includes("جلسة قديمة")), "الجلسة في نطاق العضو داخل مجموعتها");
  assert.ok(M.factsOf(M.scopeOf("group", { chatJid: GA, isGroup: true })).some((f) => f.text.includes("الاحترام")), "ذاكرة المجموعة المسمّاة");
  const agentFacts = JSON.stringify(M.factsOf(M.scopeOf("system", { name: "agent:global" })));
  assert.ok(agentFacts.includes("style"), "ذاكرة الوكيل بصيغة المحوّل");
  assert.ok(!agentFacts.includes("abcdefghijklmnopqrstuvwxyz"), "السر لم يُرحَّل");
  const again = M.migrateLegacyStores({ dbData, agentMemory });
  assert.deepEqual(again, { sessions: 0, longTerm: 0, groupMemory: 0, agent: 0 }, "الترحيل لا يتكرر");
}

M.flush();
console.log("✅ terboo-memory-matrix: 5 خلايا بلا تسريب · مشتركة بلا خاص · دلالي · ملخّص · نسيان · TTL · إذن المالك · ترحيل");
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
