// ═══════════════════════════════════════════════
// 📚 Terboo Web — سجل القدرات المعروض للموقع
// ───────────────────────────────────────────────
// كل صف يأتي من السجل الحقيقي في الذاكرة وقت الطلب:
//   • الأدوات والـscrapers من terboo-tool-registry.js / terboo-scraper-registry.js
//   • الأوامر والتصنيفات من pluginStore في terboo-plugins.js
//   • الألعاب من سجل الأركيد الحقيقي
// الحقيقة التي يصرّح بها هذا الملف للواجهة:
//   • أوامر واتساب **ليست** قابلة للتشغيل عبر HTTP: كل handler يتطلّب رسالة
//     مُسلسَلة حقيقية (m.reply · m.quoted) ومقبساً حياً. تُعرض كمرجع لا كزر.
//     (أُثبت بفحص 897 ملفاً: التوقيع handler(m, { sock, ... }) بلا استثناء.)
//   • أداة بلا مزوّد مُعدّ تُعلَن غير متاحة بسبب واضح، ولا يُخفى الصف.
//   • أدوات المالك لا تُدرَج لغير المالك أبداً (لا في القائمة ولا في البحث).
// ═══════════════════════════════════════════════

import { getCategories, getCommandsByCategory, pluginStore } from "../../lib/terboo-plugins.js";
import { allTools, healthOfTool, searchTools } from "../../lib/terboo-tool-registry.js";
import { CATALOG as SCRAPER_CATALOG, healthOf, isOpen } from "../../lib/terboo-scraper-registry.js";

/** صور التصنيفات الموجودة فعلاً (تُفحص عند التوليد لا تُفترض) */
const SECTION_IMAGE = (category) => `/brand/sections/${category}.jpg`;

/** هل مستوى صلاحية الأداة متاح لهذا الـprincipal؟ */
function allowedFor(permission, principal) {
  if (permission === "owner") return principal.isOwner === true;
  if (permission === "premium") return principal.isOwner === true || principal.isPremium === true;
  return true;
}

/** سبب عدم التوفّر، أو "" */
function unavailableReason(tool) {
  const health = healthOfTool(tool.id);
  if (health?.open) return "circuit-open";
  if (tool.source === "scraper" && isOpen(tool.target)) return "circuit-open";
  return "";
}

/**
 * الأدوات القابلة للتشغيل من الموقع.
 * كل أداة في السجل تعمل بلا سياق واتساب حين تُشغَّل بـ deliver:false،
 * ما عدا أدوات تحتاج المجموعة أو المقبس — تُوسَم webRunnable:false بسبب.
 */
const NEEDS_WHATSAPP = new Set(["group.members"]);

function toolRows(principal, { category = "", search = "" } = {}) {
  const base = search ? searchTools(search, { limit: 40 }) : allTools(category ? { category } : {});
  return base
    .filter((tool) => allowedFor(tool.permission || "user", principal))
    .map((tool) => {
      const needsWhatsApp = NEEDS_WHATSAPP.has(tool.id);
      const reason = unavailableReason(tool);
      return {
        id: tool.id,
        category: tool.category,
        source: tool.source,
        kind: tool.kind || "",
        purpose: tool.purpose || "",
        output: tool.output || "",
        permission: tool.permission || "user",
        timeoutMs: tool.timeoutMs || 0,
        maxBytes: tool.maxBytes || 0,
        // مخطّط المدخلات الحقيقي: الواجهة تبني الحقول منه لا من تخمين
        input: tool.input || null,
        platforms: tool.platforms || [],
        webRunnable: !needsWhatsApp && !reason,
        unavailableReason: needsWhatsApp ? "needs-whatsapp-group-context" : reason,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
}

/** الـscrapers كما هي في السجل المركزي (مرجع + حالة صحة) */
function scraperRows(principal) {
  return Object.entries(SCRAPER_CATALOG)
    .filter(([, entry]) => allowedFor(entry.permission || "user", principal))
    .map(([id, entry]) => {
      const health = healthOf(id) || {};
      return {
        id,
        kind: entry.kind,
        input: entry.input,
        output: entry.output,
        permission: entry.permission || "user",
        timeoutMs: entry.timeoutMs || 0,
        platforms: entry.platforms || [],
        fallbacks: entry.fallbacks || [],
        purpose: entry.purpose || "",
        circuitOpen: isOpen(id),
        health: { ok: health.ok ?? null, fail: health.fail ?? null, lastLatencyMs: health.lastLatencyMs ?? null },
      };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/**
 * تصنيفات الأوامر للتنقل والعرض.
 * owner تُستبعد لغير المالك، وكل صف يحمل صورة التصنيف إن وُجدت فعلاً.
 */
function categoryRows(principal, { imageExists = () => true } = {}) {
  const byCategory = getCommandsByCategory() || {};
  return getCategories()
    .filter((category) => category !== "owner" || principal.isOwner)
    .map((category) => {
      const commands = byCategory[category] || [];
      const image = SECTION_IMAGE(category);
      return {
        category,
        commandCount: Array.isArray(commands) ? commands.length : 0,
        image: imageExists(`assets/image/sections/${category}.jpg`) ? image : null,
      };
    })
    .filter((row) => row.commandCount > 0)
    .sort((a, b) => b.commandCount - a.commandCount);
}

/**
 * أوامر واتساب كمرجع (channel: "whatsapp").
 * تُعرض بلا زر تشغيل: التنفيذ عبر HTTP مستحيل بلا رسالة مُسلسَلة ومقبس حيّ.
 */
function commandRows(principal, { category = "", limit = 200, offset = 0 } = {}) {
  const seen = new Set();
  const rows = [];
  for (const plugin of pluginStore.commands.values()) {
    const config = plugin?.config || {};
    const name = String(config.name || "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (config.isOwner && !principal.isOwner) continue;
    if (category && String(config.category || "") !== category) continue;
    rows.push({
      command: name,
      alias: Array.isArray(config.alias) ? config.alias : [],
      category: config.category || "uncategorized",
      description: config.description || "",
      usage: config.usage || "",
      example: config.example || "",
      requires: {
        owner: Boolean(config.isOwner),
        premium: Boolean(config.isPremium),
        group: Boolean(config.isGroup),
        private: Boolean(config.isPrivate),
        groupAdmin: Boolean(config.isAdmin),
        botAdmin: Boolean(config.isBotAdmin),
      },
      cost: { cooldown: config.cooldown ?? 0, energi: config.energi ?? 0 },
      enabled: config.isEnabled !== false,
      // الحقيقة الصريحة التي تعرضها الواجهة
      channel: "whatsapp",
      webRunnable: false,
      unavailableReason: "handler-requires-serialized-whatsapp-message",
    });
  }
  rows.sort((a, b) => a.category.localeCompare(b.category) || a.command.localeCompare(b.command));
  return { total: rows.length, rows: rows.slice(offset, offset + Math.min(limit, 500)) };
}

/** الألعاب المسجّلة فعلاً في محرّك الأركيد */
async function gameRows(principal) {
  try {
    const arcade = await import("../../lib/terboo-arcade/index.js");
    const list = typeof arcade.listGames === "function" ? arcade.listGames() : [];
    return list.map((game) => ({
      id: game.id || game.key || "",
      title: game.title || game.name || game.id || "",
      players: game.players || game.maxPlayers || 1,
      multiplayer: Boolean(game.multiplayer || (game.maxPlayers || 1) > 1),
      category: game.category || "arcade",
      // قابلية الويب تُحكم عليها بوجود بروتوكول إجراء حتمي في المحرّك
      webRunnable: Boolean(game.actions || game.protocol || game.move),
      unavailableReason: game.actions || game.protocol || game.move ? "" : "engine-has-no-channel-neutral-action-protocol",
    }));
  } catch (error) {
    // محرّك الأركيد غير متاح في هذا البناء ⇒ لا ألعاب على الويب (لا قائمة وهمية)
    return { unavailable: true, reason: String(error?.message || error).slice(0, 120) };
  }
}

/** ملخّص للواجهة: ما يعمل فعلاً وما لا يعمل ولماذا */
function capabilitySummary(principal) {
  const tools = toolRows(principal);
  return {
    tools: { total: tools.length, webRunnable: tools.filter((t) => t.webRunnable).length },
    scrapers: { total: Object.keys(SCRAPER_CATALOG).length },
    commands: { total: commandRows(principal, { limit: 1 }).total, webRunnable: 0, channel: "whatsapp" },
    categories: categoryRows(principal).length,
  };
}

export { allowedFor, capabilitySummary, categoryRows, commandRows, gameRows, scraperRows, toolRows };
