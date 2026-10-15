// ═══════════════════════════════════════════════
// 🚫🖼️ TERBOO — حارس «لا صور في مسارات الألعاب»
// ───────────────────────────────────────────────
// شرط قبول أساسي: لا لعبة ترسل صورة في أي رسالة واتساب، في أي مرحلة،
// ولا تملك مسار رجوع إلى صورة عند فشل HTML أو النقل.
//
// 1) فحص AST/نصي على مسارات الألعاب: لا مولّد صور ولا حقل صورة في حمولة إرسال.
// 2) فحص زمن تشغيل: كل لعبة تمر على mock socket، ونُفتّش **كل** رسالة صادرة
//    (sendMessage + relayMessage، وبكل أغلفتها) عن أي حقل صورة أو بايتات صورة.
// 3) فشل النقل: HTML يفشل ⇒ المخرج نص/رابط فقط، لا صورة.
// 4) عقد VisualResponse يرفض صورة لبطاقة لعبة، ويجرّدها دفاعاً ثانياً.
// 5) الصور **غير** المرتبطة بالألعاب تبقى مسموحة (لا نكسر الملصقات/التنزيلات).
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "acorn";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const ROOT = process.cwd();

// ─────────────── 1) فحص ثابت على مسارات الألعاب ───────────────

/** الملفات التي تُعدّ «مسار لعبة» */
function gamePathFiles() {
  const out = [];
  const add = (p) => { if (fs.existsSync(p) && fs.statSync(p).isFile() && p.endsWith(".js")) out.push(p); };
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else add(p);
    }
  };
  walk(path.join(ROOT, "plugins", "game"));
  walk(path.join(ROOT, "src", "lib", "terboo-arcade"));
  for (const f of ["terboo-games.js", "terboo-game-data.js", "terboo-game-queue.js", "terboo-game-ulartangga.js",
    "terboo-html-game.js", "terboo-game-design-system.js", "terboo-fisch.js", "terboo-minecraft.js"]) {
    add(path.join(ROOT, "src", "lib", f));
  }
  return out;
}

const FILES = gamePathFiles();
assert.ok(FILES.length >= 70, `مسارات الألعاب مفحوصة (وُجد ${FILES.length})`);

/** مولّدات صور ممنوعة في مسارات الألعاب */
const IMAGE_GENERATORS = [
  /\bcreateCanvas\s*\(/,
  /\bloadImage\s*\(/,
  /\bfrom\s+["']@napi-rs\/canvas["']/,
  /\bfrom\s+["']skia-canvas["']/,
  /\bfrom\s+["']sharp["']/,
  /\bfrom\s+["']jimp["']/,
  /\.toBuffer\s*\(/,
  /data:image\/[a-z]+;base64/,
];

const staticHits = [];
for (const file of FILES) {
  const src = fs.readFileSync(file, "utf8");
  // التعليقات لا تُحتسب: نزيلها قبل الفحص حتى لا يمرّ/يفشل الاختبار بسبب شرح
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  for (const re of IMAGE_GENERATORS) {
    if (re.test(code)) staticHits.push(`${path.relative(ROOT, file)} :: ${re}`);
  }
}
assert.deepEqual(staticHits, [], `لا مولّد صور في أي مسار لعبة:\n${staticHits.join("\n")}`);

/** حقل صورة داخل كائن حمولة إرسال — يُفحص على شجرة AST لا بنص */
function imagePayloadKeys(file) {
  const src = fs.readFileSync(file, "utf8");
  let tree;
  try {
    tree = parse(src, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch (error) {
    assert.fail(`${path.relative(ROOT, file)} لا يُحلَّل: ${error.message}`);
  }
  const bad = [];
  const BAD_KEYS = new Set(["image", "imagemessage", "imagebuffer", "imagedataurl", "inlineimagedataurl", "thumbnail", "jpegthumbnail", "sticker", "video", "document"]);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.type === "Property" && !node.computed) {
      const key = node.key?.name || node.key?.value;
      if (key && BAD_KEYS.has(String(key).toLowerCase())) {
        // قيمة null/false/"" ليست إرسال صورة (تعطيل صريح مقبول)
        const v = node.value;
        const isOff = (v?.type === "Literal" && (v.value === null || v.value === false || v.value === ""))
          || (v?.type === "Identifier" && v.name === "undefined");
        if (!isOff) bad.push({ key, line: node.loc?.start?.line });
      }
    }
    for (const k of Object.keys(node)) if (k !== "loc" && k !== "range") visit(node[k]);
  };
  visit(tree);
  return bad;
}

const astHits = [];
for (const file of FILES) {
  for (const hit of imagePayloadKeys(file)) astHits.push(`${path.relative(ROOT, file)}:${hit.line} key=${hit.key}`);
}
assert.deepEqual(astHits, [], `لا حقل حمولة صورة في أي مسار لعبة:\n${astHits.join("\n")}`);

// ─────────────── تهيئة بيئة التشغيل ───────────────

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-img-policy-"));
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
const config = (await import("../config.js")).default;
config.bot.primaryNumber = "201111111133";
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(ROOT, "plugins"));
const { loadArcade, arcadeContracts, games } = await import("../src/lib/terboo-arcade/index.js");
await loadArcade();
const E = await import("../src/lib/terboo-arcade/engine.js");
const { memoryRepository } = await import("../src/lib/terboo-arcade/repository.js");
E.configure({ repository: memoryRepository(), wallet: { credit() {} } });
const WA = await import("../src/lib/terboo-arcade/whatsapp.js");
const V = await import("../src/lib/terboo-visual-response.js");
const H = await import("../src/lib/terboo-html-game.js");

// ─────────────── مفتّش الرسائل الصادرة ───────────────

const IMAGE_FIELDS = new Set(["image", "imagemessage", "sticker", "stickermessage", "video", "videomessage", "thumbnail", "jpegthumbnail", "thumbnailurl", "imagebuffer", "imagedataurl"]);
const MAGIC = [
  { name: "PNG", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: "JPEG", bytes: [0xff, 0xd8, 0xff] },
  { name: "GIF", bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: "WEBP", bytes: [0x52, 0x49, 0x46, 0x46] },
];

/** يبحث في أي حمولة صادرة عن حقل صورة أو بايتات صورة أو data URL لصورة */
function imageViolations(payload, trail = "msg", seen = new Set()) {
  const out = [];
  if (payload === null || payload === undefined) return out;
  if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) {
    const b = Buffer.from(payload);
    for (const m of MAGIC) if (b.length >= m.bytes.length && m.bytes.every((x, i) => b[i] === x)) out.push(`${trail}: raw ${m.name} bytes (${b.length}B)`);
    return out;
  }
  if (typeof payload === "string") {
    if (/^data:image\//i.test(payload)) out.push(`${trail}: data:image URL`);
    return out;
  }
  if (typeof payload !== "object") return out;
  if (seen.has(payload)) return out;
  seen.add(payload);
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => out.push(...imageViolations(v, `${trail}[${i}]`, seen)));
    return out;
  }
  for (const [k, v] of Object.entries(payload)) {
    if (IMAGE_FIELDS.has(k.toLowerCase()) && v !== null && v !== undefined && v !== false && v !== "") {
      out.push(`${trail}.${k} present`);
    }
    out.push(...imageViolations(v, `${trail}.${k}`, seen));
  }
  return out;
}

/** mock socket يسجّل كل شيء صادر */
function mockSock() {
  const outbox = [];
  return {
    outbox,
    user: { id: `${config.bot.primaryNumber}@s.whatsapp.net` },
    async sendMessage(jid, content, opts) { outbox.push({ via: "sendMessage", jid, content, opts }); return { key: { id: `M${outbox.length}`, remoteJid: jid } }; },
    async relayMessage(jid, message, opts) { outbox.push({ via: "relayMessage", jid, message, opts }); return { key: { id: `R${outbox.length}`, remoteJid: jid } }; },
    async sendPresenceUpdate() {},
    async profilePictureUrl() { return null; },
    async groupMetadata() { return { participants: [] }; },
  };
}

const mkMsg = (sock, jid, body) => ({
  key: { remoteJid: jid, fromMe: false, id: `K${Math.random().toString(36).slice(2, 10).toUpperCase()}` },
  chat: jid, sender: jid, isGroup: false, body, prefix: ".", pushName: "Tester",
  reply: async (text, extra) => sock.sendMessage(jid, { text, ...(extra || {}) }),
});

function assertClean(sock, label) {
  const bad = sock.outbox.flatMap((o, i) => imageViolations(o.content ?? o.message, `${label}#${i}(${o.via})`));
  assert.deepEqual(bad, [], `${label}: لا صورة في أي رسالة صادرة:\n${bad.join("\n")}`);
}

// ─────────────── 2) كل لعبة: دورة حياة كاملة بلا صورة ───────────────

const contracts = arcadeContracts();
assert.ok(contracts.length >= 45, `كل العقود محمّلة (${contracts.length})`);

let played = 0;
let skipped = [];
for (const c of contracts) {
  const jid = `2015${String(played).padStart(8, "0")}@s.whatsapp.net`;
  db.setUser(jid, { language: "ar", name: "T" });
  const sock = mockSock();
  const m = mkMsg(sock, jid, `.${c.id}`);
  const made = E.createRoom({
    gameId: c.id, chat: jid, isGroup: false,
    host: { jid, name: "T" },
    vsAI: c.mode === "pvp" && c.supportsAI,
    difficulty: "EASY", options: { lang: "ar" },
  });
  if (!made.ok) { skipped.push(`${c.id}:${made.code}`); continue; }
  const room = made.room;
  // مرحلة البدء
  await WA.sendRoom(sock, m, room, { lang: "ar" });
  // مرحلة الحركة (حتى 6 حركات، تغطي الفوز/الخسارة/التعادل حسب اللعبة)
  for (let step = 0; step < 6; step += 1) {
    const view = E.getView(room.roomId, { viewerJid: jid, lang: "ar" });
    if (!view || view.state !== "PLAYING" || !view.actions?.length) break;
    const pick = view.actions[0];
    const res = await E.applyAction({
      gameId: c.id, sessionId: room.sessionId, actionId: pick.id, actor: E.idOf(jid),
      nonce: view.nonce, timestamp: Date.now(), payload: pick.payload ?? null, source: "html",
    });
    if (!res.ok) break;
    await WA.afterAction(sock, m, res, "ar");
  }
  // مرحلة النهاية / الاستسلام
  const sres = E.surrender(room.roomId, { jid });
  if (sres.ok) await WA.sendRoom(sock, m, sres.room, { lang: "ar" });
  assertClean(sock, c.id);
  assert.ok(sock.outbox.length > 0, `${c.id}: أرسل شيئاً فعلاً (ليس صامتاً)`);
  played += 1;
}
assert.ok(played >= 40, `لُعبت دورة حياة كاملة لـ${played} لعبة (تخطّي: ${skipped.join(", ") || "—"})`);

// ─────────────── 3) فشل النقل ⇒ نص/رابط فقط، لا صورة ───────────────

{
  const jid = "201599999001@s.whatsapp.net";
  db.setUser(jid, { language: "ar", name: "T" });
  const sock = mockSock();
  // relayMessage يفشل ⇒ لا يجوز الرجوع إلى صورة
  sock.relayMessage = async () => { throw new Error("relay down"); };
  const m = mkMsg(sock, jid, ".اكس_او");
  const room = E.createRoom({ gameId: "xo", chat: jid, isGroup: false, host: { jid, name: "T" }, vsAI: true, difficulty: "EASY" }).room;
  await WA.sendRoom(sock, m, room, { lang: "ar" });
  assertClean(sock, "transport-failure");
  assert.ok(sock.outbox.length > 0, "فشل النقل ⇒ ما زال يرسل نصاً");
}

{
  // بطاقة سؤال قديمة: فشل HTML لا ينتج صورة
  const jid = "201599999002@s.whatsapp.net";
  db.setUser(jid, { language: "ar", name: "T" });
  const sock = mockSock();
  sock.relayMessage = async () => { throw new Error("relay down"); };
  const m = mkMsg(sock, jid, ".خمن_الصورة");
  const cfg = games.get("خمن_الصورة");
  assert.ok(cfg, "تسجيل خمن الصورة موجود");
  assert.equal(cfg.hasImage, true, "اللعبة بصرية بطبيعتها (لم نغيّر قواعدها)");
  const plugin = (await import("../src/lib/terboo-plugins.js")).getPlugin("خمن_الصورة");
  assert.ok(plugin?.handler, "للعبة handler");
  await plugin.handler(m, { sock, db, command: "خمن_الصورة", args: [], text: "" });
  assertClean(sock, "visual-quiz");
  const texts = sock.outbox.map((o) => JSON.stringify(o.content ?? o.message)).join("\n");
  assert.doesNotMatch(texts, /data:image|\.jpg|\.jpeg|\.png|\.webp/i, "لا رابط صورة في نص الرسالة");
}

// ─────────────── 4) عقد VisualResponse ───────────────

{
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  for (const cardId of ["arcade:xo", "quiz:خمن_الصورة", "game:anything"]) {
    const check = V.validateVisualResponse({ mode: "html", cardId, text: "x", image: { key: "k", buffer: buf } });
    assert.equal(check.ok, false, `${cardId}: صورة مرفوضة`);
    assert.ok(check.errors.includes("game-image-forbidden"), `${cardId}: سبب صريح`);
  }
  // غير الألعاب: الصورة مسموحة (لا نكسر الملصقات/التنزيلات/canvas)
  for (const cardId of ["sticker:make", "download:yt", "canvas:brat", "member:card"]) {
    const check = V.validateVisualResponse({ mode: "media", cardId, text: "x", image: { key: "k", buffer: buf } });
    assert.equal(check.ok, true, `${cardId}: صورة غير مرتبطة بلعبة ما زالت مسموحة (${check.errors.join(",")})`);
  }
  assert.equal(V.isGameCard("arcade:xo"), true);
  assert.equal(V.isGameCard("sticker:make"), false);
  // الدفاع الثاني: التسليم يجرّد الصورة من بطاقة لعبة حتى لو مرّت بلا تدقيق
  const sock = mockSock();
  const jid = "201599999003@s.whatsapp.net";
  db.setUser(jid, { language: "ar", name: "T" });
  const m = mkMsg(sock, jid, ".x");
  await V.deliverVisual(sock, m, { mode: "buttons", cardId: "arcade:xo", lang: "ar", text: "لوحة", actions: [{ id: ".اركيد menu", text: "القائمة" }], image: { key: "k", buffer: buf } });
  assertClean(sock, "deliverVisual-strip");
}

// ─────────────── 5) بنّاء HTML لا يصدر <img> ولا data:image ───────────────

{
  for (const c of arcadeContracts().slice(0, 45)) {
    const html = H.buildGameHtml({
      gameId: c.id, icon: c.icon, title: c.name.ar, state: "PLAYING", turn: 0,
      players: [{ name: "A" }, { name: "B" }],
      board: { kind: "grid", cols: 3, cells: [{ t: "❌" }, { t: "⭕" }, { t: "▫️" }] },
      panels: [], actions: [{ id: "a", label: "1" }], lang: "ar",
      // محاولة حقن صورة عبر الحقول القديمة يجب أن تُهمَل تماماً
      inlineImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      image: { kind: "grid", cols: 1, cells: [{ t: "x" }] },
    }, { lang: "ar" });
    assert.doesNotMatch(html, /<img\b/i, `${c.id}: لا وسم img`);
    assert.doesNotMatch(html, /data:image\//i, `${c.id}: لا data:image`);
    assert.equal(H.validateTemplate(html).ok, true, `${c.id}: يمر من المدقق`);
  }
  const quiz = H.buildTextGameHtml({ gameId: "q", icon: "🖼️", title: "خمن الصورة", text: "سؤال", imageDataUrl: "data:image/png;base64,iVBORw0KGgo=" });
  assert.doesNotMatch(quiz, /<img\b|data:image\//i, "بطاقة السؤال بلا صورة ولو مُرِّر imageDataUrl");
}

console.log(`✅ terboo-game-image-policy: فحص ثابت (${FILES.length} ملف · 0 مولّد · 0 حقل صورة) · دورة حياة ${played} لعبة بلا صورة · فشل النقل بلا صورة · عقد VisualResponse (ألعاب ممنوعة · غير الألعاب مسموحة) · بنّاء HTML بلا img/data:image`);
process.exit(0);
