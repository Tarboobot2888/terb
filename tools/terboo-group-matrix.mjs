#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 👥 مصفوفة إجراءات المجموعة (G) — من الكود نفسه لا من وصف يدوي
// ───────────────────────────────────────────────
//   node tools/terboo-group-matrix.mjs ⇒ docs/terboo-group-action-matrix.json
// لكل إجراء: أداة النموذج · سياسة الصلاحية (المستوى/التأكيد/جماعي/مشرف البوت) · قرار كل مستوى
// · طريقة التنفيذ · طريقة التحقق · أمثلة كلام طبيعي مفهومة فعلاً (يُتحقق منها بالمحلل هنا).
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

const { ACTIONS, permissionMatrix } = await import("../src/lib/terboo-permissions.js");
const { GROUP_TOOLS, parseGroupRequest } = await import("../src/lib/terboo-group-agent.js");
const { parseMemberStep } = await import("../src/lib/terboo-action-engine.js");

const ROWS = [
  { action: "group.member.add", executes: "plugin اضف via dispatchCommand", verify: "fresh groupMetadata: member present", examples: ["ضيف أحمد", "add Ahmed"] },
  { action: "group.member.readd", executes: "plugin اضف (last removed)", verify: "fresh groupMetadata: member present", examples: ["رجعه"] },
  { action: "group.member.kick", executes: "plugin طرد via dispatchCommand", verify: "fresh groupMetadata: member absent", examples: ["اطرد أحمد", "kick Ahmed"] },
  { action: "group.member.promote", executes: "plugin ترقية", verify: "fresh groupMetadata: admin", examples: ["خلي أحمد أدمن", "promote Ahmed"] },
  { action: "group.member.demote", executes: "plugin خفض", verify: "fresh groupMetadata: not admin", examples: ["شيل الادمن من أحمد"] },
  { action: "group.member.warn", executes: "plugin انذار", verify: "plugin result", examples: ["انذر أحمد"] },
  { action: "group.members.kickAll", executes: "bulk executor task (groupParticipantsUpdate remove, batches of 5)", verify: "fresh groupMetadata after every batch", examples: ["اطرد الكل", "اطرد كل الأعضاء إلا أحمد", "kick everyone except Ahmed", "expulsa a todos menos Ahmed"] },
  { action: "group.members.kickSelected", executes: "bulk executor task", verify: "fresh groupMetadata after every batch", examples: ["اطرد سارة وكريم", "اطرد @a @b"] },
  { action: "group.members.promoteSelected", executes: "bulk executor task", verify: "fresh groupMetadata after every batch", examples: ["رقي سارة وكريم"] },
  { action: "group.members.demoteSelected", executes: "bulk executor task", verify: "fresh groupMetadata after every batch", examples: ["شيل الادمن من @a @b"] },
  { action: "group.settings.get", executes: "groupMetadata {fresh:true}", verify: "read-only", examples: ["الجروب مقفول؟", "is the group locked?"] },
  { action: "group.settings.lock", executes: "groupSettingUpdate announcement", verify: "fresh groupMetadata.announce === true", examples: ["اقفل الجروب", "lock the group", "cierra el grupo"] },
  { action: "group.settings.unlock", executes: "groupSettingUpdate not_announcement", verify: "fresh groupMetadata.announce === false", examples: ["افتح الجروب", "open the group"] },
  { action: "group.settings.schedule", executes: "task queue delayed task (notBefore), persisted, auto-resumed after restart", verify: "same as lock/unlock at due time + late notice", examples: ["اقفل الجروب ساعة", "افتح الجروب بعد 30 دقيقة", "lock the group for 1 hour"] },
  { action: "group.settings.restrict", executes: "groupSettingUpdate locked", verify: "fresh groupMetadata.restrict === true", examples: ["اقفل تعديل بيانات الجروب"] },
  { action: "group.settings.unrestrict", executes: "groupSettingUpdate unlocked", verify: "fresh groupMetadata.restrict === false", examples: ["افتح تعديل بيانات الجروب"] },
  { action: "group.subject.set", executes: "groupUpdateSubject", verify: "fresh groupMetadata.subject === value", examples: ["غير اسم الجروب لـ «أصحاب»", "rename the group to Friends"] },
  { action: "group.description.set", executes: "groupUpdateDescription", verify: "fresh groupMetadata.desc === value", examples: ["غير وصف الجروب لـ …", "امسح وصف الجروب"] },
  { action: "group.invite.get", executes: "groupInviteCode", verify: "code returned", examples: ["هات لينك الجروب", "group link"] },
  { action: "group.invite.revoke", executes: "groupRevokeInvite", verify: "new code !== old code", examples: ["غير اللينك", "reset the group link"] },
  { action: "group.member.mute", executes: "plugin كتم (command path)", verify: "plugin result", examples: [".كتم @x 5د"] },
  { action: "contact.block", executes: "updateBlockStatus block", verify: "fetchBlocklist contains target", examples: ["احظر أحمد", "احظره", "block Ahmed"] },
  { action: "contact.unblock", executes: "updateBlockStatus unblock", verify: "fetchBlocklist excludes target", examples: ["فك الحظر عن أحمد", "unblock Ahmed"] },
];

const decisions = new Map(permissionMatrix().map((row) => [row.action, row.decisions]));
const rows = ROWS.map((row) => {
  const policy = ACTIONS[row.action];
  if (!policy) throw new Error(["missing-policy", row.action].join(":"));
  const understood = row.examples.filter((text) => !text.startsWith(".")).map((text) => ({ text, parsedAs: parseGroupRequest(text)?.kind || parseMemberStep(text)?.kind || null }));
  return {
    action: row.action,
    modelTool: Object.keys(GROUP_TOOLS).find((id) => GROUP_TOOLS[id].action === row.action) || null,
    minLevel: policy.min, confirm: Boolean(policy.confirm), bulk: Boolean(policy.bulk), ownerBypass: Boolean(policy.ownerBypass),
    botMustBeAdmin: Boolean(policy.botAdmin), destructive: Boolean(policy.destructive),
    decisions: decisions.get(row.action),
    executes: row.executes, verify: row.verify, examples: understood,
  };
});
const notUnderstood = rows.flatMap((r) => r.examples.filter((e) => !e.parsedAs).map((e) => `${r.action}: ${e.text}`));
const out = { generatedAt: new Date().toISOString(), actions: rows.length, notUnderstood, protections: ["bot-itself", "requester-self", "group-creator", "bot-owner-protected", "admin-protected (kickAll only, unless owner says including admins)"], rows };
fs.writeFileSync(path.join(process.cwd(), "docs", "terboo-group-action-matrix.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`✅ group matrix: ${rows.length} actions · examples not understood: ${notUnderstood.length}${notUnderstood.length ? `\n${notUnderstood.join("\n")}` : ""}`);
process.exit(0);
