// ═══════════════════════════════════════════════
// 🖼️ Terboo Code Card — مُرسِم PNG اختياري للتوافق
// ───────────────────────────────────────────────
// المسار الافتراضي الآن هو Native Rich Code؛ هذا الملف لا يُستخدم للمسار الرئيسي،
// ويظل فقط كمُرسِم PNG اختياري للتوافق مع المستوردات القديمة. البديل الرسمي: الكود نفسه مرسوماً كبطاقة محرّر
// (خلفية داكنة · تلوين صياغي · أرقام أسطر · اسم اللغة) بخطوط المشروع (لا خطوط النظام).
//
//   • التلوين من tokenize() نفسه (بلا فقد) — نفس محلّل الرسائل الغنية.
//   • الحروف اللاتينية تُرسم حرفاً حرفاً على شبكة ثابتة (لا ربط «===»، محاذاة تامة).
//   • التعليقات/النصوص العربية تُرسم كمقاطع كاملة بخط عربي (تشكيل واتجاه صحيحان)،
//     فلا تنقلب الأقواس ولا يتبعثر السطر كما في نص واتساب داخل رسالة عربية.
//   • الأسطر الطويلة تُلف داخل البطاقة؛ والطويلة جداً تُقص مع «+N سطر» (النسخة الكاملة
//     تصل للنسخ مع البطاقة — انظر terboo-code-renderer).
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import { FAMILY, registerFonts } from "./terboo-fonts.js";
import { HIGHLIGHT, languageLabel, tokenize } from "./terboo-rich-response.js";

const THEME = {
  frameTop: "#0b1020",
  frameBottom: "#1a2140",
  window: "#0d1117",
  header: "#161b22",
  border: "#30363d",
  gutter: "#6e7681",
  label: "#c9d1d9",
  muted: "#8b949e",
  dots: ["#ff5f56", "#ffbd2e", "#27c93f"],
  accent: "#2f81f7",
};
const COLORS = {
  [HIGHLIGHT.DEFAULT]: "#e6edf3",
  [HIGHLIGHT.KEYWORD]: "#ff7b72",
  [HIGHLIGHT.METHOD]: "#d2a8ff",
  [HIGHLIGHT.STRING]: "#a5d6ff",
  [HIGHLIGHT.NUMBER]: "#79c0ff",
  [HIGHLIGHT.COMMENT]: "#8b949e",
};

const LIMITS = { fontSize: 26, lineHeight: 40, minCols: 36, maxCols: 84, maxLines: 45, tabWidth: 4 };
const RTL_RUN = /([֐-ࣿיִ-﷿ﹰ-﻿]+(?:[ \t]+[֐-ࣿיִ-﷿ﹰ-﻿]+)*)/u;

/** أجزاء سطر ← مقاطع بلون؛ الأسطر مفصولة بحسب \n داخل كتل المحلّل */
function logicalLines(code, language) {
  const lines = [[]];
  for (const block of tokenize(String(code).replace(/\r\n?/g, "\n"), language)) {
    const color = COLORS[block.highlightType] || COLORS[HIGHLIGHT.DEFAULT];
    const pieces = block.codeContent.replace(/\t/g, " ".repeat(LIMITS.tabWidth)).split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) lines.push([]);
      if (piece) lines[lines.length - 1].push({ text: piece, color });
    });
  }
  // سطر فارغ أخير من «\n» الختامي لا يُعرض
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  return lines;
}

/** وحدات رسم: حرف لاتيني واحد (عرض خلية) أو مقطع عربي كامل (عرض مقاس) */
function unitsOf(segments, ctx, charWidth) {
  const units = [];
  for (const { text, color } of segments) {
    for (const part of text.split(RTL_RUN)) {
      if (!part) continue;
      if (RTL_RUN.test(part) && /[֐-ࣿיִ-﷿ﹰ-﻿]/u.test(part)) {
        const width = ctx.measureText(part).width;
        units.push({ text: part, color, rtl: true, width, cols: Math.max(1, Math.ceil(width / charWidth)) });
      } else {
        for (const ch of Array.from(part)) units.push({ text: ch, color, rtl: false, width: charWidth, cols: 1 });
      }
    }
  }
  return units;
}

/** لفّ السطر على عدد الأعمدة: [{units, number|null}] */
function wrap(units, cols, number) {
  const rows = [];
  let row = [];
  let used = 0;
  for (const unit of units) {
    if (used + unit.cols > cols && row.length) {
      rows.push({ units: row, number: rows.length ? null : number });
      row = [];
      used = 2; // إزاحة سطر الاستمرار
    }
    row.push(unit);
    used += unit.cols;
  }
  rows.push({ units: row, number: rows.length ? null : number, indent: rows.length > 0 });
  return rows.map((entry, index) => ({ ...entry, indent: index > 0 }));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * يرسم بطاقة كود.
 * @param {{code:string, language?:string, title?:string, brand?:string}} input
 * @returns {Promise<Buffer|null>} PNG أو null إن تعذّر الرسم (المستدعي يعود للنص)
 */
async function renderCodeCard({ code, language = "", title = "", brand = "" } = {}) {
  if (typeof code !== "string" || !code.trim()) return null;
  let canvasLib;
  try {
    canvasLib = await import("@napi-rs/canvas");
  } catch (error) {
    noteFailure("code-card", error, { where: "src/lib/terboo-code-card.js:renderCodeCard", stage: "import:canvas", fallback: "text" });
    return null;
  }
  await registerFonts();
  const font = `${LIMITS.fontSize}px "${FAMILY.mono}", "${FAMILY.arabic}", "${FAMILY.latin}"`;
  const probe = canvasLib.createCanvas(10, 10).getContext("2d");
  probe.font = font;
  const charWidth = probe.measureText("M").width || LIMITS.fontSize * 0.6;

  const lines = logicalLines(code, language);
  const longest = Math.max(1, ...lines.map((segments) => unitsOf(segments, probe, charWidth).reduce((sum, unit) => sum + unit.cols, 0)));
  const cols = Math.min(LIMITS.maxCols, Math.max(LIMITS.minCols, longest));
  const allRows = lines.flatMap((segments, index) => wrap(unitsOf(segments, probe, charWidth), cols, index + 1));
  const truncated = Math.max(0, allRows.length - LIMITS.maxLines);
  const rows = truncated ? allRows.slice(0, LIMITS.maxLines - 1) : allRows;

  const gutterDigits = String(lines.length).length;
  const pad = 40;
  const inner = 28;
  const header = 64;
  const gutter = gutterDigits * charWidth + 32;
  const windowWidth = Math.ceil(inner * 2 + gutter + cols * charWidth);
  const bodyHeight = (rows.length + (truncated ? 1 : 0)) * LIMITS.lineHeight;
  const width = windowWidth + pad * 2;
  const height = Math.ceil(pad * 2 + header + inner * 2 + bodyHeight);

  const canvas = canvasLib.createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const frame = ctx.createLinearGradient(0, 0, width, height);
  frame.addColorStop(0, THEME.frameTop);
  frame.addColorStop(1, THEME.frameBottom);
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, width, height);

  // النافذة + ظل
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  roundRect(ctx, pad, pad, windowWidth, height - pad * 2, 16);
  ctx.fillStyle = THEME.window;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, pad, pad, windowWidth, height - pad * 2, 16);
  ctx.strokeStyle = THEME.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  // الشريط العلوي: نقاط المحرّر · اللغة/العنوان · اسم البوت
  ctx.save();
  roundRect(ctx, pad, pad, windowWidth, header, 16);
  ctx.clip();
  ctx.fillStyle = THEME.header;
  ctx.fillRect(pad, pad, windowWidth, header);
  ctx.restore();
  ctx.fillStyle = THEME.border;
  ctx.fillRect(pad, pad + header - 1, windowWidth, 2);
  THEME.dots.forEach((color, index) => {
    ctx.beginPath();
    ctx.arc(pad + 30 + index * 26, pad + header / 2, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
  ctx.textBaseline = "middle";
  const label = [languageLabel(language) || "Code", title].filter(Boolean).join(" · ");
  ctx.font = `bold 22px "${FAMILY.mono} Bold", "${FAMILY.mono}", "${FAMILY.arabic}"`;
  ctx.fillStyle = THEME.label;
  ctx.fillText(label, pad + 30 + 3 * 26 + 14, pad + header / 2);
  if (brand) {
    ctx.font = `20px "${FAMILY.latin}", "${FAMILY.arabic}"`;
    ctx.fillStyle = THEME.muted;
    const w = ctx.measureText(brand).width;
    ctx.fillText(brand, pad + windowWidth - 24 - w, pad + header / 2);
  }

  // الأسطر
  ctx.font = font;
  ctx.textBaseline = "middle";
  const top = pad + header + inner;
  const left = pad + inner;
  rows.forEach((row, index) => {
    const y = top + index * LIMITS.lineHeight + LIMITS.lineHeight / 2;
    if (row.number) {
      ctx.fillStyle = THEME.gutter;
      const text = String(row.number);
      ctx.fillText(text, left + gutter - 24 - ctx.measureText(text).width, y);
    }
    let x = left + gutter + (row.indent ? 2 * charWidth : 0);
    for (const unit of row.units) {
      ctx.fillStyle = unit.color;
      if (unit.text.trim()) ctx.fillText(unit.text, x, y);
      x += unit.rtl ? unit.cols * charWidth : charWidth;
    }
  });
  if (truncated) {
    const y = top + rows.length * LIMITS.lineHeight + LIMITS.lineHeight / 2;
    ctx.fillStyle = THEME.muted;
    ctx.fillText(`… +${truncated + 1}`, left + gutter, y);
  }
  return canvas.toBuffer("image/png");
}

export { LIMITS as CODE_CARD_LIMITS, renderCodeCard };
export default { renderCodeCard };
