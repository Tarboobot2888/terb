import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import { askNvidia } from "../../src/lib/terboo-nvidia-ai.js";
import { detectReplyLanguage, languageDirective } from "../../src/lib/terboo-ai-context.js";
import { getDatabase } from "../../src/lib/terboo-database.js";
import { getLanguageForJid } from "../../src/lib/terboo-localization.js";

const pluginConfig = {
  name: "زد_اي", alias: ["zai", "glm", "glm5", "زد"], category: "ai",
  description: "محادثة GLM-5 من Z.ai - تدقيق وتحليل", usage: ".زد_اي <سؤال/كود>",
  example: ".زد_اي راجع هذا الكود", isOwner: false, isPremium: false, isGroup: false, isPrivate: false,
  cooldown: 8, energi: 2, isEnabled: true,
};

async function handler(m, { text }) {
  if (!text) return m.reply(`🤖 *Z.ai GLM-5*\n\n${m.prefix}زد_اي <سؤال أو كود>\n\nمثال:\n${m.prefix}زد_اي حلل هذا الكود`);
  await m.react("🧠");
  // لغة الرد = لغة السؤال أو اللغة المحفوظة للمستخدم (§36)
  let saved = "ar";
  try { saved = getLanguageForJid(m.sender, getDatabase()); } catch (error) { noteFailure("plugin:ai/زد_اي", error, {where: "plugins/ai/زد_اي.js:18",stage: "getLanguageForJid"}); }
  const replyLanguage = detectReplyLanguage(text, saved);
  const messages = [
    { role: "system", content: `أنت مساعد لتحليل الكود والأمن السيبراني الدفاعي. لا تقدم تعليمات ضارة. ${languageDirective(replyLanguage)}` },
    { role: "user", content: text },
  ];
  try {
    const result = await askNvidia({ model: "z-ai/glm5", messages, maxTokens: 2000 });
    return m.reply(result.answer);
  } catch {
    try {
      const result = await askNvidia({ model: "deepseek-ai/deepseek-v4-pro", messages, maxTokens: 2000 });
      return m.reply(result.answer);
    } catch (error) {
      await m.react("❌");
      return m.reply(error.message.includes("غير مهيأ") ? "❌ مزود Z.ai غير مهيأ على السيرفر." : "❌ فشل الاتصال. حاول لاحقاً.");
    }
  }
}

export { pluginConfig as config, handler };
