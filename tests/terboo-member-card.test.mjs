// ═══════════════════════════════════════════════
// 🧪 بطاقة الترحيب/الوداع — هوية البوت + اسم العضو الفعلي
// ───────────────────────────────────────────────
// · الاسم من دليل المجموعة (اسم واتساب) لا الرقم · الاسم المسجّل في Terboo · رقم منسّق عند غياب الاسم
// · LID بلا رقم معروف ⇒ لا اسم مخترع («عضو جديد» بلغة المجموعة) · من غادر يُعرف اسمه من سجل الخارجين
// · تنظيف الاسم: حروف الزخرفة ⇒ عادية · بلا رموز تعبيرية (لا مربعات)
// · البطاقة JPEG 1280×720 للحالتين وبلا صورة شخصية · الترحيب والوداع الفعليان يرسلان صورة البطاقة
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const GROUP = "120363000000000888@g.us";
const NAMED = "201016948771@s.whatsapp.net";
const REGISTERED = "201011112222@s.whatsapp.net";
const ANON = "201033334444@s.whatsapp.net";
const LID_ONLY = "99887766554433@lid";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-member-card-"));
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
db.setUser(REGISTERED, { isRegistered: true, regName: "Sara Ahmed", name: "Sara" });
const REG_ONLY = "201055556666@s.whatsapp.net";
db.setUser(REG_ONLY, { isRegistered: true, regName: "Omar Khaled", name: "Unknown" });
db.setGroup(GROUP, { welcome: true, goodbye: true, language: "ar" });

let participants = [
  { id: NAMED, notify: "محمود 🔥 عبد الرحمن", admin: null },
  { id: REGISTERED, admin: null },
  { id: ANON, admin: null },
  { id: REG_ONLY, admin: null },
];
const sent = [];
const sock = {
  user: { id: "201111111111:1@s.whatsapp.net" },
  groupMetadata: async () => ({ id: GROUP, subject: "مجتمع تيربو", participants: participants.map((p) => ({ ...p })) }),
  profilePictureUrl: async () => { throw new Error("no picture"); },
  sendMessage: async (chat, content) => { sent.push({ chat, content }); return { key: { id: `S${sent.length}` } }; },
};

const W = await import("../src/lib/terboo-welcome-card.js");
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

await check("clean-name", async () => {
  assert.equal(W.cleanDisplayName("𝓜𝓪𝓱𝓶𝓸𝓾𝓭 🔥✨ Dev"), "Mahmoud Dev", "زخرفة ⇒ عادية · بلا رموز");
  assert.equal(W.cleanDisplayName("محمود 🔥 عبد الرحمن"), "محمود عبد الرحمن");
  assert.equal(W.cleanDisplayName("🔥🔥"), "", "رموز فقط ⇒ لا اسم");
  assert.equal(W.formatPhone("201016948771"), "+20 101 694 8771");
});

await check("name-resolution", async () => {
  assert.deepEqual(await W.resolveMemberName(sock, GROUP, NAMED), { name: "محمود عبد الرحمن", source: "directory" }, "اسم واتساب لا الرقم");
  assert.equal((await W.resolveMemberName(sock, GROUP, REGISTERED)).name, "Sara", "اسمه في واتساب كما يراه البوت أولاً");
  assert.equal((await W.resolveMemberName(sock, GROUP, REG_ONLY)).name, "Omar Khaled", "الاسم المسجّل حين لا اسم واتساب");
  assert.deepEqual(await W.resolveMemberName(sock, GROUP, ANON), { name: "+20 103 333 4444", source: "number" }, "بلا اسم ⇒ رقم منسّق");
  assert.equal((await W.resolveMemberName(sock, GROUP, LID_ONLY)).name, null, "LID مجهول ⇒ لا اسم مخترع");
});

await check("card-render", async () => {
  for (const kind of ["welcome", "goodbye"]) {
    const card = await W.createMemberCard({ kind, name: "محمود عبد الرحمن", avatar: "", groupName: "مجتمع تيربو", memberCount: 128, lang: "ar", timezone: "Africa/Cairo" });
    const meta = await sharp(card).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", 1280, 720], kind);
  }
  const unknown = await W.createMemberCard({ kind: "welcome", name: null, lang: "en", memberCount: 3 });
  assert.equal((await sharp(unknown).metadata()).width, 1280, "بلا اسم ولا صورة");
});

await check("welcome-and-goodbye-send-card", async () => {
  const { sendWelcomeMessage } = await import("../plugins/group/ترحيب.js");
  const { sendGoodbyeMessage } = await import("../plugins/group/وداع.js");
  const meta = await sock.groupMetadata();
  assert.equal(await sendWelcomeMessage(sock, GROUP, NAMED, meta), true);
  const welcome = sent.at(-1);
  assert.equal(welcome.chat, GROUP);
  assert.ok(Buffer.isBuffer(welcome.content.image), "صورة البطاقة");
  assert.deepEqual((await sharp(welcome.content.image).metadata()).width, 1280);
  // يغادر: الدليل يحفظ اسمه بعد خروجه
  participants = participants.filter((p) => p.id !== NAMED);
  const { applyParticipantsUpdate } = await import("../src/lib/terboo-group-directory.js");
  applyParticipantsUpdate({ id: GROUP, action: "remove", participants: [NAMED] });
  assert.equal((await W.resolveMemberName(sock, GROUP, NAMED)).name, "محمود عبد الرحمن", "اسم من غادر معروف");
  assert.equal(await sendGoodbyeMessage(sock, GROUP, NAMED, await sock.groupMetadata()), true);
  assert.ok(Buffer.isBuffer(sent.at(-1).content.image));
});

console.log(`✅ terboo-member-card: ${results.length} — ${results.join(" · ")}`);
process.exit(0);
