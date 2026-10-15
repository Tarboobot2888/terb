// ═══════════════════════════════════════════════
// 🧪 Terboo — Rich Response Engine + Universal Code Renderer (v4 §4–§8، §43–§44)
// ───────────────────────────────────────────────
// المحرّك نفسه (بلا مقبس):
//   • اكتشاف 18 لغة بالتحليل المعجمي، وترتيب الأولوية fence ← metadata ← extension ← context ← lexical،
//     ولا افتراض javascript أبداً.
//   • التلوين بلا فقد: ضمّ الكتل = الكود الأصلي حرفياً (CRLF، tabs، مسافات ختامية، عربي، إيموجي).
//   • محلّل المخرجات: نص + كتل متعددة، وفن ASCII بلا لغة لا يُعامل ككود.
//   • كود طويل ⇒ رسائل متتالية بلا فقد؛ بديل نصي بعناوين مترجمة؛ كود يحوي ``` ⇒ ملف بنفس البايتات.
//   • الرسالة الغنية صالحة في WAProto الرسمي، وبلا أي هوية Meta AI.
// على مقبس بكل الطبقات (توافق ⇐ كود ⇐ ترجمة ⇐ تسليم):
//   • نص فيه كود لمستخدم إنجليزي: النص يُترجم والكود (بتعليقاته العربية) لا يُمس، ولا يمسّه نظام التصميم.
//   • الإعداد richCode="text" ⇒ إخراج نصي فقط.
//   • AIRich (ai/فن/فيديو/ping3/تست2) عبر المحرّك: نصوص البلوقن تُترجم، ردود الذكاء raw، الوسائط بالترتيب.
//   • البلوقنات التي كانت تنتحل Meta AI (اعلان · ping3 · تست2) تعمل الآن بلا انتحال.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import * as baileys from "@whiskeysockets/baileys";
import {
  HIGHLIGHT, LANGUAGES, MAX_CODE_CHARS, buildNativeRichCodeContent, buildRichContent, detectLanguage, hasRenderableCode, parseOutput,
  renderFallback, richBatches, splitCode, tokenize,
} from "../src/lib/terboo-rich-response.js";
import { installCodeRenderer, localizeParts, segmentParts } from "../src/lib/terboo-code-renderer.js";
import { installWhatsAppCompat } from "../src/lib/terboo-wa-compat.js";
import { installLocalization, markRaw } from "../src/lib/terboo-i18n/runtime.js";
import { _resetDelivery, deliveryLog, installMenuDelivery } from "../src/lib/terboo-menu-delivery.js";
import { AIRich } from "../src/lib/terboo-builder.js";

const ROOT = process.cwd();
const { proto } = baileys;
const results = [];
const check = async (name, fn) => {
  await fn();
  results.push(name);
};
const joined = (blocks) => blocks.map((block) => block.codeContent).join("");
const roundTrip = (message) => proto.Message.decode(proto.Message.encode(message).finish());
const config = (await import("../config.js")).default;
const IMPERSONATION = /forwardedAiBotMessageInfo|botForwardedMessage|botMetadata|867051314767696|13135550002|["']0@bot["']|@bot\b/;

// ═══════════════════════════════════════════════
// 1. اكتشاف اللغة
// ═══════════════════════════════════════════════

const SAMPLES = {
  javascript: "const total = items.reduce((sum, x) => sum + x, 0);\nconsole.log(total);\n",
  typescript: "interface User {\n  id: number;\n  name: string;\n}\nexport type Id = User[\"id\"];\nconst f = (u: User): string => u.name;\n",
  python: "def greet(name):\n    # تحية\n    print(f\"مرحبا {name}\")\n\nif __name__ == \"__main__\":\n    greet(None)\n",
  json: "{\n  \"name\": \"terboo\",\n  \"version\": 4,\n  \"ok\": true\n}\n",
  html: "<!DOCTYPE html>\n<html>\n<body>\n  <div class=\"card\"><p>Hi</p></div>\n</body>\n</html>\n",
  css: ":root {\n  --brand: #145aa0;\n}\n.card {\n  color: var(--brand);\n  padding: 8px;\n}\n",
  bash: "#!/usr/bin/env bash\nset -e\nexport NODE_ENV=production\nnpm install\necho \"done $HOME\"\n",
  php: "<?php\n$name = \"Terboo\";\nfunction greet($who) {\n  echo \"Hi \" . $who;\n}\ngreet($name);\n",
  java: "public class Main {\n  public static void main(String[] args) {\n    System.out.println(\"Hi\");\n  }\n}\n",
  c: "#include <stdio.h>\n\nint main(void) {\n  printf(\"%d\\n\", 42);\n  return 0;\n}\n",
  cpp: "#include <iostream>\n#include <vector>\nint main() {\n  std::vector<int> v{1, 2};\n  std::cout << v.size();\n}\n",
  csharp: "using System;\nnamespace App {\n  public class Program {\n    static void Main() { Console.WriteLine(\"Hi\"); }\n  }\n}\n",
  go: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tx := 42\n\tfmt.Println(x)\n}\n",
  rust: "use std::io;\nfn main() {\n    let mut s = String::new();\n    println!(\"{}\", s.len());\n}\n",
  sql: "SELECT u.id, u.name\nFROM users u\nJOIN orders o ON o.user_id = u.id\nWHERE o.total > 100;\n",
  yaml: "---\nname: terboo\nservices:\n  - name: bot\n    port: 3000\n",
  xml: "<?xml version=\"1.0\"?>\n<config>\n  <item key=\"a\">1</item>\n</config>\n",
  lua: "local count = 0\nfunction inc(n)\n  if n > 0 then\n    count = count + n\n  end\nend\n",
};

await check("detect-supported-languages", () => {
  assert.ok(Object.keys(LANGUAGES).length >= 18, `عدد اللغات المدعومة: ${Object.keys(LANGUAGES).length}`);
  assert.ok(Object.keys(SAMPLES).every((name) => name in LANGUAGES), "كل العينات ضمن اللغات المدعومة");
  for (const [language, code] of Object.entries(SAMPLES)) {
    const detected = detectLanguage(code);
    assert.equal(detected.language, language, `تحليل معجمي: ${language} ⇒ ${detected.language}`);
    assert.equal(detected.source, "lexical");
  }
});

await check("detect-priority", () => {
  const py = SAMPLES.python;
  assert.deepEqual([detectLanguage(py, { fence: "js" }).language, detectLanguage(py, { fence: "js" }).source], ["javascript", "fence"]);
  assert.equal(detectLanguage(py, { language: "rust" }).source, "metadata");
  assert.equal(detectLanguage("x", { fileName: "main.go" }).language, "go");
  assert.equal(detectLanguage("x", { fileName: "main.go" }).source, "extension");
  assert.equal(detectLanguage("x = 1", { context: "اشرح كود python" }).language, "python");
  assert.equal(detectLanguage("hello world").language, null, "لا افتراض javascript");
  assert.equal(detectLanguage("").language, null);
  assert.equal(detectLanguage("⣿⣿⣷⡄\n⠿⠿⠟", { fence: "txt" }).language, null, "txt وسم نصي صريح");
  assert.equal(detectLanguage(SAMPLES.python, { fence: "text" }).language, null, "text لا يُخمَّن");
  assert.equal(detectLanguage("x", { fence: "C++" }).language, "cpp");
  assert.equal(detectLanguage("x", { fence: "golang" }).language, "go");
});

// أنماط الاكتشاف تعمل على كل رد يخرج من البوت: مدخلات عدائية يجب أن تبقى خطية الزمن
// (نمط CSS سابق كان يتراجع أُسّياً: 1.6 ث على 40 حرفاً من SQL، و38 ث لسطر 200 ألف حرف).
await check("detect-no-catastrophic-backtracking", () => {
  const inputs = {
    words: "a ".repeat(20000), dashes: `${"a-".repeat(20000)}!`, sqlish: `SELECT ${"x, ".repeat(8000)}`,
    selectors: ".a .b > .c ".repeat(4000), colons: "a: ".repeat(10000), angle: `<a ${"b=\"c\" ".repeat(5000)}`,
    params: `def f(${"x, ".repeat(8000)}`, spaces: `${" ".repeat(50000)}{`, arabic: "مرحبا بك ".repeat(10000),
    longline: "x".repeat(200000), manyLines: "const a = 1;\n".repeat(20000), quotes: "\"".repeat(20000),
  };
  for (const [name, text] of Object.entries(inputs)) {
    let started = performance.now();
    detectLanguage(text);
    parseOutput(`\`\`\`\n${text}\n\`\`\``);
    const detectMs = performance.now() - started;
    assert.ok(detectMs < 500, `${name}: الاكتشاف استغرق ${detectMs.toFixed(0)}ms`);
    started = performance.now();
    assert.equal(joined(tokenize(text, "javascript")), text, `${name}: فقد في التلوين`);
    const tokenizeMs = performance.now() - started;
    assert.ok(tokenizeMs < 1500, `${name}: التلوين استغرق ${tokenizeMs.toFixed(0)}ms`);
  }
});

// ═══════════════════════════════════════════════
// 2. التلوين بلا فقد
// ═══════════════════════════════════════════════

await check("tokenize-lossless", () => {
  const tricky = [
    "const a = `x ${b} y`;\r\nlet s = 'it\\'s';\t// تعليق 🚀   \r\n",
    "s = \"\"\"multi\nline\"\"\"\n# end",
    "unterminated = \"abc\nnext = 1",
    "/* block\n comment */ int x = 0x1F; // c",
    "",
    "   \n\t\n",
    "emoji = \"😀\" # 😀",
    "SELECT 'a''b' -- note\nFROM t;",
  ];
  for (const [language, code] of Object.entries(SAMPLES)) {
    assert.equal(joined(tokenize(code, language)), code, `فقد في ${language}`);
    for (const extra of tricky) assert.equal(joined(tokenize(extra, language)), extra, `فقد في ${language} مع حالة صعبة`);
  }
  for (const extra of tricky) assert.equal(joined(tokenize(extra, null)), extra, "فقد بلا لغة");
});

await check("tokenize-highlight", () => {
  const blocks = tokenize("def f(x):\n    # c\n    return \"s\" + 42\n", "python");
  const typeOf = (text) => blocks.find((block) => block.codeContent === text)?.highlightType;
  assert.equal(typeOf("def"), HIGHLIGHT.KEYWORD);
  assert.equal(typeOf("return"), HIGHLIGHT.KEYWORD);
  assert.equal(typeOf("# c"), HIGHLIGHT.COMMENT);
  assert.equal(typeOf("\"s\""), HIGHLIGHT.STRING);
  assert.equal(typeOf("42"), HIGHLIGHT.NUMBER);
  const js = tokenize("console.log(1)", "javascript");
  assert.ok(js.some((block) => block.codeContent === "log" && block.highlightType === HIGHLIGHT.METHOD), "استدعاء دالة بلا تلوين METHOD");
  assert.ok(tokenize("plain words only", null).every((block) => block.highlightType === HIGHLIGHT.DEFAULT));
});

// ═══════════════════════════════════════════════
// 3. محلّل المخرجات
// ═══════════════════════════════════════════════

await check("parse-mixed", () => {
  const text = "الحل:\n```python\nprint(1)\n```\nثم:\n```\nconst x = require('fs');\nconsole.log(x);\n```\nانتهى.";
  const parts = parseOutput(text);
  assert.deepEqual(parts.map((part) => part.type), ["text", "code", "text", "code", "text"]);
  assert.equal(parts[1].language, "python");
  assert.equal(parts[1].code, "print(1)\n");
  assert.equal(parts[3].language, "javascript", "سياج بلا وسم ⇒ تحليل معجمي");
  assert.equal(parts[3].source, "lexical");
  assert.equal(hasRenderableCode(text), true);
  const art = "```\n  /\\_/\\\n ( o.o )\n  > ^ <\n```";
  assert.equal(hasRenderableCode(art), false, "فن ASCII ليس كوداً");
  assert.equal(hasRenderableCode("نص عادي بلا كود"), false);
  assert.equal(hasRenderableCode("قيمة `x` داخل سطر"), false);
});

// ═══════════════════════════════════════════════
// 4. البناء: كود طويل · بديل · حماية
// ═══════════════════════════════════════════════

await check("long-code", () => {
  const line = "result = compute(value) + other_value  # حساب\n";
  const code = line.repeat(Math.ceil((MAX_CODE_CHARS * 2.5) / line.length));
  const chunks = splitCode(code);
  assert.ok(chunks.length >= 3, `قطع قليلة: ${chunks.length}`);
  assert.equal(chunks.join(""), code, "التقطيع فقد شيئاً");
  assert.ok(chunks.every((chunk) => chunk.length <= MAX_CODE_CHARS));
  assert.ok(chunks.slice(0, -1).every((chunk) => chunk.endsWith("\n")), "قطع وسط السطر");
  const batches = richBatches([{ type: "text", text: "مقدمة" }, { type: "code", code, language: "python" }, { type: "text", text: "خاتمة" }]);
  assert.equal(batches.length, chunks.length);
  assert.equal(batches.flat().filter((part) => part.type === "code").map((part) => part.code).join(""), code);
  const fallback = renderFallback([{ type: "code", code, language: "python" }], { lang: "en" });
  assert.equal(fallback.length, chunks.length);
  assert.ok(fallback[0].text.startsWith("*💻 Python code* (1/"), fallback[0].text.slice(0, 40));
  const long = "x".repeat(MAX_CODE_CHARS * 2 + 5);
  assert.equal(splitCode(long).join(""), long, "سطر واحد أطول من الحد");
});

await check("fallback-localized-and-verbatim", () => {
  const parts = [{ type: "text", text: "intro" }, { type: "code", code: SAMPLES.python, language: "python" }, { type: "table", title: "T", rows: [{ items: ["a", "b"], isHeading: true }, { items: ["1", "2"] }] }];
  const titles = { ar: "💻 كود Python", en: "💻 Python code" };
  for (const [lang, title] of Object.entries(titles)) {
    const [message] = renderFallback(parts, { lang });
    assert.ok(message.text.includes(`*${title}*`), `${lang}: ${message.text.slice(0, 60)}`);
    const body = message.text.match(/```\n([\s\S]*?)\n```/)[1];
    assert.equal(`${body}\n`, SAMPLES.python, "الكود في البطاقة ليس حرفياً");
    assert.ok(message.text.includes("> ◈ 1 · 2"), "الجدول النصي بنظام التصميم");
  }
  const withFence = "md = \"\"\"\n```js\nx\n```\n\"\"\"\n";
  const [doc] = renderFallback([{ type: "code", code: withFence, language: "python" }], { lang: "ar" });
  assert.ok(doc.document, "كود يحوي ``` لم يُرسل كملف");
  assert.ok(doc.document.buffer.equals(Buffer.from(withFence, "utf8")), "الملف ليس بنفس البايتات");
  assert.equal(doc.document.fileName, "code.py");
  const [unknown] = renderFallback([{ type: "code", code: "a b c", language: null }], { lang: "en" });
  assert.ok(unknown.text.includes("*💻 Text code*"), unknown.text);
});

await check("proto-valid-no-identity", () => {
  const content = buildRichContent([
    { type: "text", text: "مرحبا" },
    { type: "code", code: SAMPLES.rust, language: "rust" },
    { type: "table", title: "جدول", rows: [{ items: ["أ", "ب"], isHeading: true }, { items: ["1", "2"] }] },
    { type: "latex", text: "E = mc^2", expressions: [{ latexExpression: "E = mc^2" }] },
  ], { quoted: { key: { id: "Q1", remoteJid: "201@s.whatsapp.net", participant: "202@s.whatsapp.net" }, message: { conversation: "سؤال" } } });
  const decoded = roundTrip(content);
  const rich = decoded.richResponseMessage;
  assert.equal(rich.messageType, 1);
  assert.deepEqual(rich.submessages.map((sub) => sub.messageType), [2, 5, 4, 8]);
  assert.equal(joined(rich.submessages[1].codeMetadata.codeBlocks), SAMPLES.rust);
  assert.equal(rich.contextInfo.stanzaId, "Q1");
  assert.equal(rich.contextInfo.quotedMessage.conversation, "سؤال");
  assert.equal(decoded.messageContextInfo.messageSecret.length, 32);
  const serialized = JSON.stringify(proto.Message.toObject(decoded, { defaults: false }));
  assert.ok(!IMPERSONATION.test(serialized), "هوية Meta AI داخل الرسالة");
  // مُعاد توجيهها من قناة البوت نفسها فقط (config.saluran) — لا من بوت ذكاء ولا من غيرها
  assert.equal(rich.contextInfo.isForwarded, true);
  assert.equal(rich.contextInfo.forwardedNewsletterMessageInfo?.newsletterJid, config.saluran.id, "ليست من قناة البوت");
  assert.ok(!rich.contextInfo.forwardedAiBotMessageInfo && !rich.contextInfo.forwardOrigin, "إعادة توجيه من بوت ذكاء");
  config.saluran.forwardAll = false;
  try {
    const plain = roundTrip(buildRichContent([{ type: "text", text: "x" }]));
    assert.ok(!plain.richResponseMessage.contextInfo?.isForwarded, "forwardAll=false ولا تزال مُعاد توجيهها");
  } finally {
    config.saluran.forwardAll = true;
  }
});

await check("native-image-and-code-one-message", () => {
  const content = buildNativeRichCodeContent([
    { type: "media", kind: "image", source: "https://example.com/code.png", imageText: "Code" },
    { type: "text", text: "شرح" },
    { type: "code", code: SAMPLES.javascript, language: "javascript" },
  ]);
  const decoded = roundTrip(content);
  const rich = decoded.richResponseMessage;
  assert.deepEqual(rich.submessages.map((sub) => sub.messageType), [3, 2, 5]);
  assert.equal(rich.submessages[0].imageMetadata.imageUrl.imagePreviewUrl, "https://example.com/code.png");
  assert.equal(rich.submessages[0].imageMetadata.imageUrl.imageHighResUrl, "https://example.com/code.png");
  assert.equal(joined(rich.submessages[2].codeMetadata.codeBlocks), SAMPLES.javascript);
  assert.ok(rich.submessages[2].codeMetadata.codeBlocks.some((block) => block.highlightType === HIGHLIGHT.KEYWORD));
  assert.equal(rich.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid, config.saluran.id);
  assert.ok(!IMPERSONATION.test(JSON.stringify(proto.Message.toObject(decoded, { defaults: false }))));
});

await check("segments-and-localize-parts", () => {
  const parts = [{ type: "text", text: "أ" }, { type: "media", kind: "image", source: Buffer.from("x") }, { type: "code", code: "x", language: null }, { type: "text", text: "ب" }];
  assert.deepEqual(segmentParts(parts).map((segment) => segment.type), ["rich", "media", "rich"]);
  const sameMessage = segmentParts([
    { type: "media", kind: "image", source: "https://example.com/code.png" },
    { type: "text", text: "intro" },
    { type: "code", code: SAMPLES.javascript, language: "javascript" },
  ]);
  assert.deepEqual(sameMessage.map((segment) => segment.type), ["rich"]);
  const code = "# الحالة\nprint(\"الحالة\")\n";
  const localized = localizeParts([
    { type: "text", text: "الحالة" },
    { type: "table", title: "الحالة", rows: [{ items: ["الحالة", "42"], isHeading: true }] },
    { type: "code", code, language: "python" },
    { type: "text", text: markRaw("الحالة") },
  ], "en");
  assert.equal(localized[0].text, "Status");
  assert.equal(localized[1].title, "Status");
  assert.deepEqual(localized[1].rows[0].items, ["Status", "42"]);
  assert.equal(localized[2].code, code, "الكود تُرجم!");
  assert.equal(localized[3].text, "الحالة", "النص الخام (رد ذكاء) تُرجم");
});

// ═══════════════════════════════════════════════
// 5. على مقبس بكل الطبقات
// ═══════════════════════════════════════════════

const logger = pino({ level: "silent" });
const EN = "201111111111@s.whatsapp.net";
const AR = "202222222222@s.whatsapp.net";
// مسار الرسالة الغنية (بروتوكول) هو الافتراضي
const settings = { richCode: "rich" };
const db = {
  getUser: (jid) => ({ language: jid === EN ? "en" : "ar" }),
  getGroup: () => ({}),
  setting: (key) => settings[key],
};
const relayed = [];
const sent = [];
const sock = {
  user: { id: "201000000001:3@s.whatsapp.net", jid: "201000000001@s.whatsapp.net" },
  ev: baileys.makeEventBuffer(logger),
  waUploadToServer: async () => ({ mediaUrl: "https://mmg.whatsapp.net/x", directPath: "/v/x" }),
  async relayMessage(jid, message, options = {}) {
    relayed.push({ jid, message, options });
    return options.messageId;
  },
  async sendMessage(jid, content, options = {}) {
    sent.push({ jid, content, options });
    return { key: { id: `S${sent.length}`, remoteJid: jid, fromMe: true } };
  },
};
installWhatsAppCompat(sock, { langOf: (jid) => db.getUser(jid).language });
installCodeRenderer(sock, { getDatabase: () => db });
installLocalization(sock, { getDatabase: () => db });
installMenuDelivery(sock);
const lastRich = () => [...relayed].reverse().find((entry) => entry.message.richResponseMessage);

await check("socket-code-untouched-by-i18n-and-design", async () => {
  const code = "# الحالة\nitems = [\n- 1,\n> 2\n]\nprint(\"الحالة\")  \n";
  const before = relayed.length;
  await sock.sendMessage(EN, { text: `الحالة\n\`\`\`python\n${code}\`\`\`` });
  const entry = lastRich();
  assert.ok(relayed.length > before && entry, "لم تُرسل رسالة غنية");
  const subs = roundTrip(entry.message).richResponseMessage.submessages;
  assert.equal(subs[0].messageText, "Status", "النص حول الكود لم يُترجم");
  assert.equal(subs[1].codeMetadata.codeLanguage, "python");
  assert.equal(joined(subs[1].codeMetadata.codeBlocks), code, "الكود تغيّر بالترجمة أو التصميم");
});

await check("socket-send-code-and-passthrough", async () => {
  await sock.sendCode(AR, SAMPLES.go, { fileName: "main.go" });
  const code = roundTrip(lastRich().message).richResponseMessage.submessages.find((sub) => sub.messageType === 5);
  assert.equal(code.codeMetadata.codeLanguage, "go");
  assert.equal(joined(code.codeMetadata.codeBlocks), SAMPLES.go);
  const start = sent.length;
  const richBefore = relayed.length;
  await sock.sendMessage(AR, { text: "نص عادي" });
  await sock.sendMessage(AR, { text: "```\n (\\_/)\n (o.o)\n```" });
  assert.equal(sent.length - start, 2, "نص بلا كود لم يمر كما هو");
  assert.equal(relayed.length, richBefore, "نص بلا كود حُوِّل لرسالة غنية");
});

await check("socket-mode-text", async () => {
  settings.richCode = "text";
  const richBefore = relayed.filter((entry) => entry.message.richResponseMessage).length;
  const start = sent.length;
  await sock.sendMessage(EN, { text: `\`\`\`js\n${SAMPLES.javascript}\`\`\`` });
  settings.richCode = "rich";
  assert.equal(relayed.filter((entry) => entry.message.richResponseMessage).length, richBefore, "richCode=text أرسل رسالة غنية");
  const card = sent.slice(start).map((entry) => entry.content.text).join("\n");
  assert.ok(card.includes("*💻 JavaScript code*"), card.slice(0, 80));
  assert.ok(card.includes(SAMPLES.javascript.trimEnd()));
});

await check("airich-engine", async () => {
  _resetDelivery();
  const rich = new AIRich(sock).setTitle("الحالة").setFooter("Bot Terboo");
  rich.addText("الحالة");
  rich.addTable([["الصيغة", "الحالة"], ["جدول", "✅"]]);
  rich.addCode("txt", "⣿⣷⡄\n⠿⠟\n");
  rich.addVideo("https://example.com/v.mp4");
  rich.addTip("الحالة");
  const start = { relayed: relayed.length, sent: sent.length };
  await rich.send(EN, { lang: "en" });
  const richMessages = relayed.slice(start.relayed).filter((entry) => entry.message.richResponseMessage);
  assert.equal(richMessages.length, 2, "الوسيط لم يفصل الرد لجزأين مرتبين");
  const first = roundTrip(richMessages[0].message).richResponseMessage.submessages;
  assert.equal(first[0].messageText, "*Status*");
  assert.deepEqual(first[2].tableMetadata.rows.map((row) => row.items), [["Format", "Status"], ["Table", "✅"]]);
  assert.equal(first[3].codeMetadata.codeLanguage, "text", "فن نقطي عومل كلغة برمجة");
  assert.equal(joined(first[3].codeMetadata.codeBlocks), "⣿⣷⡄\n⠿⠟\n");
  const video = sent.slice(start.sent).find((entry) => entry.content.video);
  assert.equal(video?.content.video.url, "https://example.com/v.mp4", "الفيديو لم يُرسل كرسالة عادية");
  const second = roundTrip(richMessages[1].message).richResponseMessage.submessages.map((sub) => sub.messageText);
  // سطر التصميم بعلامة سمة لغة المستلم (en: › — terboo-ui-theme)
  assert.deepEqual(second, ["> › Status", "> Bot Terboo"]);
  const built = await new AIRich(sock).addText("x").build();
  assert.ok(!IMPERSONATION.test(JSON.stringify(built)), "build() يحمل هوية Meta AI");
  const raw = new AIRich(sock).addText("الحالة");
  await raw.send(EN, { lang: "en", raw: true });
  assert.equal(roundTrip(lastRich().message).richResponseMessage.submessages[0].messageText, "الحالة", "رد الذكاء raw تُرجم");
  assert.equal(joined(AIRich.tokenizer(SAMPLES.c, "c").codeBlock), SAMPLES.c);
  assert.ok(deliveryLog().some((row) => row.stage === "media" && row.outcome === "sent"));
});

// ═══════════════════════════════════════════════
// 6. البلوقنات التي كانت تنتحل Meta AI
// ═══════════════════════════════════════════════

const makeM = (chat, text = "") => ({
  chat, sender: chat, text, isGroup: false,
  key: { id: `M${Date.now()}`, remoteJid: chat, fromMe: false },
  message: { conversation: text },
  replies: [],
  reactions: [],
  async reply(value) { this.replies.push(value); },
  async react(value) { this.reactions.push(value); },
});

await check("plugins-no-impersonation", async () => {
  for (const file of ["plugins/owner/ping3.js", "plugins/main/تست2.js", "plugins/owner/اعلان.js"]) {
    const start = { relayed: relayed.length, sent: sent.length };
    const { handler, config } = await import(path.join(ROOT, file));
    assert.ok(config.name && Array.isArray(config.alias), `${file}: إعدادات البلوقن`);
    const m = makeM(AR, file.includes("اعلان") ? "إعلان مهم للجميع" : "");
    await handler(m, { sock });
    assert.deepEqual(m.replies, [], `${file}: رد بخطأ ${m.replies[0]}`);
    const out = [...relayed.slice(start.relayed).map((entry) => entry.message), ...sent.slice(start.sent).map((entry) => entry.content)];
    assert.ok(out.length > 0, `${file}: لم يُرسل شيئاً`);
    const serialized = JSON.stringify(out, (key, value) => (value?.type === "Buffer" ? "<buffer>" : value));
    assert.ok(!IMPERSONATION.test(serialized), `${file}: ما زال ينتحل Meta AI`);
    assert.ok(!/senderKeyDistributionMessage/.test(serialized), `${file}: رسالة توزيع مفاتيح مزيّفة`);
  }
  const announce = sent.at(-1).content;
  assert.equal(announce.text, "إعلان مهم للجميع");
  assert.match(announce.contextInfo.externalAdReply.sourceUrl, /^https:\/\/whatsapp\.com\/channel\//, "رابط البطاقة ليس رابطاً");
});

await check("project-wide-no-impersonation", () => {
  const SKIP = new Set(["node_modules", ".git", "session", "tmp", "temp", "backup", "database", "downloads"]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.m?js$/.test(entry.name) && !full.includes(`${path.sep}tests${path.sep}`)) {
        fs.readFileSync(full, "utf8").split("\n").forEach((line, index) => {
          const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
          if (/forwardedAiBotMessageInfo|botForwardedMessage|867051314767696|13135550002|["']0@bot["']/.test(code)) offenders.push(`${path.relative(ROOT, full)}:${index + 1}`);
        });
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, [], "انتحال Meta AI متبقٍّ في الكود");
});

await check("m-reply-routes-code-in-every-variant", async () => {
  const os = await import("node:os");
  const { initDatabase } = await import("../src/lib/terboo-database.js");
  const { serialize } = await import("../src/lib/terboo-serialize.js");
  const database = await initDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "terboo-rr-")));
  database.setting("replyVariant", 2); // شكل المستند مع الصورة — كان يبتلع الكود داخل تعليق
  const m = await serialize(sock, {
    key: { remoteJid: AR, fromMe: false, id: "RR-M1" },
    message: { conversation: "اكتب كود" },
    pushName: "مستخدم",
    messageTimestamp: Math.floor(Date.now() / 1000),
  });
  const start = { relayed: relayed.length, sent: sent.length };
  await m.reply(markRaw("تفضل:\n```python\nprint(\"مرحبا\")\n```"));
  const rich = relayed.slice(start.relayed).find((entry) => entry.message.richResponseMessage);
  assert.ok(rich, "رد m.reply بكود لم يمر بالمسار الغني");
  const subs = roundTrip(rich.message).richResponseMessage.submessages;
  assert.equal(joined(subs.find((sub) => sub.messageType === 5).codeMetadata.codeBlocks), "print(\"مرحبا\")\n");
  assert.equal(subs[0].messageText, "تفضل:");
  assert.ok(!sent.slice(start.sent).some((entry) => entry.content.document), "الكود أُرسل داخل مستند الشكل 2");
  await m.reply("نص عادي بلا كود");
  assert.ok(sent.slice(start.sent).some((entry) => entry.content.document), "الأشكال الأخرى تغيّرت للنص العادي");
});

console.log(`✅ terboo-rich-response: ${results.length} فحص · 18 لغة · تلوين بلا فقد · بديل تلقائي · بلا انتحال Meta AI`);
process.exit(0);
