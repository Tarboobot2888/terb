// ═══════════════════════════════════════════════
// 🧪 Terboo Identity & Permissions (§5 §6 §57 §106)
// ───────────────────────────────────────────────
// serialize() الحقيقي + مقبس وهمي بحقول Baileys 7 rc14 (remoteJidAlt · participantAlt ·
// participant.{id,lid,phoneNumber} · signalRepository.lidMapping · lid-mapping.update):
//   PN · LID · remoteJidAlt · participantAlt · quoted LID · mention LID · admin LID
//   · owner LID · مشارك مجموعة LID · هجوم اللاحقة عبر الدول · أوامر الإدارة الحقيقية
//   (طرد/ترقية/خفض/إنذار) على مجموعة بعنونة LID مع حماية البوت/النفس/المالك/المشرف.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-identity-"));
process.env.TERBOO_LID_CACHE_PATH = path.join(tmp, "lid-cache.json");

const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const config = (await import("../config.js")).default;
const identity = await import("../src/lib/terboo-identity.js");
const { serialize } = await import("../src/lib/terboo-serialize.js");
const { checkTarget } = await import("../src/lib/terboo-middleware.js");
const dispatch = await import("../src/lib/terboo-command-dispatch.js");

// ── الهويات ──────────────────────────────────────
const BOT_PN = "201000000001@s.whatsapp.net";
const BOT_LID = "150000000000001@lid";
const OWNER_PN = "201011112222@s.whatsapp.net";
const OWNER_LID = "150000000000002@lid";
const USER_PN = "201033334444@s.whatsapp.net";
const USER_LID = "150000000000003@lid";
const ADMIN_PN = "966512345678@s.whatsapp.net";        // مشرف سعودي
const ADMIN_LID = "150000000000004@lid";
const SUFFIX_PN = "6512345678@s.whatsapp.net";          // رقم سنغافوري تنتهي به أرقام المشرف
const SUFFIX_LID = "150000000000005@lid";
const STRANGER_LID = "150000000000009@lid";             // LID لا يُعرف رقمه أبداً
const GROUP = "120363000000000777@g.us";

config.bot.number = BOT_PN.split("@")[0];
config.owner.number = [OWNER_PN.split("@")[0]];
config.premiumUsers = [];
config.partnerUsers = [];

const participants = [
  { id: BOT_LID, phoneNumber: BOT_PN, admin: "admin" },
  { id: OWNER_LID, phoneNumber: OWNER_PN, admin: null },
  { id: USER_LID, phoneNumber: USER_PN, admin: null },
  { id: ADMIN_LID, phoneNumber: ADMIN_PN, admin: "admin" },
  { id: SUFFIX_LID, phoneNumber: SUFFIX_PN, admin: null },
];

function makeSock() {
  const ev = new EventEmitter();
  const sock = {
    ev,
    user: { id: `${BOT_PN.split("@")[0]}:7@s.whatsapp.net`, lid: `${BOT_LID.split("@")[0]}:7@lid`, name: "Terboo" },
    sent: [],
    updates: [],
    signalMap: new Map([[OWNER_LID, OWNER_PN]]),
    async groupMetadata(jid) { return { id: jid, subject: "Test", participants, addressingMode: "lid" }; },
    signalRepository: { lidMapping: {
      async getPNForLID(lid) { return sock.signalMap.get(lid) || null; },
      async getLIDForPN(pn) { for (const [l, p] of sock.signalMap) if (p === pn) return l; return null; },
    } },
    async sendMessage(jid, content, options = {}) { sock.sent.push({ jid, content, options }); return { key: { id: `S${sock.sent.length}`, remoteJid: jid, fromMe: true } }; },
    async groupParticipantsUpdate(jid, ids, action) { sock.updates.push({ jid, ids, action }); return ids.map((id) => ({ status: "200", jid: id })); },
    async readMessages() {},
  };
  identity.installIdentity(sock);
  return sock;
}

const results = [];
async function check(name, fn) { await fn(); results.push(name); }
let seq = 0;
const raw = (key, message = { conversation: "hi" }) => ({ key: { fromMe: false, id: `ID${++seq}`, ...key }, message, pushName: "Tester", messageTimestamp: Math.floor(Date.now() / 1000) });
const text = (body, contextInfo) => (contextInfo ? { extendedTextMessage: { text: body, contextInfo } } : { conversation: body });

// ── 1. PN مباشر ─────────────────────────────────
await check("pn-private", async () => {
  const sock = makeSock();
  const m = await serialize(sock, raw({ remoteJid: USER_PN }));
  assert.equal(m.sender, USER_PN);
  assert.equal(m.chat, USER_PN);
  assert.equal(m.isOwner, false);
});

// ── 2. LID خاص + remoteJidAlt ⇒ نفس الشخص ───────
await check("lid-private-remoteJidAlt", async () => {
  const sock = makeSock();
  const m = await serialize(sock, raw({ remoteJid: USER_LID, remoteJidAlt: USER_PN }));
  assert.equal(m.sender, USER_PN, "LID مع remoteJidAlt لم يُحلّ إلى الرقم الحقيقي");
  assert.equal(m.chat, USER_PN);
  assert.ok(identity.sameUser(USER_LID, USER_PN), "الربط لم يُتعلَّم من المفتاح");
  assert.equal(identity.identityOf(USER_LID).canonical, `pn:${USER_PN.split("@")[0]}`);
});

// ── 3. LID خاص بلا alt ⇒ signalRepository.lidMapping الرسمي ──
await check("lid-private-signal-mapping", async () => {
  const sock = makeSock();
  const m = await serialize(sock, raw({ remoteJid: OWNER_LID }));
  assert.equal(m.sender, OWNER_PN, "لم يُستعمل lidMapping.getPNForLID");
  assert.equal(m.isOwner, true, "مالك بهوية LID لم يُعرف");
});

// ── 4. LID غير معروف: لا رقم مختلق ولا صلاحيات ──
await check("lid-unknown-no-fabrication", async () => {
  const id = identity.identityOf(STRANGER_LID);
  assert.equal(id.pn, "");
  assert.equal(id.canonical, `lid:${STRANGER_LID.split("@")[0]}`);
  assert.equal(identity.sendableJid(STRANGER_LID), STRANGER_LID, "LID غير محلول تحوّل إلى PN مختلق");
  assert.equal(config.isOwner(STRANGER_LID), false);
  assert.equal(identity.jidFromDigits(STRANGER_LID.split("@")[0]), STRANGER_LID, "أرقام LID صارت رقم هاتف");
});

// ── 5. مجموعة: participant LID + participantAlt ──
await check("group-participantAlt", async () => {
  const sock = makeSock();
  const m = await serialize(sock, raw({ remoteJid: GROUP, participant: USER_LID, participantAlt: USER_PN }));
  assert.equal(m.sender, USER_PN);
  assert.equal(m.isAdmin, false);
  assert.equal(m.isBotAdmin, true, "البوت مشرف بهويته LID ولم يُكتشف");
  assert.ok(m.groupAdmins.includes(ADMIN_PN), "قائمة المشرفين بلا الرقم الحقيقي");
});

// ── 6. مشرف بهوية LID (بلا alt) ⇒ مشرف عبر phoneNumber المشارك ──
await check("admin-lid", async () => {
  const sock = makeSock();
  const m = await serialize(sock, raw({ remoteJid: GROUP, participant: ADMIN_LID }));
  assert.equal(m.sender, ADMIN_PN);
  assert.equal(m.isAdmin, true);
});

// ── 7. هجوم اللاحقة عبر الدول: لا مشرف ولا مالك ──
await check("suffix-attack", async () => {
  const sock = makeSock();
  const m = await serialize(sock, raw({ remoteJid: GROUP, participant: SUFFIX_LID, participantAlt: SUFFIX_PN }));
  assert.equal(m.sender, SUFFIX_PN);
  assert.equal(m.isAdmin, false, "6512345678 صار مشرفاً لأن 966512345678 ينتهي به");
  config.bot.number = "966512345678";
  assert.equal(config.isOwner(SUFFIX_PN), false, "isOwner بمطابقة جزئية لرقم البوت");
  assert.equal(config.isSelf(SUFFIX_PN), false, "isSelf بمطابقة جزئية");
  config.bot.number = BOT_PN.split("@")[0];
  config.premiumUsers = ["966512345678"];
  assert.equal(config.isPremium(SUFFIX_PN), false, "isPremium بمطابقة لاحقة");
  config.premiumUsers = [];
  getDatabase().setting("bannedUsers", ["12345678"]);
  assert.equal(config.isBanned(SUFFIX_PN), false, "حظر بمطابقة لاحقة أصاب شخصاً آخر");
  getDatabase().setting("bannedUsers", []);
});

// ── 8. المالك: صيغ الإدخال المقبولة بدقة ──────────
await check("owner-number-forms", async () => {
  for (const form of ["201011112222", "+20 101 111 2222", "00201011112222", "01011112222"]) {
    config.owner.number = [form];
    assert.equal(config.isOwner(OWNER_PN), true, `صيغة المالك «${form}» لم تُطابق`);
  }
  config.owner.number = ["1011112222"]; // بلا رمز الدولة ولا صفر: ليست رقماً دولياً مطابقاً
  assert.equal(config.isOwner(OWNER_PN), false, "مطابقة جزئية بلا رمز دولة");
  config.owner.number = [OWNER_PN.split("@")[0]];
  assert.equal(config.isOwner(OWNER_LID), true, "المالك بهوية LID معروفة");
  assert.equal(config.isOwner(`${OWNER_PN.split("@")[0]}:3@s.whatsapp.net`), true, "جهاز مرتبط للمالك");
});

// ── 9. quoted LID + mention LID ⇒ الرقم الحقيقي ──
await check("quoted-and-mention-lid", async () => {
  const sock = makeSock();
  const m = await serialize(sock, raw({ remoteJid: GROUP, participant: ADMIN_LID, participantAlt: ADMIN_PN }, text(".طرد", {
    stanzaId: "Q1", participant: USER_LID, quotedMessage: { conversation: "old" }, mentionedJid: [SUFFIX_LID],
  })));
  assert.equal(m.quoted?.sender, USER_PN, "المقتبس بهوية LID لم يُحلّ");
  assert.ok(m.mentionedJid.includes(SUFFIX_PN), `الإشارة LID لم تُحلّ: ${m.mentionedJid}`);
});

// ── 10. lid-mapping.update الرسمي ⇒ يُتعلَّم ──────
await check("lid-mapping-event", async () => {
  const sock = makeSock();
  const lid = "150000000000077@lid";
  const pn = "201077778888@s.whatsapp.net";
  assert.equal(identity.identityOf(lid).pn, "");
  sock.ev.emit("lid-mapping.update", { lid, pn });
  assert.equal(identity.identityOf(lid).pn, pn);
  assert.equal(identity.identityOf(pn).lid, lid, "الفهرس العكسي PN ⇒ LID");
  // PN مختلق من أرقام LID لا يُقبل ربطاً
  assert.equal(identity.learn("150000000000088@lid", "150000000000088@s.whatsapp.net"), false);
});

// ── 11. حماية الهدف: البوت · النفس · المالك · المشرف · العضوية ──
await check("target-guard", async () => {
  const sock = makeSock();
  const admin = await serialize(sock, raw({ remoteJid: GROUP, participant: ADMIN_LID, participantAlt: ADMIN_PN }));
  assert.equal(checkTarget(admin, sock, BOT_LID).reasonKey, "group.cantBot", "البوت بهوية LID");
  assert.equal(checkTarget(admin, sock, BOT_PN).reasonKey, "group.cantBot");
  assert.equal(checkTarget(admin, sock, ADMIN_LID).reasonKey, "group.cantSelf", "النفس بهوية مختلفة الشكل");
  assert.equal(checkTarget(admin, sock, OWNER_PN).reasonKey, "group.cantOwner", "مشرف يستهدف المالك");
  assert.equal(checkTarget(admin, sock, "201099990000@s.whatsapp.net").reasonKey, "group.notMember");
  const ok = checkTarget(admin, sock, USER_LID);
  assert.equal(ok.ok, true);
  assert.equal(ok.participant.id, USER_LID, "المشارك بالهوية الصحيحة");
});

// ── 12. أوامر الإدارة الحقيقية على مجموعة LID ──────
const pluginOf = async (file) => import(`../plugins/group/${file}.js`);
async function runModeration(file, { sender = ADMIN_LID, senderAlt = ADMIN_PN, target, quoted = false }) {
  const sock = makeSock();
  const contextInfo = quoted
    ? { stanzaId: "Q9", participant: target, quotedMessage: { conversation: "x" } }
    : { mentionedJid: [target] };
  const m = await serialize(sock, raw({ remoteJid: GROUP, participant: sender, participantAlt: senderAlt }, text(`.${file} @x`, contextInfo)));
  m.prefix = "."; m.command = file; m.args = []; m.text = "";
  const plugin = await pluginOf(file);
  const run = plugin.handler || plugin.default?.handler;
  assert.equal(typeof run, "function", `${file}: بلا handler`);
  await run(m, { sock, db: getDatabase(), config });
  const replies = sock.sent.map((s) => String(s.content?.text || s.content?.caption || "")).join("\n");
  return { sock, replies };
}

await check("kick-lid-member", async () => {
  const { sock } = await runModeration("طرد", { target: USER_LID });
  assert.deepEqual(sock.updates, [{ jid: GROUP, ids: [USER_LID], action: "remove" }], "الطرد لم يصل للمشارك الصحيح");
});
await check("kick-by-pn-in-lid-group", async () => {
  const { sock } = await runModeration("طرد", { target: USER_PN, quoted: true });
  assert.deepEqual(sock.updates.map((u) => u.ids[0]), [USER_LID], "هدف PN في مجموعة LID: «ليس عضواً»");
});
await check("kick-protections", async () => {
  for (const target of [BOT_LID, ADMIN_LID, OWNER_LID]) {
    const { sock } = await runModeration("طرد", { target });
    assert.equal(sock.updates.length, 0, `طرد محمي نُفّذ على ${target}`);
  }
});
await check("promote-demote-warn", async () => {
  const promote = await runModeration("ترقية", { target: USER_LID });
  assert.deepEqual(promote.sock.updates, [{ jid: GROUP, ids: [USER_LID], action: "promote" }]);
  const demote = await runModeration("خفض", { target: ADMIN_LID, sender: OWNER_LID, senderAlt: OWNER_PN });
  assert.deepEqual(demote.sock.updates, [{ jid: GROUP, ids: [ADMIN_LID], action: "demote" }], "خفض مشرف بهوية LID");
  const demoteOwner = await runModeration("خفض", { target: OWNER_LID });
  assert.equal(demoteOwner.sock.updates.length, 0, "مشرف خفّض المالك");
  const warnOwner = await runModeration("انذار", { target: OWNER_PN });
  assert.equal(warnOwner.sock.updates.length, 0);
  assert.ok(!Object.keys(getDatabase().getGroup(GROUP)?.warnings || {}).includes(OWNER_PN), "إنذار سُجّل على المالك");
  const warnUser = await runModeration("انذار", { target: USER_PN });
  assert.ok((getDatabase().getGroup(GROUP)?.warnings?.[USER_PN] || []).length === 1, `إنذار العضو لم يُسجَّل: ${warnUser.replies}`);
});

// ── 13. موزّع الذكاء: إشارات الهدف بهوية حقيقية ──
await check("dispatch-mentions", async () => {
  const synthetic = dispatch.buildSyntheticMessage({ key: { remoteJid: GROUP, participant: ADMIN_PN, id: "X" }, raw: { key: { remoteJid: GROUP, participant: ADMIN_PN, id: "X" }, message: { conversation: "اطرده" } } }, ".طرد", { mentions: [STRANGER_LID.split("@")[0], USER_LID.split("@")[0]] });
  const mentioned = synthetic.message.extendedTextMessage.contextInfo.mentionedJid;
  assert.ok(mentioned.includes(STRANGER_LID), `أرقام LID تحوّلت إلى رقم مختلق: ${mentioned}`);
  assert.ok(mentioned.includes(USER_PN), "LID معروف لم يُحلّ إلى رقمه");
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✅ terboo-identity: ${results.length} فحص · ${results.join(" · ")}`);
process.exit(0);
