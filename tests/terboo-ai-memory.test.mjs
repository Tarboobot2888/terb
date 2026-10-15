// اختبار محرّك الذاكرة - Bot Terboo
// يغطّي §3 §4 §5 §6 §7 §22:
//   النطاقات الأربعة · العزل بين الأشخاص والمجموعات · الذاكرة القصيرة
//   · الملخّص المتدحرج · التصنيف · TTL · التنقيح · حزمة السياق
//   · حلّ الضمائر والإشارة · أوامر الخصوصية.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-mem-"));
const M = await import("../src/lib/terboo-ai-memory.js");
M.initMemory(tmpDir);
M.resetAll();

const ctx = await import("../src/lib/terboo-ai-context.js");

const ALICE = "201000000001@s.whatsapp.net";
const BOB = "201000000002@s.whatsapp.net";
const GROUP_A = "120000000001@g.us";
const GROUP_B = "120000000002@g.us";

function msg(sender, chat, body = "", extra = {}) {
  const isGroup = String(chat).endsWith("@g.us");
  return {
    sender, chat, body, isGroup,
    type: "conversation", isCommand: false,
    mentionedJid: [], quoted: null,
    isOwner: false, isPremium: false, isPartner: false, isAdmin: false, isBotAdmin: true,
    ...extra,
  };
}

// ── 1. النطاقات الأربعة تُبنى بمفاتيح صحيحة ───────────
{
  assert.equal(M.scopeOf("private:user", { userJid: ALICE }).key, "private:201000000001");
  assert.equal(M.scopeOf("group", { chatJid: GROUP_A, isGroup: true }).key, "group:120000000001");
  assert.equal(
    M.scopeOf("group:user", { userJid: ALICE, chatJid: GROUP_A, isGroup: true }).key,
    "group:120000000001:201000000001",
  );
  assert.equal(M.scopeOf("global", {}).key, "global");

  // لا يوجد نطاق «تقريبي»: نقص أي معرّف مطلوب يرمي خطأ
  assert.throws(() => M.scopeOf("group:user", { userJid: ALICE }), /مجموعة/, "group:user بلا مجموعة يُرفض");
  assert.throws(() => M.scopeOf("group:user", { chatJid: GROUP_A, isGroup: true }), /مستخدم/, "group:user بلا مستخدم يُرفض");
  assert.throws(() => M.scopeOf("private:user", { userJid: ALICE, chatJid: GROUP_A, isGroup: true }), /مجموعة/, "private داخل مجموعة يُرفض");
  assert.throws(() => M.scopeOf("nonsense", {}), /غير معروف/, "نطاق مجهول يُرفض");
}

// ── 2. الخاص والمجموعة لنفس الشخص منفصلان ─────────────
{
  M.recordTurn(msg(ALICE, ALICE), "user", "سر خاص: مشروعي اسمه فالكون");
  M.recordTurn(msg(ALICE, GROUP_A), "user", "كلام عام في المجموعة");

  const priv = M.history(M.scopeOf("private:user", { userJid: ALICE }));
  const grp = M.history(M.scopeOf("group:user", { userJid: ALICE, chatJid: GROUP_A, isGroup: true }));

  assert.equal(priv.length, 1, "الخاص فيه دور واحد");
  assert.equal(grp.length, 1, "المجموعة فيها دور واحد");
  assert.ok(priv[0].content.includes("فالكون"), "محتوى الخاص صحيح");
  assert.ok(!grp[0].content.includes("فالكون"), "محتوى الخاص لا يظهر في المجموعة");
}

// ── 3. لا تسريب بين شخصين في نفس المجموعة (§7) ────────
{
  M.recordTurn(msg(BOB, GROUP_A), "user", "أنا بوب وعندي بيانات خاصة بي");
  const aliceInA = M.history(M.scopeOf("group:user", { userJid: ALICE, chatJid: GROUP_A, isGroup: true }));
  const bobInA = M.history(M.scopeOf("group:user", { userJid: BOB, chatJid: GROUP_A, isGroup: true }));

  assert.ok(!aliceInA.some((turn) => turn.content.includes("بوب")), "محادثة بوب لا تظهر عند أليس");
  assert.ok(bobInA.some((turn) => turn.content.includes("بوب")), "محادثة بوب محفوظة عند بوب");
  assert.notEqual(aliceInA.length, 0, "أليس ما زالت تملك سجلها");
}

// ── 4. لا تسريب بين مجموعتين لنفس الشخص ───────────────
{
  M.recordTurn(msg(ALICE, GROUP_B), "user", "كلام مجموعة ب فقط");
  const inA = M.history(M.scopeOf("group:user", { userJid: ALICE, chatJid: GROUP_A, isGroup: true }));
  const inB = M.history(M.scopeOf("group:user", { userJid: ALICE, chatJid: GROUP_B, isGroup: true }));
  assert.ok(!inA.some((turn) => turn.content.includes("مجموعة ب")), "مجموعة ب لا تظهر في مجموعة أ");
  assert.ok(inB.some((turn) => turn.content.includes("مجموعة ب")), "مجموعة ب محفوظة في مكانها");
}

// ── 5. حزمة السياق تقرأ النطاق الصحيح فقط ─────────────
{
  const pkgPrivate = ctx.buildContextPackage({ m: msg(ALICE, ALICE, "فكّرني بالمشروع"), text: "فكّرني بالمشروع" });
  const pkgGroup = ctx.buildContextPackage({ m: msg(ALICE, GROUP_A, "فكّرني بالمشروع"), text: "فكّرني بالمشروع" });

  assert.equal(pkgPrivate.scopeKey, "private:201000000001");
  assert.equal(pkgGroup.scopeKey, "group:120000000001:201000000001");
  assert.ok(
    pkgGroup.memory.turns.every((turn) => !turn.content.includes("فالكون")),
    "سياق المجموعة لا يحمل أسرار الخاص",
  );
}

// ── 6. ممنوع history فارغة مع وجود محادثة محفوظة (§5) ──
{
  const pkg = ctx.buildContextPackage({ m: msg(ALICE, ALICE, "كمل معايا"), text: "كمل معايا" });
  const history = ctx.toHistory(pkg);
  assert.ok(history.length > 0, "history لا يجوز أن تكون فارغة وهناك محادثة محفوظة");
  assert.ok(history.every((turn) => ["user", "assistant"].includes(turn.role)), "شكل history صالح للمزوّدات");

  const payload = ctx.toProviderPayload(pkg, "INSTRUCTION");
  assert.ok(Array.isArray(payload.history) && payload.history.length > 0, "الحمولة تحمل history حقيقية");
  assert.ok(payload.instruction.includes("INSTRUCTION"), "التعليمات محفوظة داخل الحمولة");

  // مستخدم جديد بلا محادثة: history فارغة مقبولة
  const fresh = ctx.buildContextPackage({ m: msg("201999999999@s.whatsapp.net", "201999999999@s.whatsapp.net", "أهلاً"), text: "أهلاً" });
  assert.equal(ctx.toHistory(fresh).length, 0, "بلا محادثة سابقة: history فارغة طبيعية");
}

// ── 7. الذاكرة القصيرة والملخّص المتدحرج (§4) ──────────
{
  const scope = M.scopeOf("private:user", { userJid: BOB });
  for (let i = 1; i <= M.LIMITS.shortTerm + 6; i += 1) {
    M.recordTurn(msg(BOB, BOB), "user", `رسالة رقم ${i}`);
  }
  const snap = M.snapshot(scope);
  assert.equal(snap.turns, M.LIMITS.shortTerm, "النافذة القصيرة محدودة بسعتها");
  assert.ok(snap.summaryChars > 0, "ما خرج من النافذة انطوى في ملخّص متدحرج");

  const recent = M.history(scope);
  assert.ok(recent[recent.length - 1].content.includes(String(M.LIMITS.shortTerm + 6)), "آخر دور هو الأحدث");
  assert.ok(!recent.some((turn) => turn.content === "رسالة رقم 1"), "أقدم دور خرج من النافذة");
}

// ── 8. التصنيف والثقة والطابع الزمني (§4) ─────────────
{
  const scope = M.scopeOf("private:user", { userJid: ALICE });
  assert.equal(M.classify("اسمي محمود"), "identity");
  assert.equal(M.classify("أنا بحب القهوة"), "preference");
  assert.equal(M.classify("قررت نكمل بالخطة دي"), "decision");
  assert.equal(M.classify("فكرني أبعت التقرير"), "task");
  assert.equal(M.classify("السماء زرقاء"), "fact");

  const stored = M.remember(scope, { text: "اسمي محمود", confidence: 0.9 });
  assert.equal(stored.type, "identity", "التصنيف التلقائي يعمل");
  assert.equal(stored.confidence, 0.9);
  assert.ok(stored.at > 0, "طابع زمني موجود");

  // نوع صريح يُحترم، والتكرار يُحدّث بدل أن يُضاعف
  M.remember(scope, { text: "مشروعي اسمه فالكون", type: "project", confidence: 0.8 });
  const again = M.remember(scope, { text: "اسمي محمود", confidence: 0.95 });
  assert.equal(again.confidence, 0.95, "الثقة تُرفع عند التكرار");
  const facts = M.snapshot(scope).facts;
  assert.equal(facts.filter((f) => f.text === "اسمي محمود").length, 1, "لا تكرار للحقيقة نفسها");
  assert.ok(facts.some((f) => f.type === "project"), "النوع الصريح محفوظ");
}

// ── 9. الاسترجاع بالصلة لا بالذاكرة كاملة (§5 §22) ─────
{
  const scope = M.scopeOf("private:user", { userJid: ALICE });
  for (let i = 0; i < 20; i += 1) {
    M.remember(scope, { text: `حقيقة جانبية رقم ${i} عن موضوع مختلف تماماً`, confidence: 0.4 });
  }
  const relevant = M.recall(scope, "احكيلي عن مشروع فالكون", 6);
  assert.ok(relevant.length > 0 && relevant.length <= 6, "الاسترجاع محدود العدد");
  assert.ok(relevant.some((item) => item.text.includes("فالكون")), "الحقيقة ذات الصلة تتصدّر");
  assert.ok(relevant.length < M.snapshot(scope).facts.length, "لا تُرسل الذاكرة كاملة");
}

// ── 10. التنقيح: لا تُخزَّن الأسرار إطلاقاً (§22) ───────
{
  const scope = M.scopeOf("private:user", { userJid: ALICE });
  const secrets = [
    "مفتاحي هو AIzaSyA1234567890abcdefghijklmnopqrstuv",
    "token: gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    "my password: SuperSecret123",
    "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
  ];
  for (const secret of secrets) {
    assert.equal(M.looksSecret(secret), true, `يُكتشف كسر: ${secret.slice(0, 20)}`);
    assert.equal(M.remember(scope, { text: secret }), null, "السر لا يُحفظ كحقيقة");
  }

  M.recordTurn(msg(ALICE, ALICE), "user", "المفتاح بتاعي AIzaSyA1234567890abcdefghijklmnopqrstuv خليه عندك");
  const turns = M.history(scope);
  const last = turns[turns.length - 1].content;
  assert.ok(!last.includes("AIzaSyA1234567890"), "السر مُنقّح داخل المحادثة المحفوظة");
  assert.ok(last.includes(M.REDACTED), "يظهر بدلاً منه وسم الحجب");
  assert.equal(M.redact("api_key = abcdefghijklmnop123").includes("abcdefghijklmnop123"), false, "redact يشمل صيغ المفاتيح");
}

// ── 11. TTL وانتهاء الصلاحية ──────────────────────────
{
  const scope = M.scopeOf("private:user", { userJid: "201000000003@s.whatsapp.net" });
  M.remember(scope, { text: "حقيقة مؤقتة جداً", ttl: 1 });
  M.remember(scope, { text: "حقيقة دائمة تبقى" });
  await new Promise((resolve) => setTimeout(resolve, 15));
  const facts = M.snapshot(scope).facts;
  assert.ok(!facts.some((f) => f.text === "حقيقة مؤقتة جداً"), "الحقيقة المنتهية تُحذف عند القراءة");
  assert.ok(facts.some((f) => f.text === "حقيقة دائمة تبقى"), "الحقيقة الدائمة باقية");

  M.setTTLDays(scope, 7);
  assert.equal(M.snapshot(scope).ttlDays, 7, "مدّة الاحتفاظ محفوظة");
  M.setTTLDays(scope, 0);
  assert.equal(M.snapshot(scope).ttlDays, 0, "الصفر يعني بلا انتهاء");
}

// ── 12. سياق الإشارة: الضمائر والهدف السابق (§6) ───────
{
  const groupMsg = msg(ALICE, GROUP_A, "اطرد @201000000077");
  M.recordCommand(groupMsg, { command: "kick", args: "@201000000077" });
  M.recordTarget(groupMsg, { jid: "201000000077@s.whatsapp.net", name: "سامي" });

  const state = M.conversationState(msg(ALICE, GROUP_A));
  assert.equal(state.lastCommand.command, "kick", "آخر أمر محفوظ");
  assert.equal(state.lastTarget.number, "201000000077", "آخر هدف محفوظ");

  // الهدف السابق لا يظهر لشخص آخر في نفس المجموعة
  const bobState = M.conversationState(msg(BOB, GROUP_A));
  assert.notEqual(bobState.lastTarget?.number, "201000000077", "هدف أليس لا يصل لبوب");

  // حلّ الضمير من الذاكرة
  const pronoun = ctx.resolveReference(msg(ALICE, GROUP_A, "وهو كمان اطرده"), "وهو كمان اطرده", state);
  assert.equal(pronoun.target.number, "201000000077", "الضمير «هو» يُحلّ من آخر هدف");
  assert.equal(pronoun.target.source, "memory");

  // الإشارة الصريحة تتقدّم على الذاكرة
  const explicit = ctx.resolveReference(
    msg(ALICE, GROUP_A, "اطرد @201000000088", { mentionedJid: ["201000000088@s.whatsapp.net"] }),
    "اطرد @201000000088",
    state,
  );
  assert.equal(explicit.target.number, "201000000088", "الهدف الصريح يتقدّم");

  // متابعة وتصحيح وترتيب
  assert.equal(ctx.resolveReference(msg(ALICE, ALICE, "خليها زرقاء"), "خليها زرقاء", state).isFollowUp, true);
  assert.equal(ctx.resolveReference(msg(ALICE, ALICE, "لا، التاني"), "لا، التاني", state).isCorrection, true);
  assert.equal(ctx.resolveReference(msg(ALICE, ALICE, "لا، التاني"), "لا، التاني", state).ordinal, 1);
  assert.equal(ctx.resolveReference(msg(ALICE, ALICE, "make it blue"), "make it blue", state).isFollowUp, true);
}

// ── 13. التفضيلات المتعلّمة ───────────────────────────
{
  const scope = M.scopeOf("private:user", { userJid: ALICE });
  M.learnPreference(scope, "replyLength", "short", 0.8);
  const prefs = M.snapshot(scope).preferences;
  assert.equal(prefs.replyLength.value, "short");
  assert.equal(prefs.replyLength.confidence, 0.8);

  const pkg = ctx.buildContextPackage({ m: msg(ALICE, ALICE, "رد عليّ"), text: "رد عليّ" });
  assert.ok(ctx.renderContextForModel(pkg).includes("replyLength"), "التفضيل يصل للنموذج");
}

// ── 14. الأحداث المهمّة ───────────────────────────────
{
  const scope = M.scopeOf("group", { chatJid: GROUP_A, isGroup: true });
  M.recordEvent(scope, "تمت ترقية سامي إلى مشرف", "promote");
  const events = M.snapshot(scope).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "promote");
}

// ── 15. أوامر الخصوصية: إيقاف · حذف · حذف شامل (§22) ──
{
  const scope = M.scopeOf("private:user", { userJid: BOB });
  M.setEnabled(scope, false);
  M.recordTurn(msg(BOB, BOB), "user", "هذا يجب ألا يُحفظ");
  assert.equal(M.history(scope).length, 0, "الذاكرة الموقوفة لا تحفظ شيئاً");
  assert.equal(M.remember(scope, { text: "ولا هذه" }), null, "ولا تحفظ الحقائق");

  M.setEnabled(scope, true);
  M.recordTurn(msg(BOB, BOB), "user", "الآن تعمل");
  assert.equal(M.history(scope).length, 1, "بعد التشغيل تحفظ من جديد");

  M.forget(scope);
  assert.equal(M.history(scope).length, 0, "الحذف يمسح كل شيء");

  M.recordTurn(msg(ALICE, ALICE), "user", "خاص");
  M.recordTurn(msg(ALICE, GROUP_A), "user", "مجموعة أ");
  M.recordTurn(msg(ALICE, GROUP_B), "user", "مجموعة ب");
  const removed = M.forgetUserEverywhere(ALICE);
  assert.ok(removed >= 3, `الحذف الشامل يشمل كل النطاقات (حذف ${removed})`);
  assert.equal(M.history(M.scopeOf("private:user", { userJid: ALICE })).length, 0);
  assert.equal(M.history(M.scopeOf("group:user", { userJid: ALICE, chatJid: GROUP_A, isGroup: true })).length, 0);
  assert.equal(M.history(M.scopeOf("group:user", { userJid: ALICE, chatJid: GROUP_B, isGroup: true })).length, 0);

  // حذف أليس لم يمس بوب: سجله في المجموعة ما زال يحمل ما كتبه من قبل
  const bobTurns = M.history(M.scopeOf("group:user", { userJid: BOB, chatJid: GROUP_A, isGroup: true }));
  assert.ok(bobTurns.length >= 1, "حذف شخص لا يمس سجل غيره");
  assert.ok(bobTurns.some((turn) => turn.content.includes("بوب")), "محتوى بوب السابق باقٍ بعد حذف أليس");
}

// ── 16. الحفظ على القرص يعمل ─────────────────────────
{
  M.flush();
  const file = path.join(tmpDir, "terboo-memory.json");
  assert.ok(fs.existsSync(file), "ملف الذاكرة يُكتب");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(raw.private && raw.groups && raw.global, "بنية الملف مشجّرة بالنطاقات");
  assert.ok(!JSON.stringify(raw).includes("AIzaSyA1234567890"), "لا سر مكتوب على القرص");
}

const stats = M.stats();
console.log(`✅ terboo-ai-memory: ${stats.privateRecords} خاص · ${stats.groups} مجموعة · ${stats.groupMemberRecords} سجل عضو · بلا تسريب`);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
process.exit(0);
