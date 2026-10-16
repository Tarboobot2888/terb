// ═══════════════════════════════════════════════
// 🧠 ذاكرتي — تحكّم المستخدم في ما يحفظه البوت عنه (§22)
// ───────────────────────────────────────────────
// يعرض · يحذف · ينسى آخر معلومة · يحذف الكل · يوقف · يشغّل · يحدّد مدّة
// الاحتفاظ · يمنح/يسحب إذن اطلاع المالك · يشرح ماذا يُحفظ (§37).
// ذاكرة كل شخص منفصلة، وذاكرة المجموعة منفصلة عن الخاص. المالك وحده
// يطّلع على ذاكرة غيره، وفقط بإذن صاحبها وبسبب مكتوب ومع سجل تدقيق.
// ═══════════════════════════════════════════════

import { getDatabase } from "../../src/lib/terboo-database.js";
import { getUserLanguage, t } from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import * as brand from "../../src/lib/terboo-brand.js";
import {
  conversationScope,
  forget,
  forgetLast,
  forgetUserEverywhere,
  inspectForOwner,
  scopeOf,
  setEnabled,
  setOwnerInspection,
  setTTLDays,
  snapshot,
} from "../../src/lib/terboo-ai-memory.js";
import { isConfigOwner } from "../../src/lib/terboo-ai-owner.js";

const pluginConfig = {
  name: "ذاكرة",
  alias: ["memory", "ذاكرتي", "memoria"],
  category: "user",
  description: "عرض أو حذف أو إيقاف ما يحفظه البوت عنك في هذه المحادثة",
  usage: ".ذاكرة [عرض|حذف|حذف آخر|حذف الكل|إيقاف|تشغيل|مدة <أيام>|سماح|منع|شفافية|فحص @عضو <سبب>]",
  example: ".ذاكرة حذف",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
  skipRegistration: true,
};

/** كلمات الأمر الفرعي بكل اللغات المدعومة */
const ACTIONS = {
  show: ["عرض", "اعرض", "show", "view", "ver", "mostrar"],
  delete: ["حذف", "امسح", "احذف", "مسح", "delete", "clear", "forget", "borrar", "olvidar"],
  deleteAll: ["الكل", "كلها", "everywhere", "all", "todo"],
  deleteLast: ["آخر", "اخر", "last", "ultimo", "último"],
  allow: ["سماح", "اسمح", "allow", "permitir", "permite"],
  deny: ["منع", "امنع", "deny", "revoke", "revocar"],
  transparency: ["شفافية", "خصوصية", "transparency", "privacy", "transparencia", "privacidad"],
  inspect: ["فحص", "اطلاع", "inspect", "inspeccionar"],
  off: ["ايقاف", "إيقاف", "اوقف", "أوقف", "off", "stop", "disable", "desactivar", "apagar"],
  on: ["تشغيل", "شغل", "on", "start", "enable", "activar", "encender"],
  ttl: ["مدة", "مدّة", "ttl", "days", "retencion", "retención", "dias", "días"],
};

function actionOf(word) {
  const value = String(word || "").trim().toLowerCase();
  if (!value) return "show";
  for (const [action, words] of Object.entries(ACTIONS)) {
    if (words.includes(value)) return action;
  }
  return "show";
}

async function handler(m) {
  const db = getDatabase();
  const lang = getUserLanguage(db.getUser(m.sender));
  const action = actionOf(m.args?.[0]);
  const second = String(m.args?.[1] || "").trim();

  let scope;
  try {
    scope = conversationScope(m);
  } catch {
    return m.reply(
      UI.errorCard(t(lang, "memory.title"), t(lang, "kernel.memoryEmpty"), {
        footer: UI.footer(brand.botName(), brand.developerName(), lang),
        lang,
      }),
    );
  }

  const scopeLabel = m.isGroup ? t(lang, "memory.scopeGroup") : t(lang, "memory.scopePrivate");

  const footer = UI.footer(brand.botName(), brand.developerName(), lang);

  // ── إذن اطلاع المالك (صاحب الذاكرة وحده يقرّره) ──
  if (action === "allow" || action === "deny") {
    setOwnerInspection(m.sender, action === "allow");
    return m.reply(UI.successCard(t(lang, "memory.title"), t(lang, action === "allow" ? "kernel.memoryInspectAllowed" : "kernel.memoryInspectRevoked"), { footer, lang }));
  }

  // ── الشفافية ────────────────────────────────
  if (action === "transparency") {
    return m.reply(UI.infoCard(t(lang, "memory.title"), [t(lang, "kernel.memoryTransparency"), UI.quote(t(lang, "memory.noSecrets"), lang)].join("\n"), { footer, lang }));
  }

  // ── اطلاع المالك: بإذن صاحب الذاكرة + سبب مكتوب + سجل تدقيق ──
  if (action === "inspect") {
    if (!isConfigOwner(m)) return m.reply(UI.errorCard(t(lang, "memory.title"), t(lang, "memory.inspectOwnerOnly"), { footer, lang }));
    const targetJid = m.mentionedJid?.[0] || (m.quoted?.sender && !m.quoted?.key?.fromMe ? m.quoted.sender : "");
    if (!targetJid) return m.reply(UI.errorCard(t(lang, "memory.title"), t(lang, "memory.inspectNeedTarget"), { footer, lang }));
    const reason = (m.args || []).slice(1).filter((word) => !/^@?\d{6,}$/.test(word)).join(" ").trim();
    const descriptor = scopeOf(m.isGroup ? "group:user" : "private:user", { userJid: targetJid, chatJid: m.chat, isGroup: m.isGroup });
    const result = inspectForOwner(descriptor, { ownerJid: m.sender, reason });
    if (!result.ok) {
      const key = result.reason === "no-consent" ? "memory.inspectNoConsent" : "memory.inspectNeedReason";
      return m.reply(UI.errorCard(t(lang, "memory.title"), t(lang, key), { footer, lang }));
    }
    const lines = (result.snapshot?.facts || []).slice(0, 12).map((fact) => UI.menuItem(fact.text, "", { lang })).join("\n") || t(lang, "memory.none");
    return m.reply(UI.card({
      title: t(lang, "memory.inspectTitle"),
      icon: "🔓",
      blocks: [lines, UI.quote(t(lang, "memory.inspectAudited"), lang)],
      footer,
      lang,
    }));
  }

  // ── حذف ────────────────────────────────────
  if (action === "delete") {
    if (ACTIONS.deleteLast.includes(second.toLowerCase())) {
      const removed = forgetLast(scope);
      return m.reply(UI.successCard(t(lang, "memory.title"), removed ? t(lang, "kernel.memoryForgotLast", { text: removed.text }) : t(lang, "kernel.memoryNothingToForget"), { footer, lang }));
    }
    const everywhere = ACTIONS.deleteAll.includes(second.toLowerCase());
    if (everywhere) {
      const removed = forgetUserEverywhere(m.sender);
      return m.reply(UI.successCard(t(lang, "memory.title"), t(lang, "kernel.memoryForgotAll", { count: removed }), { footer, lang }));
    }
    forget(scope);
    return m.reply(
      UI.successCard(t(lang, "memory.title"), `${t(lang, "kernel.memoryCleared")}\n${UI.quote(scopeLabel, lang)}`, {
        footer: UI.footer(brand.botName(), brand.developerName(), lang),
        lang,
      }),
    );
  }

  // ── إيقاف / تشغيل ──────────────────────────
  if (action === "off" || action === "on") {
    setEnabled(scope, action === "on");
    return m.reply(
      UI.successCard(
        t(lang, "memory.title"),
        t(lang, action === "on" ? "kernel.memoryEnabled" : "kernel.memoryDisabled"),
        { footer: UI.footer(brand.botName(), brand.developerName(), lang), lang },
      ),
    );
  }

  // ── مدّة الاحتفاظ ───────────────────────────
  if (action === "ttl") {
    const days = Math.max(0, Math.min(3650, Number(second) || 0));
    setTTLDays(scope, days);
    return m.reply(
      UI.successCard(
        t(lang, "memory.title"),
        days > 0 ? t(lang, "kernel.memoryTtl", { days }) : t(lang, "memory.forever"),
        { footer: UI.footer(brand.botName(), brand.developerName(), lang), lang },
      ),
    );
  }

  // ── عرض ────────────────────────────────────
  const snap = snapshot(scope);
  const facts = snap?.facts?.length
    ? snap.facts.slice(0, 12).map((fact) => UI.menuItem(fact.text, "", { lang })).join("\n")
    : t(lang, "memory.none");

  const consent = snapshot(scopeOf("user", { userJid: m.sender }))?.allowOwnerInspect === true;
  const body = [
    UI.row(t(lang, "memory.status"), t(lang, snap?.enabled === false ? "memory.off" : "memory.on"), lang),
    UI.row(t(lang, "memory.ownerAccess"), t(lang, consent ? "memory.ownerAccessOn" : "memory.ownerAccessOff"), lang),
    UI.row(
      t(lang, "memory.retention"),
      snap?.ttlDays ? t(lang, "memory.days", { days: snap.ttlDays }) : t(lang, "memory.forever"),
      lang,
    ),
    UI.row(t(lang, "kernel.memoryTurns"), String(snap?.turns || 0), lang),
    UI.row(t(lang, "kernel.memoryFacts"), String(snap?.facts?.length || 0), lang),
  ].join("\n");

  const prefix = m.prefix || ".";
  const usage = [
    ["delete", "memory.optionDelete"],
    ["deleteLast", "memory.optionForgetLast"],
    ["deleteAll", "memory.optionForgetAll"],
    ["off", "memory.optionOff"],
    ["on", "memory.optionOn"],
    ["ttl", "memory.optionTtl"],
    ["allow", "memory.optionAllow"],
    ["deny", "memory.optionDeny"],
    ["transparency", "memory.optionTransparency"],
  ].map(([cmd, label]) => UI.menuItem(t(lang, `memory.cmd.${cmd}`), t(lang, label), { lang, prefix })).join("\n");

  return m.reply(
    UI.card({
      title: t(lang, "memory.title"),
      icon: "🧠",
      subtitle: scopeLabel,
      blocks: [
        body,
        UI.section(t(lang, "memory.facts"), lang),
        facts,
        UI.divider(lang),
        UI.quote(t(lang, "memory.isolation"), lang),
        UI.quote(t(lang, "memory.noSecrets"), lang),
        UI.section(t(lang, "memory.usage"), lang),
        usage,
      ],
      footer: UI.footer(brand.botName(), brand.developerName(), lang),
      lang,
    }),
  );
}

export { pluginConfig as config, handler };
