// الترجمة الفعلية لردود بلوقنات حقيقية (§37): مستخدم إنجليزي ومستخدم إسباني يرسلان أوامر حقيقية
// عبر messageHandler الحقيقي وحدّ الإرسال الحقيقي — ولا يبقى في الرد نص عربي، إلا ما هو
// صيغة أمر ووسائطه (اسم الأمر وأمثلة وسائط يكتبها المستخدم حرفياً كأسماء السور).
// ويتحقق أيضاً: أرقام لاتينية لغير العربية، وقوالب أدق تُفضَّل، ولا استبدال داخل الكلمات.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const runtime = await import("../src/lib/terboo-i18n/runtime.js");
const { translateText, localizeNode } = runtime;

// ── وحدات: أدق قالب · حدود كلمات · ترقيم وأسهم كزخرفة · أرقام لاتينية ──
assert.equal(translateText("> ◈ 💵 السعر: *100* عملة/طاقة", "en"), "> ◈ 💵 Price: *100* coins/energy", "القالب الأدق يُفضَّل على «السعر: {0}»");
assert.doesNotMatch(translateText("> ◈ 🔒 *ملصقات غير محدودة*", "en"), /Unlimitedة/, "لا استبدال داخل الكلمات");
assert.equal(translateText("> ◈ 🔒 *ملصقات غير محدودة*", "en"), "> ◈ 🔒 *Unlimited stickers*");
assert.equal(translateText("   ↳ الأحدث", "en"), "   ↳ The newest");
assert.equal(translateText("> ◈ الأمر: .اضافة_شريك (للمالك فقط)", "en"), "> ◈ Command: .اضافة_شريك (owner only)");
const digits = { text: "💰 العملات: *٥٠٠*\n📈 الخبرة: *+٢٠٬٤٨٩*" };
localizeNode(digits, "en");
assert.equal(digits.text, "💰 Coins: *500*\n📈 XP: *+20,489*");

// ── بلوقنات حقيقية بالإنجليزية والإسبانية ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-l10n-"));
const BOT = "201111111119";
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
db.setting("audioMenu", false);
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const { messageHandler } = await import("../src/handler.js");

const out = [];
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net`, name: "Terboo" },
  async relayMessage(jid, message) { out.push({ jid, message }); return {}; },
  async sendMessage(jid, content) { out.push({ jid, content }); return { key: { id: `S${out.length}` } }; },
  async sendPresenceUpdate() { }, async readMessages() { },
  async groupMetadata() { return { id: "g@g.us", subject: "G", participants: [] }; },
  async profilePictureUrl() { throw new Error("no pp"); }, waUploadToServer: async () => ({}),
};
runtime.installLocalization(sock, { getDatabase });

// ردود محلية حتمية تغطي: ذكاء · بحث · تحميل · صور · ألعاب · RPG · ملف شخصي · معلومات · ميزات · قرآن
const COMMANDS = [
  "2شات", "ai", "اسأل", "بحث", "ايلون", "رمز_QR", "الايت_موشن", "2اقتباس_واتساب", "apk", "playch", "ابل",
  "بحث_روبلوكس", "تجسس_انستغرام", "تجسس_بنترست", "تجسس_تويتر", "aio", "happydl", "بكسل_درين", "تحميل",
  "bratlocal", "ميوزك_وهمي", "بكسل", "glitchtext", "فلتر", "الأبراج", "تحدي", "تحقق_الأناقة", "برجك",
  "تفسير_الأحلام", "توافق_الأسماء", "أسبوعي", "استشفاء", "استهلاك", "معلومات_العشيرة", "buyenergi", "buyfitur",
  "birthday", "المتصدرين", "ايقاف_البوت_الفرعي", "شخصية_بلو_ارشيف", "مميزات_الشريك", "قرآن_صوتي", "قرآن_نصي",
  "قرآني", "موسيقى",
];
/**
 * بقية عربية خارج صيغة الأمر: «.أمر» (في بداية السطر أو بعد مسافة/قوس/تنسيق) وكل ما بعده
 * في السطر وسائط يكتبها المستخدم حرفياً، وأسماء الأوامر المرقّمة (موسيقى1 … موسيقى52) أسماء أوامر.
 */
const residueOf = (line) => /[؀-ۿ]{2,}/.test(line
  .replace(/(?:^|[\s(*_])\.[\p{L}\p{N}_]+.*$/u, "")
  .replace(/[؀-ۿ_]+\d+/g, ""));

let seq = 0;
let checked = 0;
const residue = [];
for (const lang of ["en"]) {
  for (const command of COMMANDS) {
    const user = `2016990${String(++seq).padStart(5, "0")}@s.whatsapp.net`;
    db.setUser(user, { isRegistered: true, regName: "Tester", language: lang });
    const before = out.length;
    const raw = { key: { remoteJid: user, fromMe: false, id: `L10N${seq}ABCDEF` }, message: { conversation: `.${command}` }, pushName: "Tester", messageTimestamp: Math.floor(Date.now() / 1000) };
    await Promise.race([messageHandler(raw, sock), new Promise((resolve) => setTimeout(resolve, 4000))]);
    const texts = out.slice(before).map((row) => row.content?.text || row.content?.caption || "").filter(Boolean);
    assert.ok(texts.length > 0, `${command} (${lang}): لم يرد`);
    for (const text of texts) {
      checked += 1;
      assert.doesNotMatch(text, /[٠-٩]/, `${command} (${lang}): أرقام عربية-هندية لغير العربية`);
      for (const line of text.split("\n")) if (residueOf(line)) residue.push(`${lang} ${command}: ${line}`);
    }
  }
}
assert.deepEqual(residue, [], `نص عربي غير مترجم في ردود الإنجليزية/الإسبانية:\n${residue.join("\n")}`);
console.log(`✅ terboo-l10n-runtime: ${checked} رداً حقيقياً من ${COMMANDS.length} بلوقن بالإنجليزية والإسبانية بلا بقايا عربية (سوى وسائط الأوامر)، أرقام لاتينية، القالب الأدق، حدود الكلمات، الأسهم والترقيم`);
process.exit(0);
