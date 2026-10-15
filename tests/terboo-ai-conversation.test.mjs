// اختبار المحادثة المتكاملة عبر النواة (§5 §11 §36 §39)
//
// النواة الحقيقية + الذاكرة المركزية الحقيقية + الموزّع الحقيقي
// (dispatchCommand بكل تسجيله). المستبدَل فقط:
//   • المزوّد الخارجي (شبكة) ← نموذج نصّي مُبرمج يتحقق مما يصله فعلاً.
//   • المعالج النهائي ← مسجّل يثبت أي أمر حقيقي وصله وبأي وسائط.
// اختبار مسار الصلاحيات الكامل حتى البلوقن الحقيقي موجود في
// tests/terboo-ai-dispatch.integration.test.mjs.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-conv-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
memory.resetAll();
const core = await import("../src/lib/terboo-ai-core.js");
const { dispatchCommand } = await import("../src/lib/terboo-command-dispatch.js");

const BOT = "2348093093240";
const sock = { user: { id: `${BOT}:12@s.whatsapp.net` } };
const GROUP = "120363000000000777@g.us";
const USER_A = "201000000001@s.whatsapp.net";
const USER_B = "201000000002@s.whatsapp.net";
const TARGET_1 = "201000000077@s.whatsapp.net";
const TARGET_2 = "201000000088@s.whatsapp.net";
const canonical = (name) => { const c = getPlugin(name).config.name; return Array.isArray(c) ? c[0] : c; };

// ── نموذج مُبرمج: يسجّل كل حمولة ويرد بالقرار المناسب ──
const calls = [];
let script = () => ({ decision: "CHAT", reply: "…", confidence: 0.9 });
async function ask(payload) {
  calls.push(payload);
  return { text: JSON.stringify(script(payload)), provider: "Scripted" };
}

// ── معالج نهائي مُسجِّل خلف الموزّع الحقيقي ──
const executed = [];
async function recordingHandler(synthetic, _sock, options) {
  const text = synthetic.message.extendedTextMessage.text;
  executed.push({ text, mentions: synthetic.message.extendedTextMessage.contextInfo?.mentionedJid || [] });
  options.observer.done({ ok: true, status: "done" });
}
const dispatch = (m, s, request) => dispatchCommand(m, s, request, { handler: recordingHandler });
const deps = { ask, dispatch, rateLimit: false };

let seq = 0;
function message({ sender = USER_A, body, group = false, mentions = [], mentionBot = group }) {
  const replies = [];
  const mentionedJid = [...(mentionBot ? [`${BOT}@s.whatsapp.net`] : []), ...mentions];
  return {
    key: { remoteJid: group ? GROUP : sender, fromMe: false, id: `TEST${++seq}`, ...(group ? { participant: sender } : {}) },
    sender, chat: group ? GROUP : sender, isGroup: group,
    body: mentionBot ? `@${BOT} ${body}` : body,
    pushName: "مختبر", type: "conversation", isCommand: false, prefix: ".",
    isOwner: false, isPremium: false, isPartner: false, isAdmin: group, isBotAdmin: true,
    isBot: false, fromMe: false, isNewsletter: false, mentionedJid, quoted: null,
    replies,
    async reply(text) { replies.push(String(text)); return { key: { id: "r" } }; },
    async react() { },
  };
}
async function say(opts) {
  const m = message(opts);
  const result = await core.runKernel(m, sock, db, deps);
  return { m, result, text: m.replies.join("\n") };
}

// ═══ 1. «اعمل لي نظام» ← «خليه أبسط» ← «لا، رجع النسخة اللي قبلها» (§39) ═══
{
  script = () => ({ decision: "CHAT", reply: "نظام v1: تسجيل + دفع + تقارير", confidence: 0.9 });
  const first = await say({ body: "اعمل لي نظام لإدارة العملاء" });
  assert.equal(first.result, "answered");
  assert.match(first.text, /نظام v1/);

  script = (payload) => {
    assert.ok(payload.history.some((turn) => turn.role === "assistant" && /نظام v1/.test(turn.content)), "الإجابة السابقة وصلت للنموذج في history");
    assert.match(payload.instruction, /MODIFIES the previous result/, "تلميح التعديل وصل للنموذج");
    return { decision: "CHAT", reply: "نظام v2: تسجيل فقط", confidence: 0.9 };
  };
  const second = await say({ body: "خليه أبسط" });
  assert.match(second.text, /نظام v2/);

  const before = calls.length;
  const third = await say({ body: "لا، رجع النسخة اللي قبلها" });
  assert.equal(calls.length, before, "الرجوع حتمي بلا نداء نموذج");
  assert.match(third.text, /نظام v1/, "الرجوع أعاد النسخة السابقة الحقيقية");
  assert.doesNotMatch(third.text, /نظام v2/);
}

// ═══ 2. «كمل» و«خليها زرقاء» و«غيره» تصل للنموذج بتلميحها ═══
{
  const hints = [];
  script = (payload) => { hints.push(payload.instruction); return { decision: "CHAT", reply: "تمام", confidence: 0.9 }; };
  await say({ body: "كمل" });
  await say({ body: "خليها زرقاء" });
  await say({ body: "غيره" });
  assert.match(hints[0], /CONTINUE the previous answer/);
  assert.match(hints[1], /MODIFIES the previous result/);
  assert.match(hints[2], /MODIFIES the previous result/);
}

// ═══ 3. «ممكن تطرد الشخص ده؟» ← أمر حقيقي بالهدف الصحيح (لا البوت) ═══
{
  script = (payload) => {
    assert.match(payload.instruction, /Resolved target number: 201000000077/, "الهدف المحلول هو العضو لا البوت");
    return { decision: "COMMAND", command: "kick", args: "", reply: "حاضر", confidence: 0.9 };
  };
  const before = executed.length;
  const kick = await say({ body: "ممكن تطرد الشخص ده؟", group: true, mentions: [TARGET_1] });
  assert.equal(kick.result, "answered");
  assert.equal(executed.length, before + 1, "أمر واحد نُفِّذ");
  assert.equal(executed.at(-1).text, `.${canonical("kick")} @201000000077`);
  assert.ok(executed.at(-1).mentions.includes(TARGET_1), "الإشارة للهدف مرفقة بالأمر");
  const state = memory.conversationState(kick.m);
  assert.equal(state.lastCommand.command, canonical("kick"), "آخر أمر محفوظ");
  assert.equal(state.lastTarget.number, "201000000077", "آخر هدف محفوظ");
  assert.equal(state.lastResult.ok, true, "النتيجة الحقيقية محفوظة");
}

// ═══ 4. «وده؟» ← نفس الأمر على هدف جديد · «اعمل نفس اللي فوق» ← تكرار ═══
{
  const before = calls.length;
  await say({ body: "وده؟", group: true, mentions: [TARGET_2] });
  assert.equal(executed.at(-1).text, `.${canonical("kick")} @201000000088`, "نفس الأمر على الهدف الجديد");
  await say({ body: "اعمل نفس اللي فوق", group: true });
  assert.equal(executed.at(-1).text, `.${canonical("kick")} @201000000088`, "تكرار آخر أمر كما هو");
  assert.equal(calls.length, before, "المتابعات الحتمية بلا نداء نموذج");
}

// ═══ 5. ثقة منخفضة ← إجراء معلّق ← «نفذه» · «إلغاء» ═══
{
  script = () => ({ decision: "COMMAND", command: "promote", args: "", reply: "تقصد ترقيته؟", confidence: 0.3 });
  const before = executed.length;
  const ask1 = await say({ body: "ممكن تخليه ادمن", group: true, mentions: [TARGET_1] });
  assert.equal(executed.length, before, "لا تنفيذ بثقة منخفضة");
  assert.match(ask1.text, /نفذه/, "طلب تأكيد صريح");
  assert.equal(memory.peekPending(ask1.m)?.command, canonical("promote"));
  await say({ body: "نفذه", group: true });
  assert.equal(executed.at(-1).text, `.${canonical("promote")} @201000000077`, "«نفذه» نفّذت المعلّق");
  assert.equal(memory.peekPending(ask1.m), null, "المعلّق استُهلك");

  script = () => ({ decision: "COMMAND", command: "demote", args: "", reply: "تقصد تنزيله؟", confidence: 0.3 });
  await say({ body: "نزّله شوية", group: true, mentions: [TARGET_1] });
  const count = executed.length;
  const cancelled = await say({ body: "إلغاء", group: true });
  assert.equal(executed.length, count, "الإلغاء لا ينفّذ شيئاً");
  assert.match(cancelled.text, /تم الإلغاء/);
}

// ═══ 6. خيارات ← «لا قصدي التاني» ═══
{
  script = () => ({ decision: "CLARIFICATION", reply: "تقصد أيهما؟", options: [{ command: "menu", args: "" }, { command: "بروفايل", args: "" }], confidence: 0.5 });
  const q = await say({ body: "وريني حاجة" });
  assert.match(q.text, /2\./, "الخيارات معروضة مرقّمة");
  await say({ body: "لا قصدي التاني" });
  assert.equal(executed.at(-1).text, `.${canonical("بروفايل")}`, "اختيار الخيار الثاني نفّذ أمره الحقيقي");
}

// ═══ 7. لغة الرد = لغة الرسالة، لكل شخص حتى في نفس المجموعة (§36) ═══
{
  const langs = [];
  script = (payload) => {
    if (payload.purpose !== "summary") langs.push(payload.language);
    return { decision: "CHAT", reply: "ok", confidence: 0.9 };
  };
  await say({ body: "hello, what can you do for me?" });
  await say({ body: "hola, ¿qué puedes hacer por mí?" });
  await say({ body: "ازيك عامل ايه" });
  await say({ sender: USER_A, body: "what is this group about?", group: true });
  await say({ sender: USER_B, body: "الجروب ده عن ايه؟", group: true });
  // لم تعد الإسبانية مدعومة: نص لاتيني يُكتشف إنجليزياً
  assert.deepEqual(langs, ["en", "en", "ar", "en", "ar"]);
  const decisions = calls.filter((payload) => payload.purpose !== "summary");
  const english = decisions.at(-2);
  assert.match(english.instruction, /Reply ONLY in English/);
  assert.match(english.instruction, /Never answer in Indonesian/);
  assert.match(decisions.at(-3).instruction, /Reply ONLY in Arabic/);
}

// ═══ 8. ذاكرة بكلام طبيعي بلا نموذج ═══
{
  const before = calls.length;
  await say({ sender: USER_B, body: "أنا اسمي كريم وبحب البرمجة" });
  const shown = await say({ sender: USER_B, body: "ايش تعرف عني" });
  assert.match(shown.text, /كريم|البرمجة/, "عرض ما يُتذكَّر");
  const forgot = await say({ sender: USER_B, body: "انسى كل حاجة عني" });
  assert.match(forgot.text, /مسحت كل ما أعرفه/);
  const empty = await say({ sender: USER_B, body: "what do you remember about me" });
  assert.doesNotMatch(empty.text, /كريم|البرمجة/, "المعلومات المنسيّة لا تظهر");
  assert.match(empty.text, /Stored facts: ⁦?0⁩?(\n|$)/, "صفر معلومات محفوظة، والرد بالإنجليزية (قيمة نظيفة بلا backticks)");
  const modelCalls = calls.slice(before).filter((payload) => payload.purpose !== "summary");
  assert.equal(modelCalls.length, 1, "فقط الرسالة العادية وصلت للنموذج");
}

// ═══ 9. المجموعة بلا إشارة: النواة لا تتدخّل ═══
{
  const before = calls.length;
  const m = message({ body: "كلام عادي بين الأعضاء", group: true, mentionBot: false });
  assert.equal(await core.runKernel(m, sock, db, deps), false);
  assert.equal(calls.length, before);
}

// ═══ 10. composeReply: المسار المشترك (Auto AI) يحمل الذاكرة واللغة ═══
{
  const payloads = [];
  const providers = { GeminiAPI: async (payload) => { payloads.push(payload); return { text: "رد مشترك" }; } };
  const m = message({ sender: "201000000055@s.whatsapp.net", body: "أنا شغال على مشروع استضافة للعملاء" });
  await core.composeReply({ m, db, providers, persona: "شخصية اختبار" });
  const m2 = message({ sender: "201000000055@s.whatsapp.net", body: "خلصت السيرفرات" });
  const reply = await core.composeReply({ m: m2, db, providers, persona: "شخصية اختبار" });
  assert.equal(reply.text, "رد مشترك");
  const last = payloads.at(-1);
  assert.match(last.instruction, /شخصية اختبار/, "شخصية الواجهة محفوظة");
  assert.match(last.instruction, /Reply ONLY in Arabic/, "لغة المستخدم");
  assert.match(last.instruction, /استضافة/, "الموضوع السابق مربوط بالرسالة الجديدة");
  assert.ok(last.history.some((turn) => /استضافة/.test(turn.content)), "التاريخ من الذاكرة المركزية");
}

console.log(`✅ terboo-ai-conversation: متابعات حتمية · أوامر حقيقية بهدف صحيح · معلّق/إلغاء/خيارات · لغة لكل شخص · ذاكرة`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
