// ═══════════════════════════════════════════════
// 🧠 مساعد Bot Terboo — Adapter فوق النواة
// ───────────────────────────────────────────────
// هذا الملف لم يعد يحمل منطق ذكاء خاصاً به. كل القرار انتقل إلى
// النواة الواحدة src/lib/terboo-ai-core.js (§2)، ويبقى هذا الملف
// واجهة (Facade) للحفاظ على كل نقاط الدخول القديمة كما هي:
//
//   • handler.js ينادي handleAiAssistant كما كان.
//   • الاختبارات والبلوقنات تستعمل نفس الأسماء المصدَّرة.
//
// ما تغيّر خلف الواجهة:
//   • الفهرس صار Universal Command Discovery على كل السجل الحيّ (§8)
//     بدل عدد مرشّحين ثابت صغير.
//   • كل نداء نموذج يحمل حزمة سياق وذاكرة حقيقية (§5).
//
// متى يعمل؟ الخاص: أي رسالة بلا بادئة. المجموعة: رد على البوت أو إشارة له.
// ═══════════════════════════════════════════════

import { getPlugin } from "./terboo-plugins.js";
import {
  DECISIONS,
  MIN_CONFIDENCE,
  buildInstruction,
  cleanRequestText,
  parseModelJson,
  rewriteAsCommand,
  runKernel,
  shouldEngage,
} from "./terboo-ai-core.js";
import {
  allEntries,
  findEntry,
  invalidateIndex,
  rank as rankIndex,
} from "./terboo-command-index.js";

/**
 * الشكل القديم لمدخلة الفهرس (حقول مسطّحة) فوق الفهرس الجديد.
 * يبقى لأن بلوقنات واختبارات قائمة تعتمد عليه.
 */
function toLegacyEntry(entry) {
  return {
    name: entry.name,
    aliases: entry.aliases,
    category: entry.category,
    description: entry.description,
    usage: entry.usage,
    examples: entry.examples,
    related: entry.related,
    isOwner: entry.permissions.isOwner,
    isPremium: entry.permissions.isPremium,
    isAdmin: entry.permissions.isAdmin,
    isGroup: entry.permissions.isGroup,
    isPrivate: entry.permissions.isPrivate,
    requirements: entry.requirements,
    tokens: entry.tokens,
  };
}

/** فهرس كل الأوامر المحمّلة — الآن مبني على المحرّك الشامل */
function buildCommandCatalog() {
  return allEntries().map(toLegacyEntry);
}

/** إبطال الفهرس بعد إعادة تحميل البلوقنات */
function invalidateCatalog() {
  invalidateIndex();
}

/** هل يستطيع هذا المستخدم استعمال الأمر أصلاً؟ */
function isCommandAvailable(entry, m) {
  if (entry.isOwner && !m.isOwner) return false;
  if (entry.isPremium && !m.isPremium && !m.isOwner && !m.isPartner) return false;
  if (entry.isGroup && !entry.isPrivate && !m.isGroup) return false;
  if (entry.isPrivate && !entry.isGroup && m.isGroup) return false;
  if (entry.isAdmin && m.isGroup && !m.isAdmin && !m.isOwner) return false;
  return true;
}

/**
 * ترتيب الأوامر حسب قربها من نص المستخدم.
 * يمر على كل الأوامر المتاحة، لا على قائمة مختصرة ثابتة.
 */
function rankCommands(text, m, limit = 0) {
  const ranked = rankIndex(text, m).map(({ entry, score, reasons }) => ({
    entry: toLegacyEntry(entry),
    score,
    reasons,
  }));
  return limit > 0 ? ranked.slice(0, limit) : ranked;
}

/** هل يحتاج هذا الأمر هدفاً (عضواً/رقماً)؟ */
function needsTarget(entry) {
  if (entry?.requirements) return Boolean(entry.requirements.target);
  const hint = `${entry?.usage || ""} ${entry?.description || ""}`;
  return /@|<user>|<member>|<number>|عضو|رقم|mention|target|usuario|miembro|número|numero/i.test(hint);
}

/** استخراج الهدف من الوسائط أو الإشارة أو الرسالة المقتبسة */
function resolveTarget(m, args) {
  const raw = String(args || "").trim();
  if (/@?\d{6,}/.test(raw)) return raw;

  const mentioned = (m.mentionedJid || []).find((jid) => /\d{6,}/.test(String(jid)));
  if (mentioned) {
    const number = String(mentioned).split("@")[0].split(":")[0];
    return raw ? `@${number} ${raw}`.trim() : `@${number}`;
  }

  if (m.quoted?.senderNumber && /\d{6,}/.test(m.quoted.senderNumber)) {
    return raw ? `@${m.quoted.senderNumber} ${raw}`.trim() : `@${m.quoted.senderNumber}`;
  }
  return raw;
}

/** فحوص ما قبل التنفيذ — لا تستبدل نظام الصلاحيات الحقيقي */
function preflight(entry, m, resolvedArgs) {
  const plugin = getPlugin(entry?.name);
  if (plugin?.config?.isBotAdmin && m.isGroup && m.isBotAdmin === false) {
    return { ok: false, reasonKey: "assistant.botNotAdmin" };
  }
  if (needsTarget(entry) && !/@?\d{6,}/.test(resolvedArgs || "")) {
    return { ok: false, reasonKey: "assistant.needTarget" };
  }
  return { ok: true };
}

/** تعليمات النموذج — تُبنى الآن داخل النواة بحزمة السياق الكاملة */
function buildSystemInstruction({ lang, candidates = [], m, prefix }) {
  const entries = candidates.map(({ entry }) => ({
    name: entry.name,
    aliases: entry.aliases || [],
    category: entry.category,
    description: entry.description,
    usage: entry.usage,
    permissions: {
      isOwner: entry.isOwner ?? entry.permissions?.isOwner ?? false,
      isPremium: entry.isPremium ?? entry.permissions?.isPremium ?? false,
      isAdmin: entry.isAdmin ?? entry.permissions?.isAdmin ?? false,
      isGroup: entry.isGroup ?? entry.permissions?.isGroup ?? false,
    },
    requirements: entry.requirements || { target: false, media: false },
  }));
  return buildInstruction({
    pkg: { language: lang, chat: { isGroup: Boolean(m?.isGroup) } },
    candidates: entries.map((entry) => ({ entry })),
    prefix,
  });
}

/**
 * نقطة الدخول التي يناديها handler — تُمرَّر كما هي إلى النواة.
 * @returns {Promise<"command"|"answered"|false>}
 */
async function handleAiAssistant(m, sock, db) {
  return runKernel(m, sock, db);
}

export {
  DECISIONS,
  MIN_CONFIDENCE,
  buildCommandCatalog,
  buildSystemInstruction,
  cleanRequestText,
  findEntry,
  handleAiAssistant,
  invalidateCatalog,
  isCommandAvailable,
  needsTarget,
  parseModelJson,
  preflight,
  rankCommands,
  resolveTarget,
  rewriteAsCommand,
  shouldEngage,
};

export default { shouldEngage, rankCommands, handleAiAssistant, invalidateCatalog };
