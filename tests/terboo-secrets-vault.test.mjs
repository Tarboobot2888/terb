// ═══════════════════════════════════════════════
// 🧪 Terboo Secrets + Vault
// ───────────────────────────────────────────────
//   1. أسرار config (APIkey · secrets) مسجّلة وتُخفى في النصوص والكائنات.
//   2. console.* لا يطبع سراً · سجل الإخفاقات لا يحفظ سراً.
//   3. رسالة صادرة فيها سر أو توكن لوحة تُخفى، ومثال كود عادي لا يُشوَّه.
//   4. ask() لا يرسل سراً لأي نموذج.
//   5. الخزنة: AES-256-GCM · فك صحيح · AAD يربط السر بصاحبه · العبث يفشل · المفتاح يُولَّد بصلاحية 600.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-vault-"));
process.env.TERBOO_MASTER_KEY_FILE = path.join(tmp, "secure", "master.key");
delete process.env.TERBOO_MASTER_KEY;

const config = (await import("../config.js")).default;
config.security = { ...(config.security || {}), masterKey: "" };
const S = await import("../src/lib/terboo-secrets.js");
const V = await import("../src/lib/terboo-vault.js");
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

const VZ_KEY = "TESTSECRETKEY_AAAAAAAA1234";
const VZ_PASS = "TESTSECRETPASS_BBBBBBBB5678";

await check("config-secrets", async () => {
  S.registerConfigSecrets(config, {});
  S.registerSecret(VZ_KEY);
  S.registerSecret(VZ_PASS);
  assert.ok(S.secretCount() >= 2);
  const leaked = `key=${VZ_KEY} pass=${VZ_PASS} done`;
  const safe = S.redactSecrets(leaked);
  assert.ok(!safe.includes(VZ_KEY) && !safe.includes(VZ_PASS), safe);
  assert.ok(S.containsSecret(leaked));
  const deep = S.redactDeep({ a: [{ b: `x ${VZ_PASS}` }], n: 3 });
  assert.equal(deep.a[0].b, `x ${S.MASK}`);
  assert.equal(deep.n, 3);
  // نمط الاستعلام وترويسة Authorization تُخفى في السجلات حتى بلا تسجيل
  assert.ok(!S.redactSecrets("GET /index.php?act=listvs&apikey=ZZZZ1111&apipass=YYYY2222").includes("ZZZZ1111"));
  assert.ok(!S.redactSecrets("Authorization: Bearer abcdefghijklmnop123").includes("abcdefghijklmnop123"));
});

await check("console-and-failure-log", async () => {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  S.installConsoleRedaction();
  console.warn(`token ${VZ_KEY}`);
  const { noteFailure, recentFailures } = await import("../src/lib/terboo-failure-log.js");
  noteFailure("test-secrets", new Error(`boom apipass=${VZ_PASS}`), { where: "t" });
  console.warn = original;
  assert.ok(lines.every((line) => !line.includes(VZ_KEY) && !line.includes(VZ_PASS)), lines.join("\n"));
  assert.ok(recentFailures().every((entry) => !JSON.stringify(entry).includes(VZ_PASS)));
});

await check("outgoing-message", async () => {
  const { guardContentText } = await import("../src/lib/terboo-wa-compat.js");
  const panel = "ptlc_" + "A".repeat(43);
  const out = guardContentText({ text: `your key ${VZ_KEY} and ${panel}` });
  assert.ok(!out.text.includes(VZ_KEY) && !out.text.includes(panel), out.text);
  const code = 'const cfg = { password: "example-password" };';
  assert.equal(guardContentText({ text: code }).text, code, "مثال كود عادي لا يُشوَّه");
});

await check("ai-ask-redacts", async () => {
  const { ask } = await import("../src/lib/terboo-ai-providers.js");
  const seen = [];
  await ask({ text: `use ${VZ_KEY}`, instruction: `pass ${VZ_PASS}`, history: [{ role: "user", content: VZ_KEY }] }, null, { providers: { GPT: async (payload) => { seen.push(JSON.stringify(payload)); return { text: "ok" }; } } });
  assert.ok(seen.length && seen.every((s) => !s.includes(VZ_KEY) && !s.includes(VZ_PASS)), seen.join("\n"));
});

await check("vault", async () => {
  V._resetVault();
  const blob = V.encryptSecret("ptla_secret_value_123456789", { context: "pterodactyl", aad: "user-1" });
  assert.ok(V.isSealed(blob) && !blob.includes("secret_value"));
  assert.equal(V.decryptSecret(blob, { context: "pterodactyl", aad: "user-1" }), "ptla_secret_value_123456789");
  assert.throws(() => V.decryptSecret(blob, { context: "pterodactyl", aad: "user-2" }), /vault-decrypt-failed/, "صاحب آخر");
  assert.throws(() => V.decryptSecret(blob, { context: "vps", aad: "user-1" }), /vault-decrypt-failed/, "سياق آخر");
  const tampered = blob.slice(0, -2) + (blob.endsWith("A") ? "BB" : "AA");
  assert.throws(() => V.decryptSecret(tampered, { context: "pterodactyl", aad: "user-1" }), /vault-/);
  assert.notEqual(V.encryptSecret("same", { context: "c" }), V.encryptSecret("same", { context: "c" }), "IV عشوائي");
  const stat = fs.statSync(process.env.TERBOO_MASTER_KEY_FILE);
  assert.equal(stat.mode & 0o777, 0o600, "ملف المفتاح بصلاحية 600");
  assert.equal(V.maskSecret(), "••••••••••••");
  // المفتاح المولَّد نفسه يفك بعد إعادة التحميل
  V._resetVault();
  assert.equal(V.decryptSecret(blob, { context: "pterodactyl", aad: "user-1" }), "ptla_secret_value_123456789");
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✅ terboo-secrets-vault: ${results.join(" · ")}`);
process.exit(0);
