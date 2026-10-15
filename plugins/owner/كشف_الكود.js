import fs from "node:fs";
import path from "node:path";
import { getAllPlugins, getPlugin } from "../../src/lib/terboo-plugins.js";
import { sendRich } from "../../src/lib/terboo-code-renderer.js";
import { maskConfigSecrets } from "../../src/lib/terboo-ai-tools.js";
import { redact } from "../../src/lib/terboo-ai-memory.js";

/**
 * كشف الكود المصدري لأي أمر (بالاسم/المرادف أو برقمه في القائمة) — للمالك فقط.
 * العرض ببطاقة الكود (terboo-code-card) + نسخة للنسخ؛ المفاتيح والرموز محجوبة دائماً
 * (قد يُستعمل الأمر داخل مجموعة، وبعض البلوقنات تحمل مفاتيح API داخل الكود).
 */
const pluginConfig = {
  name: "كشف_الكود",
  alias: ["reveal", "سورس"],
  category: "owner",
  description: "عرض الكود المصدري لأي أمر بالاسم أو الرقم",
  usage: ".كشف_الكود <اسم الأمر أو رقمه>",
  example: ".كشف_الكود group",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
};

const MAX_BYTES = 300 * 1024;
const CHUNK = 3800;

/** كل الأوامر المحمّلة مرتبة بالمجلد ثم الاسم، مرقّمة */
function commandList() {
  return getAllPlugins()
    .filter((plugin) => plugin?.filePath && plugin.config?.name)
    .map((plugin) => ({
      name: String(plugin.config.name),
      aliases: Array.isArray(plugin.config.alias) ? plugin.config.alias : [],
      file: path.resolve(plugin.filePath),
      rel: path.relative(process.cwd(), plugin.filePath).split(path.sep).join("/"),
      folder: path.basename(path.dirname(plugin.filePath)),
    }))
    .sort((a, b) => a.folder.localeCompare(b.folder, "ar") || a.name.localeCompare(b.name, "ar"))
    .map((entry, index) => ({ ...entry, number: index + 1 }));
}

/** حجب الأسرار: حقول المفاتيح · أنماط المفاتيح المعروفة · apikey= في الروابط */
function maskSecrets(code) {
  return redact(maskConfigSecrets(code))
    .replace(/([?&](?:apikey|api_key|key|token|access_token)=)([^&"'`\s]+)/gi, "$1[محجوب]");
}

async function showSource(m, sock, entry) {
  const stat = fs.statSync(entry.file);
  if (stat.size > MAX_BYTES) return m.reply(`❌ *الملف أكبر من المسموح للعرض*\n\n> ${entry.rel}`);
  const code = maskSecrets(fs.readFileSync(entry.file, "utf8"));
  return sendRich(sock, m.chat, [
    { type: "text", text: `📄 *الكود المصدري للأمر:* ${entry.name}\n📂 *المسار:* ${entry.rel}` },
    { type: "code", code, language: "javascript", title: path.basename(entry.file) },
  ], { quoted: m, label: "reveal" });
}

async function handler(m, { sock }) {
  const input = String(m.text || "").trim();
  const list = commandList();

  // بلا مدخل: رسالة واحدة بالمجلدات ونطاق أرقامها (لا عشرات الرسائل لكل الأوامر)
  const byFolder = new Map();
  for (const entry of list) byFolder.set(entry.folder, [...(byFolder.get(entry.folder) || []), entry]);
  if (!input) {
    return m.reply([
      `📋 *الأوامر* — ${list.length}`,
      "",
      ...[...byFolder].map(([folder, entries]) => `📂 *${folder}* (${entries.length}) · ${entries[0].number}–${entries.at(-1).number}`),
      "",
      `💡 ${m.prefix}كشف_الكود <المجلد> · <اسم الأمر> · <رقمه>`,
    ].join("\n"));
  }

  // اسم مجلد ⇒ أوامره مرقّمة (مقسّمة إن طالت)
  const folder = byFolder.get(input.toLowerCase()) || byFolder.get(input);
  if (folder) {
    const lines = [`📂 *${input}* — ${folder.length}`, "", ...folder.map((entry) => `${entry.number}. ${entry.name}`)];
    let chunk = "";
    for (const line of lines) {
      if (`${chunk}${line}\n`.length > CHUNK) { await m.reply(chunk.trim()); chunk = ""; }
      chunk += `${line}\n`;
    }
    if (chunk.trim()) await m.reply(chunk.trim());
    return;
  }

  if (/^\d+$/.test(input)) {
    const entry = list.find((item) => item.number === Number(input));
    if (!entry) return m.reply(`❌ *لا يوجد أمر بهذا الرقم*\n\n> المجموع: ${list.length}`);
    return showSource(m, sock, entry);
  }

  const query = input.replace(/^[.!#/]/, "").toLowerCase();
  const exact = getPlugin(query);
  if (exact?.filePath) {
    const entry = list.find((item) => item.file === path.resolve(exact.filePath));
    if (entry) return showSource(m, sock, entry);
  }
  const partial = list.filter((item) => item.name.toLowerCase().includes(query) || item.aliases.some((alias) => String(alias).toLowerCase().includes(query))).slice(0, 15);
  if (partial.length === 1) return showSource(m, sock, partial[0]);
  if (!partial.length) return m.reply(`❌ *لا يوجد أمر بهذا الاسم*\n\n> ${m.prefix}كشف_الكود — لعرض كل الأوامر`);
  return m.reply([
    `🔍 *نتائج البحث* — ${partial.length}`,
    "",
    ...partial.map((item) => `${item.number}. ${item.name} · ${item.rel}`),
    "",
    `💡 ${m.prefix}كشف_الكود <الرقم>`,
  ].join("\n"));
}

export { pluginConfig as config, handler };
