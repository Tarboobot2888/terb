import { noteFailure } from "./lib/terboo-failure-log.js";
import config from "../config.js";
import { isSelf } from "../config.js";
import { generateWAMessageFromContent, prepareWAMessageMedia } from "@whiskeysockets/baileys";
import { serialize, getCachedThumb, parseCommand } from "./lib/terboo-serialize.js";
import { saluranCtx } from "./lib/terboo-context.js";
import {
  getPlugin,
  getPluginCount,
  getAllPlugins,
  pluginStore,
  getAllCommandNames,
} from "./lib/terboo-plugins.js";
import {
  findSimilarCommands,
  formatSuggestionMessage,
} from "./lib/terboo-similarity.js";
import { getDatabase } from "./lib/terboo-database.js";
import {
  formatUptime,
  createWaitMessage,
  createErrorMessage,
} from "./lib/terboo-formatter.js";
import { getUptime } from "./connection.js";
import { logger, logMessage, c } from "./lib/terboo-logger.js";
import {
  isLid,
  isLidConverted,
  lidToJid,
  convertLidArray,
  resolveAnyLidToJid,
  cacheParticipantLids,
  savePersistentCache,
  getLidCacheSize,
} from "./lib/terboo-lid.js";
import { hasActiveSession, getSession } from "./lib/terboo-game-data.js";
import {
  levenshtein,
  formatAfkDuration,
  checkPermission,
  checkMode,
} from "./lib/terboo-middleware.js";
import {
  handleAntilink,
  handleAntiJudol,
  handleAntiPhising,
  handleAntiCustom,
  handleAntiRemove,
  handleAntiRemoveFromUpsert,
  cacheMessageForAntiRemove,
  handleAntilinkGc,
  handleAntilinkAll,
  handleAntiHidetag,
  handleAntiSwGc,
} from "./lib/terboo-group-protection.js";
import {
  debounceMessage,
  getCachedUser,
  getCachedGroup,
  getCachedSetting,
} from "./lib/terboo-performance.js";
import {
  isJadibotOwner,
  isJadibotPremium,
  loadJadibotDb,
} from "./lib/terboo-jadibot-database.js";
import { isTrustedBot } from "../plugins/owner/بوت_رئيسي.js";
import { getActiveJadibots } from "./lib/terboo-jadibot-manager.js";
import { isKnownBotSender, shouldReplyAsBot } from "./lib/terboo-bot-loop-guard.js";
import { handleCommand as handleCaseCommand } from "../case/terboo.js";
import { handleOnboarding } from "./lib/terboo-onboarding.js";
import { handleFlowInput } from "./lib/terboo-flow.js";
import { noteSeen as noteGroupMemberSeen } from "./lib/terboo-group-directory.js";
import { applyInteractive, isInteractiveType, logFailure as logInteractiveFailure, REASON as PRESS_REASON } from "./lib/terboo-interactive.js";
import { localizeCommandArgs } from "./lib/terboo-i18n/args.js";
import { getUserLanguage, t } from "./lib/terboo-localization.js";
import * as UI from "./lib/terboo-ui-theme.js";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { botEvents } from "./lib/terboo-events.js";
import { games as terbooGames } from "./lib/terboo-games.js";
import { hasArcadeRoom } from "./lib/terboo-arcade/whatsapp.js";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import axios from "axios";
import * as timeHelper from "./lib/terboo-time.js";
import { checkAutoReact } from "../plugins/fun/تفاعل.js";
/** أنواع الرسائل الناتجة عن ضغط زر أو اختيار من قائمة */
const BUTTON_RESPONSE_TYPES = new Set([
  "buttonsResponseMessage",
  "listResponseMessage",
  "templateButtonReplyMessage",
  "interactiveResponseMessage",
  "nativeFlowResponseMessage",
]);

const safe = (fn) => {
  try {
    return fn();
  } catch (error) { noteFailure("handler", error, {where: "src/handler.js:97",stage: "fn"}); return null; }
};

let FormData,
  levelHelper,
  handleBuyerDone,
  registrationAnswerHandler,
  dungeonAnswerHandler,
  kyubigameAnswerHandler,
  pushkontakAnswerHandler,
  anticustomReplyHandler,
  dafontAnswerHandler,
  gantiAssetAnswerHandler,
  srtAnswerHandler,
  checkAfk,
  isMuted,
  detectBot,
  autoStickerHandler,
  autoMediaHandler,
  checkAntidocument,
  checkAntisticker,
  checkAntimedia,
  ytmp4Plugin,
  confessPlugin,
  sulapPlugin,
  handleAutoAI,
  handleAiAssistant,
  handleAutoDownload,
  checkStickerCommand,
  sendWelcomeMessage,
  sendGoodbyeMessage,
  autoJoinDetector,
  isMutedMember,
  isMutegc;

try {
  FormData = (await import("form-data")).default || (await import("form-data"));
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:136",stage: "import:form-data"}); }
try {
  levelHelper = await import("./lib/terboo-level.js");
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:139",stage: "import:terboo-level"}); }
try {
  handleBuyerDone = (await import("../plugins/store/تم.js")).handleBuyerDone;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:142",stage: "import:تم"}); }
try {
  registrationAnswerHandler = (await import("../plugins/user/daftar.js"))
    .registrationAnswerHandler;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:146",stage: "import:daftar"}); }
try {
  dungeonAnswerHandler = (await import("../plugins/game/دنجن.js"))
    .dungeonAnswerHandler;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:150",stage: "import:دنجن"}); }
try {
  kyubigameAnswerHandler = (await import("../plugins/game/نينجا.js"))
    .kyubigameAnswerHandler;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:154",stage: "import:نينجا"}); }
try {
  pushkontakAnswerHandler = (
    await import("../plugins/pushkontak/دفع_جهات_الاتصال.js")
  ).pushkontakAnswerHandler;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:159",stage: "import:دفع_جهات_الاتصال"}); }
try {
  anticustomReplyHandler = (await import("../plugins/group/منع_مخصص.js"))
    .replyHandler;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:163",stage: "import:منع_مخصص"}); }
try {
  dafontAnswerHandler = (await import("../plugins/tools/دافونت.js"))
    .dafontAnswerHandler;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:167",stage: "import:دافونت"}); }
try {
  gantiAssetAnswerHandler = (await import("../plugins/owner/ganti-asset.js"))
    .gantiAssetAnswerHandler;
  srtAnswerHandler = (await import("../plugins/owner/خلط_الصور.js"))
    .srtAnswerHandler;
} catch (e) { noteFailure("handler", e, {where: "src/handler.js:173",stage: "import:ganti-asset"}); }
try {
  checkAfk = (await import("../plugins/group/مشغول.js")).checkAfk;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:176",stage: "import:مشغول"}); }
try {
  isMuted = (await import("../plugins/group/كتم.js")).isMuted;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:179",stage: "import:كتم"}); }
try {
  isMutedMember = (await import("../plugins/group/mutemember.js"))
    .isMutedMember;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:183",stage: "import:mutemember"}); }
try {
  isMutegc = (await import("../plugins/group/mutegc.js")).isMutegc;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:186",stage: "import:mutegc"}); }
try {
  detectBot = (await import("../plugins/group/منع_البوتات.js")).detectBot;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:189",stage: "import:منع_البوتات"}); }
try {
  autoStickerHandler = (await import("../plugins/group/ملصق_تلقائي.js"))
    .autoStickerHandler;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:193",stage: "import:ملصق_تلقائي"}); }
try {
  autoMediaHandler = (await import("../plugins/group/تحويل_تلقائي.js"))
    .autoMediaHandler;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:197",stage: "import:تحويل_تلقائي"}); }
try {
  checkAntidocument = (await import("../plugins/group/منع_المستندات.js"))
    .checkAntidocument;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:201",stage: "import:منع_المستندات"}); }
try {
  checkAntisticker = (await import("../plugins/group/منع_الملصقات.js"))
    .checkAntisticker;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:205",stage: "import:منع_الملصقات"}); }
try {
  checkAntimedia = (await import("../plugins/group/منع_الوسائط.js"))
    .checkAntimedia;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:209",stage: "import:منع_الوسائط"}); }
try {
  ytmp4Plugin = await import("../plugins/downloader/يوت_فيديو.js");
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:212",stage: "import:يوت_فيديو"}); }
try {
  confessPlugin = await import("../plugins/fun/مصارحة.js");
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:215",stage: "import:مصارحة"}); }
try {
  sulapPlugin = await import("../plugins/fun/خدعة.js");
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:218",stage: "import:خدعة"}); }
try {
  handleAutoAI = (await import("./lib/terboo-auto-ai.js")).handleAutoAI;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:221",stage: "import:terboo-auto-ai"}); }
try {
  handleAiAssistant = (await import("./lib/terboo-ai-assistant.js")).handleAiAssistant;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:224",stage: "import:terboo-ai-assistant"}); }
try {
  handleAutoDownload = (await import("./lib/terboo-auto-download.js"))
    .handleAutoDownload;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:228",stage: "import:terboo-auto-download"}); }
try {
  checkStickerCommand = (await import("./lib/terboo-sticker-command.js"))
    .checkStickerCommand;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:232",stage: "import:terboo-sticker-command"}); }
try {
  sendWelcomeMessage = (await import("../plugins/group/ترحيب.js"))
    .sendWelcomeMessage;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:236",stage: "import:ترحيب"}); }
try {
  sendGoodbyeMessage = (await import("../plugins/group/وداع.js"))
    .sendGoodbyeMessage;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:240",stage: "import:وداع"}); }
try {
  autoJoinDetector = (await import("../plugins/owner/انضمام_تلقائي.js"))
    .autoJoinDetector;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:244",stage: "import:انضمام_تلقائي"}); }

let checkSpam = null,
  handleSpamAction = null;
try {
  const m = await import("../plugins/group/منع_الازعاج.js");
  checkSpam = m.checkSpam;
  handleSpamAction = m.handleSpamAction;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:252",stage: "import:منع_الازعاج"}); }

let checkSlowmode = null,
  incrementChatCount = null;
try {
  checkSlowmode = (await import("../plugins/group/بطء.js")).checkSlowmode;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:258",stage: "import:بطء"}); }
try {
  incrementChatCount = (await import("../plugins/group/إحصاء_الرسائل.js"))
    .incrementChatCount;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:262",stage: "import:إحصاء_الرسائل"}); }

let isToxic = null,
  handleToxicMessage = null;
try {
  const m = await import("../plugins/group/منع_الكلمات.js");
  isToxic = m.isToxic;
  handleToxicMessage = m.handleToxicMessage;
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:270",stage: "import:منع_الكلمات"}); }

const spamDelayTracker = new Map();

const globalLoadLimiter = new RateLimiterMemory({
  points: 100, // 100 طلب في الدقيقة كحد أقصى للبوت بالكامل
  duration: 60,
});
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of spamDelayTracker) {
    if (now - v > 15000) spamDelayTracker.delete(k);
  }
}, 30000);

let _smartTriggerThumb = undefined;
async function getSmartTriggerThumb() {
  if (_smartTriggerThumb !== undefined) return _smartTriggerThumb;
  try {
    const url = config.assets["terboo2"];
    if (url) {
      _smartTriggerThumb = fs.readFileSync(url)
    } else {
      _smartTriggerThumb = null;
    }
  } catch {
    _smartTriggerThumb = null;
  }
  return _smartTriggerThumb;
}

const commandRateLimiter = new RateLimiterMemory({
  points: 8,
  duration: 3,
  blockDuration: 2,
});

const cachedGamePlugins = new Map();

try {
  const gameDir = path.join(process.cwd(), "plugins", "game");
  const gameFiles = fs
    .readdirSync(gameDir)
    .filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  for (const file of gameFiles) {
    try {
      const plugin = await import(`../plugins/game/${file}`);
      const name = file.replace(".js", "");
      if (plugin.answerHandler) cachedGamePlugins.set(name, plugin);
    } catch (error) { noteFailure("handler", error, {where: "src/handler.js:319",stage: "import:${file}"}); }
  }
} catch (error) { noteFailure("handler", error, {where: "src/handler.js:321",stage: "import:${file}"}); }

async function handleGameAnswer(m, sock) {
  try {
    if (sulapPlugin?.answerHandler) {
      const handled = await sulapPlugin.answerHandler(m, sock);
      if (handled) return true;
    }

    // TERBOO ARCADE: كل ألعاب المحرك الموحّد (إكس أو · ثعبان وسلم · حجرة ورقة مقص · الألعاب الجديدة)
    // تلتقط حركاتها المكتوبة من answerHandler واحد. (المفاتيح القديمة tictactoe/ulartangga/suitpvp
    // لم تطابق أسماء الملفات العربية فلم تصل حركاتها أبداً — انظر docs/TERBOO_GAME_FORENSIC_AUDIT.md)
    const arcadePlugin = cachedGamePlugins.get('اركيد');
    if (arcadePlugin?.answerHandler && hasArcadeRoom(m)) {
      if (await arcadePlugin.answerHandler(m, sock)) return true;
    }

    if (!hasActiveSession(m.chat)) return false;

    const session = getSession(m.chat);
    if (!session) return false;

    const targeted = cachedGamePlugins.get(session.gameType);
    if (targeted) {
      const handled = await targeted.answerHandler(m, sock);
      if (handled) return true;
    }
  } catch (error) { noteFailure("handler", error, {where: "src/handler.js:355",stage: "sulapPlugin.answerHandler"}); }
  return false;
}

async function handleSmartTriggers(m, sock, db) {
  if (!m.body) return false;

  const text = m.body.trim().toLowerCase();

  const firstWord = text.split(" ")[0];
  if (
    /^[\.\/\!\#\-]?(autoreply|ar|smarttrigger|smarttriggers)$/.test(firstWord)
  ) {
    return false;
  }

  if (text === "done") {
    const sessions = db.setting("transactionSessions") || {};
    if (sessions[m.sender]) {
      try {
        if (handleBuyerDone) {
          const session = sessions[m.sender];
          await handleBuyerDone(m, sock, session);
          delete sessions[m.sender];
          db.setting("transactionSessions", sessions);
          await db.save();
          return true;
        }
      } catch (e) {
        console.error("[Handler] Done trigger error:", e.message);
      }
    }
  }

  const globalSmartTriggers =
    db.setting("smartTriggers") ?? config.features?.smartTriggers ?? false;

  try {
    const saluranId = config.saluran?.id || "120363418715609508@newsletter";
    const saluranName = config.saluran?.name || config.bot?.name || "Bot Terboo";
    const botName = config.bot?.name || "Bot Terboo";

    let isAutoreplyEnabled = globalSmartTriggers;

    const processCustomReply = async (replyItem) => {
      let replyText = (replyItem.reply || "")
        .replace(/{name}/g, m.pushName || "User")
        .replace(/{tag}/g, `@${m.sender.split("@")[0]}`)
        .replace(/{sender}/g, m.sender.split("@")[0])
        .replace(/{botname}/g, config.bot?.name || "Bot")
        .replace(/{time}/g, timeHelper.formatTime("HH:mm:ss"))
        .replace(/{date}/g, timeHelper.formatDate("DD MMMM YYYY"));

      const mentions = replyText.includes(`@${m.sender.split("@")[0]}`)
        ? [m.sender]
        : [];

      if (replyItem.image && fs.existsSync(replyItem.image)) {
        const imageBuffer = fs.readFileSync(replyItem.image);
        await sock.sendMedia(m.chat, imageBuffer, replyText, m, {
          mentions: mentions,
          type: "image",
        });
      } else {
        await m.reply(replyText, { mentions: mentions });
      }
      return true;
    };

    if (m.isGroup) {
      const groupData = db.getGroup(m.chat) || {};
      isAutoreplyEnabled = groupData.autoreply ?? globalSmartTriggers;

      if (isAutoreplyEnabled) {
        let customReplies = groupData.customReplies || [];
        if (!Array.isArray(customReplies)) {
          customReplies = [];
          db.setGroup(m.chat, { customReplies });
        }
        for (const replyItem of customReplies) {
          if (!replyItem?.trigger) continue;
          if (text === replyItem.trigger || text.includes(replyItem.trigger)) {
            return await processCustomReply(replyItem);
          }
        }

        const globalCustomReplies = db.setting("globalCustomReplies") || [];
        for (const replyItem of globalCustomReplies) {
          if (!replyItem?.trigger) continue;
          if (text === replyItem.trigger || text.includes(replyItem.trigger)) {
            return await processCustomReply(replyItem);
          }
        }
      }
    } else {
      const privateAutoreply = db.setting("autoreplyPrivate") ?? false;
      if (!privateAutoreply && !globalSmartTriggers) return false;
      isAutoreplyEnabled = privateAutoreply || globalSmartTriggers;

      if (isAutoreplyEnabled) {
        const globalCustomReplies = db.setting("globalCustomReplies") || [];
        for (const replyItem of globalCustomReplies) {
          if (!replyItem?.trigger) continue;
          if (text === replyItem.trigger || text.includes(replyItem.trigger)) {
            return await processCustomReply(replyItem);
          }
        }
      }
    }

    if (!isAutoreplyEnabled) return false;

    const botJid = sock.user?.id;
    const isMentioned = m.mentionedJid?.some(
      (jid) => jid === botJid || jid?.includes(sock.user?.id?.split(":")[0]),
    );

    const thumbBuffer = await getSmartTriggerThumb();
    const contextInfos = saluranCtx();

    if (isMentioned) {
      const replyDecision = shouldReplyAsBot(m, sock);
      if (!replyDecision.allowed) {
        if (replyDecision.reason === "rate-limit") await m.react("🤖").catch((error) => { noteFailure("handler", error, {where: "src/handler.js:478",stage: "m.react"}); });
        return true;
      }
      await m.reply(
        `*❋ Bot Terboo*
> ◈ أهلاً @${m.sender.split("@")[0]}، أنا حاضر.
> ◈ اكتب طلبك بوضوح أو أرسل أمراً يبدأ بالبادئة.
*❋ كيف أساعدك الآن؟*

> Bot Terboo`,
        { mentions: [m.sender] },
      );
      return true;
    }

    if (text?.toLowerCase() === "بوت") {
      await m.reply(`مرحباً @${m.sender.split("@")[0]}، ${botName} نشط ✅`, {
        mentions: [m.sender],
      });
      return true;
    }

    if (text?.toLowerCase()?.includes("السلام عليكم")) {
      await m.reply(`وعليكم السلام @${m.sender.split("@")[0]}`, {
        mentions: [m.sender],
      });
      return true;
    }

    if (text?.toLowerCase()?.includes("هلا") || text?.toLowerCase()?.includes("مرحبا")) {
      await m.reply(`أهلاً بك @${m.sender.split("@")[0]}`, {
        mentions: [m.sender],
      });
      return true;
    }
  } catch (error) {
    console.error("[SmartTriggers] Error:", error.message);
  }

  return false;
}

async function isSpamming(jid) {
  if (!config.features?.antiSpam) return false;

  try {
    await commandRateLimiter.consume(jid);
    return false;
  } catch (error) { noteFailure("handler", error, {where: "src/handler.js:526",stage: "commandRateLimiter.consume"}); return true; }
}

async function allowIncomingMessageProcessing(m, sock) {
  if (isKnownBotSender(m)) return false;
  if (!m.isGroup || m.isCommand) return true;
  // حركة لاعب بشري في غرفة أركيد جارية («ارمي» كل دور) ليست حلقة بوت — لا حد تكرار عليها
  if (hasArcadeRoom(m)) return true;
  const replyDecision = shouldReplyAsBot(m, sock);
  if (replyDecision.allowed) return true;
  if (replyDecision.reason === "rate-limit") await m.react("🤖").catch((error) => { noteFailure("handler", error, {where: "src/handler.js:536",stage: "m.react"}); });
  return false;
}

/** نتيجة أمر وجّهه المساعد بإعادة كتابة الرسالة — تُحفظ في ذاكرة المحادثة */
function noteAiRoutedResult(m, ok, error) {
  import("./lib/terboo-ai-memory.js")
    .then(({ recordResult }) => recordResult(m, { command: m.command, ok, summary: String(error || (ok ? "done" : "failed")).slice(0, 200) }))
    .catch((error) => { noteFailure("handler", error, {where: "src/handler.js:544",stage: "import:terboo-ai-memory"}); });
}

/** إبلاغ صاحب ضغطة لم تنتهِ بأمر — في نفس الدردشة وبلغته (السجل يسبقه دائماً عبر logInteractiveFailure) */
async function notifyUnknownPress(m, id) {
  const pressDb = safe(() => getDatabase());
  const pressLang = getUserLanguage(pressDb?.getUser?.(m.sender));
  await m.reply(
    UI.card({
      title: t(pressLang, "menu.title"),
      icon: "🎛️",
      blocks: [
        t(pressLang, "menu.pressUnknown"),
        id ? UI.row(t(pressLang, "menu.pressHint"), UI.isolate(id), pressLang) : "",
      ],
      lang: pressLang,
    }),
  ).catch((error) => { noteFailure("handler", error, { where: "src/handler.js:notifyUnknownPress", stage: "m.reply", target: m.chat, payload: "pressUnknown" }); });
}

async function messageHandler(msg, sock, options = {}) {
  const isJadibot = options.isJadibot || false;
  try {
    let m;
    try {
      m = await serialize(sock, msg);
    } catch (serializeErr) { noteFailure("handler", serializeErr, {where: "src/handler.js:553",stage: "serialize"}); return; }

    if (!m) return;
    if (!m.message) return;
    if (!m.sender) m.sender = m.chat || "";

    // أمر أرسلته النواة نيابةً عن المستخدم: نراقب ردوده ونتيجته دون تغيير أي فحص
    if (options.aiDispatched) {
      m.aiDispatched = true;
      if (options.observer && typeof m.reply === "function") {
        const originalReply = m.reply;
        m.reply = async (content, ...rest) => {
          try { options.observer.reply(content); } catch (error) { noteFailure("handler", error, {where: "src/handler.js:567",stage: "options.observer.reply"}); }
          return originalReply.call(m, content, ...rest);
        };
      }
    }

    // مسار الضغطات الكامل (§14): استخراج ← تطبيع ← تحقّق ← استنتاج البادئة
    // ← مطابقة أمر حقيقي ← تأكيد وجود البلوقن ← إكمال المسار الطبيعي ← سجل.
    // ممنوع حدوث ضغطة صامتة: أي ضغطة لا تنتهي بأمر تُسجَّل ويُبلَّغ صاحبها.
    if (!m.isCommand && isInteractiveType(m.type)) {
      try {
        const interactive = applyInteractive(m, { prefix: config.command?.prefix || "." });
        // زر «نسخ»: رد فوري بالقيمة ليسهل نسخها (لا يمر كأمر)
        if (interactive.reason === "internal" && interactive.internal === "copy") {
          await m.reply(`${String(interactive.value).slice(0, 500)}`).catch((error) => { noteFailure("handler", error, {where: "src/handler.js:581",stage: "String"}); });
          return;
        }
        if (!interactive.handled && logInteractiveFailure(m, interactive)) {
          await notifyUnknownPress(m, interactive.id);
          return;
        }
      } catch (buttonParseError) {
        console.error("[Handler] Interactive pipeline error:", buttonParseError.message);
      }
    }

    // الأوامر الصريحة تظل متاحة، أما الردود التلقائية فيمر منها المتحدث المنتخب فقط.
    if (!(await allowIncomingMessageProcessing(m, sock))) return;

    // Global Rate Limit
    try {
      await globalLoadLimiter.consume("global", 1);
    } catch {
      return m.statusReply("⚠️ البوت يواجه ضغطاً كبيراً حالياً، يرجى المحاولة لاحقاً.", "global_limit", "🛡️");
    }

    // شاشات الإدخال (رابط/مفتاح/اسم مضيف/كلمة مرور…): الرسالة التالية النصية من نفس المستخدم في نفس
    // المحادثة تُسلَّم لتدفقها قبل أي سجل أو حدث أو ذكاء — المدخل السري يُحجب ويُمسح قبل أي طباعة.
    if (!m.isCommand && !options.aiDispatched) {
      try {
        if (await handleFlowInput(m, { sock })) return;
      } catch (e) { noteFailure("handler", e, { where: "src/handler.js:flow-input", stage: "handleFlowInput" }); }
    }

    // Emit event for every message
    botEvents.emit("message", { m, sock, options });

    if (global.giveawaySessions?.has(m.sender)) {
      try {
        const { handleSession: gaHandler } =
          await import("../plugins/group/giveaways.js");
        const gaHandled = await gaHandler(m, sock);
        if (gaHandled) return;
      } catch (e) { noteFailure("handler", e, {where: "src/handler.js:626",stage: "import:giveaways"}); }
    }

    if (m.message?.stickerPackMessage && sock.saveStickerPack) {
      try {
        const packMsg = m.message.stickerPackMessage;
        const packId = packMsg.stickerPackId || m.id;
        const packName = packMsg.name || "Unknown Pack";
        sock.saveStickerPack(packId, { stickerPackMessage: packMsg }, packName);
      } catch (e) { noteFailure("handler", e, {where: "src/handler.js:635",stage: "sock.saveStickerPack"}); }
    }

    try {
      const { handleAiStudioRequest } = await import("./lib/terboo-ai-studio.js");
      const studioHandled = await handleAiStudioRequest(m, sock);
      if (studioHandled) return;
    } catch (e) { noteFailure("handler", e, {where: "src/handler.js:642",stage: "import:terboo-ai-studio"}); }

    const db = getDatabase();
    if (!db?.ready) {
      return;
    }

    if (!m.isBot && m.sender && m.isGroup) {
      // دليل الأعضاء: اسم واتساب لمن يكتب في المجموعة (بلا أي طلب شبكة، ولا يشترط التسجيل)
      noteGroupMemberSeen(m.chat, m.sender, m.pushName);
      let contacts = db.setting("contacts") || {};
      const currentName = m.pushName;
      if (currentName && currentName !== "User" && currentName !== "Unknown" && currentName !== "~ User") {
        if (!contacts[m.sender] || contacts[m.sender].name !== currentName) {
          contacts[m.sender] = {
            jid: m.sender,
            name: currentName
          };
          db.setting("contacts", contacts);
        }
      }

      const ownerNumbers = (global.owner || []).map(o => typeof o === "string" ? o.replace(/[^0-9]/g, "") : String(o));
      const senderNumber = m.sender.replace(/[^0-9]/g, "");
      const isOwnerUser = m.isOwner || ownerNumbers.includes(senderNumber);

      if (isOwnerUser) {
        const groupData = db.getGroup(m.chat);
        if (groupData && groupData.autoSambut && groupData.autoSambut.enabled) {
          const ownerId = m.sender;
          const lastChat = groupData.autoSambut.lastChats?.[ownerId] || 0;
          const delayMs = groupData.autoSambut.delayMs || (groupData.autoSambut.delay ? groupData.autoSambut.delay * 3600000 : 7200000);
          const now = Date.now();

          if (lastChat > 0 && (now - lastChat >= delayMs)) {
            if (groupData.autoSambut.pesan !== undefined && !groupData.autoSambut.pesanList) {
              groupData.autoSambut.pesanList = [groupData.autoSambut.pesan];
            }

            const pList = groupData.autoSambut.pesanList || ["Halo {user}! Selamat datang kembali 🙇‍♂️"];
            const randomMsg = pList[Math.floor(Math.random() * pList.length)];

            let sambutan = randomMsg
              .replace(/{name}/gi, m.pushName || "Owner")
              .replace(/{user}/gi, `@${ownerId.split('@')[0]}`);

            m.reply(sambutan, { mentions: [ownerId] }).catch((error) => { noteFailure("handler", error, {where: "src/handler.js:686",stage: "m.reply"}); });
          }

          if (!groupData.autoSambut.lastChats) groupData.autoSambut.lastChats = {};
          groupData.autoSambut.lastChats[ownerId] = now;
          db.setGroup(m.chat, { autoSambut: groupData.autoSambut });
        }
      }
    }

    const jadibotId = options.jadibotId || null;
    if (isJadibot && jadibotId) {
      const botJid = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
      const senderNum = m.sender?.replace(/[^0-9]/g, "") || "";
      const botNum = botJid.replace(/[^0-9]/g, "");
      m.isOwner = isJadibotOwner(jadibotId, m.sender) || senderNum === botNum;
      m.isPremium = isJadibotPremium(jadibotId, m.sender) || m.isOwner;
    }

    if (config.features?.logMessage) {
      let groupName = "خاص";
      if (m.isGroup) {
        const groupData = db.getGroup(m.chat);
        groupName = groupData?.name || "مجموعة غير معروفة";
        if (groupName === "مجموعة غير معروفة" || groupName === "Unknown") {
          sock
            .groupMetadata(m.chat)
            .then((meta) => {
              if (meta?.subject) db.setGroup(m.chat, { name: meta.subject });
            })
            .catch((error) => { noteFailure("handler", error, {where: "src/handler.js:716",stage: "db.getGroup"}); });
        }
      }

      if (!isJadibot) {
        const deviceHint =
          m.key?.id?.length > 22
            ? "Android"
            : m.key?.id?.startsWith("3EB0")
              ? "iPhone"
              : m.key?.id?.startsWith("BAE5")
                ? "Web"
                : null;
        logMessage({
          chatType: m.isNewsletter
            ? "newsletter"
            : m.isGroup
              ? "group"
              : "private",
          groupName: m.isNewsletter ? "Channel" : groupName,
          pushName: m.pushName,
          sender: m.sender,
          message: m.body,
          messageType: m.type,
          isForwarded: m.message?.[m.type]?.contextInfo?.isForwarded || false,
          isNewsletter:
            m.isNewsletter ||
            !!m.message?.[m.type]?.contextInfo?.forwardedNewsletterMessageInfo,
          isOwner: m.isOwner,
          isPremium: m.isPremium,
          isPartner: m.isPartner,
          isAdmin: m.isAdmin,
          device: deviceHint,
        });
      }
    }

    if (checkAfk) {
      checkAfk(m, sock).catch((error) => { noteFailure("handler", error, {where: "src/handler.js:754",stage: "checkAfk"}); });
    }

    if (m.isGroup && !m.isNewsletter) {
      cacheMessageForAntiRemove(m, sock, db);

      const antiJudolTriggered = await handleAntiJudol(m, sock, db);
      if (antiJudolTriggered) return;

      const antiPhisingTriggered = await handleAntiPhising(m, sock, db);
      if (antiPhisingTriggered) return;

      const antiCustomTriggered = await handleAntiCustom(m, sock, db);
      if (antiCustomTriggered) return;

      const antilinkTriggered = await handleAntilink(m, sock, db);
      if (antilinkTriggered) return;

      const antilinkGcTriggered = await handleAntilinkGc(m, sock, db);
      if (antilinkGcTriggered) return;

      const antilinkAllTriggered = await handleAntilinkAll(m, sock, db);
      if (antilinkAllTriggered) return;

      const antiHidetagTriggered = await handleAntiHidetag(m, sock, db);
      if (antiHidetagTriggered) return;

      const antiSwGcTriggered = await handleAntiSwGc(m, sock, db);
      if (antiSwGcTriggered) return;

      if (checkAntidocument) {
        const isAntidocument = await checkAntidocument(m, sock, db);
        if (isAntidocument) return;
      }

      if (detectBot && !m.isOwner && !m.isAdmin) {
        try {
          const botDetected = await detectBot(m, sock);
          if (botDetected) return;
        } catch (e) { noteFailure("handler", e, {where: "src/handler.js:793",stage: "detectBot"}); }
      }

      if (isMuted && !m.isAdmin && !m.isOwner) {
        try {
          if (isMuted(m.chat, db)) {
            if (m.isBotAdmin) await sock.sendMessage(m.chat, { delete: m.key });
            return;
          }
        } catch (e) { noteFailure("handler", e, {where: "src/handler.js:802",stage: "isMuted"}); }
      }

      if (isMutedMember && !m.isAdmin && !m.isOwner) {
        try {
          if (isMutedMember(m.chat, m.sender, db)) {
            if (m.isBotAdmin) await sock.sendMessage(m.chat, { delete: m.key });
            return;
          }
        } catch (e) { noteFailure("handler", e, {where: "src/handler.js:811",stage: "isMutedMember"}); }
      }

      if (isMutegc && !m.isAdmin && !m.isOwner && !m.isPartner) {
        try {
          if (isMutegc(m.chat, db)) return;
        } catch (e) { noteFailure("handler", e, {where: "src/handler.js:817",stage: "isMutegc"}); }
      }

      if (checkSpam && handleSpamAction && !m.isAdmin && !m.isOwner) {
        try {
          const isSpam = await checkSpam(m, sock, db);
          if (isSpam) {
            const delayKey = `${m.chat}_${m.sender}`;
            spamDelayTracker.set(delayKey, Date.now());
            await handleSpamAction(m, sock, db);
          }
        } catch (e) { noteFailure("handler", e, {where: "src/handler.js:828",stage: "checkSpam"}); }
      }

      if (checkSlowmode && !m.isAdmin && !m.isOwner) {
        try {
          const slowResult = checkSlowmode(m, sock, db);
          if (slowResult) {
            if (slowResult.mode === "onlycommand") {
              if (m.isCommand) return;
            } else {
              await sock.sendMessage(m.chat, { delete: m.key });
              return;
            }
          }
        } catch (e) { noteFailure("handler", e, {where: "src/handler.js:842",stage: "checkSlowmode"}); }
      }

      if (isToxic && handleToxicMessage) {
        try {
          const groupData = db.getGroup(m.chat) || {};
          if (groupData.antitoxic && !m.isAdmin && !m.isOwner) {
            const toxicWords = groupData.toxicWords || [];
            const result = isToxic(m.body, toxicWords);
            if (result.toxic) {
              await handleToxicMessage(m, sock, db, result.word);
              return;
            }
          }
        } catch (e) { noteFailure("handler", e, {where: "src/handler.js:856",stage: "db.getGroup"}); }
      }
    }

    if (m.isGroup && incrementChatCount) {
      try {
        incrementChatCount(m.chat, m.sender, db, m.pushName);
      } catch (e) { noteFailure("handler", e, {where: "src/handler.js:863",stage: "incrementChatCount"}); }
    }

    const modeCheck = checkMode(m, getActiveJadibots);
    if (!modeCheck.allowed) {
      if (modeCheck.isAfk && m.isCommand) {
        await m.reply(modeCheck.afkMessage);
      } else if (modeCheck.hasJadibots && m.isCommand && !isJadibot) {
        await sock.sendMessage(
          m.chat,
          {
            text: modeCheck.jadibotMessage,
            contextInfo: {
              ...saluranCtx(),
              mentionedJid: modeCheck.jadibotMentions,
            },
          },
          { quoted: m },
        );
      } else if (modeCheck.isOnlyThisGroup && m.isCommand) {
        await m.reply(modeCheck.onlyThisGroupMessage);
      }
      return;
    }

    if (m.isBanned) {
      if (m.isCommand) {
        await m
          .reply(
            config.messages?.banned ||
            "🚫 *أنت محظور من استخدام البوت.*",
          )
          .catch((error) => { noteFailure("handler", error, {where: "src/handler.js:895",stage: "reply"}); });
      }
      logger.warn("مستخدم محظور", m.sender);
      return;
    }

    if (m.isGroup && m.isCommand && !m.isOwner) {
      const groupData = db.getGroup(m.chat) || {};
      if (groupData.isBanned) {
        return;
      }
    }

    const botId = sock.user?.id?.split(":")[0] || "unknown";
    const msgKey = `${botId}_${m.chat}_${m.sender}_${m.id}`;
    if (debounceMessage(msgKey)) {
      return;
    }

    if (db.setting("autoRead") ?? config.features?.autoRead) {
      sock.readMessages([m.key]).catch((error) => { noteFailure("handler", error, {where: "src/handler.js:915",stage: "sock.readMessages"}); });
    }
    if (!m.pushName || m.pushName === "Unknown" || m.pushName.trim() === "") {
      if (!m.isCommand && !m.isBot && !m.fromMe && !m.isNewsletter) {
        return;
      }
      m.pushName = m.isNewsletter
        ? "Channel"
        : m.sender?.split("@")[0] || "User";
    }

    // التسجيل اختياري (V6): من سجّل اسماً اختاره يُنادى به، ومن لم يسجّل يبقى باسم واتساب
    const registrationNameUser = db.getUser(m.sender);
    if (registrationNameUser?.isRegistered && registrationNameUser?.regName) {
      m.originalPushName = m.pushName;
      m.pushName = registrationNameUser.regName;
    }

    if (m.isCommand) {
      db.setUser(m.sender, {
        name: m.originalPushName || m.pushName,
        lastSeen: new Date().toISOString(),
      });
    }

    // بوابة الانضمام: اختيار اللغة ثم التسجيل الحالي قبل أي وصول للأوامر.
    // تُعالج أزرار اللغة هنا وتعود فوراً قبل توجيه الأوامر العادي.
    const onboardingHandled = await handleOnboarding(m, sock, db);
    if (onboardingHandled) return;

        const cmdVnEnabled = db.setting("cmdVn") || false;
    if (
      cmdVnEnabled &&
      m.type === "audioMessage" &&
      !m.isCommand &&
      config.APIkey?.groq
    ) {
      let inputFile = null;
      let wavFile = null;
      const cleanupCmdVnFiles = () => {
        [inputFile, wavFile].forEach((filePath) => {
          if (!filePath) return;
          try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch (error) { noteFailure("handler", error, {where: "src/handler.js:963",stage: "fs.existsSync"}); }
        });
      };
      try {
        const audioMsg = m.message?.audioMessage;
        const maxSize = 500 * 1024;
        if (
          audioMsg &&
          (!audioMsg.fileLength || audioMsg.fileLength <= maxSize)
        ) {
          const buffer = await m.download();
          if (buffer && buffer.length > 1000) {
            const tmpDir = path.join(process.cwd(), "tmp");
            if (!fs.existsSync(tmpDir))
              fs.mkdirSync(tmpDir, { recursive: true });

            inputFile = path.join(tmpDir, `vncmd_${Date.now()}.ogg`);
            wavFile = path.join(tmpDir, `vncmd_${Date.now()}.wav`);

            fs.writeFileSync(inputFile, buffer);

            await new Promise((resolve, reject) => {
              execFile(
                "ffmpeg", ["-y", "-i", inputFile, "-ar", "16000", "-ac", "1", "-f", "wav", wavFile],
                { timeout: 15000 },
                (err) => (err ? reject(err) : resolve()),
              );
            });

            const wavBuffer = fs.readFileSync(wavFile);
            const form = new FormData();
            form.append("file", wavBuffer, {
              filename: "audio.wav",
              contentType: "audio/wav",
            });
            form.append("model", "whisper-large-v3");
            form.append("language", "ar");
            form.append("response_format", "json");

            const { data } = await axios.post(
              "https://api.groq.com/openai/v1/audio/transcriptions",
              form,
              {
                headers: {
                  ...form.getHeaders(),
                  Authorization: `Bearer ${config.APIkey.groq}`,
                },
                timeout: 30000,
                maxContentLength: Infinity,
              },
            );

            cleanupCmdVnFiles();
            inputFile = null;
            wavFile = null;

            const transcript = (data.text || "")
              .trim()
              .toLowerCase()
              .replace(/[.,!?;:'"]/g, "")
              .trim();

            if (transcript) {
              const words = transcript.split(/\s+/);
              const rawWord = words[0];
              const prefix = config.command?.prefix || ".";

              if (rawWord === "ترجم" || rawWord === "translate") {
                const toTranslate = words.slice(1).join(" ");
                if (toTranslate) {
                  m.react("🌐");
                  try {
                    const res = await axios.get(`https://virix-api.vercel.app/api/translate/translate?q=${encodeURIComponent(toTranslate)}&to=ar`);
                    if (res.data?.translated) {
                      await m.reply(`🌐 *مترجم الصوت*\n\n> الأصل: ${toTranslate}\n> الترجمة: ${res.data.translated}`);
                      return m.react("✅");
                    }
                  } catch (error) { noteFailure("handler", error, {where: "src/handler.js:1040",stage: "axios.get"}); }
                }
              }

              const allPlugins = getAllPlugins();
              const allNames = [];
              for (const p of allPlugins) {
                if (p.config?.name && typeof p.config.name === "string")
                  allNames.push(p.config.name.toLowerCase());
                if (Array.isArray(p.config?.alias)) {
                  for (const a of p.config.alias) {
                    if (a && typeof a === "string")
                      allNames.push(a.toLowerCase());
                  }
                }
              }

              let bestMatch = null;
              let bestScore = Infinity;

              for (const cmd of allNames) {
                if (cmd === rawWord) {
                  bestMatch = cmd;
                  bestScore = 0;
                  break;
                }
                if (rawWord.startsWith(cmd) && cmd.length >= 3) {
                  const score = rawWord.length - cmd.length;
                  if (score < bestScore) {
                    bestScore = score;
                    bestMatch = cmd;
                  }
                }
                const dist = levenshtein(rawWord, cmd);
                if (dist <= 3 && dist < bestScore) {
                  bestScore = dist;
                  bestMatch = cmd;
                }
              }

              if (bestMatch) {
                const commandArgs = words.slice(1).join(" ");
                m.body = `${prefix}${bestMatch}${commandArgs ? " " + commandArgs : ""}`;
                const { parseCommand } =
                  await import("./lib/terboo-serialize.js");
                const parsed = parseCommand(m.body, prefix);
                m.isCommand = parsed.isCommand;
                m.command = parsed.command;
                m.args = parsed.args;
                m.prefix = parsed.prefix;
                m.isVnCommand = true;
              }
            }
          }
        }
      } catch (e) {
        cleanupCmdVnFiles();
        console.error("[CMD VN] Error:", e.message);
      }
    }

    if (m.body && !options.aiDispatched) {
      try {
        const userObj = db.getUser(m.sender) || db.setUser(m.sender);

        if (levelHelper && levelHelper.addExpWithLevelCheck) {
          await levelHelper.addExpWithLevelCheck(sock, m, db, userObj, 15);
        }
      } catch (e) {
        console.error("[Level System] Error:", e.message);
      }
    }

    if (handleAutoAI && m.isGroup && !m.isCommand) {
      try {
        const aiHandled = await handleAutoAI(m, sock);
        if (aiHandled) return;
      } catch (e) { noteFailure("handler", e, {where: "src/handler.js:1117",stage: "handleAutoAI"}); }
    }

    if (handleAutoDownload && m.body) {
      try {
        handleAutoDownload(m, sock, m.body);
      } catch (e) { noteFailure("handler", e, {where: "src/handler.js:1123",stage: "handleAutoDownload"}); }
    }

    if (autoJoinDetector && m.body) {
      try {
        const joined = await autoJoinDetector(m, sock);
        if (joined) return;
      } catch (e) { noteFailure("handler", e, {where: "src/handler.js:1130",stage: "autoJoinDetector"}); }
    }

    if (m.body?.startsWith(">>") && m.isOwner) {
      const code = m.body.slice(2).trim();
      if (!code) return;

      try {
        const AsyncFunction = Object.getPrototypeOf(
          async function () { },
        ).constructor;

        const execCode = new AsyncFunction(
          "m",
          "sock",
          "db",
          "config",
          "getDatabase",
          "console",
          `
          const { default: axios } = await import('axios')
          const { default: fs } = await import('fs')
          const { default: path } = await import('path')
          const { default: os } = await import('os')
          const { promisify } = await import('util')
          const { generateWAMessage, generateWAMessageFromContent, proto, generateMessageID } = await import('@whiskeysockets/baileys')
          const { getBuffer } = await import('./lib/terboo-wa-compat.js')
          const { exec: childExec } = await import('child_process')
          const { VERSION, Button, ButtonV2, Carousel, AIRich, } = await import('./lib/terboo-builder.js')
          const exec = promisify(childExec)
          
          ${code}
          `,
        );

        const result = await execCode(
          m,
          sock,
          db,
          config,
          getDatabase,
          console,
        );

        if (result !== undefined && result !== null) {
          const output =
            typeof result === "object"
              ? JSON.stringify(result, null, 2)
              : String(result);

          if (output.length > 0) {
            await m.reply(
              `✅ *نتيجة التنفيذ*\n\n\`\`\`\n${output.substring(0, 4000)}\n\`\`\``,
            );
          }
        }
      } catch (execError) {
        await m.reply(
          `❌ *خطأ في التنفيذ*\n\n\`\`\`\n${execError.message}\n\nStack:\n${execError.stack?.substring(0, 1000) || "N/A"}\n\`\`\``,
        );
      }
      return;
    }
    
    if (m.body?.startsWith("-->") && m.isOwner) {
  if (!m.quoted) {
    await m.reply("❌ *رد على رسالة لفحصها*");
    return;
  }

  try {
    const json = JSON.stringify(m.quoted || {}, null, 2);

    await sock.sendCodeBlock(
      m.chat,
      json,
      m,
      {
        language: 'json',
        title: '☞كود∆JSON الخام',
        footer: 'Bot Terboo'
      }
    );

  } catch (err) {
    await m.reply('❌ *فشل الفحص*\n\n' + err.message);
  }
  return;
    }
    
    if (m.body?.startsWith("!!") && m.isOwner) {
      const expr = m.body.slice(2).trim();
      if (!expr) return;

      try {
        const AsyncFunction = Object.getPrototypeOf(
          async function () { },
        ).constructor;

        const inspectCode = new AsyncFunction(
          "m",
          "sock",
          "db",
          "config",
          "getDatabase",
          "console",
          `
          const util = await import('util')
          const { default: axios } = await import('axios')
          const { default: fs } = await import('fs')
          const { default: path } = await import('path')
          const { default: os } = await import('os')
          const { generateWAMessage, generateWAMessageFromContent, proto, generateMessageID } = await import('@whiskeysockets/baileys')
          const { getBuffer } = await import('./lib/terboo-wa-compat.js')

          const result = await ${expr}
          if (result === undefined) return 'undefined'
          if (result === null) return 'null'
          if (typeof result === 'string') return result
          try {
            return util.inspect.default(result, { depth: 4, maxArrayLength: 30, maxStringLength: 300, breakLength: 60, compact: false })
          } catch {
            try { return JSON.stringify(result, null, 2) } catch { return String(result) }
          }
          `,
        );

        const output = await inspectCode(
          m,
          sock,
          db,
          config,
          getDatabase,
          console,
        );

        if (output && String(output).length > 0) {
          const str = String(output);
          await m.reply(
            `${str}`,
          );
        }
      } catch (inspectError) {
        await m.reply(
          `${inspectError.message}\n\`\`\``,
        );
      }
      return;
    }

    const hasArcade = hasArcadeRoom(m);

    let gameEvaluated = false;
    if (
      (hasActiveSession(m.chat) && m.quoted) ||
      hasArcade
    ) {
      gameEvaluated = true;
      const gameHandled = await handleGameAnswer(m, sock);
      if (gameHandled) return;
    }

    try {
      if (registrationAnswerHandler) {
        const handled = await registrationAnswerHandler(m, sock);
        if (handled) return;
      }
    } catch (e) {
      console.error("[Handler] Registration answer error:", e.message);
    }

    try {
      if (dungeonAnswerHandler) {
        const handled = await dungeonAnswerHandler(m, sock);
        if (handled) return;
      }
    } catch (e) {
      console.error("[Handler] Dungeon answer error:", e.message);
    }

    try {
      if (kyubigameAnswerHandler) {
        const handled = await kyubigameAnswerHandler(m, sock);
        if (handled) return;
      }
    } catch (e) {
      console.error("[Handler] Kyubigame answer error:", e.message);
    }

    try {
      if (pushkontakAnswerHandler) {
        const handled = await pushkontakAnswerHandler(m, sock);
        if (handled) return;
      }
    } catch (e) {
      console.error("[Handler] Pushkontak answer error:", e.message);
    }

    try {
      if (dafontAnswerHandler) {
        const handled = await dafontAnswerHandler(m, sock);
        if (handled) return;
      }
    } catch (e) {
      console.error("[Handler] Dafont answer error:", e.message);
    }

    try {
      if (gantiAssetAnswerHandler) {
        const handled = await gantiAssetAnswerHandler(m, sock);
        if (handled) return;
      }
    } catch (e) {
      console.error("[Handler] GantiAsset answer error:", e.message);
    }

    try {
      if (srtAnswerHandler) {
        const handled = await srtAnswerHandler(m, sock);
        if (handled) return;
      }
    } catch (e) {
      console.error("[Handler] SRT answer error:", e.message);
    }

    if (!m.isCommand) {
      if (hasActiveSession(m.chat) && !gameEvaluated) {
        gameEvaluated = true;
        const gameHandled = await handleGameAnswer(m, sock);
        if (gameHandled) return;
      }

      // المساعد الذكي: يعمل فقط عند الرد على رسالة البوت أو الإشارة إليه.
      // إذا فهم الطلب كأمر، يعيد كتابة الرسالة ويكمل مسار الأوامر الطبيعي
      // بكل فحوصات الصلاحيات والتبريد والطاقة كما هي.
      if (handleAiAssistant) {
        try {
          const assistantResult = await handleAiAssistant(m, sock, db);
          // «duplicate»: إعادة تسليم متأخرة لرسالة عولجت — لا شيء آخر يُنفَّذ لها (§52)
          if (assistantResult === "answered" || assistantResult === "duplicate") return;
          if (assistantResult === "command" && m.isCommand) {
            botEvents.emit("ai-command", { m, sock });
          }
        } catch (assistantError) {
          console.error("[Handler] AI assistant error:", assistantError.message);
        }
      }

      if (!m.isCommand) {
        const smartHandled = await handleSmartTriggers(m, sock, db);
        if (smartHandled) return;
      }

      if (m.quoted?.id || m.quoted?.key?.id) {
        try {
          if (anticustomReplyHandler) {
            const handled = await anticustomReplyHandler(m, { sock });
            if (handled) return;
          }
          if (
            global.confessData?.has(m.quoted.id) &&
            confessPlugin?.replyHandler
          ) {
            const handled = await confessPlugin.replyHandler(m, { sock });
            if (handled) return;
          }
          if (
            global.sulapSessions?.has(m.quoted.id) &&
            sulapPlugin?.replyHandler
          ) {
            const handled = await sulapPlugin.replyHandler(m, sock);
            if (handled) return;
          }
        } catch (error) { noteFailure("handler", error, {where: "src/handler.js:1421",stage: "anticustomReplyHandler"}); }
      }

      if (autoStickerHandler && m.isGroup) {
        autoStickerHandler(m, sock).catch((error) => { noteFailure("handler", error, {where: "src/handler.js:1425",stage: "autoStickerHandler"}); });
      }

      if (autoMediaHandler && m.isGroup) {
        autoMediaHandler(m, sock).catch((error) => { noteFailure("handler", error, {where: "src/handler.js:1429",stage: "autoMediaHandler"}); });
      }

     if (m.isGroup) checkAutoReact(m, sock).catch((error) => { noteFailure("handler", error, {where: "src/handler.js:1432",stage: "checkAutoReact"}); });   
        
      if (checkAntisticker && m.isGroup) {
        const stickerHandled = await checkAntisticker(m, sock, db);
        if (stickerHandled) return;
      }

      if (checkAntimedia && m.isGroup) {
        const mediaHandled = await checkAntimedia(m, sock, db);
        if (mediaHandled) return;
      }

      if (checkStickerCommand) {
        try {
          const stickerCmd = checkStickerCommand(m);
          if (stickerCmd) {
            const prefix = m.prefix || config.command?.prefix || ".";
            m.body = `${prefix}${stickerCmd}`;
            const { parseCommand } = await import("./lib/terboo-serialize.js");
            const parsed = parseCommand(m.body, prefix);
            m.isCommand = parsed.isCommand;
            m.command = parsed.command;
            m.args = parsed.args;
            m.prefix = parsed.prefix;
          }
        } catch (e) {
          console.error("[Handler] Sticker command error:", e.message);
        }
      }

      if (!m.isCommand) return;
    }

    // Emit event for commands
    botEvents.emit("command", { m, sock, options });

    const delayKey = `${m.chat}_${m.sender}`;
    if (!m.isOwner && !m.isPremium) {
      const lastSpamDetect = spamDelayTracker.get(delayKey);
      if (lastSpamDetect) {
        const elapsed = Date.now() - lastSpamDetect;
        if (elapsed < 10000) {
          await new Promise((r) => setTimeout(r, 500));
        } else {
          spamDelayTracker.delete(delayKey);
        }
      }
    }

    const spamKey = `${botId}_${m.sender}`;
    if (!m.isOwner && !m.isPremium && (await isSpamming(spamKey))) {
      return;
    }

    const storeData = db.setting("storeList") || {};
    const storeCommand = storeData[m.command.toLowerCase()];

    if (m.isGroup) {
      const groupData = db.getGroup(m.chat) || {};
      const botMode = groupData.botMode || "all";

      if (botMode === "store" && storeCommand) {
        storeData[m.command.toLowerCase()].views =
          (storeCommand.views || 0) + 1;
        db.setting("storeList", storeData);

        const caption =
          `📦 *${m.command.toUpperCase()}*\n\n` +
          `${storeCommand.content}\n\n` +
          `───────────────\n` +
          `> 👁️ المشاهدات: ${storeData[m.command.toLowerCase()].views}\n` +
          `> 💳 اكتب ${m.prefix}دفع للدفع`;

        if (storeCommand.hasImage && storeCommand.imagePath) {
          try {
            const imageBuffer = await getCachedThumb(storeCommand.imagePath);
            if (imageBuffer) {
              await sock.sendMessage(
                m.chat,
                {
                  image: imageBuffer,
                  caption: caption,
                },
                { quoted: m },
              );
              return;
            }
          } catch (e) {
            console.error("فشل تحميل صورة المتجر:", e.message);
          }
        }

        await m.reply(caption);
        return;
      }
    }

    try {
      const caseResult = await handleCaseCommand(m, sock);
      if (caseResult && caseResult.handled) {
        if (config.dev?.debugLog) {
          logger.success("Case", `تمت المعالجة: ${m.command}`);
        }
        return;
      }
    } catch (caseError) {
      logger.error("Case System", caseError.message);
      if (config.dev?.debugLog) {
        console.error("[CaseSystem] Stack:", caseError.stack);
      }
    }

    let plugin = getPlugin(m.command);

    if (!plugin) {
      if (storeCommand) {
        storeData[m.command.toLowerCase()].views =
          (storeCommand.views || 0) + 1;
        db.setting("storeList", storeData);

        const caption =
          `📦 *${m.command.toUpperCase()}*\n\n` +
          `${storeCommand.content}\n\n` +
          `───────────────\n` +
          `> 👁️ المشاهدات: ${storeData[m.command.toLowerCase()].views}\n` +
          `> 💳 اكتب ${m.prefix}دفع للدفع`;

        if (storeCommand.hasImage && storeCommand.imagePath) {
          try {
            const imageBuffer = await getCachedThumb(storeCommand.imagePath);
            if (imageBuffer) {
              await sock.sendMessage(
                m.chat,
                {
                  image: imageBuffer,
                  caption: caption,
                },
                { quoted: m },
              );
              return;
            }
          } catch (e) {
            console.error("فشل تحميل صورة المتجر:", e.message);
          }
        }

        await m.reply(caption);
        return;
      }

      // ضغطة زر/قائمة معرّفها صيغة أمر لكن لا أمر بهذا الاسم: لا ضغطة صامتة (v4 §31 §32)
      if (isInteractiveType(m.type)) {
        const unknown = { handled: false, reason: PRESS_REASON.UNKNOWN_COMMAND, id: String(m.body || ""), command: m.command };
        if (logInteractiveFailure(m, unknown)) await notifyUnknownPress(m, unknown.id);
        return;
      }

      const storeCommands = Object.keys(storeData);
      const allCommands = [...getAllCommandNames(), ...storeCommands];

      const similarityEnabled = db.setting("similarity") !== false;

      if (similarityEnabled) {
        const suggestions = findSimilarCommands(m.command, allCommands, {
          maxResults: 1,
          minSimilarity: 0.6,
          maxDistance: 3,
        });

        if (suggestions.length > 0) {
          const message = formatSuggestionMessage(
            m.command,
            suggestions,
            m.prefix,
            m,
            config,
          );
          try {
            const suggestionAsset = fs.readFileSync(config.assets["terboo"]);
            const suggestionLink =
              config.socialLinks?.website || "https://github.com/Tarboobot2888";
            const content = {
              buttonsMessage: {
                contentText: message.footer,
                buttons: message.buttons,
                footerText: " ",
                headerType: 6,
                locationMessage: {
                  degreesLatitude: 0,
                  degreesLongitude: 0,
                  name: "الأوامر المقترحة",
                  address: suggestionLink,
                  jpegThumbnail: suggestionAsset,
                },
                contextInfo: {
                  externalAdReply: {
                    title: "الأوامر المقترحة",
                    body: "Bot Terboo",
                    mediaType: 1,
                    thumbnailUrl: suggestionLink,
                    sourceUrl: suggestionLink,
                    renderLargerThumbnail: true,
                  },
                },
              },
            };
            const msg = generateWAMessageFromContent(
              m.chat,
              content,
              { quoted: m },
            );
            await sock.relayMessage(m.chat, msg.message, {
              messageId: msg.key.id,
            });
          } catch (err) {
            console.error("[Similarity] فشل إرسال رسالة الاقتراح:", err.message);
          }
        }
      }

      return;
    }

    if (!plugin.config.isEnabled) {
      return;
    }

    if (m.isGroup) {
      const groupData = db.getGroup(m.chat) || {};
      let botMode = groupData.botMode || "all";
      const pluginCategory = plugin.config.category?.toLowerCase();
      const baseAllowed = ["main", "group", "sticker", "owner"];

      if (isJadibot) {
    botMode = "all";

    const botNumber = jadibotId?.replace(/@.+/g, "") || "";
    
    // ✅ لو البوت موثوق، يتخطى كل القيود
    if (!isTrustedBot(botNumber)) {
        const jadibotBlockedCategories = [
            "owner", "sewa", "panel", "store", "pushkontak",
        ];
        const jadibotBlockedCommands = [
            "sewa", "sewabot", "sewalist", "listsewa",
            "addsewa", "delsewa", "extendsewa", "checksewa",
            "sewainfo", "sewagroup", "stopsewa",
            "jadibot", "listjadibot",
            "addowner", "delowner", "ownerlist", "listowner",
            "self", "public", "botmode",
            "restart", "shutdown",
        ];

        if (
            jadibotBlockedCategories.includes(pluginCategory) ||
            jadibotBlockedCommands.includes(m.command.toLowerCase())
        ) {
            return m.reply(
                `⚠️ *وصول مقيد*\n\n` +
                `هذه الميزة متاحة فقط للبوتات الموثوقة.\n` +
                `> تواصل مع مالك البوت الرئيسي للترقية.`,
            );
            }
    }

      }

      const modeConfig = {
        all: { allowed: null, excluded: null, name: "كل الميزات" },
        md: {
          allowed: null,
          excluded: ["pushkontak", "store", "panel", "otp"],
          name: "متعدد الأجهزة",
        },
        cpanel: { allowed: [...baseAllowed, "tools", "panel"], name: "لوحة التحكم" },
        pushkontak: {
          allowed: [...baseAllowed, "pushkontak"],
          name: "دفع جهات الاتصال",
        },
        store: { allowed: [...baseAllowed, "store"], name: "متجر" },
        otp: { allowed: [...baseAllowed, "otp"], name: "OTP" },
      };

      const categoryModeMap = {
        download: "md",
        search: "md",
        ai: "md",
        fun: "md",
        game: "md",
        media: "md",
        utility: "md",
        tools: "md",
        ephoto: "md",
        religi: "md",
        info: "md",
        panel: "cpanel",
        pushkontak: "pushkontak",
        store: "store",
        otp: "otp",
        jpm: "md",
      };

      const currentConfig = modeConfig[botMode] || modeConfig.all;

      if (
        m.command !== "botmode" &&
        m.command !== "menu" &&
        m.command !== "menucat"
      ) {
        let isBlocked = false;

        if (
          currentConfig.allowed &&
          !currentConfig.allowed.includes(pluginCategory)
        ) {
          isBlocked = true;
        }
        if (
          currentConfig.excluded &&
          currentConfig.excluded.includes(pluginCategory)
        ) {
          isBlocked = true;
        }

        if (isBlocked) {
          const suggestedMode = categoryModeMap[pluginCategory] || "all";
          const suggestedModeName =
            modeConfig[suggestedMode]?.name || "متعدد الأجهزة";

          await m.reply(
            `🔒 *الأمر غير متاح*\n\n` +
            `> البوت في وضع *${currentConfig.name}*\n` +
            `> الأمر ${m.prefix}${m.command} متاح في وضع *${suggestedModeName}*\n\n` +
            `💡 تواصل مع مشرف المجموعة لتغيير الوضع:\n` +
            `${m.prefix}وضع_البوت ${suggestedMode}`,
          );
          return;
        }
      }
    }

    // إذا البلوقن يدعم المجموعات والخاص معاً
    if (plugin.config.isGroup === true && plugin.config.isPrivate === true) {
      // تخطي التحقق - البلوقن يدعم النوعين
    } else {
      const permission = checkPermission(m, plugin.config);
      if (!permission.allowed) {
        await m.reply(permission.reason);
        return;
      }
    }

    // V6: لا منع لأي أمر بسبب عدم التسجيل — الهوية معروفة من المرسل، والتسجيل تخصيص اختياري (.daftar)

    const user = db.getUser(m.sender);

    if (!m.isOwner && !m.isPartner && plugin.config.cooldown > 0) {
      const cooldownRemaining = db.checkCooldown(
        m.sender,
        m.command,
        plugin.config.cooldown,
      );
      if (cooldownRemaining) {
        m.react("⏱️").catch((error) => { noteFailure("handler", error, {where: "src/handler.js:1815",stage: "m.react"}); });
        // أمر أرسلته النواة نيابةً عن كلام طبيعي: التفاعل وحده غير مفهوم ⇒ سبب صريح بالوقت المتبقي (لا تجاوز)
        if (options.aiDispatched) {
          const waitLang = getUserLanguage(db.getUser(m.sender));
          await m.reply(t(waitLang, "common.cooldown", { time: Math.ceil(Number(cooldownRemaining) || 1) })).catch((error) => { noteFailure("handler", error, { where: "src/handler.js:cooldown-ai", stage: "m.reply" }); });
        }
        return;
      }
    }

    const energiEnabled =
      db.setting("energi") !== undefined
        ? db.setting("energi")
        : config.energi?.enabled !== false;
    if (energiEnabled && plugin.config.energi > 0) {
      const ownerEnergi = config.energi?.owner ?? -1;
      const premiumEnergi = config.energi?.premium ?? -1;
      const defaultEnergi = config.energi?.default ?? 0;

      let currentEnergi;
      if (
        (m.isOwner || m.isPartner) &&
        (ownerEnergi === -1 || user?.energi === -1)
      ) {
      } else if (m.isPremium && (premiumEnergi === -1 || user?.energi === -1)) {
      } else {
        currentEnergi =
          user?.energi ??
          (m.isOwner || m.isPartner
            ? ownerEnergi
            : m.isPremium
              ? premiumEnergi
              : defaultEnergi);
        if (currentEnergi < plugin.config.energi) {
          const energiLang = getUserLanguage(user);
          await m.reply(
            energiLang === "ar"
              ? config.messages?.energiExceeded || t(energiLang, "common.energyExceeded")
              : t(energiLang, "common.energyExceeded"),
          );
          return;
        }
        db.updateEnergi(m.sender, -plugin.config.energi);

        if (db.setting("notiflimit")) {
          const limitLang = getUserLanguage(user);
          const amount = plugin.config.energi.toString();
          const left = (currentEnergi - plugin.config.energi).toString();
          let limitMsg =
            limitLang === "ar" && config.messages?.limitDeducted
              ? config.messages.limitDeducted
              : t(limitLang, "common.limitDeducted", { amount, left });
          limitMsg = limitMsg.replace("{amount}", amount).replace("{sisa}", left).replace("{left}", left);
          await m.reply(limitMsg);
        }
      }
    }

    if (db.setting("autoTyping") ?? config.features?.autoTyping) {
      sock.sendPresenceUpdate("composing", m.chat).catch((error) => { noteFailure("handler", error, {where: "src/handler.js:1869",stage: "sock.sendPresenceUpdate"}); });
    }

    // كلمات فرعية بالإنجليزية/الإسبانية (on, delete, list…) ← الكلمة العربية التي يفهمها البلوقن
    try { localizeCommandArgs(m, plugin); } catch (error) { noteFailure("handler", error, {where: "src/handler.js:1873",stage: "localizeCommandArgs"}); }

    const context = {
      sock,
      m,
      args: m.args || [],
      text: m.text || "",
      command: m.command || "",
      prefix: m.prefix || config.command?.prefix || ".",
      config,
      db,
      uptime: getUptime(),
      plugins: {
        count: getPluginCount(),
      },
      jadibotId: jadibotId,
      isJadibot: isJadibot,
    };

    try {
      await plugin.handler(m, context);
    } catch (pluginError) {
      options.observer?.done?.({ ok: false, status: "error", error: String(pluginError?.message || pluginError).slice(0, 200) });
      if (m.aiRouted && !options.observer) noteAiRoutedResult(m, false, pluginError?.message);
      throw pluginError;
    }
    options.observer?.done?.({ ok: true, status: "done", command: m.command });
    if (m.aiRouted && !options.observer) noteAiRoutedResult(m, true, "");

    if (!m.isOwner && !m.isPartner && plugin.config.cooldown > 0) {
      db.setCooldown(m.sender, m.command, plugin.config.cooldown);
    }

    db.incrementStat("commandsExecuted");
    db.incrementStat(`command_${m.command}`);

    if (db.setting("autoTyping") ?? config.features?.autoTyping) {
      sock.sendPresenceUpdate("paused", m.chat).catch((error) => { noteFailure("handler", error, {where: "src/handler.js:1910",stage: "sock.sendPresenceUpdate"}); });
    }
  } catch (error) {
    logger.error("handler", `${error.message}`);
    console.error("[Handler Stack]", error.stack);

    try {
      const db = getDatabase();
      if (db) {
        db.incrementStat("commandErrors");
        const errorLog = db.setting("errorLog") || [];
        errorLog.unshift({
          cmd: "unknown",
          err: error.message?.substring(0, 200),
          at: Date.now(),
        });
        if (errorLog.length > 50) errorLog.splice(50);
        db.setting("errorLog", errorLog);
      }
    } catch (error) { noteFailure("handler", error, {where: "src/handler.js:1929",stage: "getDatabase"}); }

    try {
      const m = await serialize(sock, msg);
      if (m) {
        await m.reply(`يبدو أن هناك مشكلة، تواصل مع المطور`);
      }
    } catch {
      logger.error("فشل إرسال رسالة الخطأ");
    }
  }
}

async function groupHandler(update, sock) {
  try {
    if (global.sewaLeaving) return;

    const { id: groupJid, participants, action } = update;

    if (
      !participants ||
      !Array.isArray(participants) ||
      participants.length === 0
    ) {
      return;
    }

    const db = getDatabase();

    let groupData = db.getGroup(groupJid);
    if (!groupData) {
      db.setGroup(groupJid, {
        welcome: config.welcome?.defaultEnabled ?? true,
        goodbye: config.goodbye?.defaultEnabled ?? true,
        leave: config.goodbye?.defaultEnabled ?? true,
      });
      groupData = db.getGroup(groupJid);
    }

    let groupMeta;
    try {
      const cached = global.groupMetadataCache?.get(groupJid);
      if (cached && Date.now() - (cached._ts || 0) < 30000) {
        groupMeta = cached;
      } else {
        groupMeta = await sock.groupMetadata(groupJid);
        if (global.groupMetadataCache) {
          groupMeta._ts = Date.now();
          global.groupMetadataCache.set(groupJid, groupMeta);
        }
      }

      if (groupMeta?.participants) {
        cacheParticipantLids(groupMeta.participants);
      }
    } catch (e) {
      if (
        e.message?.includes("forbidden") ||
        e.message?.includes("401") ||
        e.message?.includes("403")
      ) {
        return;
      }
      if (
        e.message?.includes("rate-overlimit") ||
        e?.output?.statusCode === 429
      ) {
        logger.warn("GroupHandler", "تحديد معدل، تخطي الحدث");
        return;
      }
      throw e;
    }

    for (let participant of participants) {
      let participantJid;

      if (typeof participant === "object" && participant !== null) {
        participantJid =
          participant.jid || participant.id || participant.lid || "";
      } else {
        participantJid = participant;
      }

      if (!participantJid || typeof participantJid !== "string") continue;

      if (isLid(participantJid) || isLidConverted(participantJid)) {
        const found = groupMeta.participants?.find(
          (p) =>
            p.id === participantJid ||
            p.lid === participantJid ||
            p.lid === participantJid.replace("@s.whatsapp.net", "@lid"),
        );
        if (found) {
          participantJid =
            found.jid &&
              !found.jid.endsWith("@lid") &&
              !isLidConverted(found.jid)
              ? found.jid
              : found.id &&
                !found.id.endsWith("@lid") &&
                !isLidConverted(found.id)
                ? found.id
                : lidToJid(participantJid);
        } else {
          participantJid = lidToJid(participantJid);
        }
      }

      participant = participantJid;

      if (action === "add" && sendWelcomeMessage) {
        await sendWelcomeMessage(sock, groupJid, participant, groupMeta);
      }

      if (action === "remove" && sendGoodbyeMessage) {
        await sendGoodbyeMessage(sock, groupJid, participant, groupMeta);
      }

      const saluranId = config.saluran?.id || "120363418715609508@newsletter";
      const saluranName =
        config.saluran?.name || config.bot?.name || "Bot Terboo";

      let groupPpUrl = null;
      try {
        groupPpUrl = await sock.profilePictureUrl(groupJid, "image");
      } catch (error) { noteFailure("handler", error, {where: "src/handler.js:2054",stage: "sock.profilePictureUrl"}); }

      const rankActions = {
        promote: {
          notifKey: "notifPromote",
          imgKey: "_promoteImg",
          // صورة الترقية الخاصة (يغيّرها أمر «تغيير_صورة_الترقية»)، وإلا صورة البوت
          imgPath: config.assets["terboo-promote"] || config.assets["terboo"],
          emoji: "🎉",
          label: "ترقية",
          text: (p, a) =>
            `🌿 @${p} أصبح مشرفاً جديداً 💕\nتمت الترقية بواسطة: @${a}`,
        },
        demote: {
          notifKey: "notifDemote",
          imgKey: "_demoteImg",
          imgPath: config.assets["terboo-demote"],
          emoji: "📉",
          label: "تنزيل",
          text: (p, a) =>
            `🌿 @${p} لم يعد مشرفاً.\nتم التنزيل بواسطة: @${a}`,
        },
      };

      const rankCfg = rankActions[action];
      if (rankCfg && groupData[rankCfg.notifKey] === true) {
        const author = update.author || null;
        if (!groupHandler[rankCfg.imgKey]) {
          try {
            groupHandler[rankCfg.imgKey] = fs.readFileSync(rankCfg.imgPath);
          } catch {
            groupHandler[rankCfg.imgKey] = null;
          }
        }
        if (groupHandler[rankCfg.imgKey]) {
          const pNum = participant.split("@")[0];
          const aNum = author?.split("@")[0] || "غير معروف";
          const mentions = author ? [participant, author] : [participant];

          const fakeQuoted = {
            key: {
              fromMe: false,
              participant: participant,
              remoteJid: participant
            },
            message: {
              conversation: action === "promote"
                ? `مرحباً بالجميع، أنا مشرف جديد هنا`
                : `للأسف، لم أعد مشرفاً 😔`
            }
          };

          const media4 = await prepareWAMessageMedia({ image: groupHandler[rankCfg.imgKey] }, { upload: sock.waUploadToServer });

          const promoteButtons = [
            {
              name: "cta_url",
              buttonParamsJson: JSON.stringify({
                display_text: "🍙 كيف تصبح مشرفاً",
                url: "https://www.whatsapp.com/communities/learning/beingagoodadmin?lang=ar",
                merchant_url: "https://www.whatsapp.com/communities/learning/beingagoodadmin?lang=ar"
              })
            },
            {
              name: "quick_reply",
              buttonParamsJson: JSON.stringify({
                display_text: "🖐 مرحباً بالمشرف الجديد",
                id: ""
              })
            }
          ];

          const demoteButtons = [
            {
              name: "quick_reply",
              buttonParamsJson: JSON.stringify({
                display_text: "استمر بقوة! 💪",
                id: ""
              })
            }
          ];

          const msg4 = generateWAMessageFromContent(groupJid, {
            viewOnceMessage: {
              message: {
                messageContextInfo: {},
                interactiveMessage: {
                  header: { title: "", subtitle: "", hasMediaAttachment: true, imageMessage: media4.imageMessage },
                  footer: { text: config.bot?.name || "Bot Terboo" },
                  body: { text: rankCfg.text(pNum, aNum) },
                  contextInfo: {
                    mentionedJid: mentions,
                    isForwarded: true,
                    forwardingScore: 9999,
                    forwardedNewsletterMessageInfo: {
                      newsletterJid: config.saluran?.id || "120363418715609508@newsletter",
                      newsletterName: config.saluran?.name || config.bot?.name || "Bot Terboo",
                      serverMessageId: 127,
                    },
                  },
                  nativeFlowMessage: {
                    messageParamsJson: JSON.stringify({
                      limited_time_offer: {
                        text: action === "promote" ? `مبروك 🎉` : `استمر بقوة 📉`,
                        url: "مرحباً",
                        expiration_time: Date.now() + 1000000
                      },
                      bottom_sheet: { in_thread_buttons_limit: 2, divider_indices: [1, 2], list_title: "خيارات", button_title: "🍙 عرض الخيارات" },
                      tap_target_configuration: { title: " X ", description: "إغلاق", canonical_url: "https://github.com/Tarboobot2888", domain: "shop.example.com", button_index: 0 },
                    }),
                    buttons: action === "promote" ? promoteButtons : demoteButtons
                  }
                }
              }
            }
          }, { quoted: fakeQuoted, userJid: sock.user.jid });

          await sock.relayMessage(groupJid, msg4.message, { messageId: msg4.key.id });
        }
      }
    }
  } catch (error) {
    console.error("[GroupHandler] Error:", error.message);
  }
}

async function messageUpdateHandler(updates, sock) {
  const db = getDatabase();

  for (const update of updates) {
    try {
      await handleAntiRemove(update, sock, db);
    } catch (error) {
      continue;
    }

    try {
      const editedMsg = update.update?.message?.editedMessage?.message;
      const regularMsg = update.update?.message;

      const resolvedMessage =
        editedMsg ||
        (regularMsg && !regularMsg.protocolMessage ? regularMsg : null);

      if (!resolvedMessage) continue;

      const newMsg = {
        key: update.key,
        message: editedMsg ? { ...resolvedMessage } : regularMsg,
        messageTimestamp:
          update.messageTimestamp || Math.floor(Date.now() / 1000),
        pushName: update.pushName || "مستخدم",
      };

      await messageHandler(newMsg, sock);
    } catch (error) {
      console.error("[MsgUpdate] Error:", error.message);
    }
  }
}

const groupSettingsCache = new Map();
const GROUP_SETTINGS_COOLDOWN = 1000;

async function groupSettingsHandler(update, sock) {
  try {
    if (global.sewaLeaving) return;
    if (global.isFetchingGroups) return;

    const groupId = update.id;
    if (!groupId || !groupId.endsWith("@g.us")) return;

    if (update.announce === undefined && update.restrict === undefined) {
      return;
    }

    const cached = groupSettingsCache.get(groupId) || {};
    const now = Date.now();

    if (
      cached.lastUpdate &&
      now - cached.lastUpdate < GROUP_SETTINGS_COOLDOWN
    ) {
      return;
    }

    let hasRealChange = false;

    let groupName = groupId;
    let groupPpUrl = null;
    try {
      const meta = await sock.groupMetadata(groupId);
      groupName = meta?.subject || groupId;
    } catch (error) { noteFailure("handler", error, {where: "src/handler.js:2246",stage: "sock.groupMetadata"}); }
    try {
      groupPpUrl = await sock.profilePictureUrl(groupId, "image");
    } catch (error) { noteFailure("handler", error, {where: "src/handler.js:2249",stage: "sock.profilePictureUrl"}); }

    const db = getDatabase();
    const groupData = db.getGroup(groupId) || {};

    const terbooContext = {
      contextInfo: saluranCtx(),
    };

    if (update.announce !== undefined) {
      if (cached.announce === undefined) {
        cached.announce = update.announce;
      } else if (cached.announce !== update.announce) {
        hasRealChange = true;

        if (update.announce === true && groupData.notifCloseGroup === true) {
          await sock.sendText(
            groupId,
            `🥗 مجموعة *${groupName}* تم إغلاقها بواسطة المشرف`,
            null,
            terbooContext,
          );
        }

        if (update.announce === false && groupData.notifOpenGroup === true) {
          await sock.sendText(
            groupId,
            `🎃 مجموعة *${groupName}* تم فتحها مرة أخرى بواسطة المشرف`,
            null,
            terbooContext,
          );
        }

        cached.announce = update.announce;
      }
    }

    if (update.restrict !== undefined) {
      if (cached.restrict === undefined) {
        cached.restrict = update.restrict;
      } else if (cached.restrict !== update.restrict) {
        hasRealChange = true;

        if (update.restrict === true) {
          await sock.sendText(
            groupId,
            `🥗 معلومات مجموعة *${groupName}* مقيدة!\nفقط المشرفين يمكنهم التعديل`,
            null,
            terbooContext,
          );
        } else {
          await sock.sendText(
            groupId,
            `🥗 معلومات مجموعة *${groupName}* مفتوحة!\nجميع الأعضاء يمكنهم التعديل`,
            null,
            terbooContext,
          );
        }
        cached.restrict = update.restrict;
      }
    }
    if (hasRealChange) {
      cached.lastUpdate = now;
    }
    if (cached.announce !== undefined || cached.restrict !== undefined) {
      groupSettingsCache.set(groupId, cached);
    }
  } catch (error) {
    console.error("[GroupSettings] Error:", error.message);
  }
}

export {
  messageHandler,
  groupHandler,
  messageUpdateHandler,
  groupSettingsHandler,
  checkPermission,
  checkMode,
  isSpamming,
  allowIncomingMessageProcessing,
  handleAntiRemoveFromUpsert,
};
