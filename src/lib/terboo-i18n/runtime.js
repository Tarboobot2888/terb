// ═══════════════════════════════════════════════
// 🌐 Terboo Localization Runtime — الترجمة عند حدّ الإرسال (§30)
// ───────────────────────────────────────────────
// كل نص يخرج من البوت إلى واتساب يمر من هنا مرة واحدة، بلغة المستلم:
//   • قوالب سطرية من كتالوج المحتوى (catalog/{ar,en,es}.json) مفتاحها
//     جوهر السطر في المصدر، مع {0} {1} للقيم المتغيّرة — تُعاد القيم في
//     موضعها الصحيح من الترجمة (ترتيب الكلمات يختلف بين اللغات).
//   • الزخرفة حول السطر (> ❌ * …) تبقى كما هي.
//   • كتل الكود ``` لا تُمس، ولا ردود الذكاء الحرّة (مُعلَّمة markRaw).
//   • المستخدم العربي يرى ترجمة أي مصدر غير عربي (إندونيسي/إنجليزي).
//   • قبل الترجمة: طبقة التصميم الموحّدة (terboo-design.js) تزيل backticks
//     الزخرفة والإطارات القديمة؛ وبعدها تُحوَّل رموز المحرّك لرموز لغة المستلم.
//   • ولغير المالك: حارس الأخطاء (terboo-error-guard.js) يحذف Stack Trace والمسارات
//     ويستبدل الأخطاء التقنية المعروفة برسالة مصنّفة بلغة المستلم (§53).
// لا يغيّر أي منطق أو أمر أو صلاحية: النص وحده.
// ═══════════════════════════════════════════════

import { noteFailure } from "../terboo-failure-log.js";
import fs from "node:fs";
import path from "node:path";
import { ARABIC, normalizeCore, splitEdges } from "./units.js";
import { designText, themeGlyphs } from "../terboo-design.js";
import { sanitizeForUser } from "../terboo-error-guard.js";

const CATALOG_DIR = path.join(process.cwd(), "src", "lib", "terboo-i18n", "catalog");
const LANGS = ["ar", "en"];
const RAW_MARK = "⁣⁤⁣";

const cache = new Map();

function readCatalog(lang) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, `${lang}.json`), "utf8"));
  } catch (error) { noteFailure("runtime", error, {where: "src/lib/terboo-i18n/runtime.js:34",stage: "JSON.parse"}); return {}; }
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** كلمات مفهرسة من نص (للترشيح السريع) */
function wordsOf(text) {
  return String(text).split(/[\s,.!?؟،:;()\[\]*_~`"'«»]+/).filter((word) => word.length >= 2);
}

/**
 * فهرس لغة: مطابقة تامة + قوالب بمتغيرات + مقاطع للدمج.
 * @returns {{exact:Map, byWord:Map, segments:Array, size:number}}
 */
function indexFor(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const catalog = readCatalog(lang);
  const exact = new Map();
  const byWord = new Map();
  const segments = [];
  for (const [source, target] of Object.entries(catalog)) {
    if (typeof target !== "string" || !target.trim()) continue;
    const key = normalizeCore(source);
    if (!/\{\d+\}/.test(key)) {
      exact.set(key, target);
      // مقطع قابل للاستبدال داخل سطر مركّب: جملة من كلمتين فأكثر فقط
      if (wordsOf(key).length >= 2 && key.length >= 6) segments.push({ source: key, target });
      continue;
    }
    const parts = key.split(/(\{\d+\})/);
    const order = [];
    const pattern = parts.map((part, index) => {
      const hole = part.match(/^\{(\d+)\}$/);
      if (!hole) return escapeRegex(part).replace(/\\?\s+/g, "\\s+");
      order.push(Number(hole[1]));
      return index === parts.length - 2 && parts[parts.length - 1] === "" ? "(.+)" : "(.+?)";
    }).join("");
    const statics = parts.filter((part) => part && !/^\{\d+\}$/.test(part));
    const anchor = wordsOf(statics.sort((a, b) => b.length - a.length)[0] || "")[0];
    if (!anchor) continue;
    const entry = { re: new RegExp(`^${pattern}$`, "u"), order, target, weight: statics.join("").length };
    if (!byWord.has(anchor)) byWord.set(anchor, []);
    byWord.get(anchor).push(entry);
  }
  for (const list of byWord.values()) list.sort((a, b) => b.weight - a.weight);
  segments.sort((a, b) => b.source.length - a.source.length);
  const index = { exact, byWord, segments, size: Object.keys(catalog).length };
  cache.set(lang, index);
  return index;
}

/** إعادة تحميل الكتالوجات (بعد تحديثها) */
function reloadCatalogs() {
  cache.clear();
}

function fillTemplate(target, values) {
  return target.replace(/\{(\d+)\}/g, (match, index) => (values[Number(index)] ?? match));
}

/** يحاول ترجمة جوهر سطر كاملاً (مطابقة تامة ثم قوالب) */
function translateCore(core, index, depth = 0) {
  const key = normalizeCore(core);
  if (!key) return null;
  if (index.exact.has(key)) return index.exact.get(key);
  // أدق قالب يطابق السطر كله (أكبر نص ثابت) — لا أول قالب يصادف كلمته
  // («السعر: *{0}* عملة/طاقة» قبل «السعر: {0}»)
  const seen = new Set();
  let best = null;
  for (const word of wordsOf(key)) {
    const candidates = index.byWord.get(word);
    if (!candidates) continue;
    for (const entry of candidates) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      if (best && entry.weight <= best.entry.weight) continue;
      const match = key.match(entry.re);
      if (match) best = { entry, match };
    }
  }
  if (!best) return null;
  const values = [];
  best.entry.order.forEach((slot, i) => {
    // قيمة هي نفسها عبارة معروفة («جيد»، «متاح»…) تُترجم أيضاً
    // وقيمة هي نفسها قالب معروف («5 دقيقة» ← «{0} دقيقة») تُترجم بعمق محدود
    // وإلا تُترجم العبارات المعروفة داخلها («(للمالك فقط)»)
    const raw = best.match[i + 1];
    const inner = splitEdges(raw).core;
    const known = index.exact.get(normalizeCore(inner))
      ?? (depth < 2 && inner && inner.length <= 80 && inner !== core ? translateCore(inner, index, depth + 1) : null);
    values[slot] = known ? raw.replace(inner, known) : (depth < 2 ? translateSegments(raw, index) ?? raw : raw);
  });
  return fillTemplate(best.entry.target, values);
}

/** بديل للأسطر المركّبة من عدة نصوص: استبدال مقاطع جُمل معروفة داخل السطر */
function translateSegments(line, index) {
  // أسطر الواجهة المركّبة قصيرة؛ النثر الطويل (ردود نماذج مثلاً) لا يُرقَّع جزئياً
  if (line.length > 140 || wordsOf(line).length > 18) return null;
  let out = line;
  let changed = false;
  const words = new Set(wordsOf(line));
  for (const segment of index.segments) {
    const first = wordsOf(segment.source)[0];
    if (!words.has(first)) continue;
    if (!out.includes(segment.source)) continue;
    // حدود كلمات: «غير محدود» لا تُستبدل داخل «غير محدودة»
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(segment.source)}(?![\\p{L}\\p{N}_])`, "gu");
    const next = out.replace(re, () => segment.target);
    if (next !== out) {
      out = next;
      changed = true;
    }
  }
  return changed ? out : null;
}

/** هل يحتاج هذا السطر ترجمة إلى لغة الهدف؟ */
function needsWork(line, lang) {
  if (lang === "ar") return /[A-Za-zÀ-ÿ]{3,}/.test(line);
  return ARABIC.test(line) || /[A-Za-z]{3,}/.test(line);
}

/** ترجمة سطر واحد مع حفظ الزخرفة */
function translateLine(line, lang, index = indexFor(lang)) {
  if (!line.trim() || !needsWork(line, lang)) return line;
  const trimmedEnd = line.replace(/\s+$/, "");
  const trailing = line.slice(trimmedEnd.length);
  const { prefix, core, suffix } = splitEdges(trimmedEnd);
  const lead = trimmedEnd.match(/^\s*/)[0];
  // المطابقة التامة أولاً (الجوهر ثم السطر كاملاً)، ثم القوالب — كي لا يبتلع قالبٌ
  // فضفاض مثل «{0}تم {1}» سطراً له ترجمة تامة
  const coreKey = normalizeCore(core);
  if (index.exact.has(coreKey)) return `${prefix}${index.exact.get(coreKey)}${suffix}${trailing}`;
  const wholeKey = normalizeCore(trimmedEnd.trim());
  if (index.exact.has(wholeKey)) return `${lead}${index.exact.get(wholeKey)}${trailing}`;
  const translated = translateCore(core, index);
  if (translated !== null) return `${prefix}${translated}${suffix}${trailing}`;
  const whole = translateCore(trimmedEnd.trim(), index);
  if (whole !== null) return `${lead}${whole}${trailing}`;
  return translateSegments(line, index) ?? line;
}

/**
 * ترجمة نص كامل (رسالة، تسمية توضيحية، زر…).
 * @param {string} text
 * @param {"ar"|"en"|"es"} lang
 */
function translateText(text, lang) {
  if (typeof text !== "string" || !text) return text;
  if (text.startsWith(RAW_MARK)) return text.slice(RAW_MARK.length);
  if (!LANGS.includes(lang)) return text;
  const index = indexFor(lang);
  if (!index.size) return text;
  // ما بين ``` كود يبقى حرفياً
  const pieces = text.split(/(```[\s\S]*?```)/);
  return pieces.map((piece) => (piece.startsWith("```") ? piece
    : piece.split("\n").map((line) => translateLine(line, lang, index)).join("\n"))).join("");
}

/** يعلّم نصاً بأنه لا يُترجم (رد ذكاء حرّ، محتوى ملف، نص المستخدم نفسه) */
function markRaw(text) {
  return typeof text === "string" && !text.startsWith(RAW_MARK) ? `${RAW_MARK}${text}` : text;
}

/** يزيل علامة «لا تترجم» إن وُجدت */
function stripRaw(text) {
  return typeof text === "string" && text.startsWith(RAW_MARK) ? text.slice(RAW_MARK.length) : text;
}

// ═══════════════════════════════════════════════
// محتوى رسائل واتساب
// ═══════════════════════════════════════════════

/** حقول نصية تُعرض للمستخدم داخل كائنات الرسائل */
const TEXT_FIELDS = new Set([
  "text", "caption", "contentText", "footerText", "displayText", "display_text", "title", "description",
  "buttonText", "footer", "body", "subtitle", "hydratedContentText", "hydratedFooterText", "hydratedTitleText",
  "sectionTitle", "headerTitle", "orderTitle", "name", "address", "comment", "fileName",
]);
/** حقول نص رسالة يطبَّق عليها نظام التصميم (لا الأسماء ولا أسماء الملفات) */
const DESIGN_FIELDS = new Set([
  "text", "caption", "contentText", "footerText", "description", "body", "footer", "subtitle", "title",
  "hydratedContentText", "hydratedFooterText", "hydratedTitleText", "displayText", "display_text", "buttonText",
]);

/**
 * نص معروض: تصميم موحّد ⇒ حارس الأخطاء (لغير المالك) ⇒ ترجمة ⇒ رموز لغة المستلم.
 * الردود الخام (markRaw) تُترجم فقط كما كانت.
 * @param {{owner?:boolean}} [ctx] المالك في الخاص يرى تفاصيل الأخطاء للتشخيص
 */
function presentText(value, lang, key = "text", ctx = {}) {
  if (typeof value !== "string" || !value) return value;
  if (value.startsWith(RAW_MARK) || !DESIGN_FIELDS.has(key)) return translateText(value, lang);
  const designed = designText(value);
  const safe = ctx.owner ? designed : sanitizeForUser(designed, lang);
  return latinDigits(themeGlyphs(translateText(safe, lang), lang), lang);
}

/** أرقام عربية-هندية (٥٠٠ · ٢٠٬٤٨٩) ⇒ أرقام لاتينية لمستخدمي الإنجليزية والإسبانية */
function latinDigits(text, lang) {
  if (lang === "ar" || typeof text !== "string" || !/[٠-٩]/.test(text)) return text;
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/(?<=\d)٬(?=\d)/g, ",").replace(/(?<=\d)٫(?=\d)/g, ".");
}

/** حقول معرّفات لا تُمس أبداً */
const ID_FIELDS = new Set(["id", "buttonId", "rowId", "selectedId", "url", "merchant_url", "jid", "remoteJid", "participant", "mimetype", "fileSha256", "mediaKey"]);
/** حقول JSON نصية تحمل أزراراً وقوائم */
const JSON_FIELDS = new Set(["buttonParamsJson", "paramsJson", "messageParamsJson"]);

function localizeNode(node, lang, depth = 0, seen = new WeakSet(), ctx = {}) {
  if (!node || depth > 14) return node;
  if (typeof node === "string") return presentText(node, lang, "text", ctx);
  if (typeof node !== "object" || Buffer.isBuffer(node) || node instanceof Uint8Array || seen.has(node)) return node;
  seen.add(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      if (typeof node[i] === "object") localizeNode(node[i], lang, depth + 1, seen, ctx);
    }
    return node;
  }
  for (const [key, value] of Object.entries(node)) {
    if (ID_FIELDS.has(key) || value == null) continue;
    if (typeof value === "string") {
      if (TEXT_FIELDS.has(key)) node[key] = presentText(value, lang, key, ctx);
      else if (JSON_FIELDS.has(key) && value.trim().startsWith("{")) {
        try {
          node[key] = JSON.stringify(localizeNode(JSON.parse(value), lang, depth + 1, seen, ctx));
        } catch (error) { noteFailure("runtime", error, {where: "src/lib/terboo-i18n/runtime.js:265",stage: "JSON.stringify"}); }
      }
    } else if (typeof value === "object") {
      localizeNode(value, lang, depth + 1, seen, ctx);
    }
  }
  return node;
}

// ═══════════════════════════════════════════════
// لغة المستلم
// ═══════════════════════════════════════════════

/** مرسل الرسالة الخام كما حلّه serialize (أدق من participant/LID) */
const senderOfRaw = new WeakMap();
function rememberSender(raw, sender) {
  if (raw && typeof raw === "object" && sender) senderOfRaw.set(raw, sender);
}

/**
 * لغة من سيقرأ الرد: صاحب الرسالة المقتبسة، ثم محادثة الخاص، ثم لغة المجموعة.
 * @param {string} jid
 * @param {Object} options خيارات sendMessage
 * @param {{getUser:Function, getGroup:Function}} db
 */
function recipientLanguage(jid, options = {}, db = null, fallback = "ar") {
  const explicit = options?.terbooLang;
  if (LANGS.includes(explicit)) return explicit;
  const quoted = options?.quoted;
  const who = quoted?.sender
    || (quoted ? senderOfRaw.get(quoted) : null)
    || quoted?.key?.participant
    || (quoted?.key?.remoteJid && !String(quoted.key.remoteJid).endsWith("@g.us") && !quoted?.key?.fromMe ? quoted.key.remoteJid : null)
    || (!String(jid || "").endsWith("@g.us") ? jid : null);
  try {
    const language = who ? db?.getUser?.(who)?.language : db?.getGroup?.(jid)?.language;
    if (LANGS.includes(language)) return language;
  } catch (error) { noteFailure("runtime", error, {where: "src/lib/terboo-i18n/runtime.js:302",stage: "LANGS.includes"}); }
  return fallback;
}

/** صاحب الرسالة المقتبسة داخل رسالة مُولَّدة (contextInfo.participant) */
function quotedParticipant(message, depth = 0) {
  if (!message || typeof message !== "object" || depth > 8) return null;
  if (message.contextInfo?.participant && message.contextInfo?.stanzaId) return message.contextInfo.participant;
  for (const value of Object.values(message)) {
    if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
      const found = quotedParticipant(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * يلفّ sendMessage و relayMessage لمقبس واحد (مرة واحدة).
 * @param {Object} sock
 * @param {{getDatabase:Function, fallback?:string}} deps
 */
/** المالك في محادثته الخاصة فقط (المجموعات يقرؤها غيره) */
function ownerRecipient(jid, isOwner) {
  if (typeof isOwner !== "function" || !jid || String(jid).endsWith("@g.us")) return false;
  try { return Boolean(isOwner(jid)); } catch (error) { noteFailure("runtime", error, {where: "src/lib/terboo-i18n/runtime.js:327",stage: "Boolean"}); return false; }
}

/**
 * @param {{getDatabase:Function, fallback?:string, isOwner?:(jid:string)=>boolean}} deps
 */
function installLocalization(sock, { getDatabase, fallback = "ar", isOwner = null } = {}) {
  if (!sock || sock.__terbooLocalized) return sock;
  const send = sock.sendMessage?.bind(sock);
  const relay = sock.relayMessage?.bind(sock);
  if (send) {
    sock.sendMessage = async (jid, content, options = {}) => {
      const { terbooLang, ...rest } = options || {};
      try {
        const lang = recipientLanguage(jid, options, getDatabase?.(), fallback);
        if (content && typeof content === "object") localizeNode(content, lang, 0, new WeakSet(), { owner: ownerRecipient(jid, isOwner) });
      } catch (error) { noteFailure("runtime", error, { where: "src/lib/terboo-i18n/runtime.js:343", stage: "localize-send", target: jid, payload: Object.keys(content || {})[0], fallback: "sent-untranslated" }); }
      return send(jid, content, rest);
    };
  }
  if (relay) {
    sock.relayMessage = async (jid, message, options = {}) => {
      try {
        const quotedBy = quotedParticipant(message);
        const lang = recipientLanguage(jid, quotedBy ? { ...options, quoted: { sender: quotedBy } } : options, getDatabase?.(), fallback);
        localizeNode(message, lang, 0, new WeakSet(), { owner: ownerRecipient(jid, isOwner) });
      } catch (error) { noteFailure("runtime", error, { where: "src/lib/terboo-i18n/runtime.js:353", stage: "localize-relay", target: jid, payload: Object.keys(message || {})[0], fallback: "relayed-untranslated" }); }
      return relay(jid, message, options);
    };
  }
  sock.__terbooLocalized = true;
  return sock;
}

export {
  LANGS,
  RAW_MARK,
  indexFor,
  installLocalization,
  localizeNode,
  markRaw,
  presentText,
  recipientLanguage,
  reloadCatalogs,
  rememberSender,
  stripRaw,
  translateLine,
  translateText,
};
export default { translateText, installLocalization, markRaw, stripRaw, recipientLanguage, rememberSender };
