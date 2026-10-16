// ═══════════════════════════════════════════════
// 🧪 Terboo SSH Agent — تكامل: تسجيل آمن · تثبيت بصمة · تشخيص · أوامر · نشر zip · إصلاح بالذكاء · الأوامر القديمة
// ───────────────────────────────────────────────
// خادم SSH حقيقي داخل العملية + pm2 وهمي على PATH الخادم. التسجيل والتشخيص عبر messageHandler الحقيقي؛
// النشر عبر نفس واجهة الأمر برسالة تحمل zip حقيقياً (تنزيل وسائط واتساب لا يُحاكى داخل serialize).
// يثبت: السر يُحذف من الدردشة ولا يُكتب صريحاً · لا اتصال قبل التثبيت · المرفوض مرفوض · الكتابة بتأكيد
// · zip-slip/أسرار مرفوضة/مستبعدة · فشل البناء ⇒ اقتراح ⇒ تأكيد ⇒ نسخة ⇒ تطبيق ⇒ إعادة ⇒ يعمل
// · اقتراح لا يصلح ⇒ استرجاع الملف الأصلي · «IP|كلمة مرور» في الأوامر القديمة ⇒ حذف الرسالة ورفض.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111111";
const OWNER = "201000000999@s.whatsapp.net";
const STRANGER = "201200000077@s.whatsapp.net";

global.terbooProviders = {
  map: { GeminiAPI: async () => ({ text: JSON.stringify({ decision: "CHAT", reply: "تمام", confidence: 0.9 }) }) },
  loadedAt: Date.now() + 3_600_000,
  names: ["GeminiAPI"],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-ssh-agent-"));
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
process.env.TERBOO_VPS_STORE = path.join(tmp, "vps.json");
process.env.TERBOO_SSH_STORE = path.join(tmp, "ssh-hosts.json");
process.env.TERBOO_MASTER_KEY_FILE = path.join(tmp, "master.key");
process.env.TERBOO_AGENT_STATE_DIR = path.join(tmp, "agent");

// pm2 وهمي: start يفحص الملف فعلاً (node --check) ويحفظ الحالة؛ jlist يعيدها
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, "pm2"), `#!/usr/bin/env bash
STATE="$HOME/.pm2state"
case "$1" in
  start) shift; file=""; name=""
    while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --interpreter) shift 2;; --) shift; break;; -*) shift;; *) [ -z "$file" ] && file="$1"; shift;; esac; done
    if node --check "$file" 2>/dev/null; then echo "$name online" > "$STATE"; echo "[PM2] started $name"; exit 0; else echo "$name errored" > "$STATE"; echo "boom" >&2; exit 1; fi;;
  jlist) if [ -f "$STATE" ]; then read n s < "$STATE"; echo "[{\\"name\\":\\"$n\\",\\"pm2_env\\":{\\"status\\":\\"$s\\",\\"restart_time\\":0}}]"; else echo "[]"; fi;;
  logs) echo "app started fine";;
  *) exit 0;;
esac
`, { mode: 0o755 });

const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
config.owner.number = [OWNER.split("@")[0]];
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const { messageHandler } = await import("../src/handler.js");
const S = await import("../src/lib/terboo-ssh.js");
const agent = await import("../src/lib/terboo-ssh-agent.js");
const RW = await import("../src/lib/terboo-remote-workspace.js");
const { startSshServer } = await import("./fixtures/ssh-server.mjs");
db.setting("registrationRequired", false);
for (const jid of [OWNER, STRANGER]) db.setUser(jid, { isRegistered: true, regName: "مختبر", language: "ar" });
RW.installRemoteWorkspace();

const server = await startSshServer({ extraPath: bin });
const outbox = [];
const deleted = [];
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net` },
  sendMessage: async (chat, content) => {
    if (content?.delete) { deleted.push(content.delete.id); return { key: { id: "DEL" } }; }
    outbox.push({ chat, text: content?.text || content?.caption || "" });
    return { key: { id: `M${outbox.length}`, remoteJid: chat, fromMe: true } };
  },
  relayMessage: async (chat, message, opts) => {
    const node = message?.viewOnceMessage?.message?.interactiveMessage || message?.interactiveMessage;
    const buttons = (node?.nativeFlowMessage?.buttons || []).map((b) => { try { return JSON.parse(b.buttonParamsJson || "{}").id; } catch { return null; } });
    outbox.push({ chat, text: node?.body?.text || "", buttons });
    return opts?.messageId || `R${outbox.length}`;
  },
  // «حذف لدي» على جهاز البوت (المحادثة الخاصة لا تسمح بحذف نسخة المستخدم)
  chatModify: async (mod) => { if (mod?.deleteForMe?.key?.id) deleted.push(mod.deleteForMe.key.id); },
  sendPresenceUpdate: async () => { },
  readMessages: async () => { },
};

let seq = 0;
async function say(sender, text) {
  const before = outbox.length;
  const id = `SA${++seq}X${Date.now().toString(36).toUpperCase()}`;
  await messageHandler({ key: { remoteJid: sender, fromMe: false, id }, message: { conversation: text }, pushName: "المالك", messageTimestamp: Math.floor(Date.now() / 1000) }, sock);
  await new Promise((r) => setTimeout(r, 40));
  const fresh = outbox.slice(before);
  return { id, replies: fresh.map((x) => x.text).join("\n"), buttons: fresh.flatMap((x) => x.buttons || []) };
}
const okButton = (r) => r.buttons.find((b) => /\.ssh ok /.test(b));
/** رسالة مباشرة لواجهة الأمر (للنشر بملف zip حقيقي) */
function direct(text, { zip = null, name = "app.zip" } = {}) {
  const replies = [];
  const m = {
    sender: OWNER, chat: OWNER, isGroup: false, prefix: ".", command: "ssh", text, body: `.ssh ${text}`, pushName: "المالك",
    key: { id: `D${++seq}`, remoteJid: OWNER, fromMe: false }, message: { conversation: `.ssh ${text}` }, mentionedJid: [],
    reply: async (value) => { replies.push(String(value)); outbox.push({ chat: OWNER, text: String(value) }); return { key: { id: `X${seq}` } }; },
    quoted: zip ? { isDocument: true, type: "documentMessage", message: { documentMessage: { fileName: name } }, download: async () => zip } : null,
  };
  return { m, replies };
}
async function command(text, options) {
  const before = outbox.length;
  const { m } = direct(text, options);
  await agent.handleSshCommand(m, sock, "ar");
  const fresh = outbox.slice(before);
  return { replies: fresh.map((x) => x.text).join("\n"), buttons: fresh.flatMap((x) => x.buttons || []) };
}
async function waitFor(fn, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
}
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

await check("register-secret-scrubbed", async () => {
  const start = await say(OWNER, `.ssh add lab tester@127.0.0.1:${server.port} /srv/ws`);
  assert.match(start.replies, /ابعت المفتاح الخاص/);
  const key = await say(OWNER, server.userKey.private);
  assert.ok(deleted.includes(key.id), "رسالة المفتاح حُذفت من سجل البوت");
  assert.match(key.replies, /SHA256:/, "البصمة معروضة قبل أي اتصال موثّق");
  assert.doesNotMatch(fs.readFileSync(process.env.TERBOO_SSH_STORE, "utf8"), /PRIVATE KEY/);
  assert.equal(S.getHost("lab").fingerprint, "", "لم تُثبَّت قبل الضغط");
  const pin = await say(OWNER, okButton(key));
  assert.match(pin.replies, /اتثبتت بصمة lab/);
  assert.match(S.getHost("lab").fingerprint, /^SHA256:/);
});

await check("stranger-denied", async () => {
  const r = await say(STRANGER, ".ssh status lab");
  assert.doesNotMatch(r.replies, /uptime/);
  const nl = await say(STRANGER, "حالة سيرفر lab");
  assert.doesNotMatch(nl.replies, /load average/, "لا تشخيص لغير المالك");
});

await check("natural-status", async () => {
  const r = await say(OWNER, "حالة سيرفر lab");
  assert.match(r.replies, /حالة lab/);
  assert.match(r.replies, /uptime/);
  assert.match(r.replies, /load average/, "مخرجات حقيقية من الخادم");
});

await check("run-policy", async () => {
  const denied = await command("run lab rm -rf /");
  assert.match(denied.replies, /مرفوض/);
  const ask = await command("run lab mkdir -p /srv/ws/demo");
  assert.ok(okButton(ask), "أمر كتابة ⇒ زر تأكيد");
  assert.equal(fs.existsSync(path.join(server.root, "demo")), false);
  await command(okButton(ask).replace(/^\.ssh /, ""));
  assert.ok(fs.existsSync(path.join(server.root, "demo")), "نُفّذ بعد التأكيد");
});

const zipOf = (files) => {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
};

await check("zip-rejections", async () => {
  const slip = new AdmZip();
  slip.addFile("ok.js", Buffer.from("1"));
  const raw = slip.toBuffer();
  // مسار صاعد داخل الأرشيف (zip-slip) يُكتب يدوياً لأن adm-zip يطبّعه
  const evil = Buffer.from(raw.toString("latin1").split("ok.js").join("../x.js".slice(0, 5)), "latin1");
  assert.equal(RW.inspectZip(evil).ok, false);
  assert.equal(RW.inspectZip(Buffer.from("not a zip")).code, "bad-zip");
  const info = RW.inspectZip(zipOf({ "proj/package.json": "{\"name\":\"x\",\"main\":\"index.js\"}", "proj/index.js": "1", "proj/.env": "TOKEN=abc", "proj/node_modules/a/b.js": "x" }));
  assert.equal(info.ok, true);
  assert.equal(info.type, "node");
  assert.deepEqual(info.files.map((f) => f.name).sort(), ["index.js", "package.json"], "مجلد الجذر أزيل · الأسرار والتبعيات استُبعدت");
  assert.deepEqual(info.skipped, { deps: 1, secrets: 1 });
});

await check("deploy-fail-fix-run", async () => {
  agent._setSshAsk(async () => ({ text: JSON.stringify({ file: "index.js", find: "console.log(\"bot up\"", replace: "console.log(\"bot up\")", reason: "missing closing parenthesis", risk: "low" }) }));
  const zip = zipOf({ "package.json": JSON.stringify({ name: "demo-bot", version: "1.0.0", main: "index.js" }), "index.js": "console.log(\"bot up\"\n", ".env": "SECRET=1" });
  const plan = await command("deploy lab", { zip, name: "demo-bot.zip" });
  assert.match(plan.replies, /نشر «demo-bot.zip» على lab/);
  assert.match(plan.replies, /npm install/);
  assert.match(plan.replies, /اتشال 1 ملف أسرار/);
  const before = outbox.length;
  await command(okButton(plan).replace(/^\.ssh /, ""));
  assert.ok(await waitFor(() => outbox.slice(before).some((x) => /النشر وقف عند خطوة check/.test(x.text))), "فشل حقيقي عند فحص الصياغة");
  const failure = outbox.slice(before).find((x) => /النشر وقف/.test(x.text));
  const workspace = fs.readdirSync(server.root).find((d) => d.startsWith("demo-bot-"));
  assert.ok(workspace, "مساحة عمل جديدة معزولة");
  assert.equal(fs.existsSync(path.join(server.root, workspace, ".env")), false, "ملف الأسرار لم يُرفع");
  const fixButton = (failure.buttons || []).find((b) => /\.ssh ok /.test(b));
  const proposal = await command(fixButton.replace(/^\.ssh /, ""));
  assert.match(proposal.replies, /إصلاح مقترح \(خطورة منخفضة\)/);
  assert.match(proposal.replies, /\+ console\.log\("bot up"\)/, "فرق واضح قبل التطبيق");
  assert.equal(fs.readFileSync(path.join(server.root, workspace, "index.js"), "utf8"), "console.log(\"bot up\"\n", "لا تطبيق قبل التأكيد");
  const applied = await command(okButton(proposal).replace(/^\.ssh /, ""));
  assert.match(applied.replies, /اتصلح ✓/);
  assert.match(applied.replies, /online/);
  assert.equal(fs.readFileSync(path.join(server.root, workspace, "index.js"), "utf8"), "console.log(\"bot up\")\n");
  assert.ok(fs.existsSync(path.join(server.root, workspace, ".terboo-backup")), "نسخة احتياطية قبل التعديل");
});

await check("bad-fix-rolled-back", async () => {
  agent._setSshAsk(async () => ({ text: JSON.stringify({ file: "index.js", find: "let x = ;", replace: "let x = (;", reason: "try", risk: "high" }) }));
  const zip = zipOf({ "package.json": JSON.stringify({ name: "broken", version: "1.0.0", main: "index.js" }), "index.js": "let x = ;\n" });
  const plan = await command("deploy lab", { zip, name: "broken.zip" });
  const before = outbox.length;
  await command(okButton(plan).replace(/^\.ssh /, ""));
  assert.ok(await waitFor(() => outbox.slice(before).some((x) => /النشر وقف/.test(x.text))));
  const failure = outbox.slice(before).find((x) => /النشر وقف/.test(x.text));
  const proposal = await command((failure.buttons || []).find((b) => /\.ssh ok /.test(b)).replace(/^\.ssh /, ""));
  const applied = await command(okButton(proposal).replace(/^\.ssh /, ""));
  assert.match(applied.replies, /رجعت الملف الأصلي/);
  const workspace = fs.readdirSync(server.root).find((d) => d.startsWith("broken-"));
  assert.equal(fs.readFileSync(path.join(server.root, workspace, "index.js"), "utf8"), "let x = ;\n", "استرجاع حقيقي للمحتوى الأصلي");
});

agent._setSshAsk(null);
await server.close();
console.log(`✅ terboo-ssh-agent: ${results.join(" · ")}`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* مجلد مؤقت */ }
process.exit(0);
