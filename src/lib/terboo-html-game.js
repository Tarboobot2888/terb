// ═══════════════════════════════════════════════
// 🧩 TERBOO ARCADE — محرك HTML للألعاب
// ───────────────────────────────────────────────
// builder   : View Model ⇒ مستند HTML مستقل (CSS من نظام التصميم، بلا موارد خارجية)
// validator : فحص القالب (وسوم/سمات/بروتوكولات ممنوعة · حد الحجم) قبل أي عرض أو نقل
// registry  : htmlGameRegistry — قوالب لكل نوع لوحة؛ قوالب يقترحها الذكاء تمر من موافقة المالك فقط
// transport : build → serialize → encode → WAProto validate → decode → verify → (relay)
// runtime   : عقد زمن التشغيل وجسر الإجراءات موثّقان، لكن الجسر **غير مُفعّل**:
//             لا قناة مُثبتة تعيد نقرة داخل HTML إلى الخادم ⇒ HTML = عرض فقط،
//             والتفاعل عبر أزرار تحمل Action ID + nonce (hybrid). لا HTML Multiplayer وهمي.
// لا نسخ لأي معرّف/قيمة تحقق/بيانات وصفية من الكود المرجعي — كل المعرّفات ديناميكية.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { proto } from "@whiskeysockets/baileys";
import { protoMessage } from "./terboo-interactive-builder.js";
import { cssFor, dirOf, themeFor } from "./terboo-game-design-system.js";

const MAX_HTML_BYTES = 64 * 1024;
const TRANSPORT_KIND = "terboo.arcade.view";

/**
 * نقل HTML المضمَّن داخل رسالة واتساب: **مطفأ افتراضياً** ويُفتح صراحةً فقط.
 *
 * السبب:
 *   • `richResponseMessage.unifiedResponse.data` يحمل HTML فعلاً ويمر encode/decode
 *     بلا فقدان على @whiskeysockets/baileys 7.0.0-rc14 (مُثبت باختبار round-trip).
 *   • لكن نجاح الترميز ≠ تصيير العميل. هذا العنصر ردُّ مساعدٍ من Meta، ولا دليل
 *     أن حساباً عادياً يجعل WhatsApp Android يصيّره، ولا قناة تُعيد نقرة منه للخادم.
 *   • لذلك لا يُسلك هذا المسار افتراضياً، ولا يُسمّى «تفاعلياً».
 *
 * تجربة اللعب الفعلية هي Mini App الويب على /play/<token> (خادم = مصدر الحقيقة).
 * من يريد تجربة النقل المضمَّن على جهاز حقيقي يفعّله بـTERBOO_ARCADE_HTML=rich
 * أو config.arcade.html.transport = "rich"، ويبقى مسار البطاقة والأزرار كما هو.
 */
function resolveHtmlTransport(configured = null) {
  const env = String(process.env.TERBOO_ARCADE_HTML || "").trim().toLowerCase();
  if (env === "off" || env === "rich") return env;
  return configured === "rich" ? "rich" : "off";
}

/** حالة جسر الإجراءات: لا يُعلن «يعمل» إلا بإثبات Click → Action ID → Backend → Validate → Mutate → Response */
const ACTION_BRIDGE = Object.freeze({
  enabled: false,
  reason: "no-proven-client-channel",
  contract: { message: "terboo.action", fields: ["gameId", "sessionId", "actionId", "nonce", "payload", "timestamp"] },
});

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const FORBIDDEN_TAGS = ["script", "iframe", "object", "embed", "frame", "frameset", "link", "base", "form", "input", "textarea", "select", "applet", "foreignobject", "portal", "audio", "video", "source", "track"];
const FORBIDDEN_PROTOCOLS = /(javascript|vbscript|file|blob)\s*:|data\s*:\s*(text\/html|application|image\/svg)/i;

/** يفصل المستند إلى وسوم ونص: النص المُهرَّب لا يُفحَص كأنه markup. */
const TAG_RE = /<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;

/**
 * قيم السمات كما كُتبت (مع إزالة علامات التنصيص) لكل سمة في وسم واحد.
 * @returns {Array<{name:string, value:string}>}
 */
function attrsOf(rawAttrs) {
  const out = [];
  const re = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(String(rawAttrs || "")))) {
    if (!m[1]) continue;
    out.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? "" });
  }
  return out;
}

/**
 * يفحص قالب HTML.
 *
 * الفحص واعٍ بالبنية: السمات تُفحَص بأسمائها وقيمها، والنص المُهرَّب لا يُفحَص كـmarkup.
 * الفحص بـregex خام على المستند كله كان يرفض قوالب سليمة (نص لاعب مُهرَّب داخل
 * `aria-label` يحتوي ` onerror=` حرفياً) ويقبل الخطر نفسه بلا تمييز.
 * @returns {{ok:boolean, errors:string[], bytes:number}}
 */
function validateTemplate(html) {
  const errors = [];
  const text = String(html || "");
  const bytes = Buffer.byteLength(text, "utf8");
  if (!text.trim()) errors.push("empty");
  if (bytes > MAX_HTML_BYTES) errors.push(`too-large:${bytes}`);

  const forbidden = new Set(FORBIDDEN_TAGS);
  const styles = [];
  let match;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(text))) {
    const tag = match[1].toLowerCase();
    if (forbidden.has(tag)) errors.push(`tag:${tag}`);
    for (const { name, value } of attrsOf(match[2])) {
      // سمات الأحداث: الاسم وحده يحسم — لا قيمة مُهرَّبة تُشبهها
      if (/^on[a-z]+$/.test(name)) errors.push("event-handler-attribute");
      if (!value) continue;
      if (FORBIDDEN_PROTOCOLS.test(value)) errors.push("forbidden-protocol");
      if (["src", "href", "action", "xlink:href", "srcset", "poster", "formaction"].includes(name)
        && /^\s*(?:https?:)?\/\//i.test(value)) errors.push("external-resource");
      if (name === "style" && cssErrorsOf(value).length) errors.push(...cssErrorsOf(value));
      if (name === "http-equiv") errors.push("meta-http-equiv");
    }
  }
  const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  while ((match = STYLE_RE.exec(text))) styles.push(match[1]);
  for (const css of styles) errors.push(...cssErrorsOf(css));
  if (styles.length > 2) errors.push("too-many-styles");
  return { ok: errors.length === 0, errors: [...new Set(errors)], bytes };
}

/**
 * أخطاء CSS داخل كتلة style أو سمة style.
 * `behavior:` تعني خاصية IE القديمة فقط — `scroll-behavior:` و`overscroll-behavior:`
 * خصائص قياسية سليمة، فلا تُطابَق بسلسلة فرعية.
 */
function cssErrorsOf(css) {
  const out = [];
  const text = String(css || "");
  if (/@import/i.test(text)) out.push("css-injection");
  if (/\bexpression\s*\(/i.test(text)) out.push("css-injection");
  if (/(?:^|[;{\s])behavior\s*:/i.test(text)) out.push("css-injection");
  if (/url\(\s*["']?\s*(?:https?:)?\/\//i.test(text)) out.push("external-css-url");
  if (FORBIDDEN_PROTOCOLS.test(text)) out.push("forbidden-protocol");
  return out;
}

// ─────────────── القوالب (حسب نوع اللوحة) ───────────────

function gridHtml(board) {
  const cols = Math.max(1, Math.min(20, Number(board.cols) || 3));
  const cells = (board.cells || []).map((cell, index) => {
    const kind = String(cell.k || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
    const cls = ["ta-cell", kind ? `kind-${kind}` : "", cell.hl ? "hl" : "", cell.a != null ? "act" : "", cell.pop ? "pop" : ""].filter(Boolean).join(" ");
    const rawColor = cell.color ?? cell.c;
    const color = typeof rawColor === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i.test(rawColor) ? rawColor : "";
    const style = color ? ` style="--cell-color:${color}"` : "";
    const action = cell.a != null ? ` data-action="${escapeHtml(cell.a)}"` : "";
    const label = cell.t ?? cell.n ?? "";
    return `<div class="${cls}"${style}${action} aria-label="${escapeHtml(`cell ${index + 1}`)}">${escapeHtml(label)}</div>`;
  }).join("");
  return `<div class="ta-board"><div class="ta-board-in" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${cells}</div></div>`;
}

function trackHtml(board) {
  const size = Math.max(1, Math.min(200, Number(board.size) || 100));
  const cols = Math.max(2, Math.min(20, Number(board.cols) || 10));
  const rows = Math.ceil(size / cols);
  const tokensAt = new Map();
  for (const tk of board.tokens || []) tokensAt.set(tk.pos, [...(tokensAt.get(tk.pos) || []), tk]);
  const jumps = new Map([...(board.snakes || []).map(([a, b]) => [a, `🐍 ${b}`]), ...(board.ladders || []).map(([a, b]) => [a, `🪜 ${b}`])]);
  const cells = [];
  for (let r = rows - 1; r >= 0; r -= 1) {
    const line = [];
    for (let c = 0; c < cols; c += 1) line.push(r * cols + c + 1);
    if (r % 2 === 1) line.reverse();
    for (const n of line) {
      if (n > size) continue;
      const tks = (tokensAt.get(n) || []).map((tk) => `<span class="ta-dot" style="background:${/^#[0-9a-f]{3,8}$/i.test(String(tk.color || "")) ? tk.color : "var(--accent2)"}"></span>`).join("");
      cells.push(`<div class="ta-cell ta-track-cell">${n}${jumps.has(n) ? `<small>${escapeHtml(jumps.get(n))}</small>` : ""}${tks ? `<div>${tks}</div>` : ""}</div>`);
    }
  }
  return `<div class="ta-board"><div class="ta-board-in" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${cells.join("")}</div></div>`;
}

function linesHtml(board) {
  const rows = (board.lines || []).slice(-24).map((line) => `<div class="ta-line">${escapeHtml(line)}</div>`).join("");
  return `<div class="ta-lines">${rows || '<div class="ta-line">—</div>'}</div>`;
}
/** htmlGameRegistry: نوع اللوحة ⇒ قالب. القوالب المعتمدة فقط (لا قالب خام من إضافة) */
const htmlGameRegistry = new Map([
  ["grid", gridHtml],
  ["track", trackHtml],
  ["lines", linesHtml],
]);
const pendingTemplates = new Map();

/**
 * اقتراح قالب (من الذكاء أو المالك) — يُفحص ويُحفظ معلّقاً، ولا يُستعمل حتى يعتمده المالك.
 * @returns {{ok, id?, errors?}}
 */
function proposeTemplate({ kind, html, by }) {
  const check = validateTemplate(html);
  if (!check.ok) return { ok: false, errors: check.errors };
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(String(kind || ""))) return { ok: false, errors: ["bad-kind"] };
  const id = `tpl_${crypto.randomBytes(5).toString("hex")}`;
  pendingTemplates.set(id, { id, kind, html: String(html), by: String(by || ""), at: Date.now() });
  return { ok: true, id };
}

/** اعتماد قالب معلّق — المالك فقط (isOwner من محرك الصلاحيات، لا من النموذج) */
function approveTemplate(id, { isOwner = false } = {}) {
  if (!isOwner) return { ok: false, errors: ["owner-only"] };
  const tpl = pendingTemplates.get(id);
  if (!tpl) return { ok: false, errors: ["unknown-template"] };
  const check = validateTemplate(tpl.html);
  if (!check.ok) return { ok: false, errors: check.errors };
  const fixed = tpl.html;
  // قالب ثابت معتمد: يُعرض كما هو (القيم الديناميكية تبقى من القوالب المدمجة)
  htmlGameRegistry.set(tpl.kind, () => fixed);
  pendingTemplates.delete(id);
  return { ok: true, kind: tpl.kind };
}

// ─────────────── البنّاء ───────────────

/**
 * View Model ⇒ مستند HTML كامل.
 * @param {Object} view من engine.getView (+ status/panels/board)
 * @param {{theme?:string, lang?:string, labels?:Object}} opts
 */
function buildGameHtml(view, { theme = null, lang = view?.lang || "ar", labels = {} } = {}) {
  const t = themeFor(theme || view?.theme, view?.category);
  const dir = dirOf(lang);
  const safeLang = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(String(lang || "")) ? String(lang) : "ar";
  // بعض الألعاب (مثل وردل العربي) لها لوحة HTML مخصصة بالإضافة إلى سجل نصي احتياطي.
  // `view.visualBoard` (سابقاً `view.image`) هو **View Model منظَّم** لشبكة/مسار،
  // يُصيَّر عناصرَ HTML — لا بكسل ولا صورة. أُعيدت تسميته لإزالة الغموض عن حارس الصور.
  const visualBoard = view?.visualBoard || view?.board;
  const render = htmlGameRegistry.get(visualBoard?.kind) || (() => "");
  // لا صور داخل بطاقة اللعبة: لا data URL ولا Base64 ولا <img>. الأصول البصرية
  // للألعاب القائمة على صورة تُعرض داخل صفحة Mini App على same-origin فقط.
  const stateLabel = String(view?.status || view?.state || "");
  const title = String(view?.title || "TERBOO ARCADE");
  const players = (view?.players || []).map((p, i) => {
    const on = view.turn === i && view.state === "PLAYING" ? " on" : "";
    const mark = p.mark || view.marks?.[i] || "";
    const score = view?.scores?.[i] != null ? `<small class="ta-player-score">${escapeHtml(view.scores[i])}</small>` : "";
    return `<div class="ta-chip${on}"><span class="ta-dot" style="background:${t.seats[i % t.seats.length]}"></span><span>${escapeHtml(mark)} ${escapeHtml(p.name)}${p.isAI ? " · 🤖" : ""}</span>${score}</div>`;
  }).join("");
  const panels = (view?.panels || []).slice(0, 8).map((p) => `<div class="ta-panel"><b>${escapeHtml(p.label)}</b><span>${escapeHtml(p.value)}</span></div>`).join("");
  const actionItems = (view?.actions || []).slice(0, 10).map((a) => `<span class="ta-action-chip">${escapeHtml(a.label || a.id)}</span>`).join("");
  const controlHint = view?.state === "PLAYING" && (view?.actions?.length || view?.free?.length)
    ? (safeLang.startsWith("ar") ? "استخدم أزرار واتساب أو أرسل الحركة في المحادثة. هذه البطاقة تعرض الحالة الحالية." : safeLang.startsWith("es") ? "Usa los botones de WhatsApp o escribe tu movimiento en el chat." : "Use the WhatsApp buttons or type your move in chat. This card shows the live game state.")
    : "";
  const gameCode = String(view?.gameId || view?.id || "ARCADE").replace(/[^a-z0-9_-]/gi, " ").trim().toUpperCase();
  const body = [
    `<main class="ta-shell"><section class="ta" dir="${dir}">`,
    `<header class="ta-head"><span class="ta-emblem" aria-hidden="true">${escapeHtml(view?.icon || "🎮")}</span><div class="ta-brand"><small class="ta-kicker">TERBOO ARCADE · 3D EDITION</small><strong class="ta-title">${escapeHtml(title)}</strong></div><span class="ta-pill">${escapeHtml(stateLabel)}</span></header>`,
    `<div class="ta-meta"><span>${escapeHtml(gameCode || "ARCADE")}</span><i></i><span>${safeLang.startsWith("ar") ? "لعبة تفاعلية" : safeLang.startsWith("es") ? "JUEGO EN VIVO" : "LIVE GAME"}</span></div>`,
    players ? `<div class="ta-players">${players}</div>` : "",
    // (لا <figure>/<img> هنا: مسار الصور في الألعاب محذوف بالكامل)
    visualBoard ? `<section class="ta-playfield" aria-label="${escapeHtml(title)}">${render(visualBoard)}</section>` : `<section class="ta-empty">${escapeHtml(view?.description || stateLabel || "🎮")}</section>`,
    panels ? `<div class="ta-panels">${panels}</div>` : "",
    actionItems ? `<div class="ta-actions">${actionItems}</div>` : "",
    controlHint ? `<div class="ta-control-hint"><strong>↗</strong><span>${escapeHtml(controlHint)}</span></div>` : "",
    `<footer class="ta-foot"><span>${escapeHtml(labels.footer || "BOT TERBOO")}</span><span>ARCADE SYSTEMS · V6</span></footer>`,
    "</section></main>",
  ].join("");
  const html = `<!doctype html><html lang="${escapeHtml(safeLang)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><title>${escapeHtml(title)}</title><style>${cssFor(t, safeLang)}</style></head><body>${body}</body></html>`;
  return html;
}

/**
 * بطاقة HTML عامة لرسائل الألعاب القديمة (الحالة، النتائج، السجلات والقوائم النصية).
 * لا تغيّر حالة اللعبة؛ إنها طبقة عرض فقط وتبقى أوامر/أزرار واتساب هي وسيلة التحكم.
 */
function buildTextGameHtml({ gameId = "ARCADE", icon = "🎮", title = "TERBOO ARCADE", body = "", text = "", status = "LIVE", lang = "ar", theme = null } = {}) {
  const plain = (value) => String(value ?? "")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~([^~]+)~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[\*_~`]/g, "")
    .replace(/\u0000/g, "");
  const lines = [body, text]
    .filter((part) => String(part ?? "").trim())
    .join("\n")
    .split(/\r?\n/)
    .map((line) => plain(line).trim().slice(0, 280))
    .filter(Boolean)
    .slice(0, 24);
  return buildGameHtml({
    gameId,
    title: (plain(title).slice(0, 120)) || "TERBOO ARCADE",
    icon,
    category: "arcade",
    state: "PLAYING",
    status: plain(status).slice(0, 80) || "LIVE",
    board: { kind: "lines", lines: lines.length ? lines : ["—"] },
  }, { theme, lang });
}

/** يرسل أو يحاول إرسال بطاقة HTML مستقلة؛ يظل على المستدعي إرسال مساره الاحتياطي. */
async function relayHtmlGame(sock, jid, html, { transport = "rich", meta = {} } = {}) {
  if (transport !== "rich") return { relayed: false, reason: "transport-disabled" };
  const packet = encodeTransport(html, meta);
  if (!packet.ok) return { relayed: false, reason: "transport-invalid", stages: packet.stages };
  return relayTransport(sock, jid, packet, { enabled: true });
}

/**
 * Каталог игр: статичная HTML-карточка для меню. Кнопки запуска остаются нативными WhatsApp.
 * @param {Array<{id:string,icon:string,title:string,description:string,category:string,mode:string,players:string}>} items
 */
function buildArcadeCatalogHtml(items, { lang = "ar", title: titleOverride = null, subtitle: subtitleOverride = null } = {}) {
  const safeLang = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(String(lang || "")) ? String(lang) : "ar";
  const dir = dirOf(safeLang);
  const t = themeFor("NEON", "arcade");
  const cards = (Array.isArray(items) ? items : []).slice(0, 40).map((game, index) => {
    const tags = [game.category, game.mode, game.players].filter(Boolean).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    return `<article class="ta-game-card"><div class="ta-game-top"><span class="ta-game-icon">${escapeHtml(game.icon || "🎮")}</span><small class="ta-game-index">GAME ${String(index + 1).padStart(2, "0")}</small></div><h3>${escapeHtml(game.title || game.id || "ARCADE")}</h3><p>${escapeHtml(game.description || "")}</p><div class="ta-game-tags">${tags}</div></article>`;
  }).join("");
  const title = titleOverride || (safeLang.startsWith("ar") ? "ألعاب تربو" : safeLang.startsWith("es") ? "Juegos Terboo" : "Terboo Games");
  const subtitle = subtitleOverride || (safeLang.startsWith("ar") ? "اختر لعبتك وابدأ التحدي" : safeLang.startsWith("es") ? "Elige tu juego y acepta el reto" : "Pick a game. Start the challenge.");
  const hint = safeLang.startsWith("ar") ? "استخدم قائمة الاختيار أسفل الرسالة لتشغيل اللعبة. لوحة HTML للعرض؛ تنفيذ الحركات يتم بأمان عبر البوت." : safeLang.startsWith("es") ? "Usa el selector de WhatsApp para abrir un juego. Los movimientos se validan en el servidor." : "Use the WhatsApp selector below to launch a game. Moves remain server-validated.";
  return `<!doctype html><html lang="${escapeHtml(safeLang)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><title>${escapeHtml(title)}</title><style>${cssFor(t, safeLang)}</style></head><body><main class="ta-shell"><section class="ta" dir="${dir}"><header class="ta-head"><span class="ta-emblem">🎮</span><div class="ta-brand"><small class="ta-kicker">TERBOO ARCADE · 3D SYSTEM</small><strong class="ta-title">${escapeHtml(title)}</strong></div><span class="ta-pill">V6</span></header><div class="ta-meta"><span>${escapeHtml(subtitle)}</span></div><div class="ta-catalog-grid">${cards}</div><div class="ta-catalog-hint">${escapeHtml(hint)}</div><footer class="ta-foot"><span>BOT TERBOO</span><span>3D ARCADE COLLECTION · ${Math.min(Array.isArray(items) ? items.length : 0, 40)} GAMES</span></footer></section></main></body></html>`;
}

// ─────────────── النقل (Transport) ───────────────

/**
 * build → serialize → encode → WAProto validate → decode → verify.
 * لا يرسل شيئاً: يعيد الرسالة الجاهزة ونتيجة كل مرحلة.
 * @returns {{ok:boolean, stages:Array<{stage:string, ok:boolean, detail?:string}>, message?:Object, bytes?:number, sha256?:string}}
 */
function encodeTransport(html, meta = {}) {
  const stages = [];
  const mark = (stage, ok, detail) => {
    stages.push({ stage, ok, ...(detail ? { detail } : {}) });
    return ok;
  };
  const check = validateTemplate(html);
  if (!mark("build", check.ok, check.errors.join(",") || undefined)) return { ok: false, stages };
  const sourceHtml = String(html);
  const sha256 = crypto.createHash("sha256").update(sourceHtml).digest("hex");
  const responseId = crypto.randomUUID();
  const title = sourceHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "").slice(0, 120) || "TERBOO ARCADE";
  // البنية المستخدمة لعنصر HTML الغني فقط. لا botForwardedMessage ولا botMetadata
  // ولا شهادات/توقيعات مصطنعة ولا trusted_sources. HTML للعرض؛ التحكم الحقيقي من أزرار واتساب/الخادم.
  const response = {
    response_id: responseId,
    sections: [{
      view_model: {
        primitive: { __typename: "GenAIaeacdsnwHtmlPrimitive", payload: sourceHtml },
        __typename: "GenAISingleLayoutViewModel",
      },
    }],
  };
  const json = JSON.stringify(response);
  mark("serialize", true);
  const data = Buffer.from(json, "utf8");
  const message = {
    messageContextInfo: { messageSecret: crypto.randomBytes(32) },
    richResponseMessage: {
      messageType: 1,
      submessages: [{ messageType: 2, messageText: title }],
      unifiedResponse: { data },
    },
  };
  let typed;
  try {
    const invalid = typeof proto.Message.verify === "function" ? proto.Message.verify(message) : null;
    if (invalid) throw new Error(invalid);
    typed = protoMessage("Message", message);
    const carried = typed.richResponseMessage?.unifiedResponse?.data;
    if (!carried || Buffer.from(carried).length !== data.length) throw new Error("unifiedResponse.data not carried");
    mark("validate", true);
  } catch (error) {
    mark("validate", false, String(error?.message || error));
    return { ok: false, stages };
  }
  let encoded;
  try {
    encoded = proto.Message.encode(typed).finish();
    mark("encode", encoded.length > 0, `${encoded.length}B`);
  } catch (error) {
    mark("encode", false, String(error?.message || error));
    return { ok: false, stages };
  }
  let decoded;
  try {
    decoded = proto.Message.decode(encoded);
    mark("decode", true);
  } catch (error) {
    mark("decode", false, String(error?.message || error));
    return { ok: false, stages };
  }
  let back;
  try {
    const bytes = decoded.richResponseMessage?.unifiedResponse?.data;
    back = JSON.parse(Buffer.from(bytes || []).toString("utf8") || "{}");
  } catch (error) {
    mark("verify", false, "invalid-json-roundtrip");
    return { ok: false, stages };
  }
  const carriedHtml = back?.sections?.[0]?.view_model?.primitive?.payload;
  const same = back.response_id === responseId && carriedHtml === sourceHtml && crypto.createHash("sha256").update(carriedHtml || "").digest("hex") === sha256;
  if (!mark("verify", same, same ? undefined : "roundtrip-mismatch")) return { ok: false, stages };
  return { ok: true, stages, message: typed, bytes: encoded.length, sha256, responseId, sessionId: String(meta.sessionId || ""), version: Number(meta.version) || 0 };
}
/**
 * relay: محاولة HTML غنية اختيارية من دون انتحال بيانات Meta. إن تجاهل العميل صيغة HTML،
 * يستمر مسار النص والأزرار الأصلية كبديل؛ لا يجري الاعتماد على HTML لاتخاذ قرارات اللعب.
 */
async function relayTransport(sock, jid, transport, { enabled = false } = {}) {
  if (!enabled) return { relayed: false, reason: "client-rendering-unproven" };
  if (!transport?.ok || typeof sock?.relayMessage !== "function") return { relayed: false, reason: "transport-invalid" };
  const messageId = crypto.randomBytes(8).toString("hex").toUpperCase();
  await sock.relayMessage(jid, transport.message, { messageId });
  return { relayed: true, messageId };
}

export { ACTION_BRIDGE, MAX_HTML_BYTES, TRANSPORT_KIND, approveTemplate, buildArcadeCatalogHtml, buildGameHtml, buildTextGameHtml, encodeTransport, escapeHtml, htmlGameRegistry, pendingTemplates, proposeTemplate, relayHtmlGame, relayTransport, resolveHtmlTransport, validateTemplate };
