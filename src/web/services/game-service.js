// ═══════════════════════════════════════════════
// 🎮 Terboo Web — الألعاب عبر محرّك الأركيد الحقيقي
// ───────────────────────────────────────────────
// محرّك terboo-arcade/engine.js قناعي الحياد أصلاً: init/legalActions/apply/
// status/view دوال خالصة، والغرف تُقفل بـwithLock وتحمل nonce ونسخة.
// لذلك يُلعب من الويب بلا أي تزييف رسالة، بشرط:
//   • كل انتقال حالة يحدث في المحرّك على الخادم. العميل يعرض فقط.
//   • الإجراءات تُرسل بـsessionId + nonce: إعادة إرسال نفس الحركة تُرفض.
//   • العرض لكل مشاهد من getView(roomId, {viewerJid}) فيبقى الخفي خفياً.
//   • الاقتصاد والمكافآت من محفظة المحرّك (قاعدة البوت) لا من الموقع.
//   • معرّفات اللاعبين (jid) تُقنَّع قبل أن تغادر الخادم.
// ═══════════════════════════════════════════════

import { apiError } from "../errors.js";
import { maskPhone } from "./identity-service.js";

let engine = null;
let registry = null;

/** تحميل متأخر: محرّك الأركيد يُحمّل عند أول استعمال فعلي */
async function arcade() {
  if (engine && registry) return { engine, registry };
  const index = await import("../../lib/terboo-arcade/index.js");
  await index.loadArcade();
  engine = await import("../../lib/terboo-arcade/engine.js");
  registry = index;
  return { engine, registry };
}

/** نطاق غرف الويب: منفصل عن محادثات واتساب لنفس الشخص */
const webChat = (principal) => `web:${principal.canonical}`;

/** الألعاب المسجّلة فعلاً */
async function listGames(lang = "ar") {
  const { registry: reg } = await arcade();
  return reg.arcadeContracts().map((contract) => ({
    id: contract.id,
    title: contract.name?.[lang] || contract.name?.ar || contract.id,
    icon: contract.icon || "",
    category: contract.category,
    mode: contract.mode,
    uiMode: contract.uiMode,
    players: contract.players,
    supportsAI: Boolean(contract.supportsAI),
    supportsPrivate: contract.supportsPrivate !== false,
    // الويب يلعب في نطاق خاص ⇒ تحتاج اللعبة دعم الخاص أو خصماً آلياً
    webRunnable: contract.supportsPrivate !== false,
    unavailableReason: contract.supportsPrivate === false ? "game-is-group-only" : "",
  }));
}

/** يُقنَّع كل معرّف لاعب قبل الإرسال للعميل */
function maskView(view, principal) {
  if (!view) return null;
  const players = (view.players || []).map((player) => ({
    name: player.name || "",
    seat: player.seat,
    isAI: Boolean(player.isAI),
    difficulty: player.difficulty || null,
    ready: Boolean(player.ready),
    host: Boolean(player.host),
    me: player.jid ? player.jid.includes(principal.digits) : false,
    // الرقم لا يغادر الخادم
    label: player.isAI ? "AI" : maskPhone(String(player.jid || "").replace(/\D/g, "")),
  }));
  const { players: _ignored, hostId: _host, ...rest } = view;
  return { ...rest, players };
}

/** ينشئ جلسة لعب في نطاق الويب */
async function createSession({ principal, gameId, vsAI = true, difficulty = "normal", lang = "ar" }) {
  const { engine: e } = await arcade();
  const outcome = e.createRoom({
    gameId: String(gameId || ""),
    chat: webChat(principal),
    isGroup: false,
    host: { jid: principal.sender, name: principal.number ? maskPhone(principal.number) : "player" },
    vsAI: Boolean(vsAI),
    difficulty,
    lang,
  });
  if (outcome?.ok === false) {
    const code = String(outcome.code || "refused");
    if (code === "unknown-game") throw apiError("NOT_FOUND");
    if (code === "private-unsupported") throw apiError("NOT_AVAILABLE_IN_WEB", { details: { reason: "game-is-group-only" } });
    throw apiError("INVALID_INPUT", { details: { reason: code } });
  }
  const roomId = outcome.roomId || outcome.room?.roomId || "";
  return maskView(e.getView(roomId, { viewerJid: principal.sender, lang }), principal);
}

/** الحالة الحالية لغرفة يملك المستخدم مقعداً فيها */
async function sessionState({ principal, roomId, lang = "ar" }) {
  const { engine: e } = await arcade();
  const room = e.getState(String(roomId || ""));
  // ليست غرفته ⇒ 404 (لا تمييز بين غير موجودة وغير مملوكة)
  if (!room || room.chat !== webChat(principal)) throw apiError("NOT_FOUND");
  return maskView(e.getView(room.roomId, { viewerJid: principal.sender, lang }), principal);
}

/**
 * ينفّذ حركة. كل تحقق (الدور · الشرعية · nonce · القواعد) في المحرّك.
 * العميل لا يرسل نتيجة ولا نقاطاً — فقط نيّة حركة.
 */
async function act({ principal, roomId, action = {}, lang = "ar" }) {
  const { engine: e } = await arcade();
  const room = e.getState(String(roomId || ""));
  if (!room || room.chat !== webChat(principal)) throw apiError("NOT_FOUND");

  const outcome = await e.applyAction({
    sessionId: room.sessionId,
    gameId: room.gameId,
    // المقعد يُشتق من الهوية لا من الطلب
    jid: principal.sender,
    nonce: action.nonce,
    type: String(action.type || "").slice(0, 40),
    value: action.value === undefined ? null : action.value,
  });

  if (outcome?.ok === false) {
    const code = String(outcome.code || "refused");
    if (["no-session", "session-mismatch"].includes(code)) throw apiError("NOT_FOUND");
    if (["not-your-turn", "stale-nonce", "illegal-action", "not-playing"].includes(code)) {
      throw apiError("INVALID_INPUT", { details: { reason: code } });
    }
    throw apiError("INVALID_INPUT", { details: { reason: code } });
  }
  return maskView(e.getView(room.roomId, { viewerJid: principal.sender, lang }), principal);
}

/** يغادر/يلغي غرفة يملكها */
async function leave({ principal, roomId }) {
  const { engine: e } = await arcade();
  const room = e.getState(String(roomId || ""));
  if (!room || room.chat !== webChat(principal)) throw apiError("NOT_FOUND");
  const outcome = e.leaveRoom(room.roomId, { jid: principal.sender });
  return { left: outcome?.ok !== false, reason: outcome?.code || "" };
}

export { act, createSession, leave, listGames, maskView, sessionState, webChat };
