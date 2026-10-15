// ═══════════════════════════════════════════════
// 🌐 TERBOO ARCADE — نصوص الواجهة (ar · en)
// ───────────────────────────────────────────────
// كل نص يراه اللاعب يأتي من هنا أو من كتلة STRINGS داخل ملف اللعبة نفسها
// (مسجّلة عبر register). كل مفتاح موجود باللغتين — يتحقق منه
// tests/terboo-arcade-engine.test.mjs (اكتمال الترجمة).
// أي كتلة es قديمة داخل STRINGS تُتجاهَل لأن es لم تعد ضمن اللغات.
// ═══════════════════════════════════════════════

const BANK = { ar: {}, en: {} };
const LANGS = Object.freeze(["ar", "en"]);

/** يسجّل نصوص مساحة (ns) بالثلاث لغات: register("g.xo", {ar:{...}, en:{...}, es:{...}}) */
function register(ns, strings) {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(strings[lang] || {})) BANK[lang][ns ? `${ns}.${key}` : key] = value;
  }
}

const norm = (lang) => (LANGS.includes(String(lang || "").slice(0, 2)) ? String(lang).slice(0, 2) : "ar");

/** نص بمتغيرات {name} — fallback: en ثم ar ثم المفتاح نفسه */
function L(lang, key, vars = {}) {
  const l = norm(lang);
  const raw = BANK[l][key] ?? BANK.en[key] ?? BANK.ar[key] ?? key;
  return String(raw).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

/** المفاتيح الناقصة في أي لغة (للاختبار) */
function missingKeys() {
  const all = new Set(LANGS.flatMap((l) => Object.keys(BANK[l])));
  const missing = [];
  for (const key of all) for (const l of LANGS) if (!(key in BANK[l])) missing.push(`${l}:${key}`);
  return missing;
}

register("ui", {
  ar: {
    brand: "TERBOO ARCADE",
    menuIntro: "اختر قسماً أو لعبة. كل الألعاب على محرك واحد: غرف · أدوار · خصم كمبيوتر · ترتيب.",
    "cat.board": "ألعاب لوحية", "cat.puzzle": "ألغاز ذهنية", "cat.word": "ألعاب كلمات", "cat.quiz": "أسئلة ومعلومات", "cat.arcade": "أركيد", "cat.party": "ألعاب جماعية", "cat.adventure": "مغامرات",
    "state.WAITING": "بانتظار لاعبين", "state.READY": "جاهزة للبدء", "state.PLAYING": "جارية", "state.PAUSED": "متوقفة مؤقتاً", "state.FINISHED": "انتهت", "state.CANCELLED": "أُلغيت", "state.EXPIRED": "انتهت مهلتها",
    turn: "الدور: {name}", yourTurn: "دورك يا {name}", players: "اللاعبون", spectators: "المشاهدون", waiting: "بانتظار لاعبين {n}/{max}", host: "المضيف",
    created: "تم إنشاء غرفة {game}.", joinHint: "للانضمام: اضغط «انضمام» أو اكتب {cmd}", joined: "{name} انضم للغرفة.", left: "{name} غادر الغرفة.", started: "بدأت اللعبة!", paused: "تم إيقاف اللعبة مؤقتاً.", resumed: "استؤنفت اللعبة.", cancelled: "أُلغيت الغرفة.", expired: "انتهت مهلة الغرفة.", hostNow: "المضيف الآن: {name}",
    win: "🏆 الفائز: {name}", winMany: "🏆 الفائزون: {names}", draw: "🤝 تعادل!", lost: "انتهت اللعبة.", solved: "🎉 أحسنت! أنهيت التحدي.", surrendered: "🏳️ {name} استسلم.", timedOut: "⏱️ انتهى وقت {name}.",
    reward: "🎁 {name}: {parts}", koin: "+{n} عملة", exp: "+{n} خبرة", energi: "+{n} طاقة", achievement: "🏅 إنجاز جديد لـ{name}: {title}", noReward: "(بلا مكافأة: الحد اليومي)",
    "btn.join": "➕ انضمام", "btn.start": "▶️ ابدأ", "btn.leave": "🚪 خروج", "btn.surrender": "🏳️ استسلام", "btn.pause": "⏸️ إيقاف", "btn.resume": "▶️ كمل", "btn.rematch": "🔁 إعادة", "btn.board": "🔄 اللوحة", "btn.leaderboard": "🏆 الترتيب", "btn.ai": "🤖 ضد الكمبيوتر", "btn.friend": "👥 مع صديق", "btn.solo": "🎯 العب الآن", "btn.accept": "✅ قبول", "btn.decline": "❌ رفض", "btn.menu": "🎮 قائمة الألعاب", "btn.details": "ℹ️ التفاصيل", "btn.stats": "📊 إحصاءاتي", "btn.moves": "🎯 الحركات",
    "diff.EASY": "سهل", "diff.NORMAL": "عادي", "diff.HARD": "صعب", "diff.EXPERT": "خبير", difficulty: "المستوى",
    chooseDifficulty: "اختر مستوى الكمبيوتر:", chooseMove: "اختر حركتك", moreMoves: "حركات أخرى",
    "err.unknown-game": "اللعبة غير موجودة.", "err.group-unsupported": "هذه اللعبة لا تُلعب في المجموعات.", "err.private-unsupported": "هذه اللعبة للمجموعات فقط.", "err.already-in-room": "أنت في غرفة {game} بالفعل. أنهها أو اكتب «استسلام».", "err.ai-unsupported": "هذه اللعبة لا تدعم اللعب ضد الكمبيوتر.", "err.needs-opponent": "في الخاص: العب ضد الكمبيوتر أو تحدَّ صديقاً بالمنشن.",
    "err.no-room": "لا توجد غرفة نشطة.", "err.not-joinable": "لا يمكن الانضمام لهذه الغرفة الآن.", "err.already-joined": "أنت في الغرفة بالفعل.", "err.room-full": "الغرفة ممتلئة.", "err.not-invited": "هذه الغرفة لمدعوين فقط.", "err.host-only": "هذا للمضيف فقط.", "err.not-startable": "لا يمكن البدء الآن.", "err.not-enough-players": "تحتاج {need} لاعبين على الأقل.", "err.not-ready": "ليس كل اللاعبين جاهزين.",
    "err.not-playing": "اللعبة ليست جارية.", "err.not-paused": "اللعبة ليست متوقفة.", "err.not-a-player": "أنت لست لاعباً في هذه الغرفة.", "err.not-in-room": "أنت لست في هذه الغرفة.", "err.duplicate": "تم تجاهل إجراء مكرر.", "err.stale": "هذه الأزرار قديمة — استعمل آخر لوحة.", "err.bad-nonce": "إجراء غير صالح.", "err.expired-action": "انتهت صلاحية الإجراء.", "err.not-your-turn": "ليس دورك.", "err.illegal": "حركة غير مسموحة.", "err.apply-failed": "تعذّر تنفيذ الحركة.", "err.finished": "اللعبة انتهت.", "err.not-started": "اللعبة لم تبدأ بعد.", "err.paused": "اللعبة متوقفة مؤقتاً.", "err.forbidden-field": "إجراء مرفوض.", "err.no-session": "الجلسة غير موجودة أو انتهت.", "err.session-mismatch": "إجراء لا يخص هذه اللعبة.", "err.not-finished": "اللعبة لم تنتهِ بعد.", "err.init-failed": "تعذّر تجهيز اللعبة.", "err.invalid-input": "إدخال غير مفهوم. {hint}", "err.generic": "تعذّر تنفيذ الطلب.", "err.unavailable": "هذه اللعبة غير متاحة حالياً (بيانات أسئلتها غير كافية).",
    challenge: "⚔️ {host} يتحدى {name} في {game}!", challengeHint: "اضغط «قبول» خلال دقيقتين.", challengeAccepted: "✅ {name} قبل التحدي.", challengeDeclined: "❌ {name} رفض التحدي.", challengeExpired: "⌛ انتهت مهلة التحدي.", noChallenge: "لا يوجد تحدٍّ بانتظارك.",
    leaderboard: "🏆 ترتيب {scope}", "period.all": "كل الأوقات", "period.week": "هذا الأسبوع", "period.month": "هذا الشهر", allGames: "كل الألعاب", empty: "لا توجد نتائج بعد.", points: "{n} نقطة", winsShort: "{n} فوز",
    stats: "📊 إحصاءات {name}", played: "لعب", won: "فوز", lost_: "خسارة", drawn: "تعادل", streak: "السلسلة", best: "الأفضل", achievements: "الإنجازات",
    details: "ℹ️ {game}", "mode.pvp": "لاعب ضد لاعب", "mode.solo": "فردي", "mode.party": "جماعي", "mode.coop": "تعاوني", playersRange: "{min}–{max} لاعبين", aiLevels: "خصم كمبيوتر: سهل · عادي · صعب · خبير", noAI: "بلا خصم كمبيوتر", uiMode: "العرض", "ui.html": "لوحة مرئية + أزرار", "ui.buttons": "أزرار", "ui.hybrid": "مرئي + أزرار", "ui.text": "نص", "ui.media": "صورة", "ui.auto": "تلقائي",
    howToPlay: "طريقة اللعب", typeHint: "يمكنك أيضاً كتابة الحركة: {hint}", privateMoves: "📩 أرسلت لك أزرار حركتك في الخاص.", privateFailed: "تعذّر الإرسال في الخاص — اكتب حركتك هنا.", aiThinking: "🤖 الكمبيوتر لعب: {move}", round: "الجولة {n}/{total}", score: "النقاط", lives: "المحاولات", time: "الوقت",
    menuTitle: "🎮 TERBOO ARCADE", gamesCount: "{n} لعبة", pickGame: "اختر لعبة", sectionGames: "ألعاب {cat}", footer: "TERBOO ARCADE · Bot Terboo", rematchPending: "🔁 بانتظار موافقة: {names}", noActiveGame: "لا توجد لعبة جارية لك هنا.", quizHint: "A / B / C / D",
  },
  en: {
    brand: "TERBOO ARCADE",
    menuIntro: "Pick a section or a game. Every game runs on one engine: rooms · turns · computer opponents · leaderboards.",
    "cat.board": "Board games", "cat.puzzle": "Brain puzzles", "cat.word": "Word games", "cat.quiz": "Quiz & trivia", "cat.arcade": "Arcade", "cat.party": "Party games", "cat.adventure": "Adventures",
    "state.WAITING": "Waiting for players", "state.READY": "Ready to start", "state.PLAYING": "In progress", "state.PAUSED": "Paused", "state.FINISHED": "Finished", "state.CANCELLED": "Cancelled", "state.EXPIRED": "Expired",
    turn: "Turn: {name}", yourTurn: "Your turn, {name}", players: "Players", spectators: "Spectators", waiting: "Waiting for players {n}/{max}", host: "Host",
    created: "{game} room created.", joinHint: "To join: tap “Join” or type {cmd}", joined: "{name} joined the room.", left: "{name} left the room.", started: "Game started!", paused: "Game paused.", resumed: "Game resumed.", cancelled: "Room cancelled.", expired: "Room expired.", hostNow: "Host is now: {name}",
    win: "🏆 Winner: {name}", winMany: "🏆 Winners: {names}", draw: "🤝 It's a draw!", lost: "Game over.", solved: "🎉 Well done! Challenge complete.", surrendered: "🏳️ {name} surrendered.", timedOut: "⏱️ {name} ran out of time.",
    reward: "🎁 {name}: {parts}", koin: "+{n} coins", exp: "+{n} XP", energi: "+{n} energy", achievement: "🏅 New achievement for {name}: {title}", noReward: "(no reward: daily cap)",
    "btn.join": "➕ Join", "btn.start": "▶️ Start", "btn.leave": "🚪 Leave", "btn.surrender": "🏳️ Surrender", "btn.pause": "⏸️ Pause", "btn.resume": "▶️ Resume", "btn.rematch": "🔁 Rematch", "btn.board": "🔄 Board", "btn.leaderboard": "🏆 Leaderboard", "btn.ai": "🤖 Vs computer", "btn.friend": "👥 With a friend", "btn.solo": "🎯 Play now", "btn.accept": "✅ Accept", "btn.decline": "❌ Decline", "btn.menu": "🎮 Games menu", "btn.details": "ℹ️ Details", "btn.stats": "📊 My stats", "btn.moves": "🎯 Moves",
    "diff.EASY": "Easy", "diff.NORMAL": "Normal", "diff.HARD": "Hard", "diff.EXPERT": "Expert", difficulty: "Level",
    chooseDifficulty: "Choose the computer level:", chooseMove: "Choose your move", moreMoves: "More moves",
    "err.unknown-game": "Game not found.", "err.group-unsupported": "This game can't be played in groups.", "err.private-unsupported": "This game is for groups only.", "err.already-in-room": "You're already in a {game} room. Finish it or type “surrender”.", "err.ai-unsupported": "This game has no computer opponent.", "err.needs-opponent": "In private: play the computer or challenge a friend by mention.",
    "err.no-room": "No active room.", "err.not-joinable": "This room can't be joined now.", "err.already-joined": "You're already in the room.", "err.room-full": "The room is full.", "err.not-invited": "This room is invite-only.", "err.host-only": "Host only.", "err.not-startable": "Can't start right now.", "err.not-enough-players": "At least {need} players are needed.", "err.not-ready": "Not every player is ready.",
    "err.not-playing": "The game isn't running.", "err.not-paused": "The game isn't paused.", "err.not-a-player": "You're not a player in this room.", "err.not-in-room": "You're not in this room.", "err.duplicate": "Duplicate action ignored.", "err.stale": "Those buttons are old — use the latest board.", "err.bad-nonce": "Invalid action.", "err.expired-action": "The action expired.", "err.not-your-turn": "Not your turn.", "err.illegal": "That move isn't allowed.", "err.apply-failed": "Couldn't apply the move.", "err.finished": "The game is over.", "err.not-started": "The game hasn't started yet.", "err.paused": "The game is paused.", "err.forbidden-field": "Action rejected.", "err.no-session": "Session not found or finished.", "err.session-mismatch": "That action belongs to another game.", "err.not-finished": "The game isn't over yet.", "err.init-failed": "Couldn't prepare the game.", "err.invalid-input": "I didn't understand that. {hint}", "err.generic": "Couldn't complete the request.", "err.unavailable": "This game is unavailable right now (not enough question data).",
    challenge: "⚔️ {host} challenges {name} to {game}!", challengeHint: "Tap “Accept” within two minutes.", challengeAccepted: "✅ {name} accepted the challenge.", challengeDeclined: "❌ {name} declined the challenge.", challengeExpired: "⌛ The challenge expired.", noChallenge: "No challenge is waiting for you.",
    leaderboard: "🏆 {scope} leaderboard", "period.all": "All time", "period.week": "This week", "period.month": "This month", allGames: "All games", empty: "No results yet.", points: "{n} pts", winsShort: "{n} wins",
    stats: "📊 {name}'s stats", played: "Played", won: "Won", lost_: "Lost", drawn: "Draws", streak: "Streak", best: "Best", achievements: "Achievements",
    details: "ℹ️ {game}", "mode.pvp": "Player vs player", "mode.solo": "Solo", "mode.party": "Party", "mode.coop": "Co-op", playersRange: "{min}–{max} players", aiLevels: "Computer opponent: easy · normal · hard · expert", noAI: "No computer opponent", uiMode: "Display", "ui.html": "Visual board + buttons", "ui.buttons": "Buttons", "ui.hybrid": "Visual + buttons", "ui.text": "Text", "ui.media": "Image", "ui.auto": "Automatic",
    howToPlay: "How to play", typeHint: "You can also type the move: {hint}", privateMoves: "📩 I sent your move buttons in private.", privateFailed: "Couldn't message you privately — type your move here.", aiThinking: "🤖 Computer played: {move}", round: "Round {n}/{total}", score: "Score", lives: "Lives", time: "Time",
    menuTitle: "🎮 TERBOO ARCADE", gamesCount: "{n} games", pickGame: "Pick a game", sectionGames: "{cat}", footer: "TERBOO ARCADE · Bot Terboo", rematchPending: "🔁 Waiting for: {names}", noActiveGame: "You have no running game here.", quizHint: "A / B / C / D",
  },
  es: {
    brand: "TERBOO ARCADE",
    menuIntro: "Elige una sección o un juego. Todos usan un mismo motor: salas · turnos · rival computadora · clasificaciones.",
    "cat.board": "Juegos de tablero", "cat.puzzle": "Rompecabezas", "cat.word": "Juegos de palabras", "cat.quiz": "Preguntas y cultura", "cat.arcade": "Arcade", "cat.party": "Juegos en grupo", "cat.adventure": "Aventuras",
    "state.WAITING": "Esperando jugadores", "state.READY": "Lista para empezar", "state.PLAYING": "En curso", "state.PAUSED": "En pausa", "state.FINISHED": "Terminada", "state.CANCELLED": "Cancelada", "state.EXPIRED": "Expirada",
    turn: "Turno: {name}", yourTurn: "Tu turno, {name}", players: "Jugadores", spectators: "Espectadores", waiting: "Esperando jugadores {n}/{max}", host: "Anfitrión",
    created: "Sala de {game} creada.", joinHint: "Para unirte: pulsa «Unirse» o escribe {cmd}", joined: "{name} se unió a la sala.", left: "{name} salió de la sala.", started: "¡Empezó el juego!", paused: "Juego en pausa.", resumed: "Juego reanudado.", cancelled: "Sala cancelada.", expired: "La sala expiró.", hostNow: "Ahora el anfitrión es: {name}",
    win: "🏆 Ganador: {name}", winMany: "🏆 Ganadores: {names}", draw: "🤝 ¡Empate!", lost: "Fin del juego.", solved: "🎉 ¡Bien hecho! Reto completado.", surrendered: "🏳️ {name} se rindió.", timedOut: "⏱️ A {name} se le acabó el tiempo.",
    reward: "🎁 {name}: {parts}", koin: "+{n} monedas", exp: "+{n} XP", energi: "+{n} energía", achievement: "🏅 Nuevo logro para {name}: {title}", noReward: "(sin premio: límite diario)",
    "btn.join": "➕ Unirse", "btn.start": "▶️ Empezar", "btn.leave": "🚪 Salir", "btn.surrender": "🏳️ Rendirse", "btn.pause": "⏸️ Pausa", "btn.resume": "▶️ Seguir", "btn.rematch": "🔁 Revancha", "btn.board": "🔄 Tablero", "btn.leaderboard": "🏆 Clasificación", "btn.ai": "🤖 Contra la computadora", "btn.friend": "👥 Con un amigo", "btn.solo": "🎯 Jugar ya", "btn.accept": "✅ Aceptar", "btn.decline": "❌ Rechazar", "btn.menu": "🎮 Menú de juegos", "btn.details": "ℹ️ Detalles", "btn.stats": "📊 Mis estadísticas", "btn.moves": "🎯 Jugadas",
    "diff.EASY": "Fácil", "diff.NORMAL": "Normal", "diff.HARD": "Difícil", "diff.EXPERT": "Experto", difficulty: "Nivel",
    chooseDifficulty: "Elige el nivel de la computadora:", chooseMove: "Elige tu jugada", moreMoves: "Más jugadas",
    "err.unknown-game": "Juego no encontrado.", "err.group-unsupported": "Este juego no se juega en grupos.", "err.private-unsupported": "Este juego es solo para grupos.", "err.already-in-room": "Ya estás en una sala de {game}. Termínala o escribe «rendirse».", "err.ai-unsupported": "Este juego no tiene rival computadora.", "err.needs-opponent": "En privado: juega contra la computadora o reta a un amigo con una mención.",
    "err.no-room": "No hay sala activa.", "err.not-joinable": "No puedes unirte a esta sala ahora.", "err.already-joined": "Ya estás en la sala.", "err.room-full": "La sala está llena.", "err.not-invited": "Esta sala es solo con invitación.", "err.host-only": "Solo el anfitrión.", "err.not-startable": "No se puede empezar ahora.", "err.not-enough-players": "Se necesitan al menos {need} jugadores.", "err.not-ready": "No todos los jugadores están listos.",
    "err.not-playing": "El juego no está en curso.", "err.not-paused": "El juego no está en pausa.", "err.not-a-player": "No eres jugador en esta sala.", "err.not-in-room": "No estás en esta sala.", "err.duplicate": "Acción duplicada ignorada.", "err.stale": "Esos botones son viejos — usa el último tablero.", "err.bad-nonce": "Acción no válida.", "err.expired-action": "La acción expiró.", "err.not-your-turn": "No es tu turno.", "err.illegal": "Esa jugada no está permitida.", "err.apply-failed": "No se pudo aplicar la jugada.", "err.finished": "El juego terminó.", "err.not-started": "El juego aún no empieza.", "err.paused": "El juego está en pausa.", "err.forbidden-field": "Acción rechazada.", "err.no-session": "Sesión no encontrada o terminada.", "err.session-mismatch": "Esa acción es de otro juego.", "err.not-finished": "El juego aún no termina.", "err.init-failed": "No se pudo preparar el juego.", "err.invalid-input": "No entendí eso. {hint}", "err.generic": "No se pudo completar la solicitud.", "err.unavailable": "Este juego no está disponible ahora (faltan datos de preguntas).",
    challenge: "⚔️ ¡{host} reta a {name} a {game}!", challengeHint: "Pulsa «Aceptar» en menos de dos minutos.", challengeAccepted: "✅ {name} aceptó el reto.", challengeDeclined: "❌ {name} rechazó el reto.", challengeExpired: "⌛ El reto expiró.", noChallenge: "No tienes retos pendientes.",
    leaderboard: "🏆 Clasificación de {scope}", "period.all": "Histórica", "period.week": "Esta semana", "period.month": "Este mes", allGames: "todos los juegos", empty: "Aún no hay resultados.", points: "{n} pts", winsShort: "{n} victorias",
    stats: "📊 Estadísticas de {name}", played: "Jugadas", won: "Ganadas", lost_: "Perdidas", drawn: "Empates", streak: "Racha", best: "Mejor", achievements: "Logros",
    details: "ℹ️ {game}", "mode.pvp": "Jugador contra jugador", "mode.solo": "Individual", "mode.party": "En grupo", "mode.coop": "Cooperativo", playersRange: "{min}–{max} jugadores", aiLevels: "Rival computadora: fácil · normal · difícil · experto", noAI: "Sin rival computadora", uiMode: "Vista", "ui.html": "Tablero visual + botones", "ui.buttons": "Botones", "ui.hybrid": "Visual + botones", "ui.text": "Texto", "ui.media": "Imagen", "ui.auto": "Automático",
    howToPlay: "Cómo jugar", typeHint: "También puedes escribir la jugada: {hint}", privateMoves: "📩 Te envié los botones de tu jugada en privado.", privateFailed: "No pude escribirte en privado — escribe tu jugada aquí.", aiThinking: "🤖 La computadora jugó: {move}", round: "Ronda {n}/{total}", score: "Puntos", lives: "Vidas", time: "Tiempo",
    menuTitle: "🎮 TERBOO ARCADE", gamesCount: "{n} juegos", pickGame: "Elige un juego", sectionGames: "{cat}", footer: "TERBOO ARCADE · Bot Terboo", rematchPending: "🔁 Esperando a: {names}", noActiveGame: "No tienes un juego en curso aquí.", quizHint: "A / B / C / D",
  },
});

export { LANGS, L, missingKeys, norm, register };
