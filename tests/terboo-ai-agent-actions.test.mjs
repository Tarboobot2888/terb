// ═══════════════════════════════════════════════
// 🧪 Terboo Agent — إجراءات حقيقية بالكلام الطبيعي (تكامل كامل)
// ───────────────────────────────────────────────
// كلام طبيعي ← messageHandler الحقيقي ← النواة ← محرك الإجراءات ← الموزّع ← بلوقنات المجموعة
// الحقيقية (اضف · طرد · ترقية) ← واتساب وهمي يغيّر قائمة الأعضاء فعلاً ← تحقق من الدليل.
// لا يُستبدل إلا ما هو خارج البوت: واتساب (sock وهمي) ومزوّد الذكاء (يُسجَّل كل نداء له).
//
// السيناريوهات: ضيف أحمد ⇒ اطرده ⇒ رجعه ⇒ خليه أدمن · مين الأعضاء/الأدمن · أحمد موجود؟
// · عضو غير مسجل · هدف غامض · LID · PN · رد · منشن
// · رد على رسالة البوت · تطابق ضعيف بالإنجليزية · سلسلة في رسالة واحدة · دفعة رسائل
// · عضو بلا صلاحية · فشل حقيقي بلا ادعاء نجاح · إيقاف/استئناف مهمة · متابعة ذكاء · متابعة وسائط.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111111";
const BOT_JID = `${BOT}@s.whatsapp.net`;
const GROUP = "120363000000000777@g.us";
const ADMIN = "201222222222@s.whatsapp.net";
const UNREG = "201230000000@s.whatsapp.net";
const MEMBER = "201333333333@s.whatsapp.net";
const AHMED_PN = "201555555555@s.whatsapp.net";
const AHMED_LID = "77700011122233@lid";
const MOHAMED_1 = "201666666666@s.whatsapp.net";
const MOHAMED_2 = "201677777777@s.whatsapp.net";
const SARA = "201688888888@s.whatsapp.net";
const KAREEM = "201699999999@s.whatsapp.net";

// ── مزوّد ذكاء مُسجَّل: الإجراءات الحتمية يجب ألا تستدعيه ──
const providerCalls = [];
global.terbooProviders = {
  map: {
    GeminiAPI: async (payload) => {
      providerCalls.push(payload);
      return { text: JSON.stringify({ decision: "CHAT", reply: "تمام، كملت لك الشرح: الخطوة التالية هي الحفظ.", confidence: 0.9 }) };
    },
  },
  loadedAt: Date.now() + 3_600_000,
  names: ["GeminiAPI"],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-agent-actions-"));
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const { messageHandler } = await import("../src/handler.js");
// التبريد يحمي من التكرار في الاستخدام الحقيقي؛ هنا يُختبر مرة صريحة (cooldown-explained) ثم يُصفَّر للسرعة
const { getPlugin } = await import("../src/lib/terboo-plugins.js");
const cooldowns = Object.fromEntries(["اضف", "طرد", "ترقية", "خفض", "فئة", "انذار"].map((name) => [name, getPlugin(name).config.cooldown]));
const ctx = await import("../src/lib/terboo-context-engine.js");
const tasks = await import("../src/lib/terboo-task-queue.js");
const { identityOf } = await import("../src/lib/terboo-identity.js");
const engine = await import("../src/lib/terboo-action-engine.js");
const directory = await import("../src/lib/terboo-group-directory.js");

db.setting("registrationRequired", true);
for (const jid of [ADMIN, MEMBER]) db.setUser(jid, { isRegistered: true, regName: "مختبر", language: "ar" });
// أحمد ليس في المجموعة: معروف فقط كجهة اتصال (اسم واتساب شوهد سابقاً)
db.setting("contacts", { [AHMED_PN]: { jid: AHMED_PN, name: "أحمد" } });

// ── واتساب وهمي: قائمة أعضاء حقيقية تتغير مع كل عملية ──
let participants = [
  { id: BOT_JID, admin: "admin" },
  { id: ADMIN, admin: "admin", notify: "مختبر" },
  { id: UNREG, admin: "admin", notify: "زائر" },
  { id: MEMBER, admin: null, notify: "عضو عادي" },
  { id: MOHAMED_1, admin: null, notify: "محمد" },
  { id: MOHAMED_2, admin: null, notify: "محمد سمير" },
  { id: SARA, admin: null, notify: "Sara" },
  { id: KAREEM, admin: null, notify: "كريم" },
];
const ops = [];
const sent = [];
const relays = [];
const same = (p, jid) => [p.id, p.phoneNumber, p.lid].includes(jid) || (jid === AHMED_PN && p.id === AHMED_LID) || (jid === AHMED_LID && p.phoneNumber === AHMED_PN);
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net` },
  groupMetadata: async () => ({ id: GROUP, subject: "جروب الاختبار", owner: ADMIN, participants: participants.map((p) => ({ ...p })) }),
  groupParticipantsUpdate: async (chat, jids, action) => {
    ops.push({ action, jids: [...jids] });
    return jids.map((jid) => {
      if (action === "remove" && jid === KAREEM) throw new Error("not-authorized");
      if (action === "add") {
        if (!participants.some((p) => same(p, jid))) participants.push({ id: AHMED_LID, phoneNumber: AHMED_PN, admin: null, notify: "أحمد" });
      } else if (action === "remove") participants = participants.filter((p) => !same(p, jid));
      else if (action === "promote" || action === "demote") for (const p of participants) if (same(p, jid)) p.admin = action === "promote" ? "admin" : null;
      return { jid, status: "200" };
    });
  },
  onWhatsApp: async (jid) => [{ exists: true, jid }],
  groupInviteCode: async () => "CODE",
  sendMessage: async (chat, content) => { sent.push({ chat, text: content?.text || content?.caption || "" }); return { key: { id: `S${sent.length}`, remoteJid: chat, fromMe: true } }; },
  relayMessage: async (chat, message, opts) => {
    const node = message?.viewOnceMessage?.message?.interactiveMessage || message?.interactiveMessage;
    const buttons = (node?.nativeFlowMessage?.buttons || []).map((b) => { try { return JSON.parse(b.buttonParamsJson || "{}").id; } catch { return null; } });
    relays.push({ chat, text: node?.body?.text || "", buttons });
    return opts?.messageId || `R${relays.length}`;
  },
  sendPresenceUpdate: async () => { },
  readMessages: async () => { },
  waUploadToServer: undefined,
};

let seq = 0;
function groupMessage(sender, text, { mentions = [], quotedFrom = null, quotedText = "صورة", button = null, image = false } = {}) {
  const contextInfo = { mentionedJid: [BOT_JID, ...mentions] };
  if (quotedFrom) {
    contextInfo.stanzaId = `Q${seq}`;
    contextInfo.participant = quotedFrom;
    contextInfo.quotedMessage = { conversation: quotedText };
  }
  const id = `ACT${++seq}X${Date.now().toString(36).toUpperCase()}`;
  if (button) {
    return {
      key: { remoteJid: GROUP, participant: sender, fromMe: false, id },
      message: { interactiveResponseMessage: { body: { text: "" }, nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id: button }), version: 3 }, contextInfo: { stanzaId: "BOTMSG", participant: BOT_JID, quotedMessage: { conversation: "اختيار" } } } },
      pushName: "مختبر",
      messageTimestamp: Math.floor(Date.now() / 1000),
    };
  }
  if (image) {
    return {
      key: { remoteJid: GROUP, participant: sender, fromMe: false, id },
      message: { imageMessage: { caption: `@${BOT} ${text}`, mimetype: "image/jpeg", contextInfo } },
      pushName: "مختبر",
      messageTimestamp: Math.floor(Date.now() / 1000),
    };
  }
  return {
    key: { remoteJid: GROUP, participant: sender, fromMe: false, id },
    message: { extendedTextMessage: { text: `@${BOT} ${text}`, contextInfo } },
    pushName: sender === UNREG ? "زائر" : "مختبر",
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}

async function say(sender, text, options = {}) {
  const before = { sent: sent.length, relays: relays.length, ops: ops.length, calls: providerCalls.length };
  await messageHandler(groupMessage(sender, text, options), sock);
  // الأوامر المُرسلة عبر الموزّع تكمل داخل نفس الاستدعاء؛ مهلة قصيرة لأي رد غير متزامن
  await new Promise((r) => setTimeout(r, 30));
  const replies = [...sent.slice(before.sent).map((x) => x.text), ...relays.slice(before.relays).map((x) => x.text)].join("\n");
  return { replies, ops: ops.slice(before.ops), calls: providerCalls.length - before.calls, relays: relays.slice(before.relays) };
}
const isMember = (jid) => participants.some((p) => same(p, jid));
const isAdmin = (jid) => participants.some((p) => same(p, jid) && p.admin);
const fakeM = (sender) => ({ sender, chat: GROUP, isGroup: true });

const results = [];
async function check(name, fn) {
  await fn();
  results.push(name);
}

await check("cooldown-explained", async () => {
  // تبريد حقيقي: أمر ثانٍ من الذكاء خلال التبريد ⇒ لا تنفيذ، وسبب واضح بالوقت (لا تفاعل ⏱️ صامت فقط)
  getPlugin("طرد").config.cooldown = 60;
  db.setCooldown(ADMIN, "طرد", 60);
  const r = await say(ADMIN, "اطرد كريم");
  assert.equal(r.ops.length, 0, "التبريد لا يُتجاوز");
  assert.match(r.replies, /انتظر \d+ ثانية/, "سبب صريح بالوقت المتبقي");
  for (const [name, value] of Object.entries(cooldowns)) getPlugin(name).config.cooldown = 0 * value;
});

await check("01-add-by-name", async () => {
  const r = await say(ADMIN, "ضيف أحمد");
  assert.deepEqual(r.ops.map((o) => o.action), ["add"], "إضافة حقيقية واحدة");
  assert.deepEqual(r.ops[0].jids, [AHMED_PN], "بالرقم الحقيقي لجهة الاتصال");
  assert.ok(isMember(AHMED_PN), "أحمد أصبح عضواً فعلاً");
  assert.equal(r.calls, 0, "بلا نداء نموذج");
  assert.equal(ctx.recall(fakeM(ADMIN), "added")?.pn, AHMED_PN, "سياق: آخر من أُضيف");
});

await check("02-kick-pronoun-lid", async () => {
  const r = await say(ADMIN, "اطرده");
  assert.deepEqual(r.ops.map((o) => o.action), ["remove"], "طرد حقيقي");
  assert.ok([AHMED_LID, AHMED_PN].includes(r.ops[0].jids[0]), "على نفس أحمد (هويته LID/PN)");
  assert.ok(!isMember(AHMED_PN), "خرج فعلاً");
  assert.equal(r.calls, 0);
});

await check("03-readd", async () => {
  const r = await say(ADMIN, "رجعه");
  assert.deepEqual(r.ops.map((o) => o.action), ["add"], "إعادة إضافة نفس الهدف");
  assert.deepEqual(r.ops[0].jids, [AHMED_PN]);
  assert.ok(isMember(AHMED_PN));
});

await check("04-promote-pronoun", async () => {
  const r = await say(ADMIN, "خليه أدمن");
  assert.deepEqual(r.ops.map((o) => o.action), ["promote"]);
  assert.ok(isAdmin(AHMED_PN), "أصبح مشرفاً فعلاً");
  assert.ok(r.relays.some((x) => x.buttons.some((b) => /^terboo_act_/.test(b))), "زر تراجع واحد ذو معنى");
});

await check("05-members", async () => {
  const r = await say(ADMIN, "مين أعضاء الجروب؟");
  assert.match(r.replies, /أحمد/);
  assert.match(r.replies, /محمد سمير/);
  assert.match(r.replies, /Sara/);
  assert.match(r.replies, /\(9\)|9/, "العدد الحقيقي");
  assert.doesNotMatch(r.replies, /201688888888/, "لا أرقام كاملة في المجموعة");
  assert.equal(r.calls, 0);
});

await check("06-admins", async () => {
  const r = await say(ADMIN, "مين الأدمن؟");
  assert.match(r.replies, /مختبر/);
  assert.match(r.replies, /أحمد/, "المشرف الجديد ظاهر");
  assert.doesNotMatch(r.replies, /Sara/, "غير المشرف لا يظهر");
});

await check("07-presence", async () => {
  let r = await say(ADMIN, "أحمد موجود؟");
  assert.match(r.replies, /أيوه/);
  r = await say(ADMIN, "حسين موجود؟");
  assert.match(r.replies, /مش لاقي/, "لا اختراع لعضو غير موجود");
  r = await say(ADMIN, "كام عضو في الجروب؟");
  assert.match(r.replies, /9/);
});

await check("07b-demote-same-member", async () => {
  // V6 إلزامي 5: نفس العضو من السياق — «شيل منه الأدمن» بعد «خليه أدمن»
  const r = await say(ADMIN, "شيل منه الأدمن");
  assert.deepEqual(r.ops.map((o) => o.action), ["demote"], "خفض حقيقي واحد");
  assert.ok([AHMED_LID, AHMED_PN].includes(r.ops[0].jids[0]), "على نفس أحمد");
  assert.ok(!isAdmin(AHMED_PN), "لم يعد مشرفاً فعلاً");
  assert.equal(r.calls, 0, "بلا نداء نموذج");
});

await check("07c-owner-last-added-search", async () => {
  let r = await say(ADMIN, "مين صاحب الجروب؟");
  assert.match(r.replies, /مختبر/, "المالك الحقيقي من بيانات المجموعة");
  r = await say(ADMIN, "مين آخر واحد اتضاف؟");
  assert.match(r.replies, /أحمد/, "آخر من أُضيف (حدث/سياق حقيقي)");
  r = await say(ADMIN, "هات الأعضاء اللي اسمهم محمد");
  assert.match(r.replies, /محمد سمير/, "كل التطابقات القوية");
  assert.match(r.replies, /\(2\)|2/, "العدد الحقيقي للمطابقين");
  assert.doesNotMatch(r.replies, /Sara|كريم/, "لا أسماء غير مطابقة");
  r = await say(ADMIN, "هات الأعضاء اللي اسمهم حسين");
  assert.match(r.replies, /مفيش عضو/, "لا اختراع");
  assert.equal(r.ops.length, 0, "البحث لا ينفذ أي إجراء");
  // ترقيم الصفحات: السؤال يحمل رقم الصفحة، ولا تُرسل القائمة كلها دفعة واحدة
  assert.deepEqual(engine.parseDirectoryQuery("أعضاء الجروب صفحة 3"), { kind: "members", page: 3 });
  assert.deepEqual(engine.parseDirectoryQuery("members named Sara"), { kind: "search", name: "sara" });
});

await check("07d-follow-up-chain-and-repeat", async () => {
  // مثال الوثيقة: اطرده تاني ⇒ رجعه ⇒ خليه أدمن — كلها على نفس أحمد من السياق
  let r = await say(ADMIN, "اطرده تاني");
  assert.deepEqual(r.ops.map((o) => o.action), ["remove"], "«اطرده تاني» ⇒ طرد نفس الهدف");
  assert.ok(!isMember(AHMED_PN));
  // نص مختلف عن «رجعه» السابقة: حارس الحلقات يتجاهل نفس النص من نفس الشخص خلال 20 ثانية
  r = await say(ADMIN, "رجعه تاني");
  assert.deepEqual(r.ops.map((o) => o.action), ["add"], `«رجعه تاني»: ${r.replies}`);
  r = await say(ADMIN, "اعمله مشرف");
  assert.deepEqual(r.ops.map((o) => o.action), ["promote"]);
  // «نفس الحاجة لكريم» ⇒ آخر إجراء (ترقية) على هدف جديد بالاسم
  r = await say(ADMIN, "نفس الحاجة لكريم");
  assert.deepEqual(r.ops.map((o) => o.action), ["promote"], "تكرار آخر إجراء حقيقي");
  assert.deepEqual(r.ops[0].jids, [KAREEM], "على كريم");
  assert.ok(isAdmin(KAREEM));
  r = await say(ADMIN, "نزله من الأدمن");
  assert.deepEqual(r.ops[0]?.jids, [KAREEM], "الضمير = كريم (آخر هدف)");
  // «كررها مع أحمد» ⇒ خفض أحمد أيضاً
  r = await say(ADMIN, "كررها مع أحمد");
  assert.deepEqual(r.ops.map((o) => o.action), ["demote"]);
  assert.ok([AHMED_LID, AHMED_PN].includes(r.ops[0].jids[0]));
  assert.ok(!isAdmin(AHMED_PN) && !isAdmin(KAREEM), "الحالة عادت كما كانت");
  assert.equal(r.calls, 0, "بلا نداء نموذج");
  assert.deepEqual(engine.parseRepeat("اعمل نفس اللي عملناه"), { name: "" });
  assert.equal(engine.parseRepeat("أعدها"), null, "«أعدها» تخص المهام لا الأعضاء");
});

await check("12-unregistered-group-ai", async () => {
  assert.ok(!db.getUser(UNREG)?.isRegistered, "زائر غير مسجل");
  let r = await say(UNREG, "مين الأدمن؟");
  assert.match(r.replies, /الأدمنز|مختبر/, "الذكاء يجيب بلا تسجيل");
  r = await say(UNREG, "اطرد كريم من الجروب");
  assert.ok(r.ops.some((o) => o.action === "remove"), "أمر المجموعة يعمل لمشرف غير مسجل (الصلاحيات كما هي)");
  assert.doesNotMatch(r.replies, /التسجيل مطلوب/, "لا حجب بسبب التسجيل");
});

await check("23-no-fake-success", async () => {
  // واتساب رفض طرد كريم في الخطوة السابقة: العضو باقٍ ولا ادعاء نجاح
  assert.ok(isMember(KAREEM), "كريم ما زال عضواً (الطرد فشل فعلاً)");
  const r = await say(ADMIN, "اطرد كريم");
  assert.ok(isMember(KAREEM));
  assert.doesNotMatch(r.replies, /تم طرد|kicked/i, "لا نجاح وهمي");
});

await check("13-ambiguous-then-pick", async () => {
  let r = await say(ADMIN, "اطرد محمد");
  assert.equal(r.ops.length, 0, "لا تنفيذ عند الغموض");
  const pick = r.relays.find((x) => x.buttons.includes("terboo_pick_2"));
  assert.ok(pick, "اختيار واضح بين المحمدين");
  assert.match(pick.text, /محمد سمير/);
  r = await say(ADMIN, "", { button: "terboo_pick_2" });
  assert.deepEqual(r.ops.map((o) => o.action), ["remove"], "الضغط على الاختيار نفّذ الطرد");
  assert.deepEqual(r.ops[0].jids, [MOHAMED_2], "على الشخص المختار تحديداً");
  assert.ok(isMember(MOHAMED_1), "الآخر لم يُمس");
});

await check("15-pn-name-target", async () => {
  const r = await say(ADMIN, "اعمل الأدمن لمحمد");
  assert.deepEqual(r.ops.map((o) => o.action), ["promote"]);
  assert.ok(isAdmin(MOHAMED_1), "محمد (PN) أصبح مشرفاً");
});

await check("16-quoted-target", async () => {
  const r = await say(ADMIN, "خليها أدمن", { quotedFrom: SARA, quotedText: "مرحبا" });
  assert.deepEqual(r.ops.map((o) => o.action), ["promote"]);
  assert.ok(isAdmin(SARA), "الهدف من الرسالة المقتبسة");
});

await check("17-reply-to-bot-not-target", async () => {
  const r = await say(ADMIN, "شيل الأدمن منها", { quotedFrom: BOT_JID, quotedText: "تم" });
  assert.deepEqual(r.ops.map((o) => o.action), ["demote"], "الرد على البوت لا يجعله هدفاً");
  assert.ok(!isAdmin(SARA), "الهدف من السياق (سارة)");
  assert.ok(isAdmin(BOT_JID), "البوت لم يُمس");
});

await check("18-mention-target", async () => {
  const r = await say(ADMIN, `اطرد @${SARA.split("@")[0]}`, { mentions: [SARA] });
  assert.deepEqual(r.ops.map((o) => o.action), ["remove"]);
  assert.ok(!isMember(SARA));
});

await check("weak-cross-script-confirm", async () => {
  let r = await say(ADMIN, "اطرد Sameh");
  assert.equal(r.ops.length, 0);
  assert.match(r.replies, /مش لاقي/, "اسم غير موجود ⇒ صراحة");
  // الإضافة باسم إنجليزي لجهة اتصال عربية ⇒ تطابق ضعيف ⇒ تأكيد قبل التنفيذ
  participants = participants.filter((p) => !same(p, AHMED_PN));
  directory.applyParticipantsUpdate({ id: GROUP, participants: [{ id: AHMED_LID, phoneNumber: AHMED_PN }], action: "leave" });
  r = await say(ADMIN, "add Ahmed");
  assert.equal(r.ops.length, 0, "لا تنفيذ قبل التأكيد");
  assert.ok(r.relays.some((x) => x.buttons.includes("terboo_pick_1") && x.buttons.includes("terboo_pick_no")), "أيوه/لأ");
  r = await say(ADMIN, "", { button: "terboo_pick_1" });
  assert.deepEqual(r.ops.map((o) => o.action), ["add"]);
  assert.ok(isMember(AHMED_PN));
});

await check("workflow-one-message", async () => {
  const r = await say(ADMIN, "اطرد أحمد وبعدها رجعه");
  assert.deepEqual(r.ops.map((o) => o.action), ["remove", "add"], "خطوتان بالترتيب على نفس الهدف");
  assert.ok(isMember(AHMED_PN));
  assert.equal(r.calls, 0);
});

await check("workflow-burst", async () => {
  const parsed = ["ضيف أحمد", "وبعدها طرده", "وبعدين خليه أدمن"].flatMap(engine.splitSteps).map(engine.parseMemberStep);
  assert.deepEqual(parsed.map((x) => x.kind), ["add", "kick", "promote"], "دفعة الرسائل تُفهم كسلسلة واحدة");
  // نفس ما تمرره النواة: الرسالة الأخيرة + رسائل الدفعة السابقة غير المجاب عنها ⇒ قرار واحد بثلاث خطوات حقيقية
  participants = participants.filter((p) => !same(p, AHMED_PN));
  directory.applyParticipantsUpdate({ id: GROUP, participants: [{ id: AHMED_LID, phoneNumber: AHMED_PN }], action: "leave" });
  const { serialize } = await import("../src/lib/terboo-serialize.js");
  const m = await serialize(sock, groupMessage(ADMIN, "وبعدين رجعه"));
  const before = ops.length;
  const outcome = await engine.runActionEngine({ m, sock, text: "وبعدين رجعه", lang: "ar", burst: ["ضيف أحمد", "وبعدها طرده"] });
  assert.equal(outcome, "answered");
  assert.deepEqual(ops.slice(before).map((o) => o.action), ["add", "remove", "add"], "ثلاث خطوات بالترتيب على نفس الهدف");
  assert.ok(isMember(AHMED_PN));
});

await check("member-without-permission", async () => {
  const r = await say(MEMBER, "اطرد محمد سمير");
  assert.equal(r.ops.length, 0, "عضو عادي لا يطرد (الصلاحيات لا تُتجاوز)");
});

await check("19-20-task-cancel-resume", async () => {
  tasks.registerTaskRunner("agent.workflow", async ({ signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ ok: true, summary: "done" }), 60_000);
    signal?.addEventListener?.("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("aborted"), { code: "TASK_CANCELLED" })); });
  }));
  const owner = identityOf(ADMIN).canonical;
  const job = tasks.enqueueTask({ type: "agent.workflow", title: "مهمة طويلة", owner, scope: GROUP, run: async (c) => (await import("../src/lib/terboo-task-queue.js")) && new Promise((resolve, reject) => { c.signal?.addEventListener?.("abort", () => reject(Object.assign(new Error("aborted"), { code: "TASK_CANCELLED" }))); }), persist: true, resumable: true });
  await new Promise((r) => setTimeout(r, 30));
  let r = await say(ADMIN, "وقفها");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(tasks.getTask(job.id)?.status, "cancelled", "«وقفها» ألغت المهمة الحالية فعلاً");
  assert.match(r.replies, /مهمة طويلة|أوقف|ألغ/);
  r = await say(ADMIN, "كملها");
  const resumed = tasks.listTasks({ owner, scope: GROUP, limit: 5 }).find((x) => x.id !== job.id);
  assert.ok(resumed, "«كملها» استأنفت المهمة بمهمة جديدة من نقطتها");
  tasks.cancelTask(resumed.id, null, "test-end");
});

await check("21-ai-follow-up", async () => {
  const r = await say(ADMIN, "اشرحلي ازاي احفظ ملف");
  assert.ok(r.calls >= 1, "سؤال مفتوح يذهب للنموذج");
  const r2 = await say(ADMIN, "كمل");
  assert.ok(r2.calls >= 1);
  const last = providerCalls.at(-1);
  assert.match(String(last.instruction), /CONTINUE|Working context/, "المتابعة تصل للنموذج مع السياق");
});

await check("22-multimodal-follow-up", async () => {
  await say(ADMIN, "حلل الصورة دي", { image: true });
  assert.ok(ctx.recall(fakeM(ADMIN), "image"), "سياق: آخر صورة");
  const brief = ctx.brief(fakeM(ADMIN));
  assert.ok(brief.image && brief.member, "السياق يحفظ الصورة وآخر عضو معاً");
});

console.log(`✅ terboo-ai-agent-actions: ${results.length} سيناريو حقيقي — ${results.join(" · ")}`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* مجلد مؤقت */ }
process.exit(0);
