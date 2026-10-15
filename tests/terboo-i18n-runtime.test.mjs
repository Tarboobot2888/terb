// اختبار الترجمة عند الإرسال (§30/§31/§36) ومترجم الكلمات الفرعية:
// تغطية كاملة للكتالوجات، قوالب بعناصر نائبة، قوالب config.js المعبّأة،
// الزخرفة، الكود، RAW، المصدر الإندونيسي، الأزرار، لغة المستلم، التثبيت على المقبس،
// وتحويل on/delete/list… إلى الكلمة العربية التي يفهمها البلوقن.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const runtime = await import("../src/lib/terboo-i18n/runtime.js");
const { canonicalArg, localizeCommandArgs } = await import("../src/lib/terboo-i18n/args.js");
const { distinctUnits, extractUnits } = await import("../tools/terboo-i18n-extract.mjs");
const { storeField, storeType, isUnlimitedStock } = await import("../src/lib/terboo-store-i18n.js");
const config = (await import("../config.js")).default;
const te = (await import("../src/lib/terboo-error.js")).default;
const { translateText, markRaw, localizeNode, recipientLanguage, installLocalization } = runtime;

const ROOT = process.cwd();
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const catalogs = { ar: read("src/lib/terboo-i18n/catalog/ar.json"), en: read("src/lib/terboo-i18n/catalog/en.json") };

// ── 1. كل نص معروض مستخرج له ترجمة بنفس العناصر النائبة (أو استثناء موثّق) ──
const exceptions = read("tools/i18n/exceptions.json");
const excepted = new Map(exceptions.entries.map((entry) => [entry.key, entry]));
const holes = (text) => (String(text).match(/\{\d+\}/g) || []).sort().join(",");
const units = distinctUnits(extractUnits());
assert.ok(units.length > 10000, `عدد الوحدات المستخرجة غير منطقي: ${units.length}`);
let missing = 0;
for (const unit of units) {
  if (excepted.has(unit.key)) {
    const entry = excepted.get(unit.key);
    assert.ok(exceptions.reasons[entry.reason], `استثناء بلا سبب موثّق: ${unit.key.slice(0, 40)}`);
    assert.ok(unit.refs.every((ref) => entry.files.some((file) => ref.startsWith(`${file}:`))), `استثناء خارج ملفاته: ${unit.refs[0]}`);
    continue;
  }
  for (const lang of unit.lang === "ar" ? ["en"] : ["ar", "en"]) {
    const value = catalogs[lang][unit.key];
    if (typeof value !== "string" || !value.trim()) { missing++; continue; }
    assert.equal(holes(value), holes(unit.key), `عناصر نائبة مختلفة (${lang}): ${unit.key}`);
  }
}
assert.equal(missing, 0, `وحدات بلا ترجمة: ${missing}`);
assert.ok(exceptions.entries.length <= 30, "الاستثناءات يجب أن تبقى محدودة وموثّقة");
assert.ok(exceptions.entries.every((entry) => entry.files.every((file) => /^plugins\/owner\/(امك|تحفيل)\.js$/.test(file))), "الاستثناءات محصورة في أوامر التحفيل");

// ── 2. المستخرج لا يعدّ بيانات الإدخال نصوصاً معروضة، ويقرأ نصوص config.js ──
const keys = new Set(units.map((unit) => unit.key));
for (const inputOnly of ["انقرالرابط", "اسمي", "هنعمل", "(?<![\\p{L}\\p{N}])[وف]?", "Bearer {0}", "status@broadcast", "starseed-main"]) {
  assert.ok(!keys.has(inputOnly), `بيانات إدخال/تقنية عُدّت نصاً معروضاً: ${inputOnly}`);
}
for (const shown of ["وصول مرفوض!* هذه الميزة لمالك البوت فقط.", "منع الروابط* — @{0} أرسل رابط.", "يبدو أن الأمر {0}{1} يواجه مشكلة", "انتظر!* أنت في فترة تبريد. انتظر {0} ثانية."]) {
  assert.ok(keys.has(shown), `نص معروض من config.js لم يُستخرج: ${shown}`);
}

// ── 3. ترجمة الأسطر: قوالب، زخرفة، مطابقة تامة قبل القوالب الفضفاضة ──
assert.equal(translateText(config.messages.success, "en"), "✅ *Done!* Your request is complete.");
assert.equal(translateText(config.messages.success, "ar"), config.messages.success, "العربية تبقى كما هي");
assert.equal(translateText(config.messages.ownerOnly, "en"), "*⛔ Access denied!* This feature is for the bot owner only.");
// قوالب config.js بعد تعبئة %user% / %time% / {amount}
assert.equal(translateText(config.groupProtection.antilink.replace(/%user%/g, "201234567890"), "en"), "⚠ *Link blocker* — @201234567890 sent a link.\nThe message was deleted.");
// قيمة داخل قالب هي نفسها قالب معروف («5 دقيقة» ← «5 minutes»)
assert.equal(translateText("> المتبقي: *5 دقيقة*", "en"), "> Remaining: *5 minutes*");
// مصدر إندونيسي قديم يُعرض بلغة المستخدم، والعربية أيضاً
assert.equal(translateText("> Grup dibuka otomatis sesuai jadwal.", "ar"), "> تم فتح المجموعة تلقائياً حسب الجدول.");
assert.equal(translateText("> Grup dibuka otomatis sesuai jadwal.", "en"), "> The group was opened automatically on schedule.");
// الكود وRAW لا يُمسّان
assert.equal(translateText("```\nتم بنجاح!\n```", "en"), "```\nتم بنجاح!\n```");
assert.equal(translateText(markRaw("تم بنجاح!"), "en"), "تم بنجاح!", "نص الذكاء/المستخدم المعلَّم RAW لا يُترجم");
assert.equal(translateText("سطر لا يعرفه الكتالوج إطلاقاً 12345", "en"), "سطر لا يعرفه الكتالوج إطلاقاً 12345", "النص المجهول يبقى كما هو");

// ── 4. الأزرار: النص المعروض يُترجم، والمعرّفات لا ──
const buttons = { interactiveMessage: { body: { text: "اختر فيلماً من القائمة" }, nativeFlowMessage: { buttons: [{ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "التالي", id: ".فيلم التالي" }) }] } } };
localizeNode(buttons, "en");
assert.equal(buttons.interactiveMessage.body.text, "Choose a movie from the list");
const params = JSON.parse(buttons.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson);
assert.equal(params.display_text, "Next");
assert.equal(params.id, ".فيلم التالي", "معرّف الزر لا يُترجم");

// ── 5. لغة المستلم: المقتبَس في المجموعة، الخاص، لغة المجموعة، الافتراضي ──
const db = {
  getUser: (jid) => ({ "a@s.whatsapp.net": { language: "en" }, "b@s.whatsapp.net": { language: "en" } })[jid],
  getGroup: (jid) => ({ "g@g.us": { language: "en" } })[jid],
};
assert.equal(recipientLanguage("g@g.us", { quoted: { sender: "a@s.whatsapp.net" } }, db), "en", "في المجموعة: لغة صاحب الرسالة المقتبسة");
assert.equal(recipientLanguage("b@s.whatsapp.net", {}, db), "en", "الخاص: لغة المستخدم");
assert.equal(recipientLanguage("g@g.us", {}, db), "en", "بلا اقتباس: لغة المجموعة");
assert.equal(recipientLanguage("x@s.whatsapp.net", {}, db), "ar", "الافتراضي عربي");
assert.equal(recipientLanguage("x@s.whatsapp.net", { terbooLang: "en" }, db), "en", "لغة صريحة من المرسل");

// ── 6. التثبيت على المقبس: sendMessage و relayMessage ──
const sent = [];
const sock = {
  sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { ok: true }; },
  relayMessage: async (jid, message) => { sent.push({ jid, message }); return { ok: true }; },
};
installLocalization(sock, { getDatabase: () => db });
installLocalization(sock, { getDatabase: () => db });
await sock.sendMessage("a@s.whatsapp.net", { text: config.messages.groupOnly }, { terbooLang: undefined });
assert.equal(sent[0].content.text, "👥 *Groups only!* This feature only works inside groups.");
assert.ok(!("terbooLang" in sent[0].options), "خيار terbooLang لا يصل لواتساب");
await sock.relayMessage("g@g.us", { extendedTextMessage: { text: "تم حذف الرسالة.", contextInfo: { stanzaId: "X", participant: "b@s.whatsapp.net" } } });
assert.equal(sent[1].message.extendedTextMessage.text, "The message was deleted.", "relay يترجم للغة صاحب الرسالة المقتبسة");

// ── 7. الكلمات الفرعية بالإنجليزية/الإسبانية ← الكلمة العربية التي يقارن بها البلوقن ──
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const market = src("plugins/store/market.js");
assert.equal(canonicalArg("sell", market), "عرض");
assert.equal(canonicalArg("vender", market), "عرض");
assert.equal(canonicalArg("buy", market), "شراء");
assert.equal(canonicalArg("list", market), "قائمة");
const mail = src("plugins/tools/بريد.js");
assert.equal(canonicalArg("messages", mail), "رسائل", "startsWith('رسائل') يُعدّ مقارنة");
assert.equal(canonicalArg("borrar", mail), "حذف");
assert.equal(canonicalArg("on", src("plugins/user/levelup.js")), null, "البلوقن يقبل on أصلاً فلا تحويل");

const plugin = { filePath: path.join(ROOT, "plugins/tools/بريد.js") };
const m = { args: ["messages", "0"], text: "messages 0", fullArgs: "messages 0", body: ".بريد messages 0", prefix: ".", command: "بريد" };
assert.deepEqual(localizeCommandArgs(m, plugin).map((c) => c.to), ["رسائل"]);
assert.deepEqual(m.args, ["رسائل", "0"]);
assert.equal(m.text, "رسائل 0");
assert.equal(m.body, ".بريد رسائل 0");

// نص حر لا يُمس (ترجم: اللغة ثم النص)
const translatePlugin = { filePath: path.join(ROOT, "plugins/tools/ترجم.js") };
const free = { args: ["en", "delete", "everything"], text: "en delete everything" };
localizeCommandArgs(free, translatePlugin);
assert.deepEqual(free.args, ["en", "delete", "everything"], "لا تحويل حين لا يقارن البلوقن بالكلمة العربية");

// وحدات الوقت: 5m ← 5د حين يفهم البلوقن الوحدات العربية فقط
const muteSource = src("plugins/group/كتم.js");
if (/د\|س\|ي/.test(muteSource)) {
  const mute = { args: ["@x", "5m"], text: "@x 5m" };
  localizeCommandArgs(mute, { filePath: path.join(ROOT, "plugins/group/كتم.js") });
  assert.equal(mute.args[1], "5د");
}

// ── 8. حقول المتجر بثلاث لغات ──
assert.equal(storeField("price"), "سعر");
assert.equal(storeField("precio_original"), "سعر_أصلي");
assert.equal(storeField("inventario"), "مخزون");
assert.equal(storeType("Físico"), "مادي");
assert.equal(storeType("digital"), "رقمي");
assert.equal(storeType("??"), null);
assert.ok(isUnlimitedStock("ilimitado") && isUnlimitedStock("غير محدود") && isUnlimitedStock("unlimited"));

// ── 9. نصوص الصور بلغة المستلم (الترجمة عند الإرسال لا تصل للصورة) ──
const { canvasText, CANVAS_TEXT } = await import("../src/lib/terboo-canvas-i18n.js");
for (const [key, entry] of Object.entries(CANVAS_TEXT)) {
  for (const lang of ["ar", "en"]) assert.ok(entry[lang], `نص صورة بلا ترجمة: ${key}/${lang}`);
  assert.equal(holes(entry.ar), holes(entry.en), `عناصر نائبة مختلفة: ${key}`);
}
assert.equal(canvasText("ar", "levelUp"), "ارتقيت مستوى!");
assert.equal(canvasText("xx", "welcome"), "أهلاً بك", "لغة غير مدعومة ← العربية");
const welcomeSource = fs.readFileSync(path.join(ROOT, "src/lib/terboo-welcome-card.js"), "utf8");
assert.ok(!/Bergabung|Meninggalkan|"WELCOME"|"GOODBYE"|NEW USER|DISCONNECTED/.test(welcomeSource), "لا نص ثابت داخل بطاقات الترحيب");
const { createWideDiscordCard } = await import("../src/lib/terboo-welcome-card.js");
for (const lang of ["ar", "en"]) {
  const png = await createWideDiscordCard("Ahmed", "", "Terboo", "7", lang);
  assert.ok(Buffer.isBuffer(png) && png.length > 10_000, `بطاقة ترحيب فارغة (${lang})`);
}

console.log(`✅ i18n runtime: ${units.length} وحدة مغطاة (${exceptions.entries.length} استثناء موثّق)، قوالب/زخرفة/RAW/أزرار/لغة المستلم/المقبس/الكلمات الفرعية/المتجر/نصوص الصور`);
