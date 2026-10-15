// ═══════════════════════════════════════════════
// 📲 TERBOO ARCADE — جسر واتساب (Action Router + التسليم)
// ───────────────────────────────────────────────
// كل مدخل يتحول إلى Game Action واحد ثم engine.applyAction:
//   زر/قائمة  ⇒ «.اركيد a <roomId> <nonce> <index>» ⇒ legalActions[index] لنفس النسخة (source:"button")
//   رد/نص     ⇒ contract.parseInput ⇒ (source:"text" + messageId لمنع التكرار)
//   كلام طبيعي ⇒ intent.js ⇒ نفس أمر .اركيد (بنفس الصلاحيات)
//   HTML      ⇒ عقد الجسر موثّق في terboo-html-game (غير مُفعّل: لا قناة مثبتة)
// actor دائماً من m.sender (هوية الخادم) — لا يُقرأ من الزر أو النص أبداً.
// التسليم: بطاقة HTML ثلاثية الأبعاد + نص وأزرار واتساب أصلية (بلا صور لوحات).
// ═══════════════════════════════════════════════

import config from "../../../config.js";
import { getDatabase } from "../terboo-database.js";
import { getUserLanguage } from "../terboo-localization.js";
import { noteFailure } from "../terboo-failure-log.js";
import { sendCard } from "../terboo-ui-kit.js";
import { deliverVisual } from "../terboo-visual-response.js";
import { remember } from "../terboo-context-engine.js";
import { games } from "../terboo-games.js";
import * as engine from "./engine.js";
import { L } from "./locale.js";
import { buttonsView, htmlView, textView, actionLabel } from "./render.js";
import { achievements } from "./progress.js";

const CMD = "اركيد";
const SURRENDER = /^(استسلام|استسلم|surrender|give up|rendirse|me rindo)$/i;

function langOf(m) {
  try {
    return getUserLanguage(getDatabase().getUser(m.sender));
  } catch (error) {
    noteFailure("arcade-wa", error, { where: "terboo-arcade/whatsapp:langOf", stage: "getUser", fallback: "ar" });
    return "ar";
  }
}

const prefixOf = (m) => m?.prefix || config.command?.prefix || ".";
const who = (m) => ({ jid: m.sender, name: m.pushName || String(m.sender || "").split("@")[0] });
const gameName = (id, lang) => games.contractOf(id)?.name?.[lang] || id;

function errorText(lang, res) {
  const room = res.room;
  const vars = { game: room ? gameName(room.gameId, lang) : "", need: res.need ?? "", hint: "" };
  const key = `ui.err.${res.code}`;
  const text = L(lang, key, vars);
  const base = text === key ? L(lang, "ui.err.generic") : text;
  // تفصيل من منطق اللعبة (مفتاح نص فقط، لا قيم من العميل)
  return res.detail && /^g\.[a-z0-9_]+\.[a-z]+$/i.test(res.detail) ? `${base}\n${L(lang, res.detail)}` : base;
}

/** سطور النتيجة: الفائز/التعادل/الاستسلام + المكافآت + الإنجازات */
function resultNote(room, lang) {
  const r = room.result;
  if (!r) return "";
  const names = (seats) => seats.map((i) => room.players[i]?.name).filter(Boolean);
  const lines = [];
  if (r.reason === "surrender" && r.by != null) lines.push(L(lang, "ui.surrendered", { name: room.players[r.by]?.name || "" }));
  if (r.reason === "timeout" && r.by != null) lines.push(L(lang, "ui.timedOut", { name: room.players[r.by]?.name || "" }));
  const contract = games.contractOf(room.gameId);
  if (room.state === "FINISHED") {
    if (r.draw) lines.push(L(lang, "ui.draw"));
    else if (r.winners.length && (contract.mode === "solo" || contract.mode === "coop")) lines.push(L(lang, "ui.solved"));
    else if (r.winners.length === 1) lines.push(L(lang, "ui.win", { name: names(r.winners)[0] }));
    else if (r.winners.length > 1) lines.push(L(lang, "ui.winMany", { names: names(r.winners).join("، ") }));
    else lines.push(L(lang, "ui.lost"));
  } else lines.push(L(lang, `ui.state.${room.state}`));
  const titles = new Map(achievements().map((a) => [a.id, a]));
  for (const s of room.settlement || []) {
    const p = room.players.find((x) => x.id === s.playerId);
    if (!p || s.duplicate) continue;
    const parts = ["koin", "exp", "energi"].filter((k) => s.reward?.[k] > 0).map((k) => L(lang, `ui.${k}`, { n: s.reward[k] }));
    if (parts.length) lines.push(L(lang, "ui.reward", { name: p.name, parts: parts.join(" · ") }));
    for (const id of s.achievements || []) {
      const a = titles.get(id);
      if (a) lines.push(L(lang, "ui.achievement", { name: p.name, title: `${a.icon} ${a.name[lang] || a.name.en}` }));
    }
  }
  return lines.join("\n");
}

function roomExtras(room) {
  if (room.state === "WAITING" || room.state === "READY") return ["join", "start", "leave"];
  if (room.state === "PLAYING") return ["surrender", "board"];
  if (room.state === "PAUSED") return ["resume", "surrender"];
  return ["rematch", "leaderboard", "menu"];
}

/**
 * يرسل حالة الغرفة: HTML غني + نص وأزرار واتساب أصلية (من نفس View Model).
 * لا تُنشأ أو تُرسل صور لوحات الألعاب من هذا المسار؛ النص/الأزرار تبقى بديلاً آمناً.
 * privateActions ⇒ أزرار الحركة لكل لاعب في الخاص، واللوحة العامة بلا أزرار حركة.
 */
async function sendRoom(sock, m, room, { note = "", lang = langOf(m) } = {}) {
  const contract = games.contractOf(room.gameId);
  const view = engine.getView(room.roomId, { lang });
  if (!view) return null;
  const terminal = ["FINISHED", "CANCELLED", "EXPIRED"].includes(room.state);
  const fullNote = [note, terminal ? resultNote(room, lang) : "", room.state === "WAITING" || room.state === "READY" ? L(lang, "ui.joinHint", { cmd: `${prefixOf(m)}${CMD} join ${room.roomId}` }) : ""].filter(Boolean).join("\n");
  const hint = contract.inputHint && room.state === "PLAYING" && !contract.privateActions ? L(lang, "ui.typeHint", { hint: L(lang, contract.inputHint) }) : "";
  const text = textView(view, { note: [fullNote, hint].filter(Boolean).join("\n") });
  const ui = buttonsView(contract.privateActions ? { ...view, actions: [] } : view, { prefix: prefixOf(m), cmd: CMD, extra: roomExtras(room) });
  // الصور معطّلة للألعاب بالكامل: العرض المرئي صار HTML، والحركات عبر أزرار واتساب الأصلية.
  const mentions = room.players.filter((p) => p.jid).map((p) => p.jid);
  // عقد VisualResponse واحد: بطاقة HTML مدقّقة + نص وأزرار واتساب أصلية، بلا صورة لوحة
  const sent = await deliverVisual(sock, m, {
    mode: "html",
    cardId: `arcade:${contract.id}`,
    lang,
    text,
    footer: L(lang, "ui.footer"),
    actions: ui.buttons,
    select: ui.select,
    mentions,
    to: m.chat !== room.chat ? room.chat : undefined,
    html: htmlView(view),
    htmlMeta: { sessionId: room.sessionId, version: room.version, nonce: room.nonce },
  });
  if (contract.privateActions && room.state === "PLAYING") await sendPrivateMoves(sock, m, room, lang);
  return sent;
}

/** أزرار الحركة لكل لاعب بشري في خاصه (اختيار سري) */
async function sendPrivateMoves(sock, m, room, lang) {
  for (const p of room.players) {
    if (p.isAI || !p.jid) continue;
    const view = engine.getView(room.roomId, { viewerJid: p.jid, lang });
    if (!view?.actions?.length) continue;
    const ui = buttonsView(view, { prefix: prefixOf(m), cmd: CMD });
    try {
      await sendCard(sock, m, { cardId: `arcade:${room.gameId}:private`, lang, to: p.jid, text: textView(view), buttons: ui.buttons, select: ui.select });
    } catch (error) {
      noteFailure("arcade-wa", error, { where: "terboo-arcade/whatsapp:sendPrivateMoves", stage: "sendCard", fallback: "typed-move" });
      await m.reply(L(lang, "ui.privateFailed"));
    }
  }
}

/** رد على نتيجة إجراء: خطأ واضح أو اللوحة الجديدة */
async function afterAction(sock, m, res, lang) {
  if (!res.ok) {
    await m.reply(errorText(lang, res));
    return res;
  }
  const contract = games.contractOf(res.room.gameId);
  const notes = [];
  for (const mv of res.aiMoves || []) {
    const action = contract.controller.legalActions ? mv.action : null;
    if (action) notes.push(L(lang, "ui.aiThinking", { move: actionLabel(action, lang) }));
  }
  for (const evt of res.events || []) {
    if (!evt.noteKey) continue;
    // {name} للمقعد صاحب الحدث من الغرفة نفسها (المنطق لا يعرف الأسماء)
    const name = evt.seat != null ? res.room.players[evt.seat]?.name : undefined;
    notes.push(L(lang, evt.noteKey, { ...(evt.vars || {}), ...(name ? { name } : {}) }));
  }
  remember(m, "choice", { kind: "arcade", roomId: res.room.roomId, gameId: res.room.gameId });
  await sendRoom(sock, m, res.room, { note: notes.join("\n"), lang });
  return res;
}

/** Game Action من زر: index داخل legalActions للنسخة الحالية — nonce يحسم القِدم */
function actionFromButton(m, roomId, nonce, index) {
  const room = engine.getState(roomId);
  if (!room) return { error: "no-room" };
  const contract = games.contractOf(room.gameId);
  const seat = room.players.findIndex((p) => p.id === engine.idOf(m.sender));
  const turn = room.game ? contract.controller.currentActor(room.game) : null;
  const actingSeat = turn !== null && turn !== undefined ? turn : Math.max(seat, 0);
  const legal = room.game && room.state === "PLAYING" ? contract.controller.legalActions(room.game, actingSeat) : [];
  const pick = legal[Number(index)] || { id: "noop", payload: null };
  return {
    action: {
      gameId: room.gameId,
      sessionId: room.sessionId,
      actionId: pick.id,
      actor: engine.idOf(m.sender),
      timestamp: Date.now(),
      nonce: String(nonce || ""),
      payload: pick.payload ?? null,
      source: "button",
      messageId: m.key?.id || null,
    },
    room,
  };
}

/** Game Action من نص حر (رد على اللوحة أو رسالة عادية أثناء اللعب) */
function actionFromText(m, room) {
  const contract = games.contractOf(room.gameId);
  const text = String(m.body || "").trim();
  if (!text || text.length > 64) return null;
  const base = { gameId: room.gameId, sessionId: room.sessionId, actor: engine.idOf(m.sender), timestamp: Date.now(), source: "text", messageId: m.key?.id || null };
  if (SURRENDER.test(text)) return { ...base, actionId: "sys.surrender", payload: null };
  if (!contract.controller.parseInput) return null;
  const seat = room.players.findIndex((p) => p.id === engine.idOf(m.sender));
  const parsed = contract.controller.parseInput(text, room.game, seat);
  return parsed ? { ...base, actionId: parsed.id, payload: parsed.payload ?? null } : null;
}

/**
 * answerHandler موحّد لكل ألعاب الأركيد: يلتقط الحركات المكتوبة.
 * @returns {Promise<boolean>} true إن عولجت الرسالة كحركة
 */
async function arcadeAnswer(m, sock) {
  const body = String(m.body || "").trim();
  if (!body || /^[.!#/]/.test(body)) return false;
  // الغرفة في هذه الدردشة، أو (حركات سرية) غرفة اللاعب من الخاص
  const rooms = engine.activeRoomsOf(m.sender).filter((r) => r.state === "PLAYING" && (r.chat === m.chat || (!m.isGroup && games.contractOf(r.gameId)?.privateActions)));
  for (const room of rooms) {
    const action = actionFromText(m, room);
    if (!action) continue;
    const lang = langOf(m);
    const res = await engine.applyAction(action);
    // حركة غير مفهومة كنص عادي في المجموعة ⇒ لا نزعج (قد تكون دردشة)؛ الأخطاء الحقيقية تُرد
    if (!res.ok && res.code === "illegal" && m.isGroup && !m.quoted) return false;
    await afterAction(sock, m, res, lang);
    return true;
  }
  return false;
}

/** فحص رخيص لـhandler.js قبل استدعاء arcadeAnswer */
function hasArcadeRoom(m) {
  return engine.activeRoomsOf(m.sender).some((r) => r.state === "PLAYING" && (r.chat === m.chat || !m.isGroup));
}

export {
  CMD, actionFromButton, actionFromText, afterAction, arcadeAnswer, errorText, gameName, hasArcadeRoom, langOf, prefixOf, resultNote, sendRoom, who };
