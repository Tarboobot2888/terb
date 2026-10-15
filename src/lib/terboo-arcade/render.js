// ═══════════════════════════════════════════════
// 🖼️ TERBOO ARCADE — Renderers من View Model واحد
// ───────────────────────────────────────────────
// view (engine.getView) ⇒
//   text    : لوحة إيموجي + حالة (يعمل في كل عميل)
//   buttons : أزرار/قائمة تحمل Action ID مثبّتاً بـnonce النسخة
//   html    : بطاقة 3D HTML بلا صور؛ الأفعال عبر أزرار واتساب/الموقع
// لا يوجد مسار PNG/JPEG في عارض ألعاب TERBOO ARCADE.
// نفس View Model ⇒ اتساق العرض HTML والنص والأزرار.
// ═══════════════════════════════════════════════

import { buildGameHtml } from "../terboo-html-game.js";
import { L } from "./locale.js";

const MAX_BUTTONS = 3;
const ROWS_PER_SECTION = 10;
const MAX_SECTIONS = 4;
function actionLabel(action, lang) {
  if (action.labels) return String(action.labels[lang] ?? action.labels.en ?? action.label ?? action.id);
  if (action.labelKey) return L(lang, action.labelKey, action.labelVars || {});
  return String(action.label ?? action.id);
}

function playerLine(view, p, i) {
  const mark = view.marks?.[i] || p.mark || "";
  const turn = view.state === "PLAYING" && view.turn === i ? "👉 " : "";
  const score = view.scores?.[i] != null ? ` · ${view.scores[i]}` : "";
  const ai = p.isAI ? ` 🤖 ${L(view.lang, `ui.diff.${p.difficulty || "NORMAL"}`)}` : "";
  return `${turn}${mark} ${p.name}${ai}${score}`.trim();
}

function boardText(board) {
  if (!board) return "";
  if (board.kind === "lines") return (board.lines || []).join("\n");
  if (board.kind === "track") {
    const tokens = (board.tokens || []).map((tk) => `${tk.mark || "●"} ${tk.pos}`).join("   ");
    return tokens;
  }
  if (board.kind !== "grid") return "";
  const cols = Number(board.cols) || 3;
  const rows = [];
  const cells = board.cells || [];
  if (board.colLabels) rows.push(`${board.rowLabels ? "   " : ""}${board.colLabels.join(board.sep ?? "")}`);
  for (let r = 0; r * cols < cells.length; r += 1) {
    const line = cells.slice(r * cols, r * cols + cols).map((c) => c.t || "▫️").join(board.sep ?? "");
    rows.push(`${board.rowLabels ? `${board.rowLabels[r]} ` : ""}${line}`);
  }
  return rows.join("\n");
}

/** نص كامل للحالة (بديل لكل عميل) */
function textView(view, { note = "" } = {}) {
  const lang = view.lang || "ar";
  const lines = [`${view.icon || "🎮"} *${view.title}*`];
  if (view.players?.length) lines.push(view.players.map((p, i) => playerLine(view, p, i)).join("\n"));
  const board = boardText(view.board);
  if (board) lines.push(board);
  for (const p of view.panels || []) lines.push(`> ${p.label}: *${p.value}*`);
  if (view.status) lines.push(`_${view.status}_`);
  else if (view.state !== "PLAYING") lines.push(`_${L(lang, `ui.state.${view.state}`)}_`);
  if (note) lines.push(note);
  return lines.filter(Boolean).join("\n\n");
}

/**
 * أزرار + قائمة من الإجراءات القانونية.
 * المعرّف: «<prefix><cmd> a <roomId> <nonce> <index>» — index داخل legalActions لنفس النسخة،
 * والخادم يعيد حسابها ويرفض أي nonce قديم ⇒ الزر لا يستطيع إملاء نتيجة.
 */
function buttonsView(view, { prefix = ".", cmd = "اركيد", extra = [] } = {}) {
  const lang = view.lang || "ar";
  const base = `${prefix}${cmd} a ${view.roomId} ${view.nonce}`;
  const acts = (view.actions || []).map((a, i) => ({ id: `${base} ${i}`, text: actionLabel(a, lang).slice(0, 72), group: a.groupKey ? L(lang, a.groupKey) : a.group || null }));
  let buttons = [];
  let select = null;
  if (acts.length && acts.length <= MAX_BUTTONS) buttons = acts.map(({ id, text }) => ({ id, text }));
  else if (acts.length) {
    const groups = new Map();
    for (const a of acts) {
      const key = a.group || L(lang, "ui.chooseMove");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    const sections = [];
    for (const [title, rows] of groups) {
      for (let i = 0; i < rows.length && sections.length < MAX_SECTIONS; i += ROWS_PER_SECTION) {
        sections.push({ title: i ? L(lang, "ui.moreMoves") : title, rows: rows.slice(i, i + ROWS_PER_SECTION).map((r) => ({ id: r.id, title: r.text })) });
      }
    }
    select = { title: L(lang, "ui.btn.moves"), sections };
  }
  const roomCmd = `${prefix}${cmd}`;
  const room = extra.map((key) => ({ id: `${roomCmd} ${key} ${view.roomId}`, text: L(lang, `ui.btn.${key}`) }));
  // بلا قائمة: حتى 3 حركات + أزرار الغرفة (حد 4) · مع قائمة: الحركات في القائمة وأزرار الغرفة فقط
  return { buttons: select ? room.slice(0, MAX_BUTTONS) : [...buttons, ...room].slice(0, MAX_BUTTONS + 1), select };
}

function htmlView(view, { theme = null } = {}) {
  return buildGameHtml(view, { theme, lang: view.lang, labels: { footer: L(view.lang, "ui.footer") } });
}

export { actionLabel, boardText, buttonsView, htmlView, textView };
