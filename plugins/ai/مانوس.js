// بلوقن محادثة Manus المباشر عبر الوكيل الفوري (agent-default-main_task)

import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import { diagnoseManusTaskAccess, sendMessageToAgent } from "../../src/lib/manus-api.js";
import config from "../../config.js";

const pluginConfig = {
  name: "مانوس",
  alias: ["manus", "مساعد"],
  category: "ai",
  description: "محادثة مع وكيل Manus الذكي عبر API v2 وWebhook آمن",
  usage: ".مانوس <سؤالك>",
  example: ".مانوس من أنت؟",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
};

async function handler(m, { sock }) {
  const text = m.text?.trim();

  const ownerNumber = String(config?.owner?.number || "").replace(/\D/g, "");
  const senderNumber = String(m.sender || "").split("@")[0].replace(/\D/g, "");
  const isOwner = Boolean(m.isOwner || (ownerNumber && senderNumber === ownerNumber));

  if (text === "تشخيص") {
    if (!isOwner) {
      await m.react("⛔").catch((error) => { noteFailure("plugin:ai/مانوس", error, {where: "plugins/ai/مانوس.js:31",stage: "m.react"}); });
      return;
    }
    await m.react("⏳").catch((error) => { noteFailure("plugin:ai/مانوس", error, {where: "plugins/ai/مانوس.js:34",stage: "m.react"}); });
    const report = await diagnoseManusTaskAccess();
    await m.react(report.created && report.bridgeConnected ? "✅" : "⚠️").catch((error) => { noteFailure("plugin:ai/مانوس", error, {where: "plugins/ai/مانوس.js:36",stage: "m.react"}); });
    const lines = [
      "🧪 *تشخيص جسر Manus API*",
      `> إنشاء المهمة: ${report.created ? "نجح ✅" : "فشل ❌"}`,
      `> جسر Webhook: ${report.bridgeConnected ? "متصل ✅" : "غير متصل ❌"}`,
      report.taskId ? `> المهمة: ${report.taskId}` : null,
      report.status ? `> الحالة: ${report.status === "pending" ? "بانتظار نتيجة Webhook" : report.status}` : null,
      report.code ? `> الرمز: ${report.code}` : null,
      report.requestId ? `> request_id: ${report.requestId}` : null,
      `> النتيجة: ${report.message}`,
      "",
      "> Bot Terboo",
    ].filter(Boolean);
    return m.reply(lines.join("\n"));
  }

  if (!text || text.toLowerCase() === "مسح" || text === "حذف") {
    return m.reply(
      `🤖 *محادثة Manus الذكية*\n\n` +
      `اكتب سؤالك بعد الأمر؛ سيصل الرد تلقائياً عند اكتمال مهمة Manus:\n` +
      `> ${m.prefix}مانوس ما هي آخر أخبار الذكاء الاصطناعي؟\n` +
      `> ${m.prefix}مانوس تشخيص — للمالك فقط\n\n` +
      `> Bot Terboo`
    );
  }

  await m.react("⏳").catch((error) => { noteFailure("plugin:ai/مانوس", error, {where: "plugins/ai/مانوس.js:62",stage: "m.react"}); });

  try {
    const replyText = await sendMessageToAgent(text);
    await m.react("✅").catch((error) => { noteFailure("plugin:ai/مانوس", error, {where: "plugins/ai/مانوس.js:66",stage: "m.react"}); });
    await m.reply(`${replyText}\n\n> Bot Terboo`);
  } catch (error) {
    await m.react("❌").catch((error) => { noteFailure("plugin:ai/مانوس", error, {where: "plugins/ai/مانوس.js:69",stage: "m.react"}); });
    const errMsg = error?.message || "حدث خطأ غير معروف.";
    await m.reply(`❌ تعذر الحصول على رد Manus:\n${errMsg}\n\n> Bot Terboo`);
  }
}

export { pluginConfig as config, handler };