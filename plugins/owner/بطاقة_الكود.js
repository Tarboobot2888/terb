import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getDatabase } from "../../src/lib/terboo-database.js";
import { normalizeMode, sendRich } from "../../src/lib/terboo-code-renderer.js";

/**
 * شكل الكود المرسل من البوت:
 *   صورة (افتراضي): بطاقة كود مرسومة (تلوين · أرقام أسطر · اتجاه صحيح للعربي) + نسخة للنسخ.
 *   نص           : كتلة ``` فقط.
 * البطاقة الغنية «richResponseMessage» لا تظهر على الأجهزة دون ادعاء أنها من بوت Meta AI، فليست خياراً هنا.
 */
const pluginConfig = {
  name: "بطاقة_الكود",
  alias: ["richcode"],
  category: "owner",
  description: "شكل الكود المرسل من البوت: بطاقة صورة احترافية أو نص",
  usage: ".بطاقة_الكود صورة | نص | تجربة",
  example: ".بطاقة_الكود تجربة",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
};

/** مثال حقيقي للتجربة: أول أسطر هذا الأمر نفسه (كما يعرض «كشف» كود أمر) */
const sample = () => fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 16).join("\n");
const TEST = /^(?:تجربة|تجربه|جرب|test)$/;
const IMAGE = /^(?:صورة|صوره|تشغيل|تفعيل|on|image)$/;
const TEXT = /^(?:نص|ايقاف|إيقاف|تعطيل|off|text)$/;

async function handler(m, { sock }) {
  const db = getDatabase();
  const option = String(m.text || "").toLowerCase().trim();
  const current = normalizeMode(db.setting("richCode"));

  if (TEST.test(option)) {
    return sendRich(sock, m.chat, [
      { type: "text", text: "💻 تجربة بطاقة الكود" },
      { type: "code", code: sample(), language: "javascript", title: "بطاقة_الكود.js" },
    ], { quoted: m, mode: "image", label: "richcode-test" });
  }

  if (IMAGE.test(option)) {
    db.setting("richCode", "image");
    return m.reply(`✅ *الكود يُرسل بطاقة صورة احترافية*\n\n> مع نسخة قابلة للنسخ تحتها`);
  }

  if (TEXT.test(option)) {
    db.setting("richCode", "text");
    return m.reply(`✅ *الكود يُرسل نصاً بكتلة كود*`);
  }

  return m.reply(
    `💻 *شكل الكود*\n\n` +
      `> الحالي: *${current === "text" ? "نص" : "بطاقة صورة"}*\n\n` +
      `*الاستخدام:*\n` +
      `> *${m.prefix}بطاقة_الكود صورة* — بطاقة صورة احترافية + نسخة للنسخ\n` +
      `> *${m.prefix}بطاقة_الكود نص* — كتلة كود نصية\n` +
      `> *${m.prefix}بطاقة_الكود تجربة* — يرسل مثالاً`
  );
}

export { pluginConfig as config, handler };
