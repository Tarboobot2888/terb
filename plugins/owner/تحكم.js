// ═══════════════════════════════════════════════
// 🛡️ لوحة تحكّم المالك الذكية — Owner AI Control Center (§11، §12، §13)
// ───────────────────────────────────────────────
// أدوات ملفات آمنة بتسلسل إجباري:
//   Plan → Diff → Approval → Backup → Apply → Test → Verify
// وأي فشل في الفحص أو التحقّق يُرجع الملف تلقائياً.
//
// الممنوع مفروض داخل src/lib/terboo-ai-tools.js نفسه لا هنا:
//   لا أوامر نظام حرّة · لا eval · لا وصول إلى credentials أو session
//   · لا قراءة أسرار · لا تعديل config.js أو أي مفتاح API.
//
// المالك وحده من يوافق على أي تعديل — النموذج لا يمنح نفسه صلاحية.
// ═══════════════════════════════════════════════

import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import { getDatabase } from "../../src/lib/terboo-database.js";
import { getUserLanguage, t } from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import * as brand from "../../src/lib/terboo-brand.js";
import * as tools from "../../src/lib/terboo-ai-tools.js";
import { recentFailures } from "../../src/lib/terboo-interactive.js";
import { providerNames } from "../../src/lib/terboo-ai-providers.js";
import { indexStats } from "../../src/lib/terboo-command-index.js";
import { stats as memoryStats } from "../../src/lib/terboo-ai-memory.js";

const pluginConfig = {
  name: "تحكم",
  alias: ["control", "panel", "aictl"],
  category: "owner",
  description: "لوحة تحكّم المالك: فحص المشروع، خطة تعديل بموافقة، نسخ احتياطية، اختبارات",
  usage: ".تحكم [حالة|قائمة <مسار>|اقرأ <ملف>|ابحث <نص>|فحص <ملف>|اختبار <اسم>|نسخ|استرجاع <id> <ملف>|موافقة <id>|تنفيذ <id>]",
  example: ".تحكم حالة",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
  skipRegistration: true,
};

const ACTIONS = {
  status: ["حالة", "status", "estado", "info"],
  list: ["قائمة", "سرد", "list", "ls", "listar"],
  read: ["اقرأ", "اقرا", "read", "cat", "leer"],
  inspect: ["افحص", "inspect", "inspeccionar"],
  search: ["ابحث", "بحث", "search", "grep", "buscar"],
  syntax: ["فحص", "syntax", "sintaxis", "check"],
  test: ["اختبار", "test", "prueba"],
  backups: ["نسخ", "backups", "copias"],
  rollback: ["استرجاع", "rollback", "restaurar"],
  approve: ["موافقة", "approve", "aprobar"],
  apply: ["تنفيذ", "apply", "aplicar"],
  presses: ["ضغطات", "presses", "pulsaciones"],
};

function actionOf(word) {
  const value = String(word || "").trim().toLowerCase();
  if (!value) return "status";
  for (const [action, words] of Object.entries(ACTIONS)) {
    if (words.includes(value)) return action;
  }
  return "status";
}

function panel(lang, blocks, icon = "🛡️") {
  return UI.card({
    title: t(lang, "kernel.title"),
    icon,
    blocks,
    footer: UI.footer(brand.botName(), brand.developerName(), lang),
    lang,
  });
}

async function handler(m) {
  const db = getDatabase();
  const lang = getUserLanguage(db.getUser(m.sender));
  const action = actionOf(m.args?.[0]);
  const arg1 = String(m.args?.[1] || "").trim();
  const arg2 = String(m.args?.[2] || "").trim();

  try {
    // ── حالة عامة ───────────────────────────
    if (action === "status") {
      const info = tools.diagnostics();
      const index = indexStats();
      const mem = memoryStats();
      return m.reply(panel(lang, [
        UI.section(t(lang, "kernel.title"), lang),
        [
          UI.row("Node", info.node, lang),
          UI.row(t(lang, "kernel.uptime"), `${info.uptimeSeconds}s`, lang),
          UI.row("RSS", `${info.rssMb} MB`, lang),
          UI.row(t(lang, "kernel.files"), `${info.files.plugins} plugins · ${info.files.lib} lib · ${info.files.tests} tests`, lang),
          UI.row(t(lang, "kernel.backupCreated"), String(info.backups), lang),
        ].join("\n"),
        UI.divider(lang),
        [
          UI.row("commands", String(index.commands), lang),
          UI.row("categories", String(index.categories), lang),
          UI.row("index tokens", String(index.tokens), lang),
          UI.row("providers", providerNames().join(", ") || "—", lang),
        ].join("\n"),
        UI.divider(lang),
        [
          UI.row("memory · private", String(mem.privateRecords), lang),
          UI.row("memory · groups", String(mem.groups), lang),
          UI.row("memory · members", String(mem.groupMemberRecords), lang),
        ].join("\n"),
        UI.quote(pluginConfig.usage, lang),
      ]));
    }

    // ── سرد مجلّد ───────────────────────────
    if (action === "list") {
      const items = tools.list(arg1 || ".").slice(0, 30)
        .map((item) => UI.menuItem(`${item.type === "dir" ? "📁" : "📄"} ${item.name}`, item.type === "file" ? `${item.size}B` : "", { lang }))
        .join("\n");
      return m.reply(panel(lang, [
        UI.row(t(lang, "kernel.file"), UI.isolate(arg1 || "."), lang),
        items || t(lang, "kernel.emptyFolder"),
      ]));
    }

    // ── قراءة ملف ───────────────────────────
    if (action === "read") {
      const file = tools.read(arg1, { from: Number(arg2) || 1, to: (Number(arg2) || 1) + 59 });
      return m.reply(panel(lang, [
        UI.row(t(lang, "kernel.file"), UI.isolate(file.path), lang),
        UI.row(t(lang, "kernel.lines"), UI.isolate(`${file.from}-${file.to} / ${file.total}`), lang),
        UI.code(file.content.slice(0, 1500), lang),
      ]));
    }

    // ── معلومات ملف ─────────────────────────
    if (action === "inspect") {
      const info = tools.inspect(arg1);
      return m.reply(panel(lang, [
        UI.row(t(lang, "kernel.file"), UI.isolate(info.path), lang),
        UI.row(t(lang, "kernel.lines"), String(info.lines), lang),
        UI.row("size", `${info.size}B`, lang),
        info.exports.length ? UI.quote(info.exports.slice(0, 15).join(" · "), lang) : "",
      ]));
    }

    // ── بحث نصّي ────────────────────────────
    if (action === "search") {
      const term = m.args.slice(1).join(" ");
      const hits = tools.search(term).slice(0, 15)
        .map((hit) => UI.menuItem(`${hit.path}:${hit.line}`, hit.text.slice(0, 60), { lang }))
        .join("\n");
      return m.reply(panel(lang, [hits || t(lang, "kernel.noResults")]));
    }

    // ── فحص بناء ────────────────────────────
    if (action === "syntax") {
      const result = await tools.syntax(arg1);
      return m.reply(panel(lang, [
        UI.status(t(lang, "kernel.file"), UI.isolate(result.path), { lang, ok: result.ok }),
        result.ok ? t(lang, "kernel.syntaxOk") : UI.code(result.error.slice(0, 600), lang),
      ], result.ok ? "✅" : "⛔"));
    }

    // ── تشغيل اختبار من القائمة المغلقة ─────
    if (action === "test") {
      await m.reply(panel(lang, [t(lang, "kernel.testRunning")], "⏳")).catch((error) => { noteFailure("plugin:owner/تحكم", error, {where: "plugins/owner/تحكم.js:167",stage: "m.reply"}); });
      const result = await tools.test(arg1);
      return m.reply(panel(lang, [
        UI.status(arg1, t(lang, result.ok ? "kernel.testPassed" : "kernel.testFailed"), { lang, ok: result.ok }),
        UI.code(result.output.slice(-900), lang),
      ], result.ok ? "✅" : "⛔"));
    }

    // ── النسخ الاحتياطية ────────────────────
    if (action === "backups") {
      const list = tools.listBackups(12)
        .map((entry) => UI.menuItem(entry.id, entry.files.slice(0, 2).join(", "), { lang }))
        .join("\n");
      return m.reply(panel(lang, [list || t(lang, "kernel.noResults")]));
    }

    if (action === "rollback") {
      const result = tools.rollback(arg1, arg2);
      return m.reply(panel(lang, [
        t(lang, "kernel.rolledBack"),
        UI.row(t(lang, "kernel.file"), UI.isolate(result.restored), lang),
      ], "✅"));
    }

    // ── موافقة وتنفيذ خطة تعديل ─────────────
    if (action === "approve") {
      const result = tools.approve(arg1, m.sender);
      return m.reply(panel(lang, [
        t(lang, "kernel.planApproved"),
        UI.row(t(lang, "kernel.planId"), UI.isolate(result.id), lang),
        UI.row(t(lang, "kernel.file"), UI.isolate(result.path), lang),
      ], "✅"));
    }

    if (action === "apply") {
      const result = await tools.apply(arg1, m.sender);
      if (!result.ok) {
        return m.reply(panel(lang, [
          t(lang, "kernel.planFailed"),
          UI.row(t(lang, "kernel.backupCreated"), UI.isolate(result.backup), lang),
          UI.code(String(result.error).slice(0, 600), lang),
        ], "⛔"));
      }
      return m.reply(panel(lang, [
        t(lang, "kernel.planApplied"),
        UI.row(t(lang, "kernel.file"), UI.isolate(result.path), lang),
        UI.row(t(lang, "kernel.backupCreated"), UI.isolate(result.backup), lang),
      ], "✅"));
    }

    // ── آخر الضغطات التي لم تُنفَّذ ──────────
    if (action === "presses") {
      const list = recentFailures(10)
        .map((entry) => UI.menuItem(entry.reason, `${entry.type} · ${entry.id}`, { lang }))
        .join("\n");
      return m.reply(panel(lang, [list || t(lang, "kernel.noResults")]));
    }
  } catch (error) {
    return m.reply(panel(lang, [
      t(lang, "kernel.toolDenied"),
      UI.code(String(error.message).slice(0, 400), lang),
    ], "⛔"));
  }

  return m.reply(panel(lang, [UI.quote(pluginConfig.usage, lang)]));
}

export { pluginConfig as config, handler };
