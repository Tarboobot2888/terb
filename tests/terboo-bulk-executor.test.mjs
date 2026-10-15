// ═══════════════════════════════════════════════
// 🧪 Terboo Bulk Executor + فهم طلبات المجموعة
// ───────────────────────────────────────────────
// دفعات · تحقق بعد كل دفعة · لا إعادة عمياء (فقط ما ثبت أنه لم يُطبَّق وكان فشله عابراً) · تراجع عند rate-limit
// · إلغاء بين الدفعات بتقرير جزئي · استئناف بلا تكرار · مدد بالعربية/الإنجليزية/الإسبانية
// · أنماط: قفل/فتح بمدة أو بعد مدة · طرد الكل/إلا · حظر/فك حظر · رابط/اسم/وصف — وما ليس منها.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const { runBulk, codeOfError } = await import("../src/lib/terboo-bulk-executor.js");
const { durationOf, parseGroupRequest } = await import("../src/lib/terboo-group-agent.js");
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

await check("batches-and-verify", async () => {
  const applied = new Set();
  const calls = [];
  const report = await runBulk({
    items: Array.from({ length: 12 }, (_, i) => `u${i}`),
    batchSize: 5, gapMs: 0,
    execute: async (batch) => { calls.push(batch.length); batch.forEach((k) => applied.add(k)); return batch.map((key) => ({ key, ok: true })); },
    verify: async (batch) => new Map(batch.map((k) => [k, applied.has(k)])),
  });
  assert.deepEqual(calls, [5, 5, 2], "دفعات بالحجم المطلوب");
  assert.equal(report.succeeded.length, 12);
  assert.equal(report.failed.length, 0);
  assert.equal(report.verified, true);
  assert.equal(report.batches, 3);
});

await check("no-blind-retry", async () => {
  // الدفعة الأولى: rate-limit (استثناء) لكن عنصراً واحداً طُبّق فعلاً ⇒ الإعادة لما لم يُطبَّق فقط
  const applied = new Set(["a"]);
  const seen = [];
  let first = true;
  const report = await runBulk({
    items: ["a", "b", "c"], batchSize: 3, gapMs: 0, backoffMs: 5,
    execute: async (batch) => {
      seen.push([...batch]);
      if (first) { first = false; throw Object.assign(new Error("rate-overlimit"), { data: 429 }); }
      batch.forEach((k) => applied.add(k));
      return batch.map((key) => ({ key, ok: true }));
    },
    verify: async (batch) => new Map(batch.map((k) => [k, applied.has(k)])),
  });
  assert.deepEqual(seen, [["a", "b", "c"], ["b", "c"]], "المحاولة الثانية لـ b,c فقط (a طُبّق)");
  assert.deepEqual(report.succeeded.sort(), ["a", "b", "c"]);
  assert.equal(report.rateLimited, 1);
});

await check("permanent-failure-not-retried", async () => {
  let calls = 0;
  const report = await runBulk({
    items: ["x"], gapMs: 0,
    execute: async (batch) => { calls += 1; return batch.map((key) => ({ key, ok: false, code: "not-authorized" })); },
    verify: async (batch) => new Map(batch.map((k) => [k, false])),
  });
  assert.equal(calls, 1, "فشل دائم (صلاحية) لا يُعاد");
  assert.deepEqual(report.failed, [{ key: "x", code: "not-authorized" }]);
});

await check("provider-ok-but-not-verified", async () => {
  const report = await runBulk({
    items: ["x"], gapMs: 0,
    execute: async (batch) => batch.map((key) => ({ key, ok: true })),
    verify: async (batch) => new Map(batch.map((k) => [k, false])),
  });
  assert.equal(report.succeeded.length, 0, "المزوّد قال تم والتحقق لا ⇒ لا ادعاء نجاح");
  assert.equal(report.failed[0].code, "not-verified");
});

await check("cancel-between-batches", async () => {
  const controller = new AbortController();
  const report = await runBulk({
    items: ["a", "b", "c", "d"], batchSize: 2, gapMs: 0, signal: controller.signal,
    execute: async (batch) => { controller.abort("user"); return batch.map((key) => ({ key, ok: true })); },
  });
  assert.equal(report.cancelled, true);
  assert.deepEqual(report.succeeded, ["a", "b"]);
  assert.deepEqual(report.skipped, ["c", "d"], "ما لم يبدأ يُذكر في التقرير");
  assert.equal(report.verified, false, "بلا دالة تحقق ⇒ unverified صريح");
});

await check("resume-skips-done", async () => {
  const executed = [];
  const report = await runBulk({
    items: ["a", "b", "c"], gapMs: 0, done: ["a", "b"],
    execute: async (batch) => { executed.push(...batch); return batch.map((key) => ({ key, ok: true })); },
  });
  assert.deepEqual(executed, ["c"], "لا يُعاد تنفيذ ما تم قبل الانقطاع");
  assert.deepEqual(report.succeeded.sort(), ["a", "b", "c"]);
});

await check("error-codes", async () => {
  assert.equal(codeOfError(Object.assign(new Error("rate-overlimit"), { data: 429 })), "rate-limit");
  assert.equal(codeOfError(new Error("not-authorized")), "not-authorized");
  assert.equal(codeOfError(new Error("Timed Out")), "timeout");
  assert.equal(codeOfError(new Error("Connection Closed")), "network");
});

await check("durations", async () => {
  const H = 3_600_000;
  const M = 60_000;
  assert.equal(durationOf("ساعة"), H);
  assert.equal(durationOf("ساعتين"), 2 * H);
  assert.equal(durationOf("نص ساعة"), 30 * M);
  assert.equal(durationOf("ساعة ونص"), 90 * M);
  assert.equal(durationOf("30 دقيقة"), 30 * M);
  assert.equal(durationOf("٣٠ دقيقه"), 30 * M, "أرقام عربية-هندية");
  assert.equal(durationOf("لمدة 2 ساعات"), 2 * H);
  assert.equal(durationOf("2h"), 2 * H);
  assert.equal(durationOf("5د"), 5 * M);
  assert.equal(durationOf("for an hour"), H);
  assert.equal(durationOf("half an hour"), 30 * M);
  assert.equal(durationOf("una hora"), H);
  assert.equal(durationOf("media hora"), 30 * M);
  assert.equal(durationOf("يومين"), 48 * H);
  assert.equal(durationOf("شوية"), null, "لا تخمين لمدة غامضة");
  assert.equal(durationOf("ساعة كده تقريبا"), null);
});

await check("parse-settings", async () => {
  const H = 3_600_000;
  assert.deepEqual(parseGroupRequest("اقفل الجروب"), { kind: "setting", op: "lock" });
  assert.deepEqual(parseGroupRequest("اقفل الجروب ساعة"), { kind: "setting", op: "lock", durationMs: H });
  assert.deepEqual(parseGroupRequest("افتح الجروب بعد 30 دقيقة"), { kind: "setting", op: "unlock", delayMs: 30 * 60_000 });
  assert.deepEqual(parseGroupRequest("قفل المجموعة لمدة ساعتين"), { kind: "setting", op: "lock", durationMs: 2 * H });
  assert.deepEqual(parseGroupRequest("اقفل تعديل بيانات الجروب"), { kind: "setting", op: "restrict" });
  assert.deepEqual(parseGroupRequest("lock the group for 1 hour"), { kind: "setting", op: "lock", durationMs: H });
  assert.deepEqual(parseGroupRequest("open the group in 30 minutes"), { kind: "setting", op: "unlock", delayMs: 30 * 60_000 });
  assert.deepEqual(parseGroupRequest("cierra el grupo por una hora"), { kind: "setting", op: "lock", durationMs: H });
  assert.deepEqual(parseGroupRequest("الجروب مقفول؟"), { kind: "settings.get" });
  assert.deepEqual(parseGroupRequest("is the group locked?"), { kind: "settings.get" });
  assert.equal(parseGroupRequest("اقفل الجروب عشان خاطري"), null, "بقية غير مفهومة ⇒ للذكاء لا تنفيذ مخمَّن");
});

await check("parse-bulk", async () => {
  assert.deepEqual(parseGroupRequest("اطرد كل الأعضاء إلا أحمد"), { kind: "bulk", op: "kick", mode: "all", exceptText: "احمد", allowAdmins: false });
  assert.deepEqual(parseGroupRequest("اطرد الكل ما عدا أحمد ومحمد"), { kind: "bulk", op: "kick", mode: "all", exceptText: "احمد ومحمد", allowAdmins: false });
  assert.deepEqual(parseGroupRequest("اطرد الكل"), { kind: "bulk", op: "kick", mode: "all", exceptText: "", allowAdmins: false });
  assert.deepEqual(parseGroupRequest("اطرد الكل حتى المشرفين"), { kind: "bulk", op: "kick", mode: "all", exceptText: "", allowAdmins: true });
  assert.deepEqual(parseGroupRequest("اطرد الكل الا المشرفين"), { kind: "bulk", op: "kick", mode: "all", exceptText: "", allowAdmins: false }, "المشرفون محميون أصلاً");
  assert.deepEqual(parseGroupRequest("kick everyone except Ahmed"), { kind: "bulk", op: "kick", mode: "all", exceptText: "ahmed", allowAdmins: false });
  assert.deepEqual(parseGroupRequest("expulsa a todos menos Ahmed"), { kind: "bulk", op: "kick", mode: "all", exceptText: "ahmed", allowAdmins: false });
  assert.equal(parseGroupRequest("امسح الكل"), null, "«امسح الكل» ليس طرداً");
});

await check("parse-block-and-text", async () => {
  assert.equal(parseGroupRequest("احظر أحمد").block, true);
  assert.equal(parseGroupRequest("احظر أحمد").name, "احمد");
  assert.equal(parseGroupRequest("احظره").pronoun, true);
  assert.equal(parseGroupRequest("فك الحظر عن أحمد").block, false);
  assert.equal(parseGroupRequest("احظره بدون تأكيد").explicit, true);
  assert.equal(parseGroupRequest("حظرتك عامل ايه"), null, "«حظرتك» ليست حظراً");
  assert.equal(parseGroupRequest("block the group"), null);
  assert.equal(parseGroupRequest("block chain explained in detail"), null, "جملة إنجليزية طويلة ليست حظراً");
  assert.deepEqual(parseGroupRequest("غير اسم الجروب لـ «أصحاب الكلية»"), { kind: "subject", value: "أصحاب الكلية" });
  assert.deepEqual(parseGroupRequest("rename the group to Friends"), { kind: "subject", value: "Friends" });
  assert.deepEqual(parseGroupRequest("امسح وصف الجروب"), { kind: "description", value: "" });
  assert.deepEqual(parseGroupRequest("هات لينك الجروب"), { kind: "invite.get" });
  assert.equal(parseGroupRequest("غير اللينك").kind, "invite.revoke");
  assert.equal(parseGroupRequest("شيل الخلفية"), null);
  assert.equal(parseGroupRequest("اطرد أحمد"), null, "طرد عضو واحد ⇒ مسار الأعضاء العادي");
});

console.log(`✅ terboo-bulk-executor: ${results.join(" · ")}`);
process.exit(0);
