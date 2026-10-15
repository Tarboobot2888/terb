// ═══════════════════════════════════════════════
// 📜 TERBOO ARCADE — عقد اللعبة الموحّد (Unified Game Contract)
// ───────────────────────────────────────────────
// كل لعبة (جديدة أو مُرحَّلة أو لعبة أسئلة قديمة على games.register) تُوصف بنفس العقد:
//   {id, name, aliases, category, mode, uiMode, players, supportsGroup, supportsPrivate,
//    supportsAI, supportsSolo, sessionType, stateSchema, actions, renderer, controller,
//    resultHandler, rewardPolicy, timeout, cooldown, permissions, localization, assets}
// controller = منطق نقي على حالة JSON (init · legalActions · apply · status · currentActor · parseInput)
// renderer   = view(state, viewer) ⇒ View Model واحد تُبنى منه HTML/Buttons/Text/Media.
// السجل الوحيد هو `games` في terboo-games.js (لا سجل موازٍ).
// ═══════════════════════════════════════════════

const UI_MODES = Object.freeze(["html", "buttons", "hybrid", "text", "media", "auto"]);
const CATEGORIES = Object.freeze(["board", "puzzle", "word", "quiz", "arcade", "party", "adventure"]);
const MODES = Object.freeze(["pvp", "solo", "party", "coop"]);
const SESSION_TYPES = Object.freeze(["turn", "simultaneous", "solo", "round"]);
const STATES = Object.freeze({
  WAITING: "WAITING",
  READY: "READY",
  PLAYING: "PLAYING",
  PAUSED: "PAUSED",
  FINISHED: "FINISHED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
});
const TERMINAL = new Set([STATES.FINISHED, STATES.CANCELLED, STATES.EXPIRED]);
const DIFFICULTIES = Object.freeze(["EASY", "NORMAL", "HARD", "EXPERT"]);

/** مفاتيح لا يحق للعميل إرسالها أبداً داخل payload (§ أمان الإجراءات) */
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "winner", "winners", "score", "scores", "balance", "koin", "exp", "energi", "reward", "rewards",
  "turn", "currentturn", "current_turn", "currentactor", "admin", "isadmin", "owner", "isowner",
  "state", "status", "actor", "players", "version", "result", "gameover", "over", "rank",
]);

const DEFAULT_REWARD = Object.freeze({ win: { koin: 300, exp: 120, energi: 1 }, draw: { koin: 100, exp: 50 }, solo: { koin: 150, exp: 80 }, loss: { exp: 20 } });

function fail(id, message) {
  throw new Error(`[arcade-contract] ${id || "?"}: ${message}`);
}

/**
 * يطبّع تعريف لعبة إلى العقد الكامل ويتحقق منه.
 * التعريف يكتب منطقه مباشرة (init/apply/...) والعقد يجمعه في controller/renderer.
 */
function defineGame(def) {
  const id = String(def?.id || "").trim();
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(id)) fail(id, "id يجب أن يكون لاتينياً صغيراً [a-z0-9_]");
  const uiMode = def.uiMode || "auto";
  if (!UI_MODES.includes(uiMode)) fail(id, `uiMode غير معروف: ${uiMode}`);
  const category = def.category || "arcade";
  if (!CATEGORIES.includes(category)) fail(id, `category غير معروف: ${category}`);
  const mode = def.mode || "pvp";
  if (!MODES.includes(mode)) fail(id, `mode غير معروف: ${mode}`);
  const sessionType = def.sessionType || (mode === "solo" ? "solo" : "turn");
  if (!SESSION_TYPES.includes(sessionType)) fail(id, `sessionType غير معروف: ${sessionType}`);
  const players = { min: def.players?.min ?? (mode === "solo" ? 1 : 2), max: def.players?.max ?? (mode === "solo" ? 1 : 2) };
  if (players.min < 1 || players.max < players.min) fail(id, "players غير صالح");
  for (const fn of ["init", "legalActions", "apply", "status", "view"]) {
    if (typeof def[fn] !== "function") fail(id, `الدالة ${fn} مطلوبة`);
  }
  const supportsAI = Boolean(def.ai) && def.supportsAI !== false;
  const contract = {
    id,
    name: def.name || { ar: id, en: id, es: id },
    // وصف اختياري على العقد. الاحتياط الحقيقي هو بنك النصوص `g.<id>.desc`،
    // ومن يعرضه يحلّه بـL() — فلا يُطبع مفتاح خام في أي واجهة.
    description: def.description || null,
    aliases: [...new Set([id, ...(def.aliases || [])].map((a) => String(a).toLowerCase()))],
    category,
    mode,
    uiMode,
    players,
    supportsGroup: def.supportsGroup !== false,
    supportsPrivate: def.supportsPrivate !== false,
    supportsAI,
    supportsSolo: def.supportsSolo ?? (mode === "solo" || supportsAI),
    sessionType,
    stateSchema: { version: def.stateVersion || 1, validate: typeof def.validateState === "function" ? def.validateState : null },
    actions: def.actions || [],
    controller: {
      init: def.init,
      legalActions: def.legalActions,
      apply: def.apply,
      status: def.status,
      currentActor: typeof def.currentActor === "function" ? def.currentActor : (state) => state.turn ?? 0,
      parseInput: typeof def.parseInput === "function" ? def.parseInput : null,
      onTimeout: typeof def.onTimeout === "function" ? def.onTimeout : null,
      // إجراءات بقيمة حرة (كلمة/رقم سري): لا تُعدَّد في legalActions بل يفحصها validateFree على حالة الخادم
      validateFree: typeof def.validateFree === "function" ? def.validateFree : null,
      turnTimeout: typeof def.turnTimeout === "function" ? def.turnTimeout : null,
    },
    freeActions: def.freeActions || [],
    // أزرار الحركة تُرسل لكل لاعب في الخاص (اختيار سري: حجر/ورقة/مقص · أدوار)
    privateActions: Boolean(def.privateActions),
    inputHint: def.inputHint || null,
    renderer: { view: def.view, board: def.board || "grid" },
    resultHandler: typeof def.resultHandler === "function" ? def.resultHandler : null,
    rewardPolicy: { ...DEFAULT_REWARD, ...(def.rewardPolicy || {}) },
    timeout: def.timeout ?? 120000,
    cooldown: def.cooldown ?? 5,
    permissions: { group: def.permissions?.group || "member", private: def.permissions?.private || "user" },
    localization: def.localization || ["ar", "en", "es"],
    assets: def.assets || {},
    ai: def.ai || null,
    icon: def.icon || "🎮",
    legacyCommand: def.legacyCommand || null,
  };
  return Object.freeze(contract);
}

/** عقد مُشتق لألعاب الأسئلة القديمة المسجّلة عبر games.register (بلا تغيير سلوكها) */
function legacyQuizContract(cfg) {
  return Object.freeze({
    id: cfg.gameType,
    name: { ar: cfg.title, en: cfg.title, es: cfg.title },
    aliases: [cfg.gameType, ...(cfg.alias || [])],
    category: "quiz",
    mode: "party",
    uiMode: "buttons",
    players: { min: 1, max: 64 },
    supportsGroup: true,
    supportsPrivate: true,
    supportsAI: false,
    supportsSolo: true,
    sessionType: "round",
    stateSchema: { version: 1, validate: null },
    actions: ["answer", "hint", "surrender"],
    controller: null,
    renderer: { view: null, board: "none" },
    resultHandler: null,
    rewardPolicy: cfg.rewards === false || cfg.rewards === null ? null : { win: cfg.rewards || "random" },
    timeout: cfg.timeout,
    cooldown: cfg.cooldown,
    permissions: { group: "member", private: "user" },
    localization: ["ar"],
    // اسم الحقل في ملف البيانات فقط (بيانات وصفية). سُمّي سابقاً `image` فأوهم
    // أنه صورة؛ لا يُرسل ولا يُحوَّل إلى بكسل في أي مسار.
    assets: cfg.hasImage ? { visualSourceField: cfg.imageField } : {},
    ai: null,
    icon: cfg.emoji,
    legacyCommand: cfg.gameType,
    legacy: true,
  });
}

export { CATEGORIES, DEFAULT_REWARD, DIFFICULTIES, FORBIDDEN_PAYLOAD_KEYS, MODES, SESSION_TYPES, STATES, TERMINAL, UI_MODES, defineGame, legacyQuizContract };
