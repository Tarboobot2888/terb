// ═══════════════════════════════════════════════
// 🎮 TERBOO ARCADE — أوامر الواجهة (قائمة · تفاصيل · لعب · غرف · ترتيب · إحصاءات)
// ───────────────────────────────────────────────
// يستعملها plugins/game/اركيد.js وكل أمر لعبة قصير (اكس_او · ثعبان_وسلم · …) بلا تكرار منطق.
// كل الحركات تمر من engine.applyAction (تحقق الدور · القانونية · nonce · المكافآت من الخادم).
// ═══════════════════════════════════════════════

import { sendCard } from "../terboo-ui-kit.js";
import { deliverVisual } from "../terboo-visual-response.js";
import { buildArcadeCatalogHtml, buildTextGameHtml } from "../terboo-html-game.js";
import { CATEGORIES } from "./contract.js";
import { arcadeContracts, games } from "./index.js";
import * as engine from "./engine.js";
import { L } from "./locale.js";
import { CMD, actionFromButton, afterAction, errorText, gameName, langOf, prefixOf, sendRoom, who } from "./whatsapp.js";

const DIFFS = ["EASY", "NORMAL", "HARD", "EXPERT"];
const ROOM_VERBS = new Set(["join", "start", "leave", "surrender", "pause", "resume", "rematch", "board", "accept", "decline", "cancel"]);

const p = (m) => `${prefixOf(m)}${CMD}`;
const gamesIn = (cat) => arcadeContracts().filter((c) => c.category === cat);

function catalogItems(lang) {
  return arcadeContracts().map((c) => ({
    id: c.id,
    icon: c.icon,
    title: c.name?.[lang] || c.name?.ar || c.id,
    description: L(lang, `g.${c.id}.desc`),
    category: L(lang, `ui.cat.${c.category}`),
    mode: c.mode === "solo" ? (lang === "ar" ? "فردية" : lang === "es" ? "Individual" : "SOLO") : (lang === "ar" ? "جماعية" : lang === "es" ? "Multijugador" : "MULTIPLAYER"),
    players: `${c.players?.min ?? 1}–${c.players?.max ?? 1}`,
  }));
}

function gameSections(m, lang) {
  return CATEGORIES.filter((cat) => gamesIn(cat).length).map((cat) => ({
    title: L(lang, `ui.cat.${cat}`),
    rows: gamesIn(cat).slice(0, 10).map((c) => ({
      id: `${p(m)} info ${c.id}`,
      title: `${c.icon} ${c.name[lang] || c.name.ar}`,
      description: L(lang, `g.${c.id}.desc`),
    })),
  }));
}

async function menu(m, sock, lang) {
  const sections = gameSections(m, lang);
  const counts = CATEGORIES.filter((cat) => gamesIn(cat).length).map((cat) => `> ${L(lang, `ui.cat.${cat}`)}: *${gamesIn(cat).length}*`).join("\n");
  const text = `*${L(lang, "ui.menuTitle")}*\n\n${L(lang, "ui.menuIntro")}\n\n${counts}\n\n${L(lang, "ui.gamesCount", { n: arcadeContracts().length })}`;
  return deliverVisual(sock, m, {
    mode: "html",
    cardId: "arcade:menu",
    lang,
    text,
    footer: L(lang, "ui.footer"),
    actions: [
      { id: `${p(m)} top`, text: L(lang, "ui.btn.leaderboard") },
      { id: `${p(m)} stats`, text: L(lang, "ui.btn.stats") },
    ],
    select: { title: L(lang, "ui.pickGame"), sections: sections.slice(0, 10) },
    html: buildArcadeCatalogHtml(catalogItems(lang), { lang }),
  });
}

/** الأمر .اركيد html يعرض كتالوج HTML ثلاثي الأبعاد، بلا معاينات صور. */
async function showcase(m, sock, lang) {
  return menu(m, sock, lang);
}

async function category(m, sock, lang, cat) {
  const list = gamesIn(cat);
  if (!list.length) return menu(m, sock, lang);
  const title = L(lang, `ui.cat.${cat}`);
  const items = catalogItems(lang).filter((item) => list.some((c) => c.id === item.id));
  const sections = [{ title, rows: list.slice(0, 10).map((c) => ({ id: `${p(m)} info ${c.id}`, title: `${c.icon} ${c.name[lang] || c.name.ar}`, description: L(lang, `g.${c.id}.desc`) })) }];
  return deliverVisual(sock, m, {
    mode: "html",
    cardId: `arcade:cat:${cat}`,
    lang,
    text: `*${L(lang, "ui.menuTitle")}* · ${title}\n\n${list.map((c) => `${c.name[lang] || c.name.ar} — ${L(lang, `g.${c.id}.desc`)}`).join("\n")}`,
    footer: L(lang, "ui.footer"),
    actions: [{ id: p(m), text: L(lang, "ui.btn.menu") }],
    select: { title: L(lang, "ui.pickGame"), sections },
    html: buildArcadeCatalogHtml(items, { lang, title, subtitle: L(lang, "ui.pickGame") }),
  });
}

async function details(m, sock, lang, contract) {
  const lines = [
    `*${L(lang, "ui.details", { game: `${contract.icon} ${contract.name[lang]}` })}*`,
    L(lang, `g.${contract.id}.desc`),
    `> ${L(lang, `ui.mode.${contract.mode}`)} · ${L(lang, "ui.playersRange", { min: contract.players.min, max: contract.players.max })}`,
    `> ${contract.supportsAI ? L(lang, "ui.aiLevels") : L(lang, "ui.noAI")}`,
    `> ${L(lang, "ui.uiMode")}: ${L(lang, `ui.ui.${contract.uiMode}`)}`,
    contract.inputHint ? `> ${L(lang, "ui.howToPlay")}: ${L(lang, contract.inputHint)}` : "",
  ].filter(Boolean);
  const buttons = [];
  if (contract.mode === "solo") buttons.push({ id: `${p(m)} play ${contract.id}`, text: L(lang, "ui.btn.solo") });
  else {
    if (contract.supportsAI) buttons.push({ id: `${p(m)} play ${contract.id} ai`, text: L(lang, "ui.btn.ai") });
    if (m.isGroup) buttons.push({ id: `${p(m)} play ${contract.id}`, text: L(lang, "ui.btn.friend") });
    else if (!contract.supportsAI) buttons.push({ id: `${p(m)} play ${contract.id}`, text: L(lang, "ui.btn.solo") });
  }
  buttons.push({ id: `${p(m)} top ${contract.id}`, text: L(lang, "ui.btn.leaderboard") });
  const select = contract.supportsAI && contract.mode !== "solo"
    ? { title: L(lang, "ui.difficulty"), sections: [{ title: L(lang, "ui.chooseDifficulty"), rows: DIFFS.map((d) => ({ id: `${p(m)} play ${contract.id} ai ${d}`, title: `🤖 ${L(lang, `ui.diff.${d}`)}` })) }] }
    : null;
  const title = contract.name[lang] || contract.name.ar || contract.id;
  const body = [
    L(lang, `ui.mode.${contract.mode}`),
    L(lang, "ui.playersRange", { min: contract.players.min, max: contract.players.max }),
    contract.supportsAI ? L(lang, "ui.aiLevels") : L(lang, "ui.noAI"),
  ].join(" · ");
  return deliverVisual(sock, m, {
    mode: "html",
    cardId: `arcade:info:${contract.id}`,
    lang,
    text: lines.join("\n"),
    footer: L(lang, "ui.footer"),
    actions: buttons.slice(0, 3),
    select,
    html: buildTextGameHtml({
      gameId: contract.id,
      icon: contract.icon,
      title,
      body,
      text: [L(lang, `g.${contract.id}.desc`), contract.inputHint ? L(lang, contract.inputHint) : ""].filter(Boolean).join("\n"),
      status: lang === "ar" ? "تفاصيل اللعبة" : lang === "es" ? "DETALLES" : "GAME DETAILS",
      lang,
    }),
  });
}

async function leaderboard(m, sock, lang, gameId, period) {
  const rows = engine.getLeaderboard(gameId || null, period, 10);
  const scope = gameId ? gameName(gameId, lang) : L(lang, "ui.allGames");
  const medals = ["🥇", "🥈", "🥉"];
  const body = rows.length
    ? rows.map((r, i) => `${medals[i] || `${i + 1}.`} ${r.name || "—"} · ${L(lang, "ui.points", { n: r.points })} · ${L(lang, "ui.winsShort", { n: r.wins })}`).join("\n")
    : L(lang, "ui.empty");
  const periods = ["all", "week", "month"].filter((x) => x !== period);
  return sendCard(sock, m, {
    cardId: "arcade:top",
    lang,
    text: `*${L(lang, "ui.leaderboard", { scope })}*\n_${L(lang, `ui.period.${period}`)}_\n\n${body}`,
    buttons: periods.map((x) => ({ id: `${p(m)} top ${gameId || "all"} ${x}`, text: L(lang, `ui.period.${x}`) })).concat([{ id: p(m), text: L(lang, "ui.btn.menu") }]),
  });
}

async function stats(m, lang) {
  const s = engine.getStats(m.sender);
  const name = m.pushName || String(m.sender).split("@")[0];
  if (!s) return m.reply(`*${L(lang, "ui.stats", { name })}*\n\n${L(lang, "ui.empty")}`);
  const t = s.total;
  return m.reply([
    `*${L(lang, "ui.stats", { name })}*`,
    `> ${L(lang, "ui.played")}: *${t.played}* · ${L(lang, "ui.won")}: *${t.won}* · ${L(lang, "ui.lost_")}: *${t.lost}* · ${L(lang, "ui.drawn")}: *${t.draw}*`,
    `> ${L(lang, "ui.streak")}: *${t.streak}* · ${L(lang, "ui.best")}: *${t.best}*`,
    `> ${L(lang, "ui.achievements")}: *${(s.achievements || []).length}*`,
  ].join("\n"));
}

/** يبدأ لعبة: ضد الكمبيوتر · مع صديق (منشن/رد) · فردي · غرفة مفتوحة في المجموعة */
async function play(m, sock, lang, contract, args) {
  const vsAI = args.some((a) => /^(ai|bot|cpu|كمبيوتر|بوت)$/i.test(a)) || (!m.isGroup && contract.mode === "pvp" && contract.supportsAI && !(m.mentionedJid || []).length);
  const difficulty = args.map((a) => a.toUpperCase()).find((a) => DIFFS.includes(a)) || "NORMAL";
  const mentioned = (m.mentionedJid || []).filter((j) => j && j !== m.sender);
  const quoted = m.quoted?.sender && m.quoted.sender !== m.sender ? [m.quoted.sender] : [];
  const friends = vsAI ? [] : [...new Set([...mentioned, ...quoted])].slice(0, Math.max(0, contract.players.max - 1));
  const invite = friends.map((jid) => ({ jid, name: jid.split("@")[0] }));
  const res = engine.createRoom({ gameId: contract.id, chat: m.chat, isGroup: m.isGroup, host: who(m), vsAI, difficulty, invite, options: { difficulty, lang } });
  if (!res.ok) {
    // الغرفة الحالية بدل خطأ جاف
    if (res.code === "already-in-room") {
      await m.reply(errorText(lang, res));
      return sendRoom(sock, m, res.room, { lang });
    }
    return m.reply(errorText(lang, res));
  }
  if (invite.length) {
    const host = who(m).name;
    const names = invite.map((i) => `@${i.jid.split("@")[0]}`).join(" ");
    return sendCard(sock, m, {
      cardId: `arcade:challenge:${contract.id}`,
      lang,
      text: `${L(lang, "ui.challenge", { host, name: names, game: `${contract.icon} ${contract.name[lang]}` })}\n\n${L(lang, "ui.challengeHint")}`,
      buttons: [{ id: `${p(m)} accept ${res.room.roomId}`, text: L(lang, "ui.btn.accept") }, { id: `${p(m)} decline ${res.room.roomId}`, text: L(lang, "ui.btn.decline") }],
      mentions: friends,
    });
  }
  const opening = res.room.state === "PLAYING" ? { noteKey: "ui.started" } : { noteKey: "ui.created", vars: { game: contract.name[lang] } };
  return afterAction(sock, m, { ...res, events: [opening] }, lang);
}

async function roomVerb(m, sock, lang, verb, roomId, gameId = null) {
  // بلا معرّف: الانضمام لأحدث غرفة مفتوحة في الدردشة، وغيره لغرفة المرسل نفسه
  const open = ["join", "accept"].includes(verb);
  const room = roomId
    ? engine.getState(roomId)
    : open
      ? engine.findRoom({ chat: m.chat, gameId, states: ["WAITING", "READY"] })
      : engine.findRoom({ chat: m.chat, jid: m.sender, gameId, states: ["WAITING", "READY", "PLAYING", "PAUSED", "FINISHED"] });
  if (!room) return m.reply(L(lang, "ui.noActiveGame"));
  const me = who(m);
  let res;
  let note = "";
  switch (verb) {
    case "join": res = engine.joinRoom(room.roomId, me); note = L(lang, "ui.joined", { name: me.name }); break;
    case "accept": res = engine.joinRoom(room.roomId, me); note = L(lang, "ui.challengeAccepted", { name: me.name }); break;
    case "decline":
      res = engine.declineChallenge(room.roomId, me);
      return res.ok ? m.reply(L(lang, "ui.challengeDeclined", { name: me.name })) : m.reply(errorText(lang, res));
    case "start": res = engine.startGame(room.roomId, me); note = L(lang, "ui.started"); break;
    case "leave": res = engine.leaveRoom(room.roomId, me); note = L(lang, "ui.left", { name: me.name }); break;
    case "surrender": res = engine.surrender(room.roomId, me); break;
    case "pause": res = engine.pauseGame(room.roomId, me); note = L(lang, "ui.paused"); break;
    case "resume": res = engine.resumeGame(room.roomId, me); note = L(lang, "ui.resumed"); break;
    case "rematch":
      res = engine.rematch(room.roomId, me);
      if (res.ok && res.pending) return m.reply(L(lang, "ui.rematchPending", { names: res.pending.join("، ") }));
      break;
    case "board": res = { ok: true, room }; break;
    case "cancel": res = engine.cancelGame(room.roomId, me, { force: Boolean(m.isOwner) && room.hostId !== engine.idOf(m.sender) }); note = L(lang, "ui.cancelled"); break;
    default: return null;
  }
  if (!res.ok) return m.reply(errorText(lang, res));
  return sendRoom(sock, m, res.room, { note, lang });
}

async function arcadeCommand(m, sock, rawArgs = m.args || [], { gameId = null } = {}) {
  const lang = langOf(m);
  const args = rawArgs.map(String);
  const verb = (args[0] || "").toLowerCase();
  if (!verb) return menu(m, sock, lang);
  if (verb === "a" && args.length >= 4) {
    const built = actionFromButton(m, args[1], args[2], args[3]);
    if (built.error) return m.reply(errorText(lang, { code: built.error }));
    return afterAction(sock, m, await engine.applyAction(built.action), lang);
  }
  if (ROOM_VERBS.has(verb)) return roomVerb(m, sock, lang, verb, args[1], gameId);
  if (verb === "cat") return category(m, sock, lang, args[1]);
  if (verb === "html") return showcase(m, sock, lang);
  if (verb === "top") {
    const gameId = args[1] && args[1] !== "all" ? games.resolve(args[1])?.id : null;
    const period = ["week", "month"].includes(args[2] || args[1]) ? args[2] || args[1] : "all";
    return leaderboard(m, sock, lang, gameId, period);
  }
  if (verb === "stats") return stats(m, lang);
  const isInfo = verb === "info";
  const isPlay = verb === "play";
  const target = isInfo || isPlay ? args[1] : args[0];
  const contract = games.resolve(target);
  if (!contract || contract.legacy) {
    // ألعاب الأسئلة القديمة لها أوامرها الخاصة
    if (contract?.legacy) return m.reply(`${contract.icon} ${prefixOf(m)}${contract.legacyCommand}`);
    return menu(m, sock, lang);
  }
  if (isInfo) return details(m, sock, lang, contract);
  return play(m, sock, lang, contract, args.slice(isPlay ? 2 : 1));
}

/**
 * أمر لعبة قصير (.اكس_او · .ثعبان_وسلم …): في المجموعة ينضم لغرفة مفتوحة لنفس اللعبة إن وُجدت،
 * وإلا ينشئ غرفة/تحدياً/مباراة ضد الكمبيوتر بنفس منطق .اركيد.
 */
function quickCommand(gameId) {
  return async (m, { sock }) => {
    const args = (m.args || []).map(String);
    const contract = games.contractOf(gameId);
    // لعبة أسئلة لم يُمكن ترحيلها (بيانات غير كافية لأربعة خيارات) ⇒ رسالة صريحة،
    // لا سقوط صامت ولا محرك جلسات احتياطي. السبب في games.legacySkipped.
    if (!contract || contract.legacy) {
      return m.reply(L(langOf(m), "ui.err.unavailable", { game: gameId }));
    }
    const verb = (args[0] || "").toLowerCase();
    if (ROOM_VERBS.has(verb) || verb === "a") return arcadeCommand(m, sock, args, { gameId });
    const open = m.isGroup && !args.length && !(m.mentionedJid || []).length
      ? engine.findRoom({ chat: m.chat, gameId, states: ["WAITING", "READY"] })
      : null;
    if (open && !open.invites.length && open.players.length < contract.players.max && !open.players.some((pl) => pl.id === engine.idOf(m.sender))) {
      return arcadeCommand(m, sock, ["join", open.roomId]);
    }
    return arcadeCommand(m, sock, ["play", gameId, ...args]);
  };
}

export { DIFFS, arcadeCommand, quickCommand };
