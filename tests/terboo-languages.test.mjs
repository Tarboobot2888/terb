// ═══════════════════════════════════════════════
// 🧪 Terboo Languages — دليل لغات البرمجة خارج نظام عرض الكود
// ───────────────────────────────────────────────
//   1. الدليل: 60+ لغة · أسماء ملفات خاصة (Dockerfile · Makefile · .env) · امتداد بأي حالة أحرف.
//   2. «كود بلغة X» بالعربي والإنجليزي يُعرف، وكلام عادي لا يُعدّ طلب كود.
//   3. المستندات: ملف الكود يُصنّف بلغته، والنموذج يعرف اسمها، و.env داخل أرشيف لا يُستخرج.
//   4. «حلل هذا الملف»: ملفات الكود المعروفة مقبولة، والثنائي بامتداد كود مرفوض.
//   5. طلب كود بلغة معيّنة ⇒ مسار الكود، والنموذج يُطلب منه تلك اللغة بوسم سياجها.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-languages-"));
process.env.TERBOO_LID_CACHE_PATH = path.join(tmp, "lid.json");
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
const L = await import("../src/lib/terboo-languages.js");
const docs = await import("../src/lib/terboo-documents.js");
const files = await import("../src/lib/terboo-file-intelligence.js");
const gate = await import("../src/lib/terboo-intent-gate.js");
const router = await import("../src/lib/terboo-ai-router.js");
const { zipSync, strToU8 } = await import("fflate");

const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

await check("catalog", async () => {
  assert.ok(Object.keys(L.LANGUAGES).length >= 60, `${Object.keys(L.LANGUAGES).length}`);
  const byFile = {
    "Dockerfile": "dockerfile", "deploy/Containerfile": "dockerfile", "src\\Makefile": "makefile", "CMakeLists.txt": "makefile",
    ".env": "ini", ".env.local": "ini", "App.KT": "kotlin", "main.rs": "rust", "Gemfile": "ruby", "build.gradle": "groovy",
    "query.GQL": "graphql", "main.tf": "terraform", "page.svelte": "svelte", "x.unknown": null, "photo.png": null, "": null,
  };
  for (const [name, id] of Object.entries(byFile)) assert.equal(L.languageFromFileName(name), id, name);
  // النثر ليس كوداً عند تصنيف المستندات
  assert.equal(L.languageFromFileName("README.md"), "markdown");
  assert.equal(L.codeLanguageFromFileName("README.md"), null);
  assert.deepEqual(["C#", "سي شارب", "golang", "py3", "nope"].map(L.languageId), ["csharp", "csharp", "go", "python", null]);
  assert.equal(L.languageLabel("objectivec"), "Objective-C");
});

await check("requested-language", async () => {
  const yes = {
    "اكتب كود بلغة روبي": "ruby", "اعمل لي كود كوتلن يجمع رقمين": "kotlin", "كود بالبايثون": "python", "عايز برنامج ببايثون": "python",
    "اكتبلي سكربت باور شيل": "powershell", "اكتب دالة بلغة سي شارب": "csharp", "كود سي++ للفرز": "cpp", "اكتب كود بلغة البرمجة جو": "go",
    "اكتب باللغة سويفت": "swift", "write a function in rust": "rust", "give me a kotlin script": "kotlin", "write hello world in swift": "swift",
    "send the go code": "go", "كود دوكر لتشغيل البوت": "dockerfile",
  };
  for (const [text, id] of Object.entries(yes)) assert.equal(L.requestedLanguage(text), id, text);
  for (const text of ["I want to make code that sorts", "write a poem in english", "promo code please", "الكود شغال؟", "كود جوجل", "رد بلغة انجليزي", "اكتب بلغة سياسية", "كود ماركداون", "شيل الرسالة دي"]) {
    assert.equal(L.requestedLanguage(text), null, text);
  }
});

await check("documents", async () => {
  assert.deepEqual(docs.detectDocument(Buffer.from("FROM node:20\n"), { fileName: "Dockerfile" }), { kind: "code", language: "dockerfile", ext: "" });
  assert.deepEqual(docs.detectDocument(Buffer.from("fun main() {}\n"), { fileName: "app.kt" }), { kind: "code", language: "kotlin", ext: "kt" });
  assert.equal(docs.detectDocument(Buffer.from("# hi\n"), { fileName: "notes.md" }).kind, "text", "Markdown نص");
  assert.equal(docs.detectDocument(Buffer.from("a {}"), { fileName: "style.scss" }).language, "scss");
  const doc = await docs.extractDocument(Buffer.from("fun main() { println(1) }\n"), { fileName: "Main.kt" });
  assert.match(docs.contextForModel(doc), /^UNTRUSTED DOCUMENT DATA \(code: Kotlin, Main\.kt,/);
  const zip = Buffer.from(zipSync({ "p/.env": strToU8("KEY=secret-value"), "p/.env.local": strToU8("K=2"), "p/Dockerfile": strToU8("FROM node"), "p/app.kt": strToU8("fun main(){}"), "p/x.png": strToU8("bin") }));
  const archive = await docs.extractDocument(zip, { fileName: "p.zip" });
  assert.deepEqual(archive.structure.textFiles.sort(), ["p/Dockerfile", "p/app.kt"]);
  assert.ok(!archive.text.includes("secret-value"), ".env داخل الأرشيف استُخرج");
});

await check("attachment-analysis", async () => {
  const go = files.readTextAttachment(Buffer.from("package main\n\nfunc main() {}\n"), { fileName: "main.go", mimetype: "application/octet-stream" });
  assert.equal(go.language, "go");
  assert.match(files.buildAttachmentAnalysisPrompt({ ...go, bytes: 30 }, "ar"), /النوع: Go · \.go/);
  assert.equal(files.readTextAttachment(Buffer.from("FROM node:20\n"), { fileName: "Dockerfile" }).language, "dockerfile");
  assert.throws(() => files.readTextAttachment(Buffer.from([0, 1, 2, 3, 0, 0, 255, 254]), { fileName: "evil.kt" }), /غير مدعوم/, "ثنائي بامتداد كود");
  assert.throws(() => files.readTextAttachment(Buffer.from([0, 1, 2]), { fileName: "photo.png", mimetype: "image/png" }), /غير مدعوم/);
});

await check("intent-and-route", async () => {
  for (const text of ["اكتب كود بلغة روبي", "write hello world in swift", "كود كوتلن يجمع رقمين"]) {
    const result = gate.classify({ text });
    assert.deepEqual([result.intent, result.op], ["CHAT", "code"], text);
    assert.equal(router.classifyAiTask({ text }), "code", text);
  }
  for (const text of ["ازيك يا تيربو", "write a poem in english", "promo code please"]) assert.notEqual(gate.classify({ text }).op, "code", text);
});

await check("code-instruction-language", async () => {
  const { initDatabase } = await import("../src/lib/terboo-database.js");
  const db = await initDatabase(tmp);
  const memory = await import("../src/lib/terboo-ai-memory.js");
  memory.initMemory(path.join(tmp, "memory"));
  const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
  await loadPlugins(path.join(process.cwd(), "plugins"));
  const core = await import("../src/lib/terboo-ai-core.js");
  const USER = "201066660001@s.whatsapp.net";
  const say = async (body) => {
    const calls = [];
    const replies = [];
    const m = {
      key: { remoteJid: USER, fromMe: false, id: `LG${calls.length}${Date.now()}` }, id: `LG${Date.now()}`, sender: USER, chat: USER, isGroup: false, body,
      type: "conversation", isCommand: false, prefix: ".", isOwner: false, mentionedJid: [], quoted: null, pushName: "عضو",
      async reply(text) { replies.push(String(text)); return { key: { id: "r" } }; }, async react() {},
    };
    const ask = async (payload) => { calls.push(payload.instruction || ""); return { text: "تمام:\n```ruby\nputs 'hi'\n```", provider: "GPT" }; };
    await core.runKernel(m, { user: { id: "201000000001:3@s.whatsapp.net" } }, db, { ask, rateLimit: false, media: {} });
    return { calls, replies };
  };
  const ruby = await say("اكتب كود بلغة روبي يطبع مرحبا");
  assert.ok(ruby.calls.some((instruction) => /The requested language is Ruby: write the code in Ruby and tag the fence ```ruby\./.test(instruction)), ruby.calls.join("\n---\n").slice(0, 600));
  const plain = await say("اكتب لي كود يطبع مرحبا");
  assert.ok(plain.calls.length && plain.calls.every((instruction) => !/The requested language is/.test(instruction)), "لغة بلا طلب");
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✅ terboo-languages: ${results.join(" · ")}`);
process.exit(0);
