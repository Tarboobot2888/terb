// اختبار المساعد الذكي في Bot Terboo
// يغطي: شروط التشغيل، ترتيب الأوامر محلياً، احترام الصلاحيات،
// تحليل رد النموذج، وإعادة كتابة الرسالة كأمر حقيقي.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-ai-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmpDb);
const db = getDatabase();

const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));

const ai = await import("../src/lib/terboo-ai-assistant.js");

const BOT = "2348093093240";
const sock = {
  user: { id: `${BOT}:12@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net` },
};

function makeMessage(overrides = {}) {
  const sender = overrides.sender || "201000000001";
  const jid = `${sender}@s.whatsapp.net`;
  return {
    sender: jid,
    chat: overrides.isGroup ? "1-2@g.us" : jid,
    body: "",
    type: "conversation",
    isCommand: false,
    command: "",
    prefix: ".",
    args: [],
    isGroup: false,
    isOwner: false,
    isPremium: false,
    isPartner: false,
    isAdmin: false,
    isBot: false,
    fromMe: false,
    isNewsletter: false,
    mentionedJid: [],
    quoted: null,
    replies: [],
    async reply(text) { this.replies.push(String(text)); return { key: { id: "r" } }; },
    async react() {},
    ...overrides,
  };
}

// ── شروط التشغيل ─────────────────────────────────────────
{
  const groupPlain = makeMessage({ body: "مرحبا يا شباب", isGroup: true });
  assert.equal(ai.shouldEngage(groupPlain, sock).engaged, false, "رسالة عادية في المجموعة لا تُشغّل المساعد");

  const privatePlain = makeMessage({ body: "ازيك عامل ايه" });
  assert.equal(ai.shouldEngage(privatePlain, sock).reason, "private", "الخاص: مخاطبة مباشرة بلا بادئة تُشغّل المساعد");

  const cmd = makeMessage({ body: ".menu", isCommand: true, command: "menu" });
  assert.equal(ai.shouldEngage(cmd, sock).engaged, false, "الأوامر الصريحة لا تمر على المساعد");

  const replyToBot = makeMessage({ body: "اطرد الشخص ده", quoted: { key: { fromMe: true } } });
  assert.equal(ai.shouldEngage(replyToBot, sock).reason, "reply", "الرد على رسالة البوت يُشغّل المساعد");

  const replyToOther = makeMessage({ body: "شوف كده", isGroup: true, quoted: { key: { fromMe: false } } });
  assert.equal(ai.shouldEngage(replyToOther, sock).engaged, false, "في المجموعة: الرد على شخص آخر لا يُشغّل المساعد");

  const mentionJid = makeMessage({
    body: "@2348093093240 اعرض القائمة",
    isGroup: true,
    mentionedJid: [`${BOT}@s.whatsapp.net`],
  });
  assert.equal(ai.shouldEngage(mentionJid, sock).reason, "mention", "الإشارة للبوت في مجموعة تُشغّل المساعد");

  const mentionText = makeMessage({ body: `@${BOT} ازيك`, isGroup: true });
  assert.equal(ai.shouldEngage(mentionText, sock).reason, "mention", "الإشارة النصية تُشغّل المساعد");

  const groupMentionOther = makeMessage({ body: "@201999 شوف كده", isGroup: true, mentionedJid: ["201999@s.whatsapp.net"] });
  assert.equal(ai.shouldEngage(groupMentionOther, sock).engaged, false, "الإشارة لشخص آخر لا تُشغّل المساعد");

  const fromBot = makeMessage({ body: "test", fromMe: true, quoted: { key: { fromMe: true } } });
  assert.equal(ai.shouldEngage(fromBot, sock).engaged, false, "رسائل البوت نفسه مستثناة");
}

// ── فهرس الأوامر ─────────────────────────────────────────
{
  const catalog = ai.buildCommandCatalog();
  assert.ok(catalog.length > 500, `يجب أن يشمل الفهرس كل الأوامر (وجد ${catalog.length})`);
  const names = new Set(catalog.map((e) => e.name));
  for (const expected of ["menu", "daftar", "لغة"]) {
    assert.ok(names.has(expected), `الفهرس يجب أن يحوي الأمر ${expected}`);
  }
}

// ── الترتيب المحلي يحترم الصلاحيات ───────────────────────
{
  const member = makeMessage({ body: "عايز اشوف قائمة الاوامر" });
  const ranked = ai.rankCommands("عايز اشوف قائمة الاوامر", member);
  assert.ok(ranked.length > 0, "يجب إيجاد مرشحين لطلب القائمة");
  assert.ok(
    ranked.every(({ entry }) => !entry.isOwner),
    "لا يجوز ترشيح أوامر المالك لمستخدم عادي",
  );

  const owner = makeMessage({ body: "restart", isOwner: true });
  const ownerRanked = ai.rankCommands("اعد تشغيل البوت", owner);
  assert.ok(Array.isArray(ownerRanked), "الترتيب يعمل للمالك أيضاً");

  const groupOnly = ai.rankCommands("اطرد العضو", makeMessage({ body: "اطرد" }));
  assert.ok(
    groupOnly.every(({ entry }) => !(entry.isGroup && !entry.isPrivate)),
    "أوامر المجموعات لا تُرشَّح في الخاص",
  );
}

// ── الترتيب يجد الأمر الصحيح بالاسم المباشر ──────────────
{
  const m = makeMessage({ body: "menu" });
  const ranked = ai.rankCommands("menu", m);
  assert.equal(ranked[0].entry.name, "menu", "التطابق المباشر يجب أن يتصدر");
  assert.ok(ranked[0].score >= 8, "التطابق المباشر يحصل على ثقة عالية");
}

// ── تحليل رد النموذج ─────────────────────────────────────
{
  const cases = [
    ['{"action":"command","command":"menu","args":"","reply":"حاضر","confidence":0.9}', "menu"],
    ['```json\n{"action":"command","command":"kick","args":"@201","reply":"ok","confidence":0.8}\n```', "kick"],
    ['تمام، إليك النتيجة:\n{"action":"chat","command":"","args":"","reply":"أهلاً","confidence":0.4}', ""],
  ];
  for (const [raw, expected] of cases) {
    const parsed = ai.parseModelJson(raw);
    assert.ok(parsed, `يجب تحليل: ${raw.slice(0, 30)}`);
    assert.equal(parsed.command, expected);
  }
  assert.equal(ai.parseModelJson("نص بلا JSON"), null, "نص بلا JSON يعود null");
  assert.equal(ai.parseModelJson(""), null, "نص فارغ يعود null");
}

// ── إعادة الكتابة كأمر حقيقي ─────────────────────────────
{
  const m = makeMessage({ body: "اعرض القائمة" });
  const ok = await ai.rewriteAsCommand(m, "menu", "");
  assert.equal(ok, true, "يجب نجاح إعادة الكتابة");
  assert.equal(m.isCommand, true, "الرسالة أصبحت أمراً");
  assert.equal(m.command, "menu", "اسم الأمر صحيح");
  assert.equal(m.aiRouted, true, "توضع علامة أن المساعد هو من وجّه الأمر");

  const m2 = makeMessage({ body: "اطرد" });
  await ai.rewriteAsCommand(m2, "kick", "@201000000002");
  assert.equal(m2.command, "kick");
  assert.deepEqual(m2.args, ["@201000000002"], "الوسائط تُمرَّر كما هي");
}

// ── المساعد لا يتدخل عند تعطيله ──────────────────────────
{
  db.setting("aiAssistant", false);
  const m = makeMessage({ body: "اعرض القائمة", quoted: { key: { fromMe: true } } });
  const result = await ai.handleAiAssistant(m, sock, db);
  assert.equal(result, false, "المساعد معطّل يجب ألا يتدخل");
  assert.equal(m.replies.length, 0, "ولا يرسل أي رسالة");
  db.setting("aiAssistant", true);
}

// ── حراسة الجلسات: لا نقاطع تسجيلاً جارياً ──────────────
{
  global.registrationSessions = global.registrationSessions || {};
  global.registrationSessions["201000000055"] = { step: "name", chatJid: "201000000055@s.whatsapp.net" };
  const m = makeMessage({ sender: "201000000055", body: "Mahmoud" });
  assert.equal(ai.shouldEngage(m, sock).engaged, false, "المساعد لا يقاطع جلسة تسجيل نشطة");
  delete global.registrationSessions["201000000055"];
}

// ── استخراج الهدف من الإشارة أو الرد ────────────────────
{
  const byMention = makeMessage({ isGroup: true, mentionedJid: ["201000000077@s.whatsapp.net"] });
  assert.equal(ai.resolveTarget(byMention, ""), "@201000000077", "الهدف يُستخرج من الإشارة");

  const byQuote = makeMessage({ isGroup: true, quoted: { key: { fromMe: false }, senderNumber: "201000000088" } });
  assert.equal(ai.resolveTarget(byQuote, ""), "@201000000088", "الهدف يُستخرج من الرسالة المقتبسة");

  const explicit = makeMessage({ isGroup: true });
  assert.equal(ai.resolveTarget(explicit, "@201000000099"), "@201000000099", "الهدف الصريح يبقى كما هو");

  const none = makeMessage({ isGroup: true });
  assert.equal(ai.resolveTarget(none, ""), "", "بلا هدف يعود فارغاً");
}

// ── أمان: لا تنفيذ على هدف غير محدد ─────────────────────
{
  const kickEntry = ai.buildCommandCatalog().find((e) => e.name === "طرد" || e.aliases.includes("kick"));
  assert.ok(kickEntry, "يوجد أمر طرد في الفهرس");
  assert.ok(ai.needsTarget(kickEntry), "أمر الطرد يحتاج هدفاً");

  const m = makeMessage({ isGroup: true, isAdmin: true, isBotAdmin: true });
  const blocked = ai.preflight(kickEntry, m, "");
  assert.equal(blocked.ok, false, "بلا هدف: لا ينفّذ");
  assert.equal(blocked.reasonKey, "assistant.needTarget", "ويطلب تحديد الهدف");

  const allowed = ai.preflight(kickEntry, m, "@201000000077");
  assert.equal(allowed.ok, true, "مع هدف واضح: ينفّذ");
}

// ── أمان: البوت ليس مشرفاً ──────────────────────────────
{
  const kickEntry = ai.buildCommandCatalog().find((e) => e.name === "طرد" || e.aliases.includes("kick"));
  const m = makeMessage({ isGroup: true, isAdmin: true, isBotAdmin: false });
  const result = ai.preflight(kickEntry, m, "@201000000077");
  assert.equal(result.ok, false, "البوت غير مشرف: لا يحاول التنفيذ");
  assert.equal(result.reasonKey, "assistant.botNotAdmin");
}

// ── مطابقة دلالية: صياغة طبيعية بلا اسم أمر ─────────────
{
  const expectations = [
    ["ممكن تشيل الشخص ده من الجروب؟", true, ["طرد", "kick"]],
    ["خلي أحمد مشرف", true, ["ترقية", "promote"]],
    ["اعرض البروفايل بتاعي", false, ["بروفايل", "profile"]],
    ["ابعت القائمة", false, ["menu"]],
  ];
  for (const [text, isGroup, expected] of expectations) {
    const m = makeMessage({ body: text, isGroup, isAdmin: true });
    const ranked = ai.rankCommands(text, m);
    assert.ok(ranked.length > 0, `لا مرشح لـ: ${text}`);
    const top = ranked[0].entry;
    const hit = expected.some((name) => top.name === name || top.aliases.includes(name));
    assert.ok(hit, `«${text}» أعطى ${top.name} بدل ${expected.join("/")}`);
  }
}

console.log("✅ terboo-ai-assistant: كل الاختبارات نجحت");
try { fs.rmSync(tmpDb, { recursive: true, force: true }); } catch {}
process.exit(0);
