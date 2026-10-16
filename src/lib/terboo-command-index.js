// ═══════════════════════════════════════════════
// 🗂️ Universal Command Discovery Engine
// ───────────────────────────────────────────────
// فهرس حيّ لكل أوامر البوت المحمّلة فعلاً — لا قائمة ثابتة ولا عدد
// مرشّحين صغير محدّد مسبقاً (§8). أي بلوقن جديد يُكتشف تلقائياً بمجرد
// تحميله، بلا تعديل أي ملف.
//
// لكل أمر يُستخرج:
//   name · aliases · category · description · usage · examples
//   permissions (owner/premium/admin/botAdmin/group/private/registration)
//   requirements (هدف؟ وسائط؟ نص؟ رابط؟)
//   related (أوامر نفس الفئة)
//   localized (وصف الفئة بالعربية/الإنجليزية/الإسبانية)
//   semantic keywords (من محرّك النوايا + من الوصف نفسه)
//
// المطابقة طبقات متراكبة:
//   Exact → Alias → Keyword → Semantic → Context → Language → History
//
// عدد المرشّحين ديناميكي: كل ما يقترب من الأفضل يدخل، بحدّ أدنى وأقصى
// محسوبين من توزيع النتائج نفسه لا من رقم ثابت.
// ═══════════════════════════════════════════════

import { getAllPlugins, getPlugin, pluginStore } from "./terboo-plugins.js";
import { legacyRoleAccess } from "./terboo-permissions.js";
import { expandQuery, INTENT_GROUPS, wordVariants } from "./terboo-ai-intents.js";
import { getSimilarity } from "./terboo-similarity.js";
import { getCategoryLabel, LANGUAGE_ORDER } from "./terboo-localization.js";

const INDEX_TTL_MS = 60000;
const MIN_SHORTLIST = 8;
const MAX_SHORTLIST = 60;      // سقف الحماية فقط — ليس عدد المرشّحين الثابت
const RELATIVE_CUTOFF = 0.45;  // كل ما بلغ 45% من أعلى نتيجة يدخل القائمة

if (!global.terbooCommandIndex) {
  global.terbooCommandIndex = { entries: null, byToken: null, builtAt: 0, size: 0 };
}
const cache = global.terbooCommandIndex;

// ═══════════════════════════════════════════════
// التطبيع والتقطيع
// ═══════════════════════════════════════════════

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئء]/g, "ء")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** تقطيع مع تجريد أداة التعريف: «البروفايل» ⇒ البروفايل + بروفايل */
function tokenize(value) {
  const out = new Set();
  for (const token of normalize(value).split(" ")) {
    if (token.length < 2) continue;
    out.add(token);
    if (token.startsWith("ال") && token.length > 4) out.add(token.slice(2));
  }
  return out;
}

// ═══════════════════════════════════════════════
// استخراج المتطلّبات من بيانات البلوقن نفسه
// ═══════════════════════════════════════════════

const NEEDS_TARGET = /@|<user>|<member>|<number>|عضو|رقم|mention|target|usuario|miembro|número|numero/i;
const NEEDS_MEDIA = /صوره|صورة|فيديو|ملصق|استيكر|reply (?:to )?(?:image|video|sticker)|image|video|sticker|audio|imagen|v[ií]deo/i;
const NEEDS_LINK = /https?:|رابط|link|url|enlace/i;
const NEEDS_TEXT = /<text>|<query>|نص|كلمة|اكتب|texto|palabra|query|search/i;

/** هدف بين أقواس مربعة في الاستعمال = اختياري: «.بروفايل [@user]» */
const OPTIONAL_TARGET = /\[[^\]]*(?:@|user|member|عضو|رقم|مستخدم|mention|usuario)[^\]]*\]/i;

function requirementsOf(cfg) {
  const hint = `${cfg.usage || ""} ${cfg.example || ""} ${cfg.description || ""}`;
  const targetOptional = OPTIONAL_TARGET.test(`${cfg.usage || ""} ${cfg.example || ""}`);
  return {
    target: NEEDS_TARGET.test(hint) && !targetOptional,
    targetOptional,
    media: NEEDS_MEDIA.test(hint),
    link: NEEDS_LINK.test(hint),
    text: NEEDS_TEXT.test(hint),
  };
}

function permissionsOf(cfg) {
  return {
    isOwner: Boolean(cfg.isOwner),
    isPremium: Boolean(cfg.isPremium),
    isAdmin: Boolean(cfg.isAdmin),
    isBotAdmin: Boolean(cfg.isBotAdmin),
    isGroup: Boolean(cfg.isGroup),
    isPrivate: Boolean(cfg.isPrivate),
    skipRegistration: Boolean(cfg.isEnabled === false ? false : cfg.skipRegistration),
    cooldown: Number(cfg.cooldown) || 0,
    energi: Number(cfg.energi) || 0,
  };
}

// ═══════════════════════════════════════════════
// الكلمات الدلالية من محرّك النوايا
// ═══════════════════════════════════════════════

/** intent → Set(tokens) مبنية مرة واحدة */
let intentTokenMap = null;
function buildIntentTokenMap() {
  if (intentTokenMap) return intentTokenMap;
  intentTokenMap = new Map();
  for (const group of INTENT_GROUPS || []) {
    const tokens = new Set();
    for (const word of [...(group.triggers || []), ...(group.expand || [])]) {
      for (const token of tokenize(word)) tokens.add(token);
    }
    intentTokenMap.set(group.intent, tokens);
  }
  return intentTokenMap;
}

/** أي نوايا تخص هذا الأمر؟ (تقاطع كلمات الأمر مع كلمات النية) */
function intentsFor(entryTokens) {
  const map = buildIntentTokenMap();
  const hits = [];
  for (const [name, tokens] of map) {
    let shared = 0;
    for (const token of tokens) {
      if (entryTokens.has(token)) shared += 1;
      if (shared >= 2) break;
    }
    if (shared >= 1) hits.push(name);
  }
  return hits;
}

// ═══════════════════════════════════════════════
// بناء الفهرس
// ═══════════════════════════════════════════════

/** أمثلة الاستعمال بصيغة موحّدة */
function examplesOf(cfg, primary) {
  const out = [];
  if (cfg.example) out.push(String(cfg.example).slice(0, 120));
  if (cfg.usage && cfg.usage !== cfg.example) out.push(String(cfg.usage).slice(0, 120));
  if (!out.length) out.push(primary);
  return out.slice(0, 3);
}

/**
 * بناء الفهرس من السجل الحيّ.
 * يُعاد البناء تلقائياً عند تغيّر عدد الأوامر (تحميل بلوقن جديد).
 */
function buildIndex(force = false) {
  const liveSize = pluginStore?.commands?.size || 0;
  const fresh = cache.entries
    && !force
    && cache.size === liveSize
    && Date.now() - cache.builtAt < INDEX_TTL_MS;
  if (fresh) return cache.entries;

  const seen = new Set();
  const entries = [];
  const byCategory = new Map();

  for (const plugin of getAllPlugins()) {
    const cfg = plugin?.config;
    if (!cfg?.name || cfg.isEnabled === false) continue;

    const primary = Array.isArray(cfg.name) ? cfg.name[0] : cfg.name;
    if (!primary || seen.has(primary)) continue;
    seen.add(primary);

    const aliases = Array.isArray(cfg.alias) ? cfg.alias : cfg.alias ? [cfg.alias] : [];
    const category = cfg.category || "uncategorized";
    const description = String(cfg.description || "").slice(0, 200);

    // وصف الفئة بكل اللغات يدخل الفهرس حتى يطابق الطلب بأي لغة
    const localized = {};
    for (const lang of LANGUAGE_ORDER || ["ar", "en"]) {
      localized[lang] = getCategoryLabel(lang, category) || category;
    }

    const tokens = tokenize(
      [primary, ...aliases, description, category, cfg.usage, cfg.example, ...Object.values(localized)].join(" "),
    );

    const entry = {
      name: primary,
      aliases,
      names: [primary, ...aliases],
      normalizedNames: [primary, ...aliases].map(normalize),
      category,
      description,
      usage: String(cfg.usage || "").slice(0, 120),
      examples: examplesOf(cfg, primary),
      localized,
      permissions: permissionsOf(cfg),
      requirements: requirementsOf(cfg),
      tokens,
      intents: intentsFor(tokens),
      related: [],
    };

    entries.push(entry);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(entry);
  }

  // أوامر ذات صلة = أقرب أوامر نفس الفئة
  for (const entry of entries) {
    entry.related = (byCategory.get(entry.category) || [])
      .filter((other) => other.name !== entry.name)
      .slice(0, 6)
      .map((other) => other.name);
  }

  // فهرس معكوس: كلمة ⇒ مواضع الأوامر (بحث سريع عبر 1200 أمر)
  const byToken = new Map();
  entries.forEach((entry, index) => {
    for (const token of entry.tokens) {
      if (!byToken.has(token)) byToken.set(token, new Set());
      byToken.get(token).add(index);
    }
  });

  cache.entries = entries;
  cache.byToken = byToken;
  cache.builtAt = Date.now();
  cache.size = liveSize;
  return entries;
}

/** إبطال الفهرس (بعد إعادة تحميل البلوقنات) */
function invalidateIndex() {
  cache.entries = null;
  cache.byToken = null;
  cache.builtAt = 0;
  cache.size = 0;
}

/** كل الأوامر المفهرسة */
function allEntries() {
  return buildIndex();
}

/** أمر واحد بالاسم أو المرادف */
function findEntry(name) {
  const wanted = normalize(name);
  if (!wanted) return null;
  return buildIndex().find((entry) => entry.normalizedNames.includes(wanted)) || null;
}

// ═══════════════════════════════════════════════
// الصلاحية والسياق
// ═══════════════════════════════════════════════

/** هل يستطيع هذا المستخدم استعمال الأمر في هذه المحادثة أصلاً؟ */
function isAvailable(entry, m) {
  const p = entry.permissions;
  if (p.isOwner && !m?.isOwner) return false;
  // أوامر الأدوار القديمة (لوحات cPanel · DigitalOcean): بياناتها «عامة» لكن البلوقن يفحص دوراً ⇒ لا تُقترح لمن لا دور له
  if (!p.isOwner && !legacyRoleAccess(m, entry.category)) return false;
  if (p.isPremium && !m?.isPremium && !m?.isOwner && !m?.isPartner) return false;
  if (p.isGroup && !p.isPrivate && !m?.isGroup) return false;
  if (p.isPrivate && !p.isGroup && m?.isGroup) return false;
  if (p.isAdmin && m?.isGroup && !m?.isAdmin && !m?.isOwner) return false;
  return true;
}

// ═══════════════════════════════════════════════
// المطابقة متعددة الطبقات
// ═══════════════════════════════════════════════

/** مسافة تحرير (Levenshtein) للكلمات القصيرة فقط */
function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length];
}

/**
 * ترتيب كل الأوامر المتاحة حسب قربها من الطلب.
 * @param {string} text نص المستخدم
 * @param {Object} m الرسالة (للصلاحيات والسياق)
 * @param {Object} [context] حزمة السياق (اختيارية) لطبقتي Context و History
 * @returns {Array<{entry:Object, score:number, reasons:string[]}>}
 */
function rank(text, m, context = null) {
  const entries = buildIndex();
  if (!entries.length) return [];

  const queryTokens = tokenize(text);
  if (!queryTokens.size) return [];
  // صيغ الاستعلام البديلة (سوابق/لواحق عربية) — تُطابق الفهرس دون أن تُضاف إليه
  for (const token of [...queryTokens]) {
    for (const variant of wordVariants(token)) queryTokens.add(variant);
  }

  const { intents, tokens: intentTokens } = expandQuery(text);
  const intentSet = new Set(intents || []);
  const boostTokens = new Set(intentTokens || []);
  const language = context?.language || "ar";
  const historyNames = new Set();
  if (context?.reference?.previousCommand?.command) {
    historyNames.add(normalize(context.reference.previousCommand.command));
  }

  // مرشّحون أوليّون من الفهرس المعكوس + مطابقات الاسم المباشرة
  const candidateIndexes = new Set();
  for (const token of [...queryTokens, ...boostTokens]) {
    const hits = cache.byToken.get(token);
    if (hits) for (const index of hits) candidateIndexes.add(index);
  }
  // لا مرشّح من الفهرس المعكوس ⇒ نفحص الكل (أخطاء إملائية شديدة)
  const pool = candidateIndexes.size
    ? [...candidateIndexes].map((index) => entries[index])
    : entries;

  const scored = [];
  for (const entry of pool) {
    if (!isAvailable(entry, m)) continue;

    let score = 0;
    const reasons = [];

    // ① Exact — الاسم نفسه
    if (entry.normalizedNames.includes(normalize(text))) {
      score += 30;
      reasons.push("exact");
    }

    // ② Alias — كلمة من الطلب تساوي اسماً أو مرادفاً
    let aliasHit = false;
    for (const name of entry.normalizedNames) {
      if (queryTokens.has(name)) {
        score += 12;
        reasons.push("alias");
        aliasHit = true;
        break;
      }
    }
    // ②ب خطأ إملائي في اسم لاتيني قصير: kik ⇒ kick، mnu ⇒ menu (حرف واحد)
    if (!aliasHit) {
      for (const token of queryTokens) {
        if (!/^[a-z]{3,6}$/.test(token)) continue;
        if (entry.normalizedNames.some((name) => /^[a-z]{3,7}$/.test(name) && editDistance(token, name) === 1)) {
          score += 8;
          reasons.push("alias:typo");
          break;
        }
      }
    }

    // ③ Keyword — تطابق كلمات الوصف/الفئة/الاستعمال
    let keywordHits = 0;
    for (const token of queryTokens) {
      if (entry.tokens.has(token)) {
        keywordHits += 1;
        continue;
      }
      let partial = false;
      for (const candidate of entry.tokens) {
        if (candidate.length > 3 && (candidate.includes(token) || token.includes(candidate))) {
          partial = true;
          break;
        }
      }
      if (partial) {
        score += 1;
        continue;
      }
      // تسامح إملائي للكلمات الطويلة
      if (token.length >= 4) {
        for (const candidate of entry.tokens) {
          if (Math.abs(candidate.length - token.length) > 2) continue;
          if (getSimilarity(token, candidate) >= 0.82) {
            score += 2;
            break;
          }
        }
      }
    }
    if (keywordHits) {
      score += keywordHits * 3;
      reasons.push("keyword");
    }
    // ③ب الطلب يذكر اسم الأمر كاملاً بكلماته («انشيء مجموعة» ⇒ «انشاء_مجموعة»): أقوى من مطابقة جزئية لمرادف
    const nameWords = normalize(String(entry.name || "").replace(/_/g, " ")).split(" ").filter((word) => word.length >= 3);
    if (nameWords.length >= 2 && nameWords.every((word) => queryTokens.has(word))) {
      score += 15;
      reasons.push("name-phrase");
    }

    // ④ Semantic — نوايا مشتركة + مرادفات موسّعة
    // النية تسمّي هذا الأمر صراحةً (مثل «قفل الجروب» ⇒ شات): إشارة قوية
    if (entry.normalizedNames.some((name) => boostTokens.has(name))) {
      score += 10;
      reasons.push("semantic:name");
    }
    let semanticHits = 0;
    for (const token of boostTokens) {
      if (entry.tokens.has(token)) semanticHits += 1;
    }
    for (const intent of entry.intents) {
      if (intentSet.has(intent)) semanticHits += 2;
    }
    if (semanticHits) {
      score += semanticHits * 4;
      reasons.push("semantic");
    }

    // ⑤ Context — متطلّبات الأمر مقابل ما هو متاح فعلاً في الرسالة
    if (context) {
      if (entry.requirements.target && context.reference?.target) {
        score += 4;
        reasons.push("context:target");
      }
      if (entry.requirements.media && context.hasMedia) {
        score += 4;
        reasons.push("context:media");
      }
      if (entry.requirements.link && /https?:\/\//i.test(context.request || "")) {
        score += 4;
        reasons.push("context:link");
      }
      if (entry.permissions.isGroup && context.chat?.isGroup) score += 1;
    }

    // ⑥ Language — وصف الفئة بلغة المستخدم يطابق طلبه
    const label = normalize(entry.localized?.[language] || "");
    if (label) {
      for (const token of queryTokens) {
        if (label.includes(token)) {
          score += 2;
          reasons.push("language");
          break;
        }
      }
    }

    // ⑦ History — الأمر السابق نفسه أو من أقربائه (طلب متابعة)
    if (historyNames.size) {
      if (historyNames.has(normalize(entry.name))) {
        score += context?.reference?.isFollowUp ? 6 : 2;
        reasons.push("history");
      } else if (
        context?.reference?.previousCommand?.command &&
        entry.related.includes(context.reference.previousCommand.command)
      ) {
        score += 2;
        reasons.push("history:related");
      }
    }

    if (score > 0) scored.push({ entry, score, reasons });
  }

  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return scored;
}

/**
 * قائمة مرشّحين بحجم ديناميكي يُشتق من توزيع النتائج،
 * لا من رقم ثابت صغير (§8).
 */
function shortlist(text, m, context = null) {
  const ranked = rank(text, m, context);
  if (!ranked.length) return [];

  const top = ranked[0].score;
  const cutoff = top * RELATIVE_CUTOFF;
  const strong = ranked.filter(({ score }) => score >= cutoff);

  const size = Math.min(MAX_SHORTLIST, Math.max(MIN_SHORTLIST, strong.length));
  return ranked.slice(0, size);
}

/** أوامر ذات صلة بأمر معيّن */
function relatedTo(name) {
  return findEntry(name)?.related || [];
}

/** ملخّص الفهرس — يستخدمه الاختبار والتقارير */
function indexStats() {
  const entries = buildIndex();
  const categories = new Set(entries.map((entry) => entry.category));
  return {
    commands: entries.length,
    categories: categories.size,
    tokens: cache.byToken?.size || 0,
    withTargets: entries.filter((entry) => entry.requirements.target).length,
    withIntents: entries.filter((entry) => entry.intents.length > 0).length,
  };
}

/** هل البلوقن موجود فعلاً في السجل الحيّ؟ */
function pluginExists(name) {
  return Boolean(getPlugin(name));
}

export {
  MAX_SHORTLIST,
  MIN_SHORTLIST,
  allEntries,
  buildIndex,
  findEntry,
  indexStats,
  invalidateIndex,
  isAvailable,
  normalize,
  pluginExists,
  rank,
  relatedTo,
  shortlist,
  tokenize,
};

export default { buildIndex, rank, shortlist, findEntry, allEntries, invalidateIndex, indexStats };
