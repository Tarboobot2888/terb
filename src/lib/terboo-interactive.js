// ═══════════════════════════════════════════════
// 🎛️ Terboo Interactive Pipeline — مسار الأزرار والقوائم
// ───────────────────────────────────────────────
// يغطّي كل أشكال رد واتساب التفاعلي (§14):
//   buttonsResponseMessage · listResponseMessage · templateButtonReplyMessage
//   interactiveResponseMessage · nativeFlowResponseMessage
// وكل صيغ المعرّف: response_json · paramsJson · selectedRowId · selectedId
//   · selectedButtonId · buttonId · id · JSON متداخل داخل نص.
//
// المسار الكامل بعد الاستخراج:
//   Extract → Normalize → Validate → Infer prefix → Match real command
//           → Confirm plugin exists → Dispatch → Log
//
// قاعدة صارمة: ممنوع حدوث «ضغطة صامتة».
// أي ضغطة لا تنتهي بأمر حقيقي تُسجَّل بسبب واضح، ويُبلَّغ المستخدم.
// ═══════════════════════════════════════════════

import { extractInteractiveId, parseCommand } from "./terboo-serialize.js";
import { getPlugin } from "./terboo-plugins.js";
import { getCaseCommands } from "../../case/terboo.js";

/** أمر حقيقي = بلوقن في السجل الحيّ أو أمر case يعالجه handler بعد البلوقنات */
function commandExists(name) {
  if (getPlugin(name)) return true;
  const wanted = String(name || "").toLowerCase();
  return Object.values(getCaseCommands() || {}).some((list) => list.includes(wanted));
}

/** أنواع الرسائل الناتجة عن ضغط زر أو اختيار من قائمة */
const INTERACTIVE_TYPES = new Set([
  "buttonsResponseMessage",
  "listResponseMessage",
  "templateButtonReplyMessage",
  "interactiveResponseMessage",
  "nativeFlowResponseMessage",
]);

/** أسباب النتيجة — تُستعمل في السجل وفي الاختبارات */
const REASON = {
  NOT_INTERACTIVE: "not-interactive",
  EMPTY: "empty-id",
  ALREADY_COMMAND: "already-command",
  NOT_A_COMMAND: "not-a-command",
  UNKNOWN_COMMAND: "unknown-command",
  RESOLVED: "resolved",
  INTERNAL: "internal",
};

/**
 * معرّفات داخلية ليست أوامر لكن لها معالج حقيقي في مكان آخر من المسار.
 * لا تُعامَل كضغطة فاشلة؛ تمر كما هي إلى معالجها:
 *   language     · أزرار اختيار اللغة ← بوابة الانضمام (terboo-onboarding.js)
 *   registration · أزرار بطاقة التسجيل الواحدة ← جلسة التسجيل (plugins/user/daftar.js)
 *   action-pick  · اختيار هدف/تأكيد في محرك الإجراءات، وأزرار سياسة الواجهة (اختيار/نعم/لا) ← النواة
 *   action-button· زر إجراء تالٍ (تراجع) برمز لمرة واحدة ← terboo-action-engine.js
 *   group-confirm· تأكيد/اختيار إجراء مجموعة أو حظر برمز لمرة واحدة ← terboo-group-agent.js
 *   copy         · أزرار «نسخ» ← رد فوري بالقيمة داخل backticks (handler.js)
 */
const INTERNAL_IDS = [
  { name: "language", test: (id) => /^terboo_language_(?:ar|en|es)$/i.test(id), value: (id) => id.slice("terboo_language_".length).toLowerCase() },
  { name: "registration", test: (id) => /^terboo_reg_(?:name|age|gender|g_m|g_f|save|cancel)$/i.test(id), value: (id) => id.slice("terboo_reg_".length).toLowerCase() },
  { name: "action-pick", test: (id) => /^terboo_pick_(?:\d{1,2}|no|yes)$/i.test(id), value: (id) => id.slice("terboo_pick_".length).toLowerCase() },
  { name: "action-button", test: (id) => /^terboo_act_[\w-]{6,40}$/.test(id), value: (id) => id.slice("terboo_act_".length) },
  { name: "group-confirm", test: (id) => /^terboo_grp_(?:[\w-]{6,40}|no)$/.test(id), value: (id) => id.slice("terboo_grp_".length) },
  { name: "copy", test: (id) => /^copy_\S{1,500}$/.test(id), value: (id) => id.slice(5) },
];

/** يسجّل عائلة معرّفات داخلية جديدة (للبلوقنات التي لها معالج جلسات خاص) */
function registerInternalId(name, test, value = (id) => id) {
  if (!name || typeof test !== "function") return false;
  if (INTERNAL_IDS.some((entry) => entry.name === name)) return false;
  INTERNAL_IDS.push({ name, test, value });
  return true;
}

/** هل المعرّف داخلي؟ ⇒ {name, value} */
function internalAction(id) {
  const value = normalizeSelection(id);
  const entry = INTERNAL_IDS.find((item) => item.test(value));
  return entry ? { name: entry.name, value: entry.value(value) } : null;
}

/** هل هذا النوع ناتج عن ضغطة؟ */
function isInteractiveType(type) {
  return INTERACTIVE_TYPES.has(String(type || ""));
}

// ═══════════════════════════════════════════════
// ① Extract — من أي شكل رسالة
// ═══════════════════════════════════════════════

/**
 * استخراج معرّف الزر/الصف من كائن الرسالة الخام بأي صيغة.
 * يجرّب الحقول المعروفة أولاً ثم يغوص في أي JSON متداخل.
 * @param {Object} message كائن message الخام
 * @param {string} type نوع المحتوى
 * @returns {string} المعرّف كما أرسله واتساب (قبل التطبيع)
 */
function extractSelection(message, type) {
  if (!message) return "";
  const content = message[type] || message;

  const direct = [
    content?.selectedButtonId,
    content?.singleSelectReply?.selectedRowId,
    content?.selectedId,
    content?.selectedRowId,
    content?.buttonId,
    content?.nativeFlowResponseMessage?.paramsJson,
    content?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson,
  ];
  for (const value of direct) {
    if (typeof value === "string" && value.trim() && !value.trim().startsWith("{")) {
      return value.trim();
    }
  }

  // البحث العميق يغطي paramsJson و response_json وكل تداخل غير متوقّع
  return extractInteractiveId(content) || extractInteractiveId(message) || "";
}

// ═══════════════════════════════════════════════
// ② Normalize
// ═══════════════════════════════════════════════

/**
 * تطبيع المعرّف: إزالة المحارف غير المرئية والاقتباسات والمسافات الزائدة.
 * لا يمسّ محتوى الأمر نفسه ولا لغته.
 */
function normalizeSelection(raw) {
  let value = String(raw ?? "");
  value = value.replace(/[​-‏‪-‮⁦-⁩﻿]/g, "");
  value = value.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value.replace(/\s+/g, " ");
}

// ═══════════════════════════════════════════════
// ③ Validate + ④ Infer prefix + ⑤ Match + ⑥ Confirm plugin
// ═══════════════════════════════════════════════

/**
 * يحوّل معرّف ضغطة إلى أمر حقيقي قابل للتنفيذ.
 * @param {string} rawId المعرّف كما وصل
 * @param {{prefix?:string, lookup?:Function, parse?:Function}} [options]
 * @returns {{ok:boolean, reason:string, id:string, body?:string, command?:string,
 *            args?:string[], prefix?:string, text?:string, fullArgs?:string}}
 */
function resolveSelection(rawId, options = {}) {
  const prefix = options.prefix || ".";
  const lookup = options.lookup || commandExists;
  const parse = options.parse || parseCommand;

  const id = normalizeSelection(rawId);
  if (!id) return { ok: false, reason: REASON.EMPTY, id: "" };

  const hadPrefix = id.startsWith(prefix);
  const body = hadPrefix ? id : `${prefix}${id}`;

  const parsed = parse(body, prefix);
  if (!parsed?.isCommand || !parsed.command) {
    return { ok: false, reason: REASON.NOT_A_COMMAND, id };
  }

  // البلوقن موجود فعلاً في السجل الحيّ؟ وإلا فهي ضغطة لأمر غير محمّل.
  if (!lookup(parsed.command)) {
    return { ok: false, reason: REASON.UNKNOWN_COMMAND, id, command: parsed.command };
  }

  return {
    ok: true,
    reason: REASON.RESOLVED,
    id,
    body,
    command: parsed.command,
    args: parsed.args,
    prefix: parsed.prefix,
    text: parsed.text,
    fullArgs: parsed.fullArgs,
  };
}

// ═══════════════════════════════════════════════
// ⑦ Dispatch — يكتب الرسالة كأمر ليكمل المسار الطبيعي
// ═══════════════════════════════════════════════

/**
 * يعالج رسالة ضغطة: يستخرج، يطبّع، يتحقّق، ثم يحوّل m إلى أمر حقيقي.
 * لا ينفّذ الأمر بنفسه — يترك ذلك لمسار البوت الطبيعي بكل صلاحياته.
 *
 * @param {Object} m رسالة مُسلسلة
 * @param {{prefix?:string, lookup?:Function, parse?:Function}} [options]
 * @returns {{handled:boolean, reason:string, id:string, command?:string}}
 */
function applyInteractive(m, options = {}) {
  if (!m || !isInteractiveType(m.type)) {
    return { handled: false, reason: REASON.NOT_INTERACTIVE, id: "" };
  }
  if (m.isCommand) {
    return { handled: false, reason: REASON.ALREADY_COMMAND, id: String(m.body || "") };
  }

  const raw = m.body || extractSelection(m.message, m.type);
  const internal = internalAction(raw);
  if (internal) {
    m.body = normalizeSelection(raw);
    m.interactiveInternal = internal;
    return { handled: false, reason: REASON.INTERNAL, id: m.body, internal: internal.name, value: internal.value };
  }
  const result = resolveSelection(raw, options);

  if (!result.ok) {
    return { handled: false, reason: result.reason, id: result.id, command: result.command };
  }

  m.body = result.body;
  m.isCommand = true;
  m.command = result.command;
  m.args = result.args;
  m.prefix = result.prefix;
  m.text = result.text;
  m.fullArgs = result.fullArgs;
  m.fromInteractive = true;

  return { handled: true, reason: REASON.RESOLVED, id: result.id, command: result.command };
}

// ═══════════════════════════════════════════════
// ⑧ Log — ممنوع الضغطة الصامتة
// ═══════════════════════════════════════════════

/** سجل مختصر لآخر الضغطات الفاشلة (تشخيص حيّ بلا بيانات شخصية) */
if (!global.terbooInteractiveLog) global.terbooInteractiveLog = [];
const failures = global.terbooInteractiveLog;

/**
 * يسجّل ضغطة لم تنتهِ بأمر — برسالة واضحة في الطرفية وفي السجل الداخلي.
 * @returns {boolean} true إذا كانت الضغطة فاشلة فعلاً وتستحق إبلاغ المستخدم
 */
const NOTIFY_THROTTLE_MS = 5000;
if (!global.terbooInteractiveNotified) global.terbooInteractiveNotified = new Map();
const notified = global.terbooInteractiveNotified;

function logFailure(m, result) {
  const silent = new Set([REASON.NOT_INTERACTIVE, REASON.ALREADY_COMMAND, REASON.INTERNAL]);
  if (!result || result.handled || silent.has(result.reason)) return false;

  const record = {
    at: new Date().toISOString(),
    type: m?.type || "",
    reason: result.reason,
    id: String(result.id || "").slice(0, 80),
    command: result.command || "",
    chatKind: m?.isGroup ? "group" : "private",
  };
  failures.push(record);
  if (failures.length > 50) failures.shift();

  console.error(
    `[Interactive] ضغطة لم تُنفَّذ — النوع: ${record.type} · السبب: ${record.reason} · المعرّف: "${record.id}"`,
  );

  // السجل يحدث دائماً؛ إبلاغ المستخدم يُخنق حتى لا تتحول ضغطة متكررة إلى إزعاج.
  const key = String(m?.chat || m?.sender || "");
  const now = Date.now();
  if (now - (notified.get(key) || 0) < NOTIFY_THROTTLE_MS) return false;
  notified.set(key, now);
  return true;
}

/** آخر الضغطات الفاشلة (للتشخيص ولوحة المالك) */
function recentFailures(limit = 10) {
  return failures.slice(-limit);
}

export {
  INTERACTIVE_TYPES,
  INTERNAL_IDS,
  REASON,
  applyInteractive,
  commandExists,
  internalAction,
  registerInternalId,
  extractSelection,
  isInteractiveType,
  logFailure,
  normalizeSelection,
  recentFailures,
  resolveSelection,
};

export default { applyInteractive, resolveSelection, extractSelection, normalizeSelection, isInteractiveType, REASON };
