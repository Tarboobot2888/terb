// ═══════════════════════════════════════════════
// 👁️ Visual Command Eligibility Engine + عقد VisualResponse
// ───────────────────────────────────────────────
// • visualMetadata(command): أي شكل عرض يستحقه كل أمر — html · hybrid · buttons · media · text
//   الألعاب الموحّدة تعرض بطاقة HTML ثلاثية الأبعاد مع أزرار واتساب؛ لا صور لوحات.
//   HTML اختياري تجريبي يعتمد على العميل، وأزرار واتساب تظل مسار التحكم الموثوق.
// • VisualResponse: {mode, cardId, title?, text, image?, actions[], select?, html?, mentions?, to?}
//   validateVisualResponse يرفض: أزرار بلا معرّف (ميتة) · HTML لم يمر من المدقق · نص فارغ.
// • deliverVisual: المسار الوحيد لتسليمه (sendCard الموحّد + نقل HTML اختياري بإذن المالك).
// المصادر: terboo-command-ui (أهلية الأزرار) + سجل الألعاب الموحّد (uiMode لكل لعبة).
// ═══════════════════════════════════════════════

import config from "../../config.js";
import { getPlugin, getAllPlugins } from "./terboo-plugins.js";
import { uiOf } from "./terboo-command-ui.js";
import { games } from "./terboo-games.js";
import { ACTION_BRIDGE, encodeTransport, relayTransport, resolveHtmlTransport, validateTemplate } from "./terboo-html-game.js";
import { noteFailure } from "./terboo-failure-log.js";
import { sendCard } from "./terboo-ui-kit.js";

const VISUAL_MODES = Object.freeze(["html", "hybrid", "buttons", "media", "text"]);
/**
 * بادئات معرّفات بطاقات الألعاب. أي VisualResponse بأحدها **يُمنع** من حمل صورة.
 * الحارس مقيَّد بالألعاب حتى لا يمس الملصقات والتنزيلات وبطاقات canvas العامة.
 */
const GAME_CARD_PREFIXES = Object.freeze(["arcade:", "quiz:", "game:"]);
/** هل هذا المعرّف بطاقة لعبة؟ */
const isGameCard = (cardId) => GAME_CARD_PREFIXES.some((p) => String(cardId || "").startsWith(p));
/** ألعاب قديمة رُحّلت إلى Hybrid (أزرار فوق منطقها الخاص) */
const HYBRID_LEGACY = new Set(["مستذئب", "دنجن", "نينجا", "mct"]);
const MEDIA_CATEGORIES = new Set(["download", "downloader", "sticker", "canvas", "maker", "image", "random"]);

const htmlTransportMode = () => resolveHtmlTransport(config.arcade?.html?.transport);

/** لعبة الأمر (إن كان أمر لعبة على السجل الموحّد) */
function gameOf(command) {
  const plugin = getPlugin(String(command || ""));
  const rawName = plugin?.config?.name;
  const name = (Array.isArray(rawName) ? rawName[0] : rawName) || command;
  // أوامر خارج فئة الألعاب ليست ألعاباً حتى لو شابه اسمها مرادف لعبة («ذاكرة» = ذاكرة المساعد)
  if (plugin && plugin.config?.category !== "game") return null;
  if (plugin?.config?.game) return games.contractOf(plugin.config.game);
  const direct = games.resolve(name);
  if (direct) return direct;
  for (const alias of plugin?.config?.alias || []) {
    const c = games.resolve(alias);
    if (c) return c;
  }
  return null;
}

/**
 * أهلية العرض المرئي لأمر واحد.
 * @returns {{command, mode, delivered, htmlEligible, reasons:string[], fallback:string}}
 */
function visualMetadata(command) {
  const plugin = getPlugin(String(command || ""));
  const rawName = plugin?.config?.name;
  const name = (Array.isArray(rawName) ? rawName[0] : rawName) || String(command || "");
  const declared = plugin?.config?.visual;
  const reasons = [];
  let mode = "text";
  let htmlEligible = false;
  const game = gameOf(name);
  if (declared?.mode && VISUAL_MODES.includes(declared.mode)) {
    mode = declared.mode;
    reasons.push("declared:config.visual");
  } else if (game && !game.legacy) {
    mode = "html";
    htmlEligible = true;
    reasons.push(`arcade-html:${game.id}:${game.uiMode}`);
  } else if (game?.legacy) {
    mode = "buttons";
    reasons.push("legacy-quiz:hint+surrender");
  } else if (HYBRID_LEGACY.has(name)) {
    mode = "hybrid";
    reasons.push("legacy-game:hybrid-dashboard");
  } else if (plugin) {
    const ui = uiOf(name);
    if (MEDIA_CATEGORIES.has(plugin.config?.category)) {
      mode = "media";
      reasons.push(`category:${plugin.config.category}`);
    } else if (ui?.eligible && ui.mode !== "none") {
      mode = "buttons";
      reasons.push(`ui:${ui.mode}`);
    } else {
      reasons.push(ui?.freeForm ? "free-form-input" : "plain-reply");
    }
  }
  // HTML هو العرض الافتراضي للألعاب الموحّدة. التفاعل الفعلي يبقى في أزرار واتساب/الموقع.
  let delivered = mode;
  if (mode === "html") {
    delivered = "hybrid";
    reasons.push(ACTION_BRIDGE.enabled ? "bridge:enabled" : `bridge:${ACTION_BRIDGE.reason}`);
    reasons.push(`html-transport:${htmlTransportMode()}`);
  }
  return { command: name, category: plugin?.config?.category || null, mode, delivered, htmlEligible, reasons, fallback: mode === "text" ? "text" : "text+typed-commands" };
}

/** مصفوفة كل الأوامر الحية */
function visualMatrix() {
  const seen = new Set();
  const rows = [];
  for (const plugin of getAllPlugins()) {
    // بعض البلوقنات القديمة تعرّف name كمصفوفة أسماء — الأول هو الأمر
    const raw = plugin?.config?.name;
    const name = Array.isArray(raw) ? raw[0] : raw;
    if (typeof name !== "string" || !name || seen.has(name) || plugin.config.isEnabled === false) continue;
    seen.add(name);
    rows.push(visualMetadata(name));
  }
  return rows.sort((a, b) => String(a.category).localeCompare(String(b.category)) || a.command.localeCompare(b.command));
}

/**
 * يتحقق من VisualResponse قبل التسليم.
 * @returns {{ok:boolean, errors:string[]}}
 */
function validateVisualResponse(vr) {
  const errors = [];
  if (!vr || typeof vr !== "object") return { ok: false, errors: ["not-an-object"] };
  if (!VISUAL_MODES.includes(vr.mode)) errors.push(`mode:${vr.mode}`);
  if (!vr.cardId) errors.push("cardId");
  if (!String(vr.text || "").trim()) errors.push("empty-text");
  for (const a of vr.actions || []) if (!a?.id || !a?.text) errors.push("dead-button");
  for (const s of vr.select?.sections || []) for (const r of s.rows || []) if (!(r.id ?? r.rowId)) errors.push("dead-row");
  if (vr.html) {
    const check = validateTemplate(vr.html);
    if (!check.ok) errors.push(...check.errors.map((e) => `html:${e}`));
  }
  // سياسة §6: لا صورة في أي مسار لعبة — لا لوحة، ولا معاينة، ولا صورة احتياطية.
  // الرفض هنا يمنع أي إضافة مستقبلية من إعادة مسار الصور من الباب الخلفي.
  if (vr.image && isGameCard(vr.cardId)) errors.push("game-image-forbidden");
  if (vr.image && !Buffer.isBuffer(vr.image.buffer)) errors.push("image-buffer");
  for (const l of vr.links || []) if (!l?.text || !/^https?:\/\//.test(String(l.url || ""))) errors.push("dead-link");
  return { ok: errors.length === 0, errors };
}

/**
 * يسلّم VisualResponse: (HTML تجريبي إن أذن المالك) ثم بطاقة موحّدة بصورة/نص/أزرار.
 * @returns {Promise<{stage:string, key:Object|null, html:{relayed:boolean, reason?:string}}>}
 */
async function deliverVisual(sock, m, vr) {
  const check = validateVisualResponse(vr);
  if (!check.ok) {
    noteFailure("visual-response", new Error(check.errors.join(",")), { where: "terboo-visual-response:deliver", stage: vr?.cardId || "?", fallback: "text" });
    await m.reply(String(vr?.text || ""));
    return { stage: "text", key: null, html: { relayed: false, reason: "invalid-visual-response" } };
  }
  let html = { relayed: false, reason: vr.html ? "client-rendering-unproven" : "no-html" };
  if (vr.html && htmlTransportMode() === "rich") {
    try {
      html = await relayTransport(sock, vr.to || m.chat, encodeTransport(vr.html, vr.htmlMeta || {}), { enabled: true });
    } catch (error) {
      noteFailure("visual-response", error, { where: "terboo-visual-response:deliver", stage: "html-relay", fallback: "hybrid" });
      html = { relayed: false, reason: "relay-failed" };
    }
  }
  const sent = await sendCard(sock, m, {
    cardId: vr.cardId,
    lang: vr.lang,
    text: vr.text,
    footer: vr.footer || "",
    // طبقة ثانية: حتى لو مرّ كائن غير مدقَّق، بطاقة اللعبة لا تحمل صورة أبداً
    image: isGameCard(vr.cardId) ? null : vr.image || null,
    buttons: vr.actions || [],
    links: vr.links || [],
    select: vr.select || null,
    mentions: vr.mentions || [],
    to: vr.to,
  });
  return { ...sent, html };
}

export { GAME_CARD_PREFIXES, HYBRID_LEGACY, VISUAL_MODES, deliverVisual, isGameCard, validateVisualResponse, visualMatrix, visualMetadata };
