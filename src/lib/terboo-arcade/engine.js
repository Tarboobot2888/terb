// ═══════════════════════════════════════════════
// 🕹️ TERBOO ARCADE — محرك الجلسات والغرف (Server-Authoritative)
// ───────────────────────────────────────────────
// Game API: createGame · createRoom · joinRoom · leaveRoom · readyPlayer · startGame
//   · applyAction · getState · getView · pauseGame · resumeGame · finishGame · cancelGame
//   · rematch · getLeaderboard · getStats (+ spectate · transferHost · surrender · challenge)
//
// الحالات: WAITING → READY → PLAYING ⇄ PAUSED → FINISHED | CANCELLED | EXPIRED
//
// بروتوكول الإجراء (كل المدخلات — أمر/رد/زر/HTML/ذكاء — تتحول لهذا الشكل في router):
//   {gameId, sessionId, actionId, actor, timestamp, nonce, payload}
//   • actor من هوية الخادم (identityOf) — لا من العميل
//   • nonce يتغير مع كل نسخة حالة ⇒ رفض القديم (stale) والمكرر (duplicate)
//   • الإجراء يجب أن يطابق حرفياً واحداً من legalActions() ⇒ العميل لا يملي النتيجة
//   • payload لا يحمل winner/score/turn/admin/... (FORBIDDEN_PAYLOAD_KEYS)
// قفل لكل غرفة (تسلسل الإجراءات) · مؤقت دور · تنظيف · حفظ عبر Repository.
// ═══════════════════════════════════════════════

import { EventEmitter } from "node:events";
import { games } from "../terboo-games.js";
import { identityOf } from "../terboo-identity.js";
import { noteFailure } from "../terboo-failure-log.js";
import { FORBIDDEN_PAYLOAD_KEYS, STATES, TERMINAL } from "./contract.js";
import { chooseMove, sameAction } from "./ai.js";
import { serverRng, token } from "./rng.js";
import { defaultRepository } from "./repository.js";
import { dbWallet, settle } from "./progress.js";

const WAIT_TTL = 5 * 60 * 1000;
const CHALLENGE_TTL = 2 * 60 * 1000;
const FINISHED_TTL = 10 * 60 * 1000;
const SOLO_IDLE_TTL = 30 * 60 * 1000;
const NONCE_MEMORY = 64;
const CLIENT_SKEW = 2 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 1024;
const AI_STEPS = 12;

const events = new EventEmitter();
events.setMaxListeners(50);

const rooms = new Map();
const byChat = new Map();
const byPlayer = new Map();
const bySession = new Map();
const locks = new Map();
const seenMessages = new Map();
let repo = null;
let wallet = null;
let sweeper = null;

const now = () => Date.now();
const err = (code, extra = {}) => ({ ok: false, code, ...extra });
const idOf = (jid) => {
  const id = identityOf(jid);
  return id?.canonical || String(jid || "");
};

function repository() {
  if (!repo) {
    repo = defaultRepository();
    restore();
  }
  return repo;
}

/** للاختبارات/التشغيل: مستودع ومحفظة محقونان */
function configure({ repository: r = null, wallet: w = null } = {}) {
  repo = r || repo;
  wallet = w || wallet;
  if (r) restore();
}

function walletOf() {
  return wallet || (wallet = dbWallet());
}

function index(room) {
  bySession.set(room.sessionId, room.roomId);
  if (!byChat.has(room.chat)) byChat.set(room.chat, new Set());
  byChat.get(room.chat).add(room.roomId);
  for (const p of room.players) {
    if (p.isAI) continue;
    if (!byPlayer.has(p.id)) byPlayer.set(p.id, new Set());
    byPlayer.get(p.id).add(room.roomId);
  }
}

function unindex(room) {
  byChat.get(room.chat)?.delete(room.roomId);
  if (byChat.get(room.chat)?.size === 0) byChat.delete(room.chat);
  for (const p of room.players) {
    byPlayer.get(p.id)?.delete(room.roomId);
    if (byPlayer.get(p.id)?.size === 0) byPlayer.delete(p.id);
  }
}

function restore() {
  for (const set of [rooms, byChat, byPlayer, bySession]) set.clear();
  for (const room of repo.loadRooms()) {
    if (!room?.roomId || TERMINAL.has(room.state)) continue;
    rooms.set(room.roomId, room);
    index(room);
  }
}

function save(room) {
  room.updatedAt = now();
  repository().saveRoom(room);
}

/** تسلسل كل تعديل على نفس الغرفة (لا سباق بين زرّين في نفس اللحظة) */
async function withLock(roomId, fn) {
  const prev = locks.get(roomId) || Promise.resolve();
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const chain = prev.then(() => gate);
  locks.set(roomId, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(roomId) === chain) locks.delete(roomId);
  }
}

function contractOf(gameId) {
  const contract = games.contractOf(gameId);
  return contract && !contract.legacy ? contract : null;
}

function player(jid, name, extra = {}) {
  return { id: idOf(jid), jid, name: String(name || "").slice(0, 40) || String(jid).split("@")[0], ready: false, ...extra };
}

function aiPlayer(difficulty) {
  return { id: `ai:${difficulty}`, jid: null, name: "Terboo AI", isAI: true, difficulty, ready: true };
}

function seatOf(room, jid) {
  const id = idOf(jid);
  return room.players.findIndex((p) => p.id === id);
}

function activeRoomsOf(jid, chat = null) {
  const ids = byPlayer.get(idOf(jid)) || new Set();
  return [...ids].map((id) => rooms.get(id)).filter((r) => r && !TERMINAL.has(r.state) && (!chat || r.chat === chat));
}

function bumpNonce(room) {
  room.usedNonces = [...(room.usedNonces || []), room.nonce].slice(-NONCE_MEMORY);
  room.nonce = token(6);
  room.version += 1;
}

function setDeadline(room, contract) {
  const custom = contract.controller.turnTimeout && room.game ? contract.controller.turnTimeout(room.game) : null;
  const ms = custom ?? (contract.sessionType !== "solo" ? contract.timeout : null);
  room.turnDeadline = ms ? now() + ms : null;
}

// ─────────────── Game API ───────────────

/**
 * ينشئ غرفة.
 * @param {{gameId, chat, isGroup, host:{jid,name}, vsAI?:boolean, difficulty?:string,
 *          invite?:Array<{jid,name}>, options?:Object, theme?:string}} spec
 */
function createRoom(spec) {
  repository();
  const contract = contractOf(spec.gameId);
  if (!contract) return err("unknown-game");
  const isGroup = Boolean(spec.isGroup);
  if (isGroup && !contract.supportsGroup) return err("group-unsupported");
  if (!isGroup && !contract.supportsPrivate) return err("private-unsupported");
  if (!spec.host?.jid) return err("no-host");
  const busy = activeRoomsOf(spec.host.jid, spec.chat);
  if (busy.length) return err("already-in-room", { room: busy[0] });
  const vsAI = Boolean(spec.vsAI) && contract.supportsAI;
  if (spec.vsAI && !contract.supportsAI) return err("ai-unsupported");
  const invites = (spec.invite || []).filter((p) => p?.jid && idOf(p.jid) !== idOf(spec.host.jid));
  if (!isGroup && contract.mode === "pvp" && !vsAI && !invites.length && contract.players.min > 1) return err("needs-opponent");

  const t = now();
  const roomId = `r${token(5)}`;
  const room = {
    roomId,
    sessionId: `s${token(9)}`,
    gameId: contract.id,
    chat: spec.chat,
    isGroup,
    hostId: idOf(spec.host.jid),
    players: [player(spec.host.jid, spec.host.name, { ready: true })],
    spectators: [],
    invites: invites.map((p) => ({ id: idOf(p.jid), jid: p.jid, name: p.name || "", status: "pending" })),
    state: STATES.WAITING,
    game: null,
    version: 0,
    nonce: token(6),
    usedNonces: [],
    options: { ...(spec.options || {}) },
    theme: spec.theme || null,
    createdAt: t,
    updatedAt: t,
    startedAt: null,
    expiresAt: t + (invites.length ? CHALLENGE_TTL : WAIT_TTL),
    turnDeadline: null,
    result: null,
    rematchOf: spec.rematchOf || null,
    rematchVotes: [],
  };
  if (vsAI) room.players.push(aiPlayer(spec.difficulty || "NORMAL"));
  rooms.set(roomId, room);
  index(room);
  repository().bumpAnalytics(contract.id, "created");
  if (vsAI) repository().bumpAnalytics(contract.id, "vsAI");
  // لعبة فردية أو ضد الكمبيوتر ⇒ تبدأ فوراً
  // فردي · ضد الكمبيوتر · لعبة جماعية بلاعب واحد في الخاص ⇒ تبدأ فوراً
  const soloStart = contract.mode === "solo" || vsAI || (!isGroup && contract.mode !== "pvp");
  if (contract.players.min <= room.players.length && soloStart) {
    return start(room, contract);
  }
  room.state = room.players.length >= contract.players.min ? STATES.READY : STATES.WAITING;
  save(room);
  return { ok: true, room };
}

/** اسم بديل للعقد (createGame = createRoom بخيارات اللعبة) */
const createGame = createRoom;

function start(room, contract) {
  try {
    room.game = contract.controller.init({ players: room.players.length, rng: serverRng, options: room.options, seats: room.players.map((p) => ({ isAI: Boolean(p.isAI) })) });
  } catch (error) {
    noteFailure("arcade-engine", error, { where: "terboo-arcade/engine:start", stage: `${contract.id}.init`, fallback: "room-cancelled" });
    room.state = STATES.CANCELLED;
    save(room);
    return err("init-failed");
  }
  room.state = STATES.PLAYING;
  room.startedAt = now();
  room.expiresAt = null;
  bumpNonce(room);
  setDeadline(room, contract);
  repository().bumpAnalytics(contract.id, "started");
  const aiMoves = runAI(room, contract);
  const done = checkFinish(room, contract);
  save(room);
  return { ok: true, room, aiMoves, finished: done };
}

function joinRoom(roomId, who) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  const contract = contractOf(room.gameId);
  if (![STATES.WAITING, STATES.READY].includes(room.state)) return err("not-joinable", { room });
  if (seatOf(room, who.jid) >= 0) return err("already-joined", { room });
  if (room.players.length >= contract.players.max) return err("room-full", { room });
  const id = idOf(who.jid);
  if (room.invites.length && !room.invites.some((i) => i.id === id)) return err("not-invited", { room });
  const busy = activeRoomsOf(who.jid, room.chat).filter((r) => r.roomId !== roomId);
  if (busy.length) return err("already-in-room", { room: busy[0] });
  room.players.push(player(who.jid, who.name, { ready: !room.invites.length }));
  const invite = room.invites.find((i) => i.id === id);
  if (invite) {
    invite.status = "accepted";
    room.players[room.players.length - 1].ready = true;
  }
  index(room);
  room.expiresAt = now() + WAIT_TTL;
  room.state = room.players.length >= contract.players.min ? STATES.READY : STATES.WAITING;
  // ألعاب ذات سعة ثابتة (2 لاعبين) تبدأ عند الاكتمال والجاهزية
  if (room.players.length === contract.players.max && room.players.every((p) => p.ready)) return start(room, contract);
  save(room);
  return { ok: true, room };
}

/** رفض تحدٍّ (الصديق المدعو فقط) */
function declineChallenge(roomId, who) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  const invite = room.invites.find((i) => i.id === idOf(who.jid));
  if (!invite || invite.status !== "pending") return err("not-invited");
  invite.status = "declined";
  if (room.invites.every((i) => i.status === "declined")) return close(room, STATES.CANCELLED, "declined");
  save(room);
  return { ok: true, room };
}

function readyPlayer(roomId, who) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  const seat = seatOf(room, who.jid);
  if (seat < 0) return err("not-in-room");
  room.players[seat].ready = true;
  save(room);
  return { ok: true, room };
}

function startGame(roomId, who) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  const contract = contractOf(room.gameId);
  if (room.hostId !== idOf(who.jid)) return err("host-only", { room });
  if (![STATES.WAITING, STATES.READY].includes(room.state)) return err("not-startable", { room });
  if (room.players.length < contract.players.min) return err("not-enough-players", { room, need: contract.players.min });
  if (!room.players.every((p) => p.ready)) return err("not-ready", { room });
  return start(room, contract);
}

function leaveRoom(roomId, who) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  const seat = seatOf(room, who.jid);
  if (seat < 0) {
    room.spectators = room.spectators.filter((s) => s.id !== idOf(who.jid));
    save(room);
    return { ok: true, room };
  }
  if (room.state === STATES.PLAYING || room.state === STATES.PAUSED) return surrender(roomId, who);
  const [left] = room.players.splice(seat, 1);
  byPlayer.get(left.id)?.delete(room.roomId);
  if (!room.players.some((p) => !p.isAI)) return close(room, STATES.CANCELLED, "empty");
  if (room.hostId === left.id) room.hostId = room.players.find((p) => !p.isAI).id;
  const contract = contractOf(room.gameId);
  room.state = room.players.length >= contract.players.min ? STATES.READY : STATES.WAITING;
  save(room);
  return { ok: true, room, hostChanged: room.hostId !== left.id };
}

function transferHost(roomId, who, toJid) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  if (room.hostId !== idOf(who.jid)) return err("host-only", { room });
  const target = room.players.find((p) => p.id === idOf(toJid) && !p.isAI);
  if (!target) return err("not-in-room", { room });
  room.hostId = target.id;
  save(room);
  return { ok: true, room };
}

function spectate(roomId, who) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  if (seatOf(room, who.jid) >= 0) return err("already-joined", { room });
  const id = idOf(who.jid);
  if (!room.spectators.some((s) => s.id === id)) room.spectators.push({ id, jid: who.jid, name: who.name || "" });
  save(room);
  return { ok: true, room };
}

function pauseGame(roomId, who) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  if (room.state !== STATES.PLAYING) return err("not-playing", { room });
  if (room.hostId !== idOf(who.jid)) return err("host-only", { room });
  room.state = STATES.PAUSED;
  room.pausedLeft = room.turnDeadline ? Math.max(0, room.turnDeadline - now()) : null;
  room.turnDeadline = null;
  room.pausedAt = now();
  bumpNonce(room);
  save(room);
  return { ok: true, room };
}

function resumeGame(roomId, who) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  if (room.state !== STATES.PAUSED) return err("not-paused", { room });
  if (room.hostId !== idOf(who.jid) && seatOf(room, who.jid) < 0) return err("not-in-room", { room });
  room.state = STATES.PLAYING;
  room.turnDeadline = room.pausedLeft != null ? now() + room.pausedLeft : null;
  bumpNonce(room);
  save(room);
  return { ok: true, room };
}

function surrender(roomId, who) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  if (![STATES.PLAYING, STATES.PAUSED].includes(room.state)) return err("not-playing", { room });
  const seat = seatOf(room, who.jid);
  if (seat < 0) return err("not-in-room", { room });
  const contract = contractOf(room.gameId);
  const others = room.players.map((_, i) => i).filter((i) => i !== seat);
  // فردي/تعاوني: الاستسلام = خسارة بلا فائز. تنافسي: البقية يفوزون
  const outcome = contract.mode === "solo" || contract.mode === "coop" ? { over: true, winners: [], draw: false, reason: "surrender" } : { over: true, winners: others, draw: false, reason: "surrender", by: seat };
  return finish(room, contract, outcome);
}

/** إنهاء داخلي فقط (status من منطق الخادم) — لا يُستدعى من مدخل عميل */
function finish(room, contract, outcome) {
  room.state = STATES.FINISHED;
  room.result = { winners: outcome.winners || [], draw: Boolean(outcome.draw), reason: outcome.reason || "end", scores: outcome.scores || null, at: now() };
  room.turnDeadline = null;
  room.expiresAt = now() + FINISHED_TTL;
  bumpNonce(room);
  let settlement = [];
  try {
    settlement = settle({ contract, room, outcome: room.result, repo: repository(), wallet: walletOf() });
  } catch (error) {
    noteFailure("arcade-engine", error, { where: "terboo-arcade/engine:finish", stage: "settle", fallback: "no-rewards" });
  }
  room.settlement = settlement.map(({ playerId, result, reward, points, achievements, duplicate }) => ({ playerId, result, reward, points, achievements: (achievements || []).map((a) => a.id), duplicate: Boolean(duplicate) }));
  repository().bumpAnalytics(contract.id, "finished");
  if (room.startedAt) repository().bumpAnalytics(contract.id, "durationMs", now() - room.startedAt);
  save(room);
  events.emit("finished", { room, contract, settlement });
  return { ok: true, room, finished: true, settlement };
}

/** finishGame في الـAPI: يفحص status() الحقيقي فقط — لا يقبل نتيجة من الخارج */
function finishGame(roomId) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  const contract = contractOf(room.gameId);
  const st = room.game ? contract.controller.status(room.game) : null;
  if (!st?.over) return err("not-over", { room });
  return finish(room, contract, st);
}

function close(room, state, reason) {
  room.state = state;
  room.result = { winners: [], draw: false, reason, at: now() };
  room.turnDeadline = null;
  room.expiresAt = now() + FINISHED_TTL;
  bumpNonce(room);
  save(room);
  events.emit(state === STATES.EXPIRED ? "expired" : "cancelled", { room, reason });
  return { ok: true, room };
}

function cancelGame(roomId, who, { force = false } = {}) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  if (TERMINAL.has(room.state)) return err("already-closed", { room });
  if (!force && room.hostId !== idOf(who?.jid)) return err("host-only", { room });
  // لعبة جارية بين بشر: الإلغاء من المضيف = استسلامه (لا إلغاء للهرب من خسارة)
  if (!force && room.state === STATES.PLAYING && room.players.filter((p) => !p.isAI).length > 1) return surrender(roomId, who);
  return close(room, STATES.CANCELLED, force ? "admin" : "host");
}

function checkFinish(room, contract) {
  const st = contract.controller.status(room.game);
  if (st?.over) {
    finish(room, contract, st);
    return true;
  }
  return false;
}

/** يلعب أدوار الكمبيوتر المتتالية (حتمي) — يعيد الحركات المنفذة */
function runAI(room, contract) {
  const moves = [];
  for (let i = 0; i < AI_STEPS; i += 1) {
    if (room.state !== STATES.PLAYING) break;
    if (contract.controller.status(room.game)?.over) break;
    let actor = contract.controller.currentActor(room.game);
    // لعبة متزامنة (لا صاحب دور): أي مقعد كمبيوتر ما زال عليه اختيار
    if (actor === null || actor === undefined) {
      actor = room.players.findIndex((p, i) => p.isAI && contract.controller.legalActions(room.game, i).length);
      if (actor < 0) break;
    }
    const seat = room.players[actor];
    if (!seat?.isAI) break;
    const move = chooseMove(contract, room.game, { actor, difficulty: seat.difficulty, seed: `${room.sessionId}:${room.version}` });
    if (!move) break;
    const next = structuredClone(room.game);
    const res = contract.controller.apply(next, move, { actor, rng: serverRng });
    if (res?.ok === false) break;
    room.game = res?.state || next;
    bumpNonce(room);
    setDeadline(room, contract);
    moves.push({ actor, action: move, events: res?.events || [] });
  }
  return moves;
}

// ─────────────── بروتوكول الإجراء ───────────────

function plainPayload(payload, depth = 0) {
  if (payload == null) return true;
  if (depth > 3) return false;
  if (Array.isArray(payload)) return payload.length <= 32 && payload.every((v) => plainPayload(v, depth + 1));
  if (typeof payload === "object") {
    if (Object.getPrototypeOf(payload) !== Object.prototype) return false;
    return Object.entries(payload).every(([k, v]) => !FORBIDDEN_PAYLOAD_KEYS.has(k.toLowerCase()) && plainPayload(v, depth + 1));
  }
  return ["string", "number", "boolean"].includes(typeof payload) && (typeof payload !== "string" || payload.length <= 64) && (typeof payload !== "number" || Number.isFinite(payload));
}

/** فحص بنية الإجراء قبل أي قفل (رخيص) */
function validateShape(action) {
  if (!action || typeof action !== "object") return "bad-shape";
  for (const key of ["gameId", "sessionId", "actionId", "actor"]) {
    if (typeof action[key] !== "string" || !action[key] || action[key].length > 96) return `bad-${key}`;
  }
  if (!/^[a-z][a-z0-9_.]{0,31}$/i.test(action.actionId)) return "bad-actionId";
  if (action.nonce != null && (typeof action.nonce !== "string" || action.nonce.length > 16)) return "bad-nonce";
  if (action.timestamp != null && !Number.isFinite(action.timestamp)) return "bad-timestamp";
  try {
    if (JSON.stringify(action.payload ?? null).length > MAX_PAYLOAD_BYTES) return "payload-too-large";
  } catch (error) {
    noteFailure("arcade-engine", error, { where: "terboo-arcade/engine:validateShape", stage: "stringify", fallback: "rejected" });
    return "bad-payload";
  }
  if (!plainPayload(action.payload)) return "forbidden-field";
  return null;
}

function rememberMessage(messageId) {
  if (!messageId) return false;
  if (seenMessages.has(messageId)) return true;
  seenMessages.set(messageId, now());
  if (seenMessages.size > 5000) {
    const cut = now() - 10 * 60 * 1000;
    for (const [k, v] of seenMessages) if (v < cut) seenMessages.delete(k);
  }
  return false;
}

/**
 * يطبّق إجراء لاعب.
 * @param {{gameId, sessionId, actionId, actor, timestamp?, nonce?, payload?, source?:string, messageId?:string, jid?:string}} action
 *   actor = المعرّف القانوني من الخادم (router يملؤه من m.sender) — أي قيمة أخرى تُرفض كغير لاعب.
 */
async function applyAction(action) {
  const shape = validateShape(action);
  if (shape) return err(shape);
  const room = rooms.get(bySession.get(action.sessionId));
  if (!room) return err("no-session");
  if (room.gameId !== action.gameId) return err("session-mismatch");
  return withLock(room.roomId, () => applyLocked(room, action));
}

function applyLocked(room, action) {
  const contract = contractOf(room.gameId);
  if (room.state === STATES.PAUSED) return err("paused", { room });
  if (room.state !== STATES.PLAYING) return err(TERMINAL.has(room.state) ? "finished" : "not-started", { room });
  const seat = room.players.findIndex((p) => p.id === action.actor && !p.isAI);
  if (seat < 0) return err("not-a-player", { room });
  if (rememberMessage(action.messageId)) return err("duplicate", { room });
  // الزر/HTML يحمل nonce النسخة التي رآها اللاعب
  if (action.source === "button" || action.source === "html") {
    if (!action.nonce) return err("stale", { room });
    if (action.nonce !== room.nonce) return err((room.usedNonces || []).includes(action.nonce) ? "stale" : "bad-nonce", { room });
  }
  if (action.source === "html" && Math.abs(now() - (action.timestamp || 0)) > CLIENT_SKEW) return err("expired-action", { room });

  if (action.actionId === "sys.surrender") return surrender(room.roomId, { jid: room.players[seat].jid });

  const actor = contract.controller.currentActor(room.game);
  if (actor !== null && actor !== undefined && actor !== seat) return err("not-your-turn", { room, turn: actor });
  const legal = contract.controller.legalActions(room.game, seat);
  const wanted = { id: action.actionId, payload: action.payload ?? null };
  let match = legal.find((a) => sameAction({ id: a.id, payload: a.payload ?? null }, wanted));
  if (!match && contract.freeActions.includes(wanted.id) && contract.controller.validateFree) {
    const checked = contract.controller.validateFree(room.game, wanted, seat);
    if (!checked?.ok) return err(checked?.code || "illegal", { room, detail: checked?.detail });
    match = checked.action || wanted;
  }
  if (!match) return err("illegal", { room });

  const next = structuredClone(room.game);
  let res;
  try {
    res = contract.controller.apply(next, match, { actor: seat, rng: serverRng });
  } catch (error) {
    noteFailure("arcade-engine", error, { where: "terboo-arcade/engine:apply", stage: `${contract.id}.${match.id}`, fallback: "action-rejected" });
    return err("apply-failed", { room });
  }
  if (res?.ok === false) return err(res.code || "rejected", { room });
  room.game = res?.state || next;
  room.lastActionAt = now();
  bumpNonce(room);
  setDeadline(room, contract);
  const evts = res?.events || [];
  if (checkFinish(room, contract)) return { ok: true, room, events: evts, finished: true, settlement: room.settlement };
  const aiMoves = runAI(room, contract);
  const finished = checkFinish(room, contract);
  save(room);
  return { ok: true, room, events: evts, aiMoves, finished, settlement: finished ? room.settlement : null };
}

/** إعادة مباراة: كل البشر يصوّتون؛ ضد الكمبيوتر/فردي تبدأ فوراً */
function rematch(roomId, who) {
  const room = rooms.get(roomId);
  if (!room) return err("no-room");
  if (room.state !== STATES.FINISHED) return err("not-finished", { room });
  const seat = seatOf(room, who.jid);
  if (seat < 0) return err("not-in-room", { room });
  if (room.rematchRoomId) {
    const existing = rooms.get(room.rematchRoomId);
    if (existing) return { ok: true, room: existing, already: true };
  }
  const id = idOf(who.jid);
  if (!room.rematchVotes.includes(id)) room.rematchVotes.push(id);
  const humans = room.players.filter((p) => !p.isAI);
  if (!humans.every((p) => room.rematchVotes.includes(p.id))) {
    save(room);
    return { ok: true, room, pending: humans.filter((p) => !room.rematchVotes.includes(p.id)).map((p) => p.name) };
  }
  // تحرير المقاعد القديمة ثم غرفة جديدة بنفس اللاعبين (المقاعد تُدوَّر للعدل)
  unindex(room);
  const order = [...room.players.slice(1), room.players[0]];
  const ai = room.players.find((p) => p.isAI);
  const humansOrdered = order.filter((p) => !p.isAI);
  const created = createRoom({
    gameId: room.gameId,
    chat: room.chat,
    isGroup: room.isGroup,
    host: { jid: humansOrdered[0].jid, name: humansOrdered[0].name },
    vsAI: Boolean(ai),
    difficulty: ai?.difficulty,
    options: room.options,
    theme: room.theme,
    rematchOf: room.roomId,
  });
  if (!created.ok) return created;
  const next = created.room;
  for (const p of humansOrdered.slice(1)) {
    const joined = joinRoom(next.roomId, { jid: p.jid, name: p.name });
    if (!joined.ok) return joined;
  }
  const fresh = rooms.get(next.roomId);
  if (fresh.state !== STATES.PLAYING && fresh.players.length >= contractOf(room.gameId).players.min) {
    fresh.players.forEach((p) => {
      p.ready = true;
    });
    start(fresh, contractOf(room.gameId));
  }
  room.rematchRoomId = fresh.roomId;
  save(room);
  return { ok: true, room: fresh };
}

function getState(roomId) {
  return rooms.get(roomId) || null;
}

/** View Model للعرض (لا يكشف أسرار اللاعبين الآخرين: view يتلقى viewerSeat) */
function getView(roomId, { viewerJid = null, lang = "ar" } = {}) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const contract = contractOf(room.gameId);
  const viewerSeat = viewerJid ? seatOf(room, viewerJid) : -1;
  const base = {
    gameId: room.gameId,
    roomId: room.roomId,
    sessionId: room.sessionId,
    state: room.state,
    nonce: room.nonce,
    version: room.version,
    icon: contract.icon,
    title: contract.name[lang] || contract.name.ar,
    category: contract.category,
    uiMode: contract.uiMode,
    theme: room.theme,
    lang,
    hostId: room.hostId,
    players: room.players.map((p, i) => ({ name: p.name, isAI: Boolean(p.isAI), difficulty: p.difficulty || null, seat: i, ready: p.ready, host: p.id === room.hostId, jid: p.jid })),
    spectators: room.spectators.length,
    turnDeadline: room.turnDeadline,
    result: room.result,
    settlement: room.settlement || null,
    viewerSeat,
  };
  if (!room.game) return { ...base, board: null, actions: [] };
  const turn = contract.controller.currentActor(room.game);
  // sessionId/roomId في سياق العرض: تسمح للعقد بربط مرجع أصل موقّع بالجلسة
  // (مثال: صورة سؤال تُعرض داخل Mini App) بلا تمرير العنوان الأصلي للعميل.
  const view = contract.renderer.view(room.game, { viewerSeat, lang, players: base.players, turn, sessionId: room.sessionId, roomId: room.roomId });
  // من يتصرف الآن: صاحب الدور، أو (لعبة متزامنة) المشاهد نفسه إن كان لاعباً، أو المقعد الأول لعرض عام
  const hasTurn = turn !== null && turn !== undefined;
  const actingSeat = hasTurn ? turn : viewerSeat >= 0 ? viewerSeat : 0;
  const visible = room.state === STATES.PLAYING && (!viewerJid || !hasTurn || turn === viewerSeat);
  const actions = visible && !room.players[actingSeat]?.isAI ? contract.controller.legalActions(room.game, actingSeat) : [];
  return { ...base, turn, ...view, actions };
}

function getLeaderboard(gameId = null, period = "all", limit = 10) {
  return repository().top(gameId, period, limit);
}

function getStats(jid) {
  return repository().getStats(idOf(jid));
}

function findRoom({ chat, jid = null, gameId = null, states = null } = {}) {
  const pool = jid ? [...(byPlayer.get(idOf(jid)) || [])] : [...(byChat.get(chat) || [])];
  return pool
    .map((id) => rooms.get(id))
    .filter((r) => r && (!chat || r.chat === chat) && (!gameId || r.gameId === gameId) && (!states || states.includes(r.state)))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

/** غرف تنتظر هذا الشخص كمدعو (تحدٍّ صديق) */
function pendingChallenges(jid) {
  const id = idOf(jid);
  return [...rooms.values()].filter((r) => r.state !== STATES.PLAYING && !TERMINAL.has(r.state) && r.invites.some((i) => i.id === id && i.status === "pending"));
}

// ─────────────── التنظيف والمؤقتات ───────────────

function sweep(at = now()) {
  const out = { expired: 0, timeouts: 0, purged: 0 };
  for (const room of [...rooms.values()]) {
    const contract = contractOf(room.gameId);
    if (TERMINAL.has(room.state)) {
      if (room.expiresAt && room.expiresAt < at) {
        unindex(room);
        bySession.delete(room.sessionId);
        rooms.delete(room.roomId);
        repository().deleteRoom(room.roomId);
        out.purged += 1;
      }
      continue;
    }
    if ((room.state === STATES.WAITING || room.state === STATES.READY) && room.expiresAt && room.expiresAt < at) {
      close(room, STATES.EXPIRED, room.invites.some((i) => i.status === "pending") ? "challenge-expired" : "wait-expired");
      out.expired += 1;
      continue;
    }
    if (room.state === STATES.PLAYING && contract) {
      if (contract.sessionType === "solo" && at - (room.lastActionAt || room.startedAt) > SOLO_IDLE_TTL) {
        close(room, STATES.EXPIRED, "idle");
        out.expired += 1;
        continue;
      }
      if (room.turnDeadline && room.turnDeadline < at) {
        out.timeouts += 1;
        timeout(room, contract);
      }
    }
    if (room.state === STATES.PAUSED && at - (room.pausedAt || at) > SOLO_IDLE_TTL) {
      close(room, STATES.EXPIRED, "paused-too-long");
      out.expired += 1;
    }
  }
  return out;
}

function timeout(room, contract) {
  const actor = contract.controller.currentActor(room.game);
  if (contract.controller.onTimeout) {
    const res = contract.controller.onTimeout(room.game, { actor, rng: serverRng });
    if (res?.state) room.game = res.state;
    bumpNonce(room);
    setDeadline(room, contract);
    if (!checkFinish(room, contract)) {
      runAI(room, contract);
      checkFinish(room, contract);
    }
    save(room);
    events.emit("timeout", { room, contract, actor, handled: true });
    return;
  }
  // الافتراضي: من انتهى وقته يخسر (لعبة دورية بين لاعبَين أو أكثر)
  const others = room.players.map((_, i) => i).filter((i) => i !== actor);
  finish(room, contract, { over: true, winners: actor == null ? [] : others, draw: actor == null, reason: "timeout", by: actor });
  events.emit("timeout", { room, contract, actor, handled: false });
}

function startSweeper(interval = 15000) {
  if (sweeper) return sweeper;
  sweeper = setInterval(() => {
    try {
      sweep();
    } catch (error) {
      noteFailure("arcade-engine", error, { where: "terboo-arcade/engine:sweeper", stage: "sweep", fallback: "next-tick" });
    }
  }, interval);
  sweeper.unref?.();
  return sweeper;
}

function stopSweeper() {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

function stats() {
  const byState = {};
  for (const r of rooms.values()) byState[r.state] = (byState[r.state] || 0) + 1;
  return { rooms: rooms.size, chats: byChat.size, players: byPlayer.size, locks: locks.size, byState };
}

/** للاختبارات: يمسح كل شيء */
function _reset() {
  for (const set of [rooms, byChat, byPlayer, bySession, locks, seenMessages]) set.clear();
  stopSweeper();
}

export {
  STATES,
  _reset,
  applyAction,
  activeRoomsOf,
  cancelGame,
  configure,
  createGame,
  createRoom,
  declineChallenge,
  events,
  findRoom,
  finishGame,
  getLeaderboard,
  getState,
  getStats,
  getView,
  idOf,
  joinRoom,
  leaveRoom,
  pauseGame,
  pendingChallenges,
  readyPlayer,
  rematch,
  repository,
  resumeGame,
  spectate,
  startGame,
  startSweeper,
  stats,
  stopSweeper,
  surrender,
  sweep,
  transferHost,
  validateShape,
};
