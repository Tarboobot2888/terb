// ═══════════════════════════════════════════════
// 🧪 Terboo SSH — سياسة الأوامر + المدير ضد خادم SSH حقيقي داخل العملية
// ───────────────────────────────────────────────
// سياسة: قراءة/كتابة/مرفوض · أسرار · مسارات خارج مساحة العمل · shell متداخل · رموز shell
// · مدير: تسجيل بسر مشفّر (لا نص صريح على القرص) · بصمة قبل أي مصادقة · رفض بلا تثبيت · تثبيت
// · رفض عند تغيّر مفتاح المضيف (اعتراض) · argv مقتبس فعلاً عبر bash حقيقي (لا حقن) · الكتابة تحتاج تأكيداً
// · رمز خروج حقيقي · مهلة · تنقيح الأسرار من المخرجات · SFTP داخل مساحة العمل فقط · وصفة بإجابات.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-ssh-"));
process.env.TERBOO_SSH_STORE = path.join(tmp, "ssh-hosts.json");
process.env.TERBOO_MASTER_KEY_FILE = path.join(tmp, "master.key");
const P = await import("../src/lib/terboo-ssh-policy.js");
const S = await import("../src/lib/terboo-ssh.js");
const { startSshServer } = await import("./fixtures/ssh-server.mjs");
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };
const WS = "/srv/ws";

await check("policy", async () => {
  const c = (argv, cwd = WS) => P.classify(argv, { workspace: WS, cwd });
  assert.equal(c(["df", "-h"]).level, "read");
  assert.equal(c(["systemctl", "status", "nginx"]).level, "read");
  assert.equal(c(["journalctl", "-u", "bot", "-n", "50"]).level, "read");
  assert.equal(c(["pm2", "ls"]).level, "read");
  assert.equal(c(["git", "status"]).level, "read");
  assert.equal(c(["node", "--check", "index.js"]).level, "read");
  assert.equal(c(["npm", "ci"]).level, "write");
  assert.equal(c(["pm2", "restart", "bot"]).level, "write");
  assert.equal(c(["systemctl", "restart", "nginx"]).level, "write");
  assert.equal(c(["mkdir", "-p", "/srv/ws/app"]).level, "write");
  assert.equal(c(["unzip", "-o", "a.zip", "-d", "/srv/ws/app"]).level, "write");
  assert.equal(c(["node", "/srv/ws/app/index.js"]).level, "write");
  for (const [argv, reason] of [
    [["rm", "-rf", "/"], "outside-workspace"],
    [["rm", "-rf", "/srv/ws"], "rm-workspace-root"],
    [["cp", "x", "/etc/passwd"], "outside-workspace"],
    [["unzip", "a.zip", "-d", "/etc"], "outside-workspace"],
    [["node", "/etc/x.js"], "outside-workspace"],
    [["node", "-e", "require('fs')"], "inline-code"],
    [["bash", "-c", "id"], "denied-binary:bash"],
    [["sudo", "reboot"], "denied-binary:sudo"],
    [["mkfs.ext4", "/dev/sda"], "denied-binary:mkfs.ext4"],
    [["dd", "if=/dev/zero", "of=/dev/sda"], "denied-binary:dd"],
    [["cat", "/root/.ssh/id_rsa"], "secret-path"],
    [["cat", "/srv/ws/app/.env"], "secret-path"],
    [["printenv"], "denied-binary:printenv"],
    [["ls", "|", "sh"], "shell-syntax"],
    [["curl", "-o", "/tmp/x", "http://a"], "network-write"],
    [["find", ".", "-delete"], "find-action"],
    [["kill", "-9", "-1"], "kill-all"],
    [["docker", "run", "--privileged", "x"], "docker-privileged"],
    [["chmod", "-R", "777", "/"], "outside-workspace"],
    [["./evil"], "binary-path"],
  ]) {
    const out = c(argv);
    assert.equal(out.level, "denied", `${argv.join(" ")} ⇒ مرفوض`);
    assert.equal(out.reason, reason, `${argv.join(" ")}: ${out.reason}`);
  }
  assert.deepEqual(P.splitArgs(`ls -la "my dir" 'a b'`), ["ls", "-la", "my dir", "a b"]);
  assert.equal(P.splitArgs(`echo "unclosed`), null);
  assert.equal(P.commandLine(["echo", "it's $(whoami)"]), `'echo' 'it'\\''s $(whoami)'`);
});

const server = await startSshServer();

await check("register-encrypted", async () => {
  const added = S.addHost({ id: "lab", host: "127.0.0.1", port: server.port, username: "tester", auth: "key", secret: server.userKey.private, workspace: WS, addedBy: "pn:1" });
  assert.equal(added.ok, true, JSON.stringify(added));
  const disk = fs.readFileSync(process.env.TERBOO_SSH_STORE, "utf8");
  assert.doesNotMatch(disk, /PRIVATE KEY/, "لا مفتاح صريح على القرص");
  assert.match(disk, /tv1:/, "مشفّر في الخزنة");
  assert.equal((fs.statSync(process.env.TERBOO_SSH_STORE).mode & 0o777), 0o600, "صلاحية الملف 600");
  assert.equal(S.addHost({ id: "bad", host: "127.0.0.1", auth: "key", secret: "not a key" }).code, "invalid-key");
  assert.equal(S.addHost({ id: "bad2", host: "127.0.0.1", auth: "password", secret: "x", workspace: "/" }).code, "invalid-workspace");
  assert.equal(S.listHosts()[0].pinned, false);
  assert.equal(JSON.stringify(S.listHosts()).includes("PRIVATE"), false, "العرض بلا بيانات دخول");
  assert.equal(S.hostCount(), 1);
  assert.equal(global.terbooSshHostCount(), 1, "مزوّد ssh متاح لمحرّك الصلاحيات");
});

await check("pin-before-auth", async () => {
  const blocked = await S.exec("lab", ["uname"]);
  assert.equal(blocked.code, "not-pinned", "لا اتصال قبل تثبيت البصمة");
  const before = server.commands.length;
  const probe = await S.probeFingerprint("lab");
  assert.equal(probe.ok, true, JSON.stringify(probe));
  assert.match(probe.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(server.commands.length, before, "الفحص لا ينفّذ شيئاً");
  assert.equal(S.pinHost("lab", probe.fingerprint).ok, true);
});

await check("exec-read-quoted", async () => {
  const out = await S.exec("lab", ["echo", "hi; touch PWNED $(whoami) `id`"]);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.stdout.trim(), "hi; touch PWNED $(whoami) `id`", "الوسيط حرفي — لا حقن");
  assert.equal(fs.existsSync(path.join(server.root, "PWNED")), false);
  assert.equal(out.exitCode, 0);
  assert.equal(out.level, "read");
});

await check("write-needs-confirmation", async () => {
  const ask = await S.exec("lab", ["mkdir", "-p", `${WS}/app`]);
  assert.equal(ask.code, "needs-confirmation");
  assert.equal(fs.existsSync(path.join(server.root, "app")), false);
  const done = await S.exec("lab", ["mkdir", "-p", `${WS}/app`], { allowWrite: true });
  assert.equal(done.ok, true);
  assert.ok(fs.existsSync(path.join(server.root, "app")));
  const denied = await S.exec("lab", ["rm", "-rf", "/"], { allowWrite: true });
  assert.equal(denied.code, "denied", "المرفوض مرفوض حتى مع التأكيد");
  const cwd = await S.exec("lab", ["ls"], { cwd: "/etc" });
  assert.equal(cwd.reason, "cwd-outside-workspace");
});

await check("real-exit-code-and-timeout", async () => {
  const missing = await S.exec("lab", ["ls", `${WS}/does-not-exist`]);
  assert.equal(missing.ok, false, "فشل حقيقي لا «نجاح» عند الإغلاق");
  assert.equal(missing.code, "exit-nonzero");
  assert.ok(missing.exitCode > 0);
  assert.match(missing.stderr, /No such file/);
  const slow = await S.exec("lab", ["tail", "-f", "/dev/null"], { timeoutMs: 1000 });
  assert.equal(slow.code, "timeout");
});

await check("sftp-workspace-only", async () => {
  const wrote = await S.sftpWrite("lab", `${WS}/app/index.js`, "console.log('ok')\n");
  assert.equal(wrote.ok, true, JSON.stringify(wrote));
  assert.equal(fs.readFileSync(path.join(server.root, "app", "index.js"), "utf8"), "console.log('ok')\n");
  const read = await S.sftpRead("lab", `${WS}/app/index.js`);
  assert.equal(read.data.toString(), "console.log('ok')\n");
  assert.equal((await S.sftpWrite("lab", "/etc/cron.d/x", "x")).code, "outside-workspace");
  assert.equal((await S.sftpWrite("lab", `${WS}/../etc/x`, "x")).code, "outside-workspace");
  const run = await S.exec("lab", ["node", `${WS}/app/index.js`], { allowWrite: true });
  assert.equal(run.stdout.trim(), "ok");
});

await check("recipe-with-answers", async () => {
  S.registerRecipe("echo-test", { title: "echo", steps: [{ script: "printf 'Your name? '; read n; echo \"hello $n\"", answers: [{ trigger: "Your name?", value: (a) => a.name }], timeoutMs: 5000 }] });
  const out = await S.runRecipe("lab", "echo-test", { answers: { name: "terboo" } });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.match(out.steps[0].tail, /hello terboo/);
  S.registerRecipe("fail-test", { title: "fail", steps: [{ script: "exit 3" }, { script: "echo never" }] });
  const failed = await S.runRecipe("lab", "fail-test");
  assert.equal(failed.ok, false);
  assert.equal(failed.steps.length, 1, "أول فشل يوقف ما بعده");
  assert.equal(failed.steps[0].exitCode, 3);
});

await check("password-host-redacted", async () => {
  assert.equal(S.addHost({ id: "pw", host: "127.0.0.1", port: server.port, username: "tester", auth: "password", secret: server.password, workspace: WS }).ok, true);
  assert.equal(S.pinHost("pw", (await S.probeFingerprint("pw")).fingerprint).ok, true);
  const out = await S.exec("pw", ["echo", server.password]);
  assert.equal(out.ok, true);
  assert.doesNotMatch(out.stdout, new RegExp(server.password), "كلمة المرور لا تظهر في المخرجات");
  assert.doesNotMatch(fs.readFileSync(process.env.TERBOO_SSH_STORE, "utf8"), new RegExp(server.password));
});

await check("host-key-change-refused", async () => {
  const commands = server.commands.length;
  await server.rotateHostKey();
  const out = await S.exec("lab", ["uname"]);
  assert.equal(out.code, "fingerprint-mismatch", "مفتاح مضيف مختلف ⇒ رفض قبل إرسال أي سر");
  assert.equal(server.commands.length, commands);
  const probe = await S.probeFingerprint("lab");
  assert.equal(probe.matches, false, "الفحص يوضح عدم التطابق للمالك");
});

await check("remove", async () => {
  assert.equal(S.removeHost("pw").ok, true);
  assert.equal(S.getHost("pw"), null);
});

await server.close();
console.log(`✅ terboo-ssh: ${results.join(" · ")}`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* مجلد مؤقت */ }
process.exit(0);
