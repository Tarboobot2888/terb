// ═══════════════════════════════════════════════
// 🧪 Terboo Code Card — بطاقة الكود المرسومة (بلاغ: «الكود بيتبعت بشكل مش احترافي»)
// ───────────────────────────────────────────────
//   1. البطاقة PNG بخطوط المشروع، والأسطر الطويلة تُلف، والطويل جداً يُقص بحد ارتفاع.
//   2. العربي داخل الكود: الكلمة الأولى يميناً (ترتيب RTL صحيح) — لا ينقلب ولا يتبعثر.
//   3. المسار الكامل: بطاقة + نسخة للنسخ (نص يبدأ باسم ملف لاتيني، أو ملف إن طال/احتوى ```).
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-code-card-"));
process.env.TERBOO_LID_CACHE_PATH = path.join(tmp, "lid.json");
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const { renderCodeCard, CODE_CARD_LIMITS } = await import("../src/lib/terboo-code-card.js");
const { installTransport } = await import("../src/lib/terboo-transport.js");
const sharp = (await import("sharp")).default;
const { createCanvas } = await import("@napi-rs/canvas");
const { FAMILY, registerFonts } = await import("../src/lib/terboo-fonts.js");

const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };
const USER = "201033334444@s.whatsapp.net";

await check("renders-png-with-limits", async () => {
  assert.equal(await renderCodeCard({ code: "   " }), null, "كود فارغ");
  const small = await renderCodeCard({ code: "print('hi')\n", language: "python", brand: "Bot Terboo" });
  const meta = await sharp(small).metadata();
  assert.equal(meta.format, "png");
  assert.ok(meta.width >= 600 && meta.height >= 200 && meta.height < 400, `${meta.width}x${meta.height}`);
  // سطر طويل جداً يُلف: العرض لا يتجاوز الحد
  const wide = await sharp(await renderCodeCard({ code: `x = "${"a".repeat(400)}"\n`, language: "python" })).metadata();
  assert.ok(wide.width < 1700, `عرض ${wide.width}`);
  // كود طويل جداً: الارتفاع محدود (معاينة) — النسخة الكاملة تصل للنسخ
  const long = await sharp(await renderCodeCard({ code: Array.from({ length: 400 }, (_, i) => `line_${i} = ${i}`).join("\n"), language: "python" })).metadata();
  assert.ok(long.height <= CODE_CARD_LIMITS.maxLines * CODE_CARD_LIMITS.lineHeight + 400, `ارتفاع ${long.height}`);
});

await check("arabic-word-order", async () => {
  // «هو المجموعات»: الكلمة الأولى (القصيرة) يميناً في الرسم كما تُقرأ العربية
  await registerFonts();
  const canvas = createCanvas(900, 60);
  const ctx = canvas.getContext("2d");
  ctx.font = `28px "${FAMILY.mono}", "${FAMILY.arabic}"`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText("هو المجموعات", 10, 30);
  const data = ctx.getImageData(0, 0, 900, 60).data;
  const ink = (col) => { for (let row = 0; row < 60; row += 1) if (data[(row * 900 + col) * 4 + 3] > 40) return true; return false; };
  const groups = [];
  let start = -1;
  let gap = 0;
  for (let col = 0; col < 900; col += 1) {
    if (ink(col)) { if (start < 0) start = col; gap = 0; } else if (start >= 0 && ++gap > 6) { groups.push(col - gap - start + 1); start = -1; gap = 0; }
  }
  assert.equal(groups.length, 2, JSON.stringify(groups));
  assert.ok(groups[0] > groups[1], `الكلمة القصيرة ليست يميناً: ${JSON.stringify(groups)}`);
  // بطاقة فيها تعليق عربي تُرسم بلا خطأ
  assert.ok(Buffer.isBuffer(await renderCodeCard({ code: "// بيتحقق لو الرقم زوجي\nconst ok = n % 2 === 0;\n", language: "javascript" })));
});

await check("copy-rules", async () => {
  const sent = [];
  const sock = {
    user: { id: "201000000001:3@s.whatsapp.net" }, ev: { on() {}, off() {} },
    async relayMessage(jid, message, options = {}) { return options.messageId; },
    async sendMessage(jid, content) { sent.push(content); return { key: { id: `S${sent.length}`, remoteJid: jid, fromMe: true } }; },
  };
  installTransport(sock, { getDatabase: () => getDatabase() });
  // وضع النص: الكود يظهر حرفياً داخل سياج ```، برأس يحمل اسم اللغة (يظهر على كل الأجهزة)
  getDatabase().setting("richCode", "text");
  // قصير ⇒ رسالة نص واحدة بالكود حرفياً داخل سياج
  await sock.sendMessage(USER, { text: "```python\nfor i in range(3):\n    print(i)\n```" });
  const copy = sent.find((content) => typeof content.text === "string" && content.text.includes("```"));
  assert.ok(copy, "لم تُرسل نسخة نصية للكود");
  assert.equal(copy.text, "*💻 كود Python*\n```\nfor i in range(3):\n    print(i)\n```");
  // طويل ⇒ يُقسَّم لأجزاء نصية، والكود يبقى حرفياً بعد الدمج
  sent.length = 0;
  const long = Array.from({ length: 300 }, (_, i) => `console.log(${i});`).join("\n");
  await sock.sendMessage(USER, { code: long, language: "javascript" });
  const parts = sent.map((content) => content.text || "").filter((t) => t.includes("```"));
  assert.ok(parts.length >= 1, "لم يُرسل الكود الطويل كنص");
  const joined = parts.join("\n");
  assert.ok(joined.includes("console.log(0);") && joined.includes("console.log(299);"), "الكود الطويل مبتور (أول/آخر سطر مفقود)");
});

await check("reveal-command", async () => {
  // .كشف_الكود: بالمرادف/الرقم/المجلد، ملخص برسالة واحدة، والمفاتيح محجوبة دائماً
  const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
  await loadPlugins(path.join(process.cwd(), "plugins"));
  const { handler } = await import("../plugins/owner/كشف_الكود.js");
  const sent = [];
  const sock = {
    user: { id: "201000000001:3@s.whatsapp.net" }, ev: { on() {}, off() {} },
    async relayMessage(jid, message, options = {}) { return options.messageId; },
    async sendMessage(jid, content) { sent.push(content); return { key: { id: `S${sent.length}`, remoteJid: jid, fromMe: true } }; },
  };
  installTransport(sock, { getDatabase: () => getDatabase() });
  const replies = [];
  const base = { chat: USER, sender: USER, prefix: ".", key: { id: "RV", remoteJid: USER, fromMe: false }, message: { conversation: ".كشف_الكود" }, async reply(text) { replies.push(String(text)); } };
  await handler({ ...base, text: "" }, { sock });
  assert.equal(replies.length, 1, "الملخص أكثر من رسالة");
  assert.match(replies[0], /📂 \*group\* \(\d+\) · \d+–\d+/);
  replies.length = 0;
  await handler({ ...base, text: "group" }, { sock });
  assert.ok(replies.join("\n").includes(". اضف"), "قائمة المجلد");
  const number = Number(replies.join("\n").match(/(\d+)\. اضف\n/)?.[1]);
  // وضع النص: الكشف يُرسل الكود حرفياً داخل سياج ``` برسالة نصية (المسار + الكود)، لا بطاقة
  getDatabase().setting("richCode", "text");
  sent.length = 0;
  await handler({ ...base, text: String(number) }, { sock });
  const byNumber = sent.map((content) => content.text || "").join("\n");
  assert.ok(byNumber.includes("plugins/group/اضف.js"), "بالرقم: المسار مفقود");
  assert.ok(byNumber.includes("```"), "بالرقم: بلا كود");
  sent.length = 0;
  await handler({ ...base, text: "add" }, { sock });
  const byAlias = sent.map((content) => content.text || "").join("\n");
  assert.ok(byAlias.includes("plugins/group/اضف.js"), "بالمرادف: المسار مفقود");
  assert.doesNotMatch(JSON.stringify(sent.map((content) => content.text || content.caption || content.document?.toString("utf8") || "")), /apikey=(?!\[محجوب\])[A-Za-z0-9]/, "مفتاح ظاهر");
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✅ terboo-code-card: ${results.join(" · ")}`);
process.exit(0);
