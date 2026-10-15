#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🧰 ترحيل التصميم (§34–§36): يطبّق طبقة التصميم الموحّدة على نصوص المصدر
// ───────────────────────────────────────────────
// يمر بمحلّل AST (acorn) على كل نص يراه المستخدم — بنفس قواعد مستخرج الترجمة —
// ويطبّق عليه designLine() نفسها التي تعمل عند حدّ الإرسال:
//   backticks الزخرفة ⇒ تُزال · الإطارات القديمة ⇒ صفوف > ◈ وأقسام ❋ · الفواصل ⇒ فاصل المحرّك.
// لا يمس: كتل الكود متعددة الأسطر، لوحات الألعاب، نصوص الكود/القوالب البرمجية،
// المقارنات والتعابير النمطية ومفاتيح الكائنات (مستثناة كما في المستخرج).
//
//   node tools/terboo-design-migrate.mjs           ← معاينة (عدد التغييرات)
//   node tools/terboo-design-migrate.mjs --write   ← كتابة الملفات
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import { excluded, listFiles, technicalText, userVisibleInScraper, visit } from "./terboo-i18n-extract.mjs";
import { AESTHETIC_RE, LEGACY_RE, designLine, isBoard } from "../src/lib/terboo-design.js";

const ROOT = process.cwd();
const WRITE = process.argv.includes("--write");
const VERBOSE = process.argv.includes("--verbose");
const DUMP = process.argv.find((arg) => arg.startsWith("--dump="))?.slice(7);
const dumped = [];

/** ملفات المحرّك نفسه ومصادر الرموز: لا تُرحَّل */
const SKIP = [
  /^src\/lib\/terboo-design\.js$/,
  /^src\/lib\/terboo-ui-theme\.js$/,
  /^src\/lib\/terboo-i18n\//,
  /^src\/lib\/terboo-fonts\.js$/,
  // نصوص «تحفيل» فنية موثّقة كاستثناء ترجمة (tools/i18n/exceptions.json): محتوى لا واجهة
  /^plugins\/owner\/(امك|تحفيل)\.js$/,
];

const ESC_NL = "";
const FENCE = "";
const PH = (i) => `${i}`;
const PH_RE = /(\d+)/g;

/** نص برمجي يُعرض ككود (قوالب بلوقن، سكربتات): backticks فيه جزء من الكود */
// (عناصر الاستخدام مثل <query> و <رابط> ليست HTML — فقط الوسوم الحقيقية)
const CODE_LIKE = /=>|\bfunction\s*\(|\bimport\s[^\n]*\sfrom\s|export default|module\.exports|require\(|\b(?:const|let|var)\s+\w+\s*=|<\/?(?:html|head|body|div|span|script|style|table|tr|td|th|ul|ol|li|h[1-6]|svg|meta|link|img|br|p|a|b|i|u|pre|code)\b[^>]*>|\bawait\s+\w+\(/i;
/** أسماء متغيرات تحمل كوداً/مخرجات حرفية: ```${code}``` ⇒ كتلة كود حقيقية */
const CODE_NAMES = /(code|template|script|source|json|art|output|stdout|stderr|stack|snippet|html|css|sql|diff|patch|tree|raw)$/i;

/** raw ⇒ نص عمل: \` ⇒ ` و \n ⇒ علامة+سطر، وباقي المهرّبات كما هي */
function toWork(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === "`") out += "`";
      else if (next === "n") out += `${ESC_NL}\n`;
      else out += ch + next;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function fromWork(work, template) {
  const text = work.split(`${ESC_NL}\n`).join("\\n");
  return template ? text.replace(/`/g, "\\`") : text;
}

function exprName(node) {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return node.property?.name || "";
  if (node.type === "CallExpression") return exprName(node.callee);
  return "";
}

/**
 * يطبّق التصميم على نص عمل كامل (مع عناصر نائبة للتعابير).
 * @param {string} work
 * @param {{startsLine:boolean, endsLine:boolean, names:string[]}} ctx
 */
function transform(work, { startsLine, endsLine, names }) {
  if (isBoard(work)) return work.replace(/```([^`\n]*?)```/g, "$1").replace(/`([^`\n]*?)`/g, "$1");
  let text = work
    // حواجز كتل الكود متعددة الأسطر تُحمى
    .replace(/```(?=[\w-]*?\n)/g, FENCE.repeat(3))
    .replace(/(?<=\n)```/g, FENCE.repeat(3))
    // ```${code}``` في سطر واحد لمتغيّر يحمل كوداً ⇒ كتلة كود حقيقية
    .replace(/```((\d+))```/g, (all, ph, index) => (CODE_NAMES.test(names[Number(index)] || "")
      ? `${FENCE.repeat(3)}${ESC_NL}\n${ph}${ESC_NL}\n${FENCE.repeat(3)}` : all));
  const parts = text.split(/(?\n)/);
  const last = parts.length - 1;
  text = parts.map((part, i) => (i % 2 === 1 ? part : designLine(part, { start: i > 0 || startsLine, end: i < last || endsLine }))).join("");
  return text.split(FENCE.repeat(3)).join("```");
}

function cookedOf(node) {
  if (node.type === "Literal") return node.value;
  return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join("${}");
}

/** آخر نص حرفي في طرف سلسلة + (أو null إن لم يكن نصاً) */
function tailText(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral") return node.quasis[node.quasis.length - 1].value.cooked ?? "";
  if (node?.type === "BinaryExpression" && node.operator === "+") return tailText(node.right);
  return null;
}

/** هل يبدأ هذا النص سطراً؟ وهل ينتهي بنهاية سطر؟ (داخل سلسلة + أو فاصل join) */
function lineContext(node, ancestors) {
  const parent = ancestors[ancestors.length - 1];
  let startsLine = true;
  let endsLine = true;
  if (parent?.type === "BinaryExpression" && parent.operator === "+") {
    if (parent.right === node) {
      const tail = tailText(parent.left);
      // يسار غير نصي (متغيّر) ⇒ الغالب أن النص المزخرف يبدأ سطراً جديداً
      startsLine = tail === null ? true : /\n$/.test(tail);
    }
    if (parent.left === node) endsLine = false;
  }
  if (parent?.type === "CallExpression" && (parent.callee?.property?.name === "join")) { startsLine = true; endsLine = false; }
  return { startsLine, endsLine };
}

/** حروف مزخرفة (رياضية/صغيرة/عريضة/مطوّقة) — خطوط قديمة ممنوعة في الواجهة (§47) */
// (🅰️ 🅿️ … إيموجي عادية لا خط: الحروف المربّعة/المطوّقة تُعد فقط إذا تتابعت)
const STYLED_FONT = /[\u{1D400}-\u{1D7FF}]|[ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀᴛᴜᴠᴡʏᴢ]{2,}|[Ａ-Ｚａ-ｚ]{2,}|[\u{1F130}-\u{1F169}]{2,}|[ⓐ-ⓩ]{2,}/u;

function eligible(node, ancestors, rel, text) {
  if (!/`/.test(text) && !LEGACY_RE.test(text) && !AESTHETIC_RE.test(text) && !STYLED_FONT.test(text)) return false;
  const parent = ancestors[ancestors.length - 1];
  const joinArg = parent?.type === "CallExpression" && parent.callee?.property?.name === "join" && parent.arguments?.[0] === node;
  if (!joinArg && excluded(node, ancestors)) return false;
  if (technicalText(text) || CODE_LIKE.test(text)) return false;
  if (rel.startsWith("src/scraper/") && !userVisibleInScraper(ancestors)) return false;
  return true;
}

/**
 * كل نص يراه المستخدم في ملف (بنفس قواعد الترحيل) — يستعمله فحص التصميم الصارم.
 * @param {string} rel
 * @returns {Array<{text:string, line:number}>}
 */
function userFacingLiterals(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: rel.endsWith(".cjs") ? "script" : "module", allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true });
  } catch (error) {
    // ملف لا يُحلَّل لا يجوز أن يختفي من الفحص الصارم بصمت (§31 §36)
    throw new Error(`تعذّر تحليل ${rel} لفحص التصميم: ${error.message}`);
  }
  const out = [];
  visit(ast, [], (node, ancestors) => {
    const isTemplate = node.type === "TemplateLiteral";
    if (!isTemplate && !(node.type === "Literal" && typeof node.value === "string")) return;
    if (isTemplate && ancestors[ancestors.length - 1]?.type === "TaggedTemplateExpression") return;
    const text = cookedOf(node);
    if (eligible(node, ancestors, rel, text)) out.push({ text, line: node.loc.start.line });
  });
  return out;
}

/** ملفات يشملها الترحيل والفحص */
function designFiles() {
  return listFiles().filter((rel) => !SKIP.some((re) => re.test(rel)));
}

function migrateFile(rel) {
  const full = path.join(ROOT, rel);
  const code = fs.readFileSync(full, "utf8");
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: rel.endsWith(".cjs") ? "script" : "module", allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  } catch {
    return { edits: [], skipped: 0 };
  }
  const edits = [];
  let skipped = 0;
  visit(ast, [], (node, ancestors) => {
    const isTemplate = node.type === "TemplateLiteral";
    if (!isTemplate && !(node.type === "Literal" && typeof node.value === "string")) return;
    if (isTemplate && ancestors[ancestors.length - 1]?.type === "TaggedTemplateExpression") return;
    const text = cookedOf(node);
    if (!eligible(node, ancestors, rel, text)) return;
    const ctx = { ...lineContext(node, ancestors), names: isTemplate ? node.expressions.map(exprName) : [] };

    if (!isTemplate) {
      const raw = code.slice(node.start + 1, node.end - 1);
      const next = fromWork(transform(toWork(raw), ctx), false);
      if (next !== raw) edits.push({ start: node.start + 1, end: node.end - 1, text: next });
      return;
    }
    const work = node.quasis.map((q, i) => toWork(q.value.raw) + (i < node.expressions.length ? PH(i) : "")).join("");
    const out = transform(work, ctx);
    const pieces = [];
    let cursor = 0;
    let expected = 0;
    let ok = true;
    for (const match of out.matchAll(PH_RE)) {
      if (Number(match[1]) !== expected++) { ok = false; break; }
      pieces.push(out.slice(cursor, match.index));
      cursor = match.index + match[0].length;
    }
    pieces.push(out.slice(cursor));
    if (!ok || pieces.length !== node.quasis.length) { skipped += 1; return; }
    node.quasis.forEach((q, i) => {
      const next = fromWork(pieces[i], true);
      if (next !== q.value.raw) edits.push({ start: q.start, end: q.end, text: next });
    });
  });
  if (!edits.length) return { edits, skipped };
  edits.sort((a, b) => b.start - a.start);
  let result = code;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  try {
    acorn.parse(result, { ecmaVersion: "latest", sourceType: rel.endsWith(".cjs") ? "script" : "module", allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  } catch (error) {
    console.error(`✗ ${rel}: الناتج لا يُحلَّل (${error.message}) — لم يُكتب`);
    return { edits: [], skipped: skipped + 1 };
  }
  if (WRITE) fs.writeFileSync(full, result);
  if (DUMP) for (const edit of edits) dumped.push({ file: rel, before: code.slice(edit.start, edit.end), after: edit.text });
  if (VERBOSE) for (const edit of edits.slice(0, 3)) console.log(`  ${rel}: ${JSON.stringify(code.slice(edit.start, edit.end)).slice(0, 110)}\n     → ${JSON.stringify(edit.text).slice(0, 110)}`);
  return { edits, skipped };
}

export { SKIP, STYLED_FONT, designFiles, userFacingLiterals };

if (import.meta.url === `file://${process.argv[1]}`) {
const files = designFiles();
let changedFiles = 0;
let totalEdits = 0;
let totalSkipped = 0;
for (const rel of files) {
  const { edits, skipped } = migrateFile(rel);
  totalSkipped += skipped;
  if (edits.length) { changedFiles += 1; totalEdits += edits.length; }
}
if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(dumped, null, 1));
console.log(`${WRITE ? "✅ كُتب" : "🔎 معاينة"}: ${totalEdits} تعديل في ${changedFiles} ملف · تُرك ${totalSkipped} نص لمراجعة يدوية`);
}
