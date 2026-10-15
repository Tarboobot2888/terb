// سلوك «الرد الدائم» في Auto AI — اختبار سلوكي على الدوال الحقيقية
// (بدل البحث عن نصوص تنفيذ قديمة داخل الكود المصدري).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-autoai-reply-"));
const { initDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);

const { shouldAutoAIReply, getReplyPolicy, describeAutoAISkip } = await import("../src/lib/terboo-auto-ai.js");
const plugin = await import("../plugins/group/autoai.js");

const persona = { name: "Terboo", instruction: "x" };

// ① التفعيل الافتراضي = رد دائم (يُخزَّن كما هو) — لكنه يسري على الخاص فقط.
// v4 §23 (تغيير سلوك موثّق في التقرير): داخل المجموعات لا رد على المحادثة العامة أبداً؛
// منشن البوت أو الرد على رسالته أو بدء الرسالة بـ«تيربو» فقط، أياً كان الوضع المخزّن.
const defaults = plugin.createAutoAIConfig({ persona, key: "terboo", responseType: "text", mode: "assistant", sender: "201000000001@s.whatsapp.net" });
assert.equal(defaults.alwaysReply, true, "الافتراضي هو الرد الدائم");
assert.equal(defaults.replyMode, "all");
assert.equal(defaults.replyScope, "groups");
assert.equal(shouldAutoAIReply({ autoai: defaults, isGroup: true }).allowed, false, "لا رد على المحادثة العامة في المجموعة (v4 §23)");
assert.equal(shouldAutoAIReply({ autoai: defaults, isGroup: true }).reason, "mention-or-reply");
assert.equal(shouldAutoAIReply({ autoai: defaults, isGroup: true, isMentioned: true }).allowed, true, "يرد في المجموعة عند المنشن/«تيربو»");
assert.equal(shouldAutoAIReply({ autoai: defaults, isGroup: true, isBotQuoted: true }).allowed, true, "يرد في المجموعة عند الرد على رسالته");
const everywhere = plugin.createAutoAIConfig({ persona, key: "terboo", responseType: "text", mode: "assistant", replyScope: "كل", sender: "x" });
assert.equal(shouldAutoAIReply({ autoai: everywhere, isGroup: false }).allowed, true, "الرد الدائم يبقى في الخاص بلا منشن");

// ② وضع المنشن يعطّل الرد الدائم
const mentionOnly = plugin.createAutoAIConfig({ persona, key: "terboo", responseType: "text", mode: "assistant", replyMode: "منشن", sender: "x" });
assert.equal(mentionOnly.alwaysReply, false, "المنشن يعطّل الرد الدائم");
assert.equal(shouldAutoAIReply({ autoai: mentionOnly, isGroup: true }).reason, "mention-or-reply");
assert.equal(shouldAutoAIReply({ autoai: mentionOnly, isGroup: true, isMentioned: true }).allowed, true, "يرد عند المنشن");
assert.equal(shouldAutoAIReply({ autoai: mentionOnly, isGroup: true, isBotQuoted: true }).allowed, true, "يرد عند الرد على رسالته");

// ③ توافق مع الإعدادات القديمة المخزّنة: alwaysReply=false بلا replyMode
assert.equal(getReplyPolicy({ alwaysReply: false }, true).replyMode, "mention", "الإعداد القديم يُفهم كمنشن");
assert.equal(getReplyPolicy({}, true).replyMode, "mention", "المجموعات دائماً منشن/رد/اسم (v4 §23)");
assert.equal(getReplyPolicy({}, true).requestedMode, "all", "الإعداد المخزّن نفسه لا يُمس");
assert.equal(getReplyPolicy({}, false).replyMode, "all", "الخاص: رد دائم");

// ④ النطاق يُحترم
const privateOnly = plugin.createAutoAIConfig({ persona, key: "terboo", responseType: "text", mode: "assistant", replyScope: "خاص", sender: "x" });
assert.equal(shouldAutoAIReply({ autoai: privateOnly, isGroup: true }).reason, "scope", "نطاق الخاص لا يرد في المجموعات");
assert.equal(shouldAutoAIReply({ autoai: privateOnly, isGroup: false }).allowed, true);

// ⑤ لوحة الحالة تعرض الوضع الفعلي وسبب الرفض
const status = plugin.formatAutoAIStatus({ ...mentionOnly, enabled: true });
assert.match(status, /حالة Auto AI/);
assert.match(status, /منشن البوت أو الرد عليه/, "لوحة الحالة تذكر أن الرد الدائم معطّل");
assert.match(describeAutoAISkip("mention-or-reply"), /المنشن/);

// ⑥ خيارات سطر الأوامر: الاسم الجديد --persona والقديم ما زالا مقبولين
assert.equal(plugin.parseAutoAIOptions("--persona=furina").character, "furina");
assert.equal(plugin.parseAutoAIOptions("--maromode=furina").character, "furina", "الخيار القديم ما زال مقبولاً");
assert.equal(plugin.parseAutoAIOptions("--tarboomode=furina").character, "furina", "خيار الإصدار السابق ما زال مقبولاً");
assert.equal(plugin.parseAutoAIOptions("--terboomode=furina").character, "furina", "الخيار الجديد مقبول");
assert.equal(plugin.parseAutoAIOptions("--رد=منشن").replyMode, "mention");
assert.equal(plugin.parseAutoAIOptions("").replyMode, "all", "بلا خيار: رد دائم");

console.log("auto ai always reply tests: passed");
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
