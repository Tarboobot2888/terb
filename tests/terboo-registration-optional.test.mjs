// ═══════════════════════════════════════════════
// 🧪 Terboo V6 — التسجيل اختياري بالكامل (messageHandler الحقيقي)
// ───────────────────────────────────────────────
//   1. مستخدم جديد بلا لغة ⇒ بطاقة اللغة فقط (بوابة اللغة مسموحة)
//   2. بعد اختيار اللغة ⇒ أمر عادي ينفَّذ مباشرة بلا «سجّل أولاً» — حتى لو بقي registrationRequired=true
//      مخزّناً من ترقية v5 (يُطفأ مرة واحدة)
//   3. وجود المستخدم في القاعدة ≠ مسجّل: لا يُنشأ isRegistered من مجرد الاستخدام
//   4. التسجيل اليدوي (.daftar) ما زال يعمل كخيار، وأمر المالك لا يعيد التسجيل الإجباري
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111111";
const OWNER = "201000000999@s.whatsapp.net";
const NEWBIE = "201200000088@s.whatsapp.net";

global.terbooProviders = {
  map: { GeminiAPI: async () => ({ text: JSON.stringify({ decision: "CHAT", reply: "تمام", confidence: 0.9 }) }) },
  loadedAt: Date.now() + 3_600_000,
  names: ["GeminiAPI"],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-regopt-"));
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
process.env.TERBOO_VPS_STORE = path.join(tmp, "vps.json");
process.env.TERBOO_AGENT_STATE_DIR = path.join(tmp, "agent");
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
config.owner.number = [OWNER.split("@")[0]];
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const { messageHandler } = await import("../src/handler.js");

// إعداد قديم من ترقية v5: التسجيل الإجباري مخزّن في القاعدة
db.setting("registrationRequired", true);
db.setting("terbooRegistrationMigrated", true);
db.setUser(OWNER, { language: "ar" });

const outbox = [];
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net` },
  ws: { readyState: 1 },
  sendMessage: async (chat, content) => {
    outbox.push({ chat, text: content?.text || content?.caption || "" });
    return { key: { id: `M${outbox.length}`, remoteJid: chat, fromMe: true } };
  },
  relayMessage: async (chat, message, opts) => {
    const node = message?.viewOnceMessage?.message?.interactiveMessage || message?.interactiveMessage;
    const buttons = (node?.nativeFlowMessage?.buttons || []).map((b) => JSON.parse(b.buttonParamsJson || "{}").id);
    outbox.push({ chat, text: node?.body?.text || "", buttons });
    return opts?.messageId || `R${outbox.length}`;
  },
  sendPresenceUpdate: async () => true,
  readMessages: async () => true,
  profilePictureUrl: async () => { throw new Error("no picture in tests"); },
};

let seq = 0;
function message(sender, text, { button = null } = {}) {
  const id = `RO${++seq}X${Date.now().toString(36).toUpperCase()}`;
  const base = { key: { remoteJid: sender, fromMe: false, id }, pushName: "Newbie", messageTimestamp: Math.floor(Date.now() / 1000) };
  if (button) {
    return { ...base, message: { interactiveResponseMessage: { body: { text: "" }, nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id: button }), version: 3 } } } };
  }
  return { ...base, message: { conversation: text } };
}
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
async function say(sender, text, options = {}) {
  const before = outbox.length;
  await messageHandler(message(sender, text, options), sock);
  await tick();
  const fresh = outbox.slice(before).filter((x) => x.chat === sender);
  return { text: fresh.map((x) => x.text).join("\n"), buttons: fresh.flatMap((x) => x.buttons || []) };
}
const REGISTER_PROMPT = /سجّل أولاً|التسجيل مطلوب|registration required|regístrate primero/i;

// 1) مستخدم جديد بلا لغة ⇒ بطاقة اللغة
let r = await say(NEWBIE, ".rules");
assert.deepEqual(r.buttons, ["terboo_language_ar", "terboo_language_en"], "مستخدم جديد ⇒ بطاقة اللغة");
assert.doesNotMatch(r.text, REGISTER_PROMPT, "لا «سجّل أولاً» قبل اللغة");

// 2) اختيار اللغة ⇒ القائمة الرئيسية مباشرةً — بلا بطاقة تسجيل ولا خطوة نمط استخدام
r = await say(NEWBIE, "", { button: "terboo_language_ar" });
assert.doesNotMatch(r.text, /إنشاء حسابك/, "لا بطاقة تسجيل بعد اللغة");
assert.ok(!r.buttons.some((id) => /usage/.test(id)), "لا خطوة نمط استخدام بعد اللغة");

// 3) أمر عادي بلا skipRegistration ⇒ ينفَّذ مباشرة رغم الإعداد القديم المخزّن
assert.equal(Boolean(getPlugin("rules").config.skipRegistration), false, "الأمر المختبَر ليس مستثنى أصلاً");
r = await say(NEWBIE, ".rules");
assert.doesNotMatch(r.text, REGISTER_PROMPT, `الأمر لا يُمنع بسبب التسجيل: ${r.text.slice(0, 120)}`);
assert.ok(r.text.length > 20, "الأمر نُفِّذ فعلاً وأرسل رده");
assert.equal(db.setting("registrationRequired"), false, "الإعداد القديم أُطفئ مرة واحدة");

// 4) وجود المستخدم ≠ مسجّل
const user = db.getUser(NEWBIE);
assert.ok(user, "المستخدم معروف من هويته");
assert.notEqual(user.isRegistered, true, "لا تسجيل ضمني من مجرد الاستخدام");
assert.equal(user.language, "ar");

// 5) التسجيل اليدوي ما زال يعمل اختيارياً
r = await say(NEWBIE, ".daftar");
assert.match(r.text, /إنشاء حسابك/, "التسجيل اليدوي يعرض بطاقته");
const registration = await import("../plugins/user/daftar.js");
registration.clearRegistrationSession(NEWBIE);

// 6) أمر المالك لا يعيد التسجيل الإجباري ولا يدّعي نجاحاً وهمياً
r = await say(OWNER, ".نظام_التسجيل تشغيل");
assert.match(r.text, /اختياري/, "المالك يُبلَّغ أن التسجيل اختياري");
assert.equal(db.setting("registrationRequired"), false, "لا عودة للتسجيل الإجباري");
r = await say(NEWBIE, ".rules");
assert.doesNotMatch(r.text, REGISTER_PROMPT, "ما زال الأمر متاحاً");

console.log("✅ terboo-registration-optional: 6 سيناريوهات نجحت");
process.exit(0);
