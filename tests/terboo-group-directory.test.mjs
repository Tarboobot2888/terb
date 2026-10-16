// ═══════════════════════════════════════════════
// 🧪 دليل أعضاء المجموعة · مطابقة الأسماء · مخزن الـmetadata
// ───────────────────────────────────────────────
//   1. الأسماء: تطابق صارم داخل نفس اللغة (حسن ≠ حسين) · عربي↔إنجليزي «ضعيف» يحتاج تأكيداً
//      · اسمان قويان = غموض (لا تخمين) · الاسم الكامل بكلماته يحسم.
//   2. الدليل: من metadata واتساب (LID/PN · مشرف · notify) بلا تسجيل · أسماء من pushName
//      · تحديث تدريجي (add/remove/promote/demote/leave) · الخارجون للإعادة · آخر من أُضيف/خرج.
//   3. الأداء: طلبات متزامنة ⇒ قراءة واحدة · المخزن المشترك لا يطلب الشبكة لكل رسالة
//      · يُبطَل عند تغيّر الأعضاء · fresh يتجاوزه.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const N = await import("../src/lib/terboo-name-match.js");
const D = await import("../src/lib/terboo-group-directory.js");
const { installGroupMetadataCache, invalidateGroupMetadata } = await import("../src/connection.js");

const results = [];
async function check(name, fn) {
  await fn();
  results.push(name);
}

await check("name-matching", () => {
  assert.equal(N.nameScore("احمد", "أحمد علي"), 90, "الاسم الأول بإملاء مختلف (أ/ا)");
  assert.equal(N.nameScore("مصطفي", "مصطفى"), 100, "ى/ي");
  assert.equal(N.nameScore("حسن", "حسين"), 0, "حسن ليس حسين");
  assert.equal(N.nameScore("احمد", "محمود"), 0);
  assert.ok(N.nameScore("Ahmed", "أحمد") >= N.MATCH_THRESHOLD && N.nameScore("Ahmed", "أحمد") < N.STRONG_MATCH, "عربي↔إنجليزي تطابق ضعيف");
  assert.ok(N.nameScore("sara", "سارة") >= N.MATCH_THRESHOLD, "Sara ≈ سارة (التاء المربوطة)");
  assert.ok(N.nameScore("حمو", "محمد حسن") >= N.MATCH_THRESHOLD, "اسم دلع معروف");
  const pool = [{ id: 1, names: ["محمد"] }, { id: 2, names: ["محمد سمير"] }, { id: 3, names: ["Sara"] }];
  assert.equal(N.rankByName("محمد", pool).status, "ambiguous", "محمد ومحمد سمير ⇒ سؤال لا تخمين");
  assert.deepEqual(N.rankByName("محمد", pool).options.map((o) => o.id), [1, 2]);
  assert.equal(N.rankByName("محمد سمير", pool).best.id, 2, "الاسم الكامل يحسم");
  assert.equal(N.rankByName("سارة", pool).weak, true, "سارة ⇒ Sara ضعيف ⇒ تأكيد");
  assert.equal(N.rankByName("كريم", pool).status, "not-found", "لا اختراع");
});

const GROUP = "120363000000000555@g.us";
const meta = () => ({
  id: GROUP,
  subject: "Directory Test",
  owner: "201000000001@s.whatsapp.net",
  participants: [
    { id: "201000000001@s.whatsapp.net", admin: "superadmin", notify: "Owner" },
    { id: "55500011122233@lid", phoneNumber: "201000000002@s.whatsapp.net", admin: null, notify: "" },
    { id: "201000000003@s.whatsapp.net", admin: "admin", verifiedName: "Shop Bot" },
  ],
});

await check("directory-from-metadata", async () => {
  D._resetDirectory();
  D.noteSeen(GROUP, "55500011122233@lid", "يوسف");
  const g = await D.getDirectory(null, GROUP, { metadata: meta() });
  const s = D.summary(g);
  assert.equal(s.count, 3);
  assert.deepEqual(s.admins.map(D.displayName).sort(), ["Owner", "Shop Bot"].sort(), "المشرفون من واتساب");
  const lid = D.memberByJid(g, "201000000002@s.whatsapp.net");
  assert.ok(lid, "عضو LID يُطابق برقمه PN");
  assert.equal(D.displayName(lid), "يوسف", "اسمه من pushName في المجموعة (بلا تسجيل)");
  assert.equal(D.findByName(g, "Youssef").weak, true, "بحث بالإنجليزية ⇒ تطابق ضعيف");
  assert.equal(D.peek(GROUP).count, 3);
});

await check("incremental-updates", async () => {
  D.applyParticipantsUpdate({ id: GROUP, participants: [{ id: "201000000009@s.whatsapp.net", notify: "Karim" }], action: "add" });
  let s = D.summary(await D.getDirectory(null, GROUP));
  assert.equal(s.count, 4, "إضافة بلا قراءة كاملة");
  assert.equal(D.displayName(s.lastAdded), "Karim", "آخر من أُضيف");
  D.applyParticipantsUpdate({ id: GROUP, participants: ["201000000009@s.whatsapp.net"], action: "promote" });
  assert.ok(D.memberByJid(await D.getDirectory(null, GROUP), "201000000009@s.whatsapp.net").admin);
  D.applyParticipantsUpdate({ id: GROUP, participants: ["201000000009@s.whatsapp.net"], action: "remove", author: "201000000001@s.whatsapp.net" });
  const g = await D.getDirectory(null, GROUP, { metadata: { ...meta() } });
  s = D.summary(g);
  assert.equal(s.count, 3);
  assert.equal(D.displayName(s.lastRemoved), "Karim", "آخر من خرج");
  assert.equal(D.findByName(g, "Karim").status, "not-found", "ليس عضواً الآن");
  assert.equal(D.findByName(g, "Karim", { includeDeparted: true }).best.status, "removed", "محفوظ في الخارجين لإعادته بالاسم");
});

await check("dedupe-and-refresh", async () => {
  D._resetDirectory();
  let calls = 0;
  const sock = { groupMetadata: async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return meta(); } };
  await Promise.all([D.getDirectory(sock, GROUP), D.getDirectory(sock, GROUP), D.getDirectory(sock, GROUP)]);
  assert.equal(calls, 1, "ثلاث طلبات متزامنة ⇒ قراءة واحدة");
  await D.getDirectory(sock, GROUP);
  assert.equal(calls, 1, "خلال الصلاحية: من المخزن");
  await D.getDirectory(sock, GROUP, { refresh: true });
  assert.equal(calls, 2, "refresh يقرأ من جديد");
});

await check("shared-metadata-cache", async () => {
  let calls = 0;
  const sock = { groupMetadata: async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return meta(); } };
  installGroupMetadataCache(sock);
  await Promise.all(Array.from({ length: 10 }, () => sock.groupMetadata(GROUP)));
  assert.equal(calls, 1, "عشر رسائل متزامنة ⇒ طلب شبكة واحد");
  await sock.groupMetadata(GROUP);
  assert.equal(calls, 1, "الرسائل التالية من المخزن");
  invalidateGroupMetadata(GROUP);
  await sock.groupMetadata(GROUP);
  assert.equal(calls, 2, "تغيّر الأعضاء يبطل المخزن");
  await sock.groupMetadata(GROUP, { fresh: true });
  assert.equal(calls, 3, "fresh يتجاوز المخزن");
});

console.log(`✅ terboo-group-directory: ${results.join(" · ")}`);
process.exit(0);
