// ═══════════════════════════════════════════════
// 🧠 Terboo Intelligence Kernel — النواة الواحدة لكل ذكاء البوت (§5)
// ───────────────────────────────────────────────
//   Message → Identity → Scope → Context → Memory Retrieval → Intent
//   → CHAT | COMMAND | AGENT | PROJECT | MEMORY
//   → Permissions → Tool/Plugin → Result → Memory Update → Localized Response
//
// كل مسارات الذكاء تمر من هنا:
//   • الذكاء بلا بادئة (الخاص/الإشارة/الرد)      → runKernel
//   • Auto AI للمجموعات                          → preRoute + composeReply
//   • المساعد القديم (terboo-ai-assistant.js)     → واجهة فوق runKernel
//   • الوكيل متعدد الخطوات                       → terboo-ai-agent.js
//   • تحكّم المالك بلغة طبيعية                   → terboo-ai-owner.js
//   • الذاكرة والسياق والمزوّدات                  → الذاكرة المركزية + context + providers
//
// الصلاحيات (§13): النواة لا تنفّذ أي إجراء بنفسها. كل أمر يُرسل عبر
// dispatchCommand إلى المسار الطبيعي للبوت بكل فحوصاته، وتُقرأ نتيجته
// الحقيقية (نجح / فشل / حُجب) وتُحفظ في الذاكرة.
//
// أنواع القرار (§10):
//   CHAT · COMMAND · AGENT · PROJECT_OPERATION · MEMORY_OPERATION
//   · CLARIFICATION · REFUSAL
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import config from "../../config.js";
import { getPlugin } from "./terboo-plugins.js";
import { getUserLanguage, t } from "./terboo-localization.js";
import * as UI from "./terboo-ui-theme.js";
import * as brand from "./terboo-brand.js";
import { findEntry, pluginExists, shortlist } from "./terboo-command-index.js";
import { wordVariants } from "./terboo-ai-intents.js";
import { buildContextPackage, detectReplyLanguage, toProviderPayload } from "./terboo-ai-context.js";
import { ask as providerAsk, providerNames } from "./terboo-ai-providers.js";
import { normalizeProviderText } from "./terboo-ai-router.js";
import { markRaw } from "./terboo-i18n/runtime.js";
import { dispatchCommand } from "./terboo-command-dispatch.js";
import { reportLines, runAgent } from "./terboo-ai-agent.js";
import { executeApprovedOwnerPending, executeOwnerIntent, isConfigOwner, parseOwnerIntent } from "./terboo-ai-owner.js";
import { getScraper, mightNeedTool, platformLabel, resolveScraperIntent, runScraper, toolListForModel } from "./terboo-scraper-registry.js";
import { attachTrace, claimAiMessage, markFirstResponse, startTrace, stepOf, traceOf } from "./terboo-latency.js";
import { diversify } from "./terboo-ai-diversity.js";
import { identityOf, jidFromDigits } from "./terboo-identity.js";
import { claimPrimary, enter as enterLane, isCancelText } from "./terboo-concurrency.js";
import { PATTERNS as GATE_PATTERNS, classify as classifyIntent } from "./terboo-intent-gate.js";
import { languageLabel, requestedLanguage } from "./terboo-languages.js";
import { MEDIA_INTENTS, runMediaStrategy, sendVoiceReply } from "./terboo-ai-media.js";
import { applyTalkControl, talkBlock } from "./terboo-ai-talk-control.js";
import { recentContacts } from "./terboo-serialize.js";
import { toolsForModel } from "./terboo-tool-registry.js";
import { handleReminder } from "./terboo-reminders.js";
import { ACTIVE as ACTIVE_TASK_STATES, controlTask, taskOwner } from "./terboo-task-control.js";
import { isReplayableTool } from "./terboo-task-runners.js";
import { PRIORITY as TASK_PRIORITY, enqueueTask, latestTask } from "./terboo-task-queue.js";
import { runActionEngine } from "./terboo-action-engine.js";
import { observeMessage } from "./terboo-context-engine.js";
import { resolveResponseMode } from "./terboo-command-ui.js";
import { GROUP_TOOLS, groupToolsForModel, permText, runGroupTool } from "./terboo-group-agent.js";
import { MESSAGING_TOOLS, messagingToolsForModel, runMessagingTool } from "./terboo-messaging-agent.js";
import { SSH_TOOLS, runSshTool, sshToolsForModel } from "./terboo-ssh-agent.js";
import { sendCard } from "./terboo-ui-kit.js";
import {
  conversationScope,
  conversationState,
  forget,
  forgetLast,
  forgetUserEverywhere,
  peekPending,
  previousAnswer,
  recordTurn,
  recordWork,
  refreshSummary,
  remember,
  setEnabled,
  setOwnerInspection,
  setPending,
  setTTLDays,
  snapshot,
  takePending,
} from "./terboo-ai-memory.js";

// ── ضبط ──────────────────────────────────────
const MIN_CONFIDENCE = 0.55;
// لا تأخير ثابت (كان RATE_LIMIT_MS = 4000): Smart Concurrency Controller في terboo-concurrency.js
const MAX_TEXT_LENGTH = 600;
/** تعليمات طلبات الكود: جواب مباشر بلا JSON */
const CODE_INSTRUCTION = "The user is asking for code. Reply in the user's language with one short sentence, then the complete working code in a fenced block with its language tag (for example ```js), then at most two short notes. Inside the code use English identifiers (variable, function and class names) as professional code does; comments may be in the user's language. Plain text only — never wrap the answer in JSON.";
/** اللغة المطلوبة بالاسم («بلغة روبي» · «in kotlin») ⇒ تُكتب بها ويُوسم السياج بمعرّفها */
const codeInstruction = (text) => {
  const wanted = requestedLanguage(text);
  return wanted ? `${CODE_INSTRUCTION} The requested language is ${languageLabel(wanted)}: write the code in ${languageLabel(wanted)} and tag the fence \`\`\`${wanted}.` : CODE_INSTRUCTION;
};
/** تفريغ الملاحظة الصوتية أطول من الرسالة المكتوبة (دقيقتان كلام ≈ 2000 حرف) */
const MAX_TRANSCRIPT_LENGTH = 2000;
/** نافذة «الرد السريع»: أداة تنتهي خلالها تُسلَّم مباشرة، وإلا تكمل في الخلفية بإشعار فوري (§18) */
const FAST_WINDOW_MS = 2500;
const MAX_LISTED = 40;          // أقصى ما يُعرض على النموذج من المرشّحين الديناميكيين
const OWNER_REVERT_WINDOW_MS = 30 * 60 * 1000;

/** أنواع القرار المعتمدة (§10) */
const DECISIONS = {
  CHAT: "CHAT",
  COMMAND: "COMMAND",
  AGENT: "AGENT",
  PROJECT_OPERATION: "PROJECT_OPERATION",
  MEMORY_OPERATION: "MEMORY_OPERATION",
  CLARIFICATION: "CLARIFICATION",
  REFUSAL: "REFUSAL",
  TOOL: "TOOL",
};

/** ثقة كافية لتنفيذ أداة مباشرة بلا نداء نموذج (§9 §22) */
const TOOL_FAST_CONFIDENCE = 0.85;

if (!global.terbooKernel) global.terbooKernel = { lastCall: new Map(), waiting: new Map() };
if (!global.terbooKernel.waiting) global.terbooKernel.waiting = new Map();
const kernelState = global.terbooKernel;

// ═══════════════════════════════════════════════
// ① Message — هل خوطب البوت أصلاً؟
// ═══════════════════════════════════════════════

function botIdentifiers(sock) {
  const raw = sock?.user?.id || "";
  const number = raw.split(":")[0].split("@")[0];
  const ids = new Set();
  if (number) {
    ids.add(number);
    ids.add(`${number}@s.whatsapp.net`);
  }
  if (sock?.user?.lid) ids.add(String(sock.user.lid).split(":")[0]);
  if (sock?.user?.jid) ids.add(sock.user.jid);
  return { ids, number };
}

/** جلسة تفاعلية جارية (تسجيل، لعبة، مسابقة) — لا نقاطعها أبداً */
function hasOpenSession(m) {
  const key = String(m.sender || "").replace(/[^0-9]/g, "");
  if (global.registrationSessions?.[key]) return true;
  if (global.giveawaySessions?.has?.(m.sender)) return true;
  if (global.sulapSessions?.has?.(m.quoted?.id)) return true;
  if (global.confessData?.has?.(m.quoted?.id)) return true;
  try {
    for (const store of [global.suitGames, global.tictactoeGames, global.ulartanggaGames]) {
      if (store && Object.values(store).some((room) => room?.chat === m.chat)) return true;
    }
  } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:113",stage: "Object.values"}); }
  return false;
}

/**
 * اسم البوت بكل صيغه المنطوقة/المكتوبة: تيربو · تربو · تيربوو · تربوو · terboo · tarboo · terbo · tarbo
 * (حرف «ي» اختياري، و«و» قابلة للمد؛ e/a لاتينياً).
 */
const BOT_NAME = "(?:تي?ربو+|t[ae]rbo+)";
const NAME_END_CHARS = "(?=$|[\\s،,.:!؟?…\\u{1F300}-\\u{1FAFF}\\u2600-\\u27BF])";
/** المناداة بالاسم (v4 §23): في أول الرسالة «تربو …» · «يا تيربو …» · «@Terboo …» · «hey tarbo …» */
const NAME_TRIGGER = new RegExp(`^\\s*(?:(?:يا|hey|hi|hello|ya|yo)\\s*)?@?${BOT_NAME}${NAME_END_CHARS}`, "iu");
/** نداء في أي موضع: «… يا تربو …» */
const NAME_VOCATIVE = new RegExp(`(?:^|\\s)(?:يا|ya)\\s*${BOT_NAME}${NAME_END_CHARS}`, "iu");
/** كلمة قبل الاسم تجعله كلاماً عن البوت لا نداءً له («قال تيربو» · «اسأل تيربو» · «مع تيربو» · «said terboo») */
const ABOUT_BOT_BEFORE = "(?:قال|قالت|قالي|قالو|قالوا|يقول|بيقول|بتقول|سال|سأل|اسال|اسأل|اساله|اسأله|عن|مع|زي|بتاع|من|الى|إلى|على|علي|اسمه|اسمها|اسم|about|with|from|ask|asked|said|says|to|by|like|named|called|dijo|con|de|sobre)";
/** الاسم كآخر كلمة: «عامل ايه تربو» · «ازيك terbo؟» (لا وسط الجملة: «تربو على الألف» فعل عربي؛ ولا «قال تيربو») */
const NAME_LAST = new RegExp(`(?<!(?:^| )${ABOUT_BOT_BEFORE}) @?${BOT_NAME}[\\s،,.:!؟?…\\u{1F300}-\\u{1FAFF}\\u2600-\\u27BF]*$`, "iu");

function nameTrigger(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return NAME_TRIGGER.test(value) || NAME_VOCATIVE.test(value) || NAME_LAST.test(value);
}

function stripNameTrigger(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(NAME_TRIGGER, "")
    .replace(NAME_VOCATIVE, " ")
    .replace(NAME_LAST, "")
    .replace(/^[\s،,.:!]+/, "")
    .replace(/\s+([؟?!.،,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * الخاص   : أي رسالة نصية بلا بادئة (v4 §22).
 * المجموعة: إشارة (mention) للبوت · رد على رسالته · رسالة تبدأ باسمه «تيربو» — فقط (v4 §23).
 *           لا رد على المحادثة العامة أبداً.
 */
/** ملاحظة صوتية بلا نص: تُفهم بالتفريغ الحقيقي (§28) — الوسيط الوحيد الذي يُشرك النواة بلا نص */
function isVoiceNote(m) {
  return Boolean(m && (m.isAudio || m.message?.audioMessage) && (m.ptt || m.message?.audioMessage?.ptt));
}

function shouldEngage(m, sock) {
  if (!m || (!m.body && !isVoiceNote(m))) return { engaged: false, reason: "" };
  if (m.fromMe || m.isBot || m.isNewsletter) return { engaged: false, reason: "" };
  if (m.isCommand) return { engaged: false, reason: "" };
  if (m.aiDispatched) return { engaged: false, reason: "" };
  if (m.chat === "status@broadcast") return { engaged: false, reason: "" };
  if (hasOpenSession(m)) return { engaged: false, reason: "" };

  const bare = String(m.body || "").trim();
  if (/^https?:\/\/\S+$/i.test(bare)) return { engaged: false, reason: "" };

  if (m.quoted?.key?.fromMe) return { engaged: true, reason: "reply" };

  const { ids, number } = botIdentifiers(sock);

  if (m.isGroup) {
    const mentioned = (m.mentionedJid || []).some((jid) => {
      const clean = String(jid).split("@")[0].split(":")[0];
      // رقم البوت أو LID الخاص به (منشن البوت باسم العرض قد يصل LID)
      return ids.has(String(jid)) || ids.has(clean) || (number && clean === number);
    });
    if (mentioned) return { engaged: true, reason: "mention" };
    if ([...ids].some((id) => /^\d{6,}$/.test(id) && bare.includes(`@${id}`))) return { engaged: true, reason: "mention" };
    if (nameTrigger(bare)) return { engaged: true, reason: "name" };
    return { engaged: false, reason: "" };
  }

  return { engaged: true, reason: "private" };
}

/** إزالة إشارة البوت من النص قبل تحليله */
function cleanRequestText(m, sock) {
  const { ids } = botIdentifiers(sock);
  let text = String(m.body || "");
  // إشارة البوت (رقمه أو LID) ليست جزءاً من الطلب
  for (const id of ids) if (/^\d{6,}$/.test(id)) text = text.split(`@${id}`).join(" ");
  return stripNameTrigger(text.replace(/\s+/g, " ").trim()).slice(0, MAX_TEXT_LENGTH);
}

// ═══════════════════════════════════════════════
// ② Identity + لغة الرد (§36)
// ═══════════════════════════════════════════════

/** لغة الرد: لغة الرسالة الحالية، ثم لغة المستخدم المحفوظة. لكل شخص لغته حتى داخل المجموعة */
function replyLanguage(m, db, text) {
  return detectReplyLanguage(text, getUserLanguage(db?.getUser?.(m?.sender)));
}

/** شخصية Bot Terboo المحايدة لغوياً (من config) */
function defaultPersona() {
  const personas = config.autoaiPersonas || {};
  return personas.BotTerboo || Object.values(personas)[0]
    || `You are ${brand.botName()}, the assistant of this WhatsApp bot, built by ${brand.developerName()}. Reply in the user's language.`;
}

// ═══════════════════════════════════════════════
// ④ Intent — طلبات ممنوعة + نوايا حتمية + النموذج
// ═══════════════════════════════════════════════

/** طلبات ممنوعة بنيوياً — تُرفض قبل الوصول لأي نموذج (§12) */
const FORBIDDEN_REQUEST = [
  /\b(?:eval|exec|execSync|spawnSync|child_process|rm\s+-rf|shutdown|reboot)\b/i,
  /(?:اعطني|اطبع|اعرض|هات|ابعت)[^\n]{0,30}(?:مفتاح|مفاتيح|api\s*key|token|باسورد|كلمة المرور|session|creds)/i,
  /\b(?:show|print|send|dump|leak)\b[^\n]{0,30}\b(?:api[_ ]?key|secret|token|password|credentials|session)\b/i,
  /(?:اقرا|افتح|اعرض)[^\n]{0,20}(?:\.env|creds\.json|session\/|database\/)/i,
  /\b(?:dame|muestra|imprime|env[ií]a)\b[^\n]{0,30}\b(?:clave|api[_ ]?key|token|contraseña|sesi[oó]n|credenciales)\b/i,
];

function isForbiddenRequest(text) {
  return FORBIDDEN_REQUEST.some((re) => re.test(String(text || "")));
}

function normalizeIntentText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/** نوايا الذاكرة بكلام طبيعي (§37) — الأدق أولاً، على النص المطبَّع */
const MEMORY_INTENTS = [
  { op: "allow-owner", re: /(?:اسمح|سماح|اذن)\s*(?:لل|ل)?(?:مالك|المالك|مطور|المطور)[^\n]{0,30}ذاكرتي|allow (?:the )?owner to (?:see|view|read|inspect) my memory|permite al (?:due[nñ]o|propietario) ver mi memoria/i },
  { op: "revoke-owner", re: /(?:امنع|الغي|الغ|اسحب)\s*(?:سماح|اذن|اطلاع)?\s*(?:ال)?(?:مالك|مطور)[^\n]{0,30}ذاكرتي|(?:revoke|remove) (?:the )?owner'?s? (?:access|permission)[^\n]{0,20}memory|revoca (?:el )?(?:permiso|acceso)[^\n]{0,30}memoria/i },
  { op: "forget-all", re: /(?:انسي|انسى|امسح|احذف)\s*(?:كل\s*(?:حاجه|شي|شيء)?\s*(?:تعرفه\s*)?عني|كل ذاكرتي|ذاكرتي كلها|ذاكرتي في كل مكان)|forget everything(?: about me)?|delete all (?:of )?my memor(?:y|ies)|olvida todo(?: sobre m[ií])?|borra toda mi memoria/i },
  { op: "forget-last", re: /(?:انسي|انسى|امسح|احذف)\s*(?:اخر|آخر)\s*(?:حاجه|معلومه|شي|شيء)|forget (?:the )?last (?:thing|fact)|olvida lo [uú]ltimo/i },
  { op: "delete", re: /(?:امسح|احذف|صفر)\s*(?:ال)?ذاكرتي|(?:امسح|احذف)\s*الذاكره|(?:clear|delete|reset|wipe) my memory|borra mi memoria/i },
  { op: "disable", re: /(?:اوقف|وقف|عطل|اطفي)\s*(?:ال)?ذاكره|متحفظش|لا تحفظ(?:\s*حاجه)?|stop remembering|(?:disable|turn off) (?:the |your )?memory|desactiva (?:la )?memoria|deja de recordar/i },
  { op: "enable", re: /(?:شغل|فعل|رجع)\s*(?:ال)?ذاكره|(?:enable|turn on) (?:the |your )?memory|activa (?:la )?memoria/i },
  { op: "ttl", re: /(?:احتفظ|خلي|خزن)[^\n]{0,20}(?:ذاكرتي|الذاكره)?[^\n]{0,10}?(\d{1,3})\s*(?:يوم|ايام)|keep (?:my )?memory (?:for )?(\d{1,3}) days?|guarda (?:mi )?memoria (?:por )?(\d{1,3}) d[ií]as/i },
  { op: "transparency", re: /(?:ايش|ايه|ماذا|شو|بتحفظ ايه)\s*(?:اللي)?\s*(?:بتحفظ|تحفظ|تخزن|بتخزن)(?:ه)?(?:\s*عني)?|what do you (?:store|save|keep)|qu[eé] guardas/i },
  { op: "show", re: /(?:ايش|ايه|ماذا|شو|ما)\s*(?:اللي)?\s*(?:تعرف|تعرفه|تتذكر|تتذكره|فاكر|فاكره|حافظ|حافظه)\s*عني|(?:اعرض|وريني|فرجني)\s*ذاكرتي|what do you (?:know|remember) about me|show (?:me )?my memory|qu[eé] (?:sabes|recuerdas) de m[ií]|muestra mi memoria/i },
];

function parseMemoryIntent(text) {
  const value = normalizeIntentText(text);
  if (!value || value.length > 200) return null;
  for (const { op, re } of MEMORY_INTENTS) {
    const match = value.match(re);
    if (match) {
      const days = Number(match.slice(1).find(Boolean));
      return op === "ttl" ? { op, days: Number.isFinite(days) ? days : 30 } : { op };
    }
  }
  return null;
}

/** كلمات الموافقة والإلغاء — لا معنى لها إلا بوجود إجراء معلّق */
const APPROVE_RE = /^(?:[وف]?(?:موافق|اوافق|وافقت|اكيد|ايوه|ايوا|اه|نعم|تمام|اوكي|ok|okay|yes|yep|sure|approve|approved|confirm|confirmed|s[ií]|claro|vale|apruebo|confirmo)(?:\s+(?:نفذ|نفذه|go ahead|do it|hazlo))?)[\s!.،,]*$/i;
const CANCEL_RE = /^(?:لا|لأ|الغاء|الغي|الغ|بلاش|سيبك|خلاص لا|cancel|stop|no|nope|nevermind|never mind|cancela|olv[ií]dalo)[\s!.،,]*$/i;

/** تعليمات النموذج: أنواع القرار + المرشّحون الديناميكيون */
function buildInstruction({ pkg, candidates, prefix }) {
  const commandList = candidates.slice(0, MAX_LISTED)
    .map(({ entry }) => {
      const flags = [
        entry.permissions.isOwner ? "owner-only" : null,
        entry.permissions.isPremium ? "premium" : null,
        entry.permissions.isAdmin ? "group-admin" : null,
        entry.permissions.isGroup ? "group-only" : null,
        entry.requirements.target ? "needs-target" : null,
        entry.requirements.media ? "needs-media" : null,
      ].filter(Boolean).join(",");
      const shown = brand.visibleAliases(entry.aliases);
      return `- ${entry.name}${shown.length ? ` (${shown.slice(0, 4).join(", ")})` : ""}`
        + ` [${entry.category}${flags ? `|${flags}` : ""}] :: ${entry.description || "no description"}`
        + `${entry.usage ? ` :: usage ${entry.usage}` : ""}`;
    })
    .join("\n");

  // Tool Search (§35): الأنسب للطلب والسياق فقط بدل الـ63 أداة كلها؛ لا تطابق ⇒ القائمة الكاملة
  const request = pkg?.request || pkg?.text || "";
  const hasImage = Boolean(pkg?.hasMedia || pkg?.hasImage);
  const toolList = mightNeedTool(request, { hasImage }) ? (toolsForModel(request, { hasImage, limit: 10 }) || toolListForModel()) : "";

  return [
    defaultPersona(),
    brand.brandLockPrompt(pkg?.language || "ar"),
    "",
    `You are the intelligence kernel of the WhatsApp bot "${brand.botName()}", built by ${brand.developerName()}.`,
    "The user never has to know exact command names. Understand intent, then decide.",
    "",
    "Candidate commands from the LIVE registry (choose only from these):",
    commandList || "- (none matched)",
    "",
    ...(toolList ? [
      "Tools from the scraper registry (real downloaders/searchers/image tools — choose only from these):",
      toolList,
      "",
    ] : []),
    ...(pkg?.groupTools ? [
      "Group / contact tools THIS user is allowed to use here (the bot checks permission, protects targets, confirms and verifies):",
      pkg.groupTools,
      "",
    ] : []),
    "Choose exactly one decision:",
    `  ${DECISIONS.COMMAND}           — run one of the listed commands for the user.`,
    `  ${DECISIONS.CHAT}              — just talk, answer, explain.`,
    `  ${DECISIONS.AGENT}             — the request needs several bot commands in order.`,
    `  ${DECISIONS.PROJECT_OPERATION} — inspect or modify the bot's own source files (owner only).`,
    `  ${DECISIONS.MEMORY_OPERATION}  — the user talks about what you remember (show/delete/stop/keep).`,
    `  ${DECISIONS.CLARIFICATION}     — you need one short question answered first.`,
    `  ${DECISIONS.REFUSAL}           — the request is unsafe or not allowed.`,
    `  ${DECISIONS.TOOL}              — run one tool from the Tools list (download from a link, search, create/edit/enhance an image…)${toolList || pkg?.groupTools ? "" : " — no tool is relevant here, do not choose it"}.`,
    "",
    "Rules:",
    "- Never invent a command name. Only names from the list above.",
    "- Put arguments exactly as the command expects; a person stays as @number.",
    "- Use the memory and conversation context given below to resolve pronouns and follow-ups.",
    "- If the user is correcting your previous choice, pick a DIFFERENT command.",
    `- For ${DECISIONS.AGENT}, fill "steps" with 2..6 entries of {command,args}; they will really be executed in order and verified.`,
    `- For ${DECISIONS.CLARIFICATION}, you may put the command you would run in "command"/"args", or up to 3 choices in "options" as [{command,args}].`,
    `- For ${DECISIONS.MEMORY_OPERATION}, set "memoryOp" to one of: show, delete, forget-last, forget-all, disable, enable, ttl, transparency.`,
    `- For ${DECISIONS.PROJECT_OPERATION}, set "projectOp" to one of: list, read, search, inspect, diagnostics, syntax, compare, changes, test, backup, fix, audit, manifest; "path" is the file.`,
    "- Never ask for, print, or store API keys, tokens, passwords, session or credential files.",
    ...(toolList ? [`- For ${DECISIONS.TOOL}, set "tool" to one tool id and "input" to {"url":"","query":"","prompt":"","format":"mp3|mp4"} as needed. Never invent a tool, a URL or code.`] : []),
    ...(pkg?.groupTools ? [`- For a group, messaging or server tool, "input" is {"names":[],"except":[],"text":"","minutes":0,"afterMinutes":0,"includeAdmins":false,"scope":"all|main|children","host":"","check":""}. Never put a shell command anywhere. Names exactly as the user wrote them — never a JID, and never a phone number the user did not write.`] : []),
    `- "responseMode" proposes how to answer: "text", "buttons" (choices the user can tap) or "confirm" (one complete action to approve). The bot's UI policy has the final word.`,
    `- "facts" is an optional array of durable things worth remembering about this speaker: [{"text":"...","type":"fact|preference|identity|decision|task|project|relationship|important_context","confidence":0.0}]`,
    "",
    "Answer with RAW JSON only, no markdown fence, exactly this shape:",
    `{"decision":"CHAT","command":"","args":"","steps":[],"options":[],"memoryOp":"","projectOp":"","path":"","tool":"","input":{},"reply":"","responseMode":"text","confidence":0.0,"facts":[]}`,
  ].join("\n");
}

/** أسطر جديدة/تبويب خام داخل نصوص JSON (كود داخل reply) ⇒ مهرّبة */
function escapeControlsInStrings(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === "\\") { escaped = true; out += ch; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

/** إصلاحات شائعة لـ JSON من نماذج ضعيفة: علامات ذكية · فواصل زائدة · مفاتيح بلا علامات/بعلامة مفردة */
function repairJson(text) {
  return escapeControlsInStrings(String(text)
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)'([A-Za-z_][\w]*)'\s*:/g, '$1"$2":')
    .replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:(?=\s*["'\d\[{tfn-])/g, '$1"$2":')
    .replace(/:\s*'((?:[^'\\]|\\.)*)'(?=\s*[,}])/g, (_, value) => `: ${JSON.stringify(value)}`));
}

/** كل كائنات {…} المتوازنة في النص (مع احترام النصوص بين علامات التنصيص) */
function balancedObjects(text) {
  const found = [];
  for (let start = text.indexOf("{"); start !== -1 && found.length < 6; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}" && --depth === 0) { found.push(text.slice(start, i + 1)); break; }
    }
  }
  return found;
}

/**
 * استخراج كائن القرار من رد النموذج حتى لو أحاطه بنص أو أسوار markdown،
 * أو كتب كوداً بأسطر خام داخل reply، أو استعمل صيغة JSON متساهلة.
 * @returns {Object|null} null إن لم يكن في الرد كائن JSON صالح
 */
function parseModelJson(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map((match) => match[1].trim());
  const sources = [...fenced, text];
  for (const source of sources) {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    const whole = start !== -1 && end > start ? [source.slice(start, end + 1)] : [];
    for (const candidate of [...whole, ...balancedObjects(source)]) {
      for (const attempt of [candidate, escapeControlsInStrings(candidate), repairJson(candidate)]) {
        try {
          const parsed = JSON.parse(attempt);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        } catch (error) {
          // المحاولة التالية (نسخة مُصلحة/كائن آخر)؛ آخر خطأ يُسجَّل في decide إن فشل كل شيء
          parseModelJson.lastError = error;
        }
      }
    }
  }
  return null;
}

/**
 * النموذج تجاهل صيغة القرار وأجاب مباشرة (شائع مع طلبات الكود: يكتب الكود نفسه):
 * الإجابة نفسها رد محادثة — بدل رميها وتنفيذ أقرب أمر بالخطأ.
 * رد يبدو قراراً مكسوراً («decision» بلا JSON صالح) ⇒ يُستخرج منه reply إن أمكن.
 */
function recoverDecision(raw) {
  const text = String(raw || "").trim();
  if (text.length < 2) return null;
  if (/["']?decision["']?\s*:/i.test(text)) {
    const kind = text.match(/["']?decision["']?\s*:\s*["']?([A-Za-z_]+)/i)?.[1]?.toUpperCase() || "";
    const reply = text.match(/["']?reply["']?\s*:\s*"((?:[^"\\]|\\.)*)"/i)?.[1];
    if (kind === "CHAT" && reply) {
      try { return { decision: "CHAT", reply: JSON.parse(`"${reply}"`), confidence: 0.6, recovered: "partial-json" }; } catch { return { decision: "CHAT", reply, confidence: 0.6, recovered: "partial-json" }; }
    }
    return null;
  }
  return { decision: "CHAT", reply: text, confidence: 0.6, recovered: "raw-text" };
}

/** أفعال طلب/أمر (عربي/مصري · إنجليزي · إسباني) — رسالة تحمل أحدها في بدايتها طلبٌ لا جملة خبرية */
const REQUEST_VERB = /^(?:اعمل|اعملي|نفذ|نفذه|شغل|شغلي|حمل|حملي|نزل|نزلي|ابحث|دور|دورلي|ترجم|ترجملي|اطرد|طرد|ارفع|رقي|اكتم|افتح|اقفل|قفل|انشا|انشاء|انش|انشء|انشي|انشيء|اضف|ضيف|ضيفني|احذف|امسح|شيل|غير|ابعت|ابعتلي|ارسل|هات|هاتلي|جيب|جيبلي|حول|حولي|صمم|ارسم|ولد|اعرض|وريني|فرجني|سجل|سجلني|الغي|فعل|عطل|ابدا|ابدء|خلي|اكتب|اكتبلي|كلم|بلغ|تابع|اجمع|احسب|اقترح|حدد|فكرني|ذكرني|نبهني|كمل|عدل|ظبط|رتب|حط|اقلب|make|create|send|add|remove|delete|kick|ban|translate|download|search|play|open|close|show|get|set|turn|start|stop|give|find|generate|convert|crea|envia|envía|añade|borra|busca|descarga|traduce|pon|abre|cierra|genera|convierte|muestra)$/;
/** خانة منسوخة من قالب الاستعمال لا قيمة حقيقية: «<الاسم>» · «اسم_المجموعة» · «رقمك» · «number» */
const PLACEHOLDER_ARG = /^(?:<[^>]*>|\[[^\]]*\]|\.{3}|…|(?:ال)?(?:اسم|اسمك|رقم|رقمك|ارقام|أرقام|المده|مده|المدة|مدة|نص|رابط|عضو)(?:[_\s]?[\u0600-\u06FF\w]*)?\d?|(?:your[_\s]?)?(?:name|number|numbers|phone|duration|text|link|user|member)(?:[_\s]?\w*)?\d?|group[_\s]?name)$/i;

/** اسم صريح في الطلب: «اسمها اصحاب تيربو» · «باسم …» · «named …» · «llamado …» */
const NAME_IN_TEXT = /(?:اسمها|اسمه|باسم|بإسم|تحت اسم|named|called|llamad[oa]|con el nombre)\s+["«“]?([^"»”|,،.\n]+?)["»”]?(?=\s+(?:و|and|y)\s|\s+و|[|,،.\n]|$)/i;

/** المرسل يقصد نفسه كهدف: «اضفني» · «ضيفني» · «حطني» · «add me» · «añádeme» */
const SELF_TARGET = /(?:^|\s)و?(?:ضيفني|اضفني|أضفني|ضفني|حطني|دخلني|ضمني|ارفعني|رقيني|سجلني|ضيفيني)(?=\s|$)|\b(?:add|include|invite|promote) me\b|añádeme|agrégame|invítame/i;

/** مقدمة تطلب من المستخدم بيانات أو تسأله («زودني باسم المجموعة…») — متناقضة مع أمر يُنفَّذ الآن */
const ASKS_INPUT = /(?:^|[^\p{L}])(?:زودني|زوّدني|زودنا|ابعتلي|ابعت لي|ارسل لي|أرسل لي|ارسلي|أرسلي|اكتب لي|اكتبلي|قولي|قل لي|حدد|حدّد|اعطني|أعطني|عرفني|عرّفني|please (?:provide|send|tell|give|specify)|could you (?:provide|send|tell|give|specify)|proporciona|indícame|dime)(?![\p{L}])/iu;

/** رد يدّعي أن إجراءً نُفّذ («تم إنشاء…» · «أضفتك…» · «Done, I created…») */
const ACTION_CLAIM = /^\s*(?:[^\n]{0,25}?\s)?(?:تمت?\s+(?:ال)?(?:انشاء|إنشاء|اضاف|إضاف|حذف|طرد|ارسال|إرسال|تنفيذ|تغيير|تعديل|حظر|ترقي|تنزيل|قفل|فتح|كتم|تفعيل|تعطيل|عمل|نقل|رفع)|(?:انشات|أنشأت|اضفتك|أضفتك|اضفت|أضفت|حذفت|طردت|ارسلت|أرسلت|بعتت|عملت\s+(?:ال)?(?:جروب|مجموعه|مجموعة))|done[,!.\s]|i(?:'ve| have) (?:created|added|sent|deleted|removed|kicked|banned|made)|he (?:creado|añadido|enviado|eliminado))/i;

/** جمل الرد: الادعاء قد يأتي في أي جملة لا في أولها فقط */
const sentencesOf = (text) => String(text || "").split(/(?<=[.!؟?\n])\s*/).filter((part) => part.trim());
const claimsAction = (text) => sentencesOf(text).some((sentence) => ACTION_CLAIM.test(sentence));
const withoutClaims = (text) => sentencesOf(text).filter((sentence) => !ACTION_CLAIM.test(sentence)).join(" ").trim();
const NO_ACTION_INSTRUCTION = "You executed no command and performed no action in this turn. Never say that anything was created, added, sent, deleted or done. Reply naturally to what the user said, in their language.";

/** أرقام JID (بلا جهاز/خادم) */
const digitsOfJid = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");

/** تطبيع كلمة للمقارنة (تشكيل · همزات · ى/ة) */
const normWord = (word) => String(word || "").toLowerCase().replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

/**
 * اسم الأمر الأول كاملاً في كلام المستخدم، والمختار نفس الاسم + كلمة لم يقلها المستخدم
 * («اضف» ⇐ «اضف_بريميوم» · «اضف_مالك»): اختيار النموذج أضاف معنى غير مطلوب.
 */
function siblingWithUnsaidWord(topName, chosenName, text) {
  const words = (name) => String(name || "").split(/[_\s-]+/).map(normWord).filter((word) => word.length >= 2);
  const said = new Set(String(text || "").split(/\s+/).flatMap((word) => { const base = normWord(word); return [base, ...wordVariants(base)]; }));
  const top = words(topName);
  const chosen = words(chosenName);
  return top.length > 0 && top.every((word) => said.has(word) && chosen.includes(word))
    && chosen.some((word) => !top.includes(word) && !said.has(word));
}

/** أدوات/أوامر «صورة لنص» (برومبت إنجليزي للمولّدات) — ليست إجابة عن سؤال المستخدم عن صورته */
const DESCRIBE_TOOLS = new Set(["img2prompt"]);
const DESCRIBE_COMMANDS = new Set(["صورة_لنص", "وصف"]);

/** نداء/تمهيد لا يحمل معنى («يا تيربو» · «بوت») */
const REQUEST_LEAD = /^(?:يا|تيربو|terboo|بوت|bot|hey|hola|اهلا|مرحبا)$/;
/** التماس صريح في أول الرسالة */
const REQUEST_PHRASE = /^(?:(?:يا\s+)?(?:تيربو|terboo|بوت|bot)\s+)?(?:ممكن|عايز|عاوز|عايزه|اريد|بدي|ابغي|ابي|لو سمحت|من فضلك|please|pls|plz|can you|could you|would you|i want|i need|quiero|puedes|podrias|podrías|por favor)(?:\s|$)/;

/**
 * هل الرسالة طلب تنفيذ؟ فعل أمر في أولها (بعد «ممكن/لو سمحت/عايز/يا تيربو» إن وُجدت)،
 * أو اسم الأمر/مرادفه نفسه بين أول كلماتها («ممكن تطرد…» ⇒ طرد).
 */
function looksLikeRequest(text, entry = null) {
  const normalized = String(text || "").toLowerCase().replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  // صيغة رغبة/التماس صريحة ⇒ طلب («عايز اعرف…» · «ممكن…» · «please…» · «quiero…»)
  if (REQUEST_PHRASE.test(normalized)) return true;
  const words = normalized.split(" ").filter(Boolean);
  // رسالة من كلمة أو كلمتين («المنيو» · «ستيكر») طلب أمر في الغالب
  if (words.filter((word) => !REQUEST_LEAD.test(word)).length <= 2) return true;
  const names = new Set((entry?.normalizedNames || []).flatMap((name) => [name, ...name.split(" ")]).filter((name) => name.length >= 3));
  let checked = 0;
  for (const word of words) {
    if (checked >= 3) break;
    if (REQUEST_LEAD.test(word)) continue;
    checked += 1;
    for (const form of wordVariants(word)) {
      if (REQUEST_VERB.test(form)) return true;
      // اسم الأمر نفسه: طلب إن لم يكن اسماً معرّفاً («الفاتورة وصلت» جملة خبرية، «فاتورة لمحمد» طلب)
      if (names.has(form) && (!word.startsWith("ال") || words.length <= 2)) return true;
    }
    // أول كلمة ذات معنى تحدد: فعل/اسم أمر ⇒ طلب، غير ذلك ⇒ جملة خبرية أو سؤال
    return false;
  }
  return false;
}

/**
 * نماذج ضعيفة تملأ قالب القرار خطأً: اسم الأمر داخل decision («ترجم» بدل COMMAND)،
 * args كمصفوفة، command بالبادئة («.ترجم»)، confidence = 0 لأنها خانة لم تُفهم.
 * يُصلح القالب بدل رميه (كان يُرد بـ«الخدمة لا ترد» رغم أن النموذج أجاب).
 */
function repairDecision(parsed) {
  const kinds = new Set(Object.values(DECISIONS));
  const strip = (value) => String(value || "").trim().replace(/^[.!#/]+/, "");
  if (Array.isArray(parsed.args)) parsed.args = parsed.args.map((part) => normalizeProviderText(part) || String(part ?? "")).join(" ").trim();
  if (parsed.command) parsed.command = strip(parsed.command);
  let kind = String(parsed.decision || "").trim().toUpperCase();
  if (!kinds.has(kind)) {
    // decision يحمل اسم أمر حقيقي («انشاء_مجموعة») ⇒ أمر حتى لو وُجد reply (كان يتحوّل محادثة بتأكيد زائف «تم الإنشاء»)
    const asCommand = findEntry(parsed.command || "") || findEntry(strip(parsed.decision));
    if (asCommand) {
      kind = DECISIONS.COMMAND;
      parsed.command = asCommand.name;
    } else if (parsed.tool && getScraper(String(parsed.tool))) kind = DECISIONS.TOOL;
    else kind = DECISIONS.CHAT;
    parsed.repaired = true;
  }
  parsed.decision = kind;
  // ثقة 0/مفقودة = خانة لم تُملأ، لا «ثقة منخفضة» تحوّل كل أمر إلى طلب تأكيد
  if (!(Number(parsed.confidence) > 0)) delete parsed.confidence;
  return parsed;
}

/** نداء النموذج بحزمة سياق كاملة — history حقيقية دائماً (§5) */
async function decide({ pkg, candidates, prefix, ask = providerAsk, trace = null }) {
  const instruction = buildInstruction({ pkg, candidates, prefix });
  const payload = toProviderPayload(pkg, instruction, { purpose: "decision" });
  // نداء القرار نصّي دائماً (لا بايتات صورة فيه) ⇒ مسار المحادثة لا الرؤية
  const answer = await ask({ ...payload, hasImage: false });
  trace?.providerResult(answer);
  if (!answer?.text) return null;
  const parsed = parseModelJson(answer.text) || recoverDecision(answer.text);
  if (!parsed) {
    noteFailure("ai-core", parseModelJson.lastError || new Error("model_decision_unparseable"), { where: "src/lib/terboo-ai-core.js:decide", stage: "parse", payload: String(answer.text).slice(0, 80) });
    return null;
  }
  if (parsed.recovered) trace?.step("strategy", `recovered:${parsed.recovered}`);
  // حقول نصية قد تصل كائنات/مصفوفات من نماذج ضعيفة ⇒ نص (لا «[object Object]» في أي رد)
  for (const key of ["reply", "args", "command", "tool"]) {
    if (parsed[key] !== undefined && typeof parsed[key] !== "string") parsed[key] = normalizeProviderText(parsed[key]);
  }
  if (typeof parsed.decision !== "string") parsed.decision = normalizeProviderText(parsed.decision) || "CHAT";
  repairDecision(parsed);
  if (parsed.repaired) trace?.step("strategy", `repaired:${parsed.decision.toLowerCase()}`);
  parsed.provider = answer.provider;
  return parsed;
}

// ═══════════════════════════════════════════════
// ⑤ Permission + ⑥ Tool/Plugin
// ═══════════════════════════════════════════════

/** الهدف الجاهز كوسيطة للأمر */
function resolveArgs(pkg, rawArgs) {
  const args = String(rawArgs || "").trim().slice(0, 300);
  if (/@?\d{6,}/.test(args)) return args;
  const target = pkg.reference?.target?.number;
  if (!target) return args;
  return args ? `@${target} ${args}`.trim() : `@${target}`;
}

/**
 * فحوص ما قبل التنفيذ. لا تستبدل نظام الصلاحيات الحقيقي —
 * تمنع فقط محاولة بلا معنى (هدف مفقود، البوت ليس مشرفاً).
 */
function preflight(entry, m, resolvedArgs) {
  const plugin = getPlugin(entry.name);
  if (!plugin) return { ok: false, reasonKey: "assistant.unavailable" };
  if (plugin.config?.isBotAdmin && m.isGroup && m.isBotAdmin === false) {
    return { ok: false, reasonKey: "assistant.botNotAdmin" };
  }
  // أوامر بصيغة «اسم|أرقام|…» تتحقق من مدخلها بنفسها (لا «أشِر إلى عضو»)
  if (entry.requirements?.target && !/@?\d{6,}/.test(resolvedArgs || "") && !String(entry.usage || "").includes("|")) {
    return { ok: false, reasonKey: "assistant.needTarget" };
  }
  return { ok: true };
}

/**
 * إعادة كتابة الرسالة كأمر حقيقي (واجهة قديمة يعتمد عليها المساعد القديم).
 * النواة نفسها تستعمل dispatchCommand لتقرأ نتيجة الأمر الحقيقية.
 */
async function rewriteAsCommand(m, commandName, args) {
  const { parseCommand } = await import("./terboo-serialize.js");
  const prefix = config.command?.prefix || ".";
  const body = `${prefix}${commandName}${args ? ` ${args}` : ""}`;
  const parsed = parseCommand(body, prefix);
  if (!parsed.isCommand) return false;

  m.body = body;
  m.isCommand = parsed.isCommand;
  m.command = parsed.command;
  m.args = parsed.args;
  m.prefix = parsed.prefix;
  m.text = parsed.text;
  m.fullArgs = parsed.fullArgs;
  m.aiRouted = true;
  return true;
}

// ═══════════════════════════════════════════════
// ⑨ Memory Update
// ═══════════════════════════════════════════════

/** حفظ ما يستحق البقاء من قرار النموذج — بلا أسرار وبثقة معقولة */
function storeFacts(m, facts) {
  if (!Array.isArray(facts) || !facts.length) return 0;
  let saved = 0;
  let scope;
  try {
    scope = conversationScope(m);
  } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:425",stage: "conversationScope"}); return 0; }
  for (const fact of facts.slice(0, 4)) {
    const stored = remember(scope, {
      text: fact?.text,
      type: fact?.type,
      confidence: Number(fact?.confidence) || 0.6,
      source: "kernel",
    });
    if (stored) saved += 1;
  }
  return saved;
}

/** ملخّص ذكي في الخلفية حين يتراكم ما يكفي من المحادثة (§9) */
function refreshSummaryInBackground(m, ask = providerAsk, lang = "ar") {
  let scope;
  try {
    scope = conversationScope(m);
  } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:445",stage: "conversationScope"}); return; }
  refreshSummary(scope, async ({ turns, summary }) => {
    const answer = await ask({
      message: turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n").slice(0, 6000),
      instruction: `Summarize this conversation for your own memory in 3-5 short lines, in the conversation's language. Keep names, decisions, tasks and open questions. Never include secrets.${summary ? `\nPrevious summary: ${summary}` : ""}`,
      history: [],
      language: lang,
      purpose: "summary",
    });
    return answer?.text || "";
  }).catch((error) => { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:457"}); });
}

// ═══════════════════════════════════════════════
// ⑩ Response
// ═══════════════════════════════════════════════

function kernelCard(lang, blocks, { icon = "🧠", withFooter = true } = {}) {
  return UI.card({
    title: t(lang, "assistant.title"),
    icon,
    blocks,
    footer: withFooter ? UI.footer(brand.botName(), brand.developerName(), lang) : undefined,
    lang,
  });
}

/**
 * قرار تجاوزته المحادثة (رسالة أحدث قبل بدء الرد) أو ألغاه المستخدم ⇒ لا رد متأخر ولا إجراء (§17 §85).
 * @returns {boolean} true إن كان يجب السكوت
 */
function staleDecision(m) {
  const ticket = m?.__terbooTicket;
  if (!ticket?.stale?.()) return false;
  stepOf(m, "verify", ticket.cancelled() ? "cancelled" : "superseded");
  return true;
}

/** يعلن بدء الرد: بعدها لا يُعدّ القرار متجاوَزاً */
function beginResponse(m) {
  m?.__terbooTicket?.markResponding?.();
}

/** رد نصي + تسجيله في الذاكرة كدور «assistant» */
async function replyAndRemember(m, lang, blocks, options = {}) {
  if (staleDecision(m)) return "superseded";
  beginResponse(m);
  const text = kernelCard(lang, blocks, options);
  await m.reply(text).catch((error) => { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:477",stage: "m.reply"}); });
  markFirstResponse(m);
  const plain = Array.isArray(blocks) ? blocks.filter(Boolean).join(" ") : String(blocks || "");
  try { recordTurn(m, "assistant", plain); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:480",stage: "recordTurn"}); }
  return "answered";
}

/** زرا التأكيد: معرّفات داخلية تُحسم في المعلّق (نعم ⇒ تنفيذ عبر الصلاحيات · لا ⇒ إلغاء) */
function confirmButtons(lang) {
  return [
    { id: "terboo_pick_yes", text: `✅ ${t(lang, "act.btnYes")}` },
    { id: "terboo_pick_no", text: `✖️ ${t(lang, "act.btnNo")}` },
  ];
}

/**
 * رد بأزرار قررتها سياسة الواجهة. نص البطاقة نفسه يشرح البديل المكتوب (رقم/نفذه/إلغاء)،
 * وأي تعذّر في الأزرار ⇒ نفس النص عبر المسار العادي (لا رد مفقود ولا مكرر).
 */
async function replyWithButtons(m, sock, lang, blocks, buttons, options = {}) {
  if (staleDecision(m)) return "superseded";
  if (!buttons.length || typeof sock?.sendMessage !== "function") return replyAndRemember(m, lang, blocks, options);
  beginResponse(m);
  try {
    await sendCard(sock, m, { cardId: "ai-choice", lang, text: kernelCard(lang, blocks, options), buttons });
  } catch (error) {
    noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:replyWithButtons", fallback: "text" });
    return replyAndRemember(m, lang, blocks, options);
  }
  markFirstResponse(m);
  try { recordTurn(m, "assistant", blocks.filter(Boolean).join(" ")); } catch (error) { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:replyWithButtons", stage: "recordTurn" }); }
  return "answered";
}

/**
 * نداء النموذج المعتمد للأدوات خارج النواة (وكيل إصلاح النشر…): نفس المزوّدات ونفس تنقيح الأسرار
 * — لا مسار ذكاء موازٍ يستورد المزوّدات بنفسه (§8).
 */
function kernelAsk(payload, routeHint = null) {
  return providerAsk(payload, routeHint);
}

/** أداة مجموعة/حظر من النموذج ⇒ نفس المسار الحتمي (صلاحية مركزية · حماية · تأكيد · تحقق) */
async function runGroupToolDecision({ m, sock, lang, id, input, text }) {
  stepOf(m, "tool", `group:${id}`);
  if (staleDecision(m)) return "superseded";
  beginResponse(m);
  const handled = GROUP_TOOLS[id] ? await runGroupTool({ id, input, m, sock, lang, text })
    : SSH_TOOLS[id] ? await runSshTool({ id, input, m, sock, lang })
      : await runMessagingTool({ id, input, m, sock, lang, text });
  try { recordTurn(m, "assistant", `→ ${id}`); } catch (error) { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:runGroupToolDecision", stage: "recordTurn" }); }
  if (!handled) return replyAndRemember(m, lang, [t(lang, "scraper.unknownTool")]);
  return "answered";
}

/** إجابة محادثة عادية: نص النموذج (بلا بطاقة) بعد طبقة التنويع (§14 §40 §41) */
async function replyChat(m, text, lang = "") {
  stepOf(m, "permission", "chat");
  stepOf(m, "tool", "provider");
  // أي شكل يصل (نص · كائن مزوّد) ⇒ نص حقيقي؛ لا شيء ⇒ رسالة صريحة بدل «[object Object]»
  const plain = normalizeProviderText(text);
  if (!plain) {
    stepOf(m, "verify", "empty-provider-text");
    return replyAndRemember(m, lang || "ar", [t(lang || "ar", "assistant.aiBusy")]);
  }
  const clean = diversify(plain.slice(0, 3000), { m, lang: lang || "ar", userText: m?.body || m?.text || "" }).text;
  // Result Verification: رد فعلي غير فارغ بعد طبقة التنويع
  stepOf(m, "verify", clean.trim() ? "text" : "empty");
  if (staleDecision(m)) return "superseded";
  beginResponse(m);
  // رد النموذج مكتوب أصلاً بلغة المستخدم: لا يمر على ترجمة الواجهة
  await m.reply(markRaw(clean)).catch((error) => { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:492",stage: "m.reply"}); });
  markFirstResponse(m);
  try { recordTurn(m, "assistant", clean); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:494",stage: "recordTurn"}); }
  return "answered";
}

// ═══════════════════════════════════════════════
// المسار المشترك للمحادثة (Auto AI وكل واجهات الدردشة)
// ═══════════════════════════════════════════════

/**
 * رد محادثة بحزمة سياق وذاكرة كاملة، بلغة المستخدم، من أي واجهة.
 * @param {{m:Object, db?:Object, text?:string, lang?:string, persona?:string, extraInstruction?:string,
 *          providers?:Object, route?:Object, imageBuffer?:Buffer, recordUser?:boolean,
 *          recordAssistant?:boolean, throwOnError?:boolean, ask?:Function}} input
 * @returns {Promise<{text:string, provider:string, language:string, pkg:Object}|null>}
 */
async function composeReply({
  m, db = null, text, lang = "", persona = "", extraInstruction = "", providers = null, route = null,
  imageBuffer = null, recordUser = true, recordAssistant = true, throwOnError = false, ask = providerAsk,
  pkg: givenPkg = null,
} = {}) {
  const request = String(text ?? m?.body ?? "").trim();
  const language = lang || replyLanguage(m, db, request);
  // حزمة مبنية مسبقاً (قبل تسجيل رسالة المستخدم) تُمرَّر كما هي حتى لا تتكرر الرسالة في التاريخ
  const pkg = givenPkg || buildContextPackage({ m, db, text: request, lang: language });
  const instruction = [persona || defaultPersona(), brand.brandLockPrompt(language), extraInstruction].filter(Boolean).join("\n\n");
  const payload = {
    ...toProviderPayload(pkg, instruction),
    imageBuffer: imageBuffer || undefined,
    hasImage: Boolean(imageBuffer) || pkg.hasImage,
  };
  if (recordUser) {
    try { recordTurn(m, "user", request || "[image]"); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:525",stage: "recordTurn"}); }
  }
  const answer = await ask(payload, route, { providers, throwOnError });
  if (!answer?.text) return null;
  // طبقة التنويع: لا إعادة تعريف، لا بداية/خاتمة/إيموجي مكرّرة (§14 §40 §41)
  answer.text = diversify(answer.text, { m, lang: language, userText: request }).text;
  if (recordAssistant) {
    try { recordTurn(m, "assistant", answer.text); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:532",stage: "recordTurn"}); }
  }
  refreshSummaryInBackground(m, ask, language);
  return {
    text: answer.text, provider: answer.provider, route: answer.route, language, pkg,
    latencyMs: answer.latencyMs, attempts: answer.attempts, fallbackUsed: answer.fallbackUsed, fallbackLatencyMs: answer.fallbackLatencyMs,
  };
}

// ═══════════════════════════════════════════════
// مسارات القرار
// ═══════════════════════════════════════════════

/** تقرير أمر نفّذته النواة: الأمر نفسه يرد على المستخدم، والنواة تشرح فقط الفشل الصامت */
async function reportDispatch(m, lang, prefix, result) {
  if (result.ok) return "answered";
  if (result.status === "rejected") {
    return replyAndRemember(m, lang, [t(lang, "assistant.unavailable")]);
  }
  // الحجب/الخطأ يرد عليه المسار الطبيعي نفسه؛ لا نرسل شيئاً إن كان قد رد
  if (!result.replies?.length) {
    return replyAndRemember(m, lang, [
      t(lang, "kernel.commandBlocked"),
      UI.row(t(lang, "assistant.runningCommand"), UI.isolate(`${prefix}${result.command}`), lang),
    ], { icon: "⚠️" });
  }
  return "answered";
}

/** COMMAND — أمر واحد حقيقي عبر المسار الطبيعي، مع قراءة نتيجته */
async function runCommandDecision({ m, sock, pkg, lang, prefix, commandName, rawArgs, reply, deps }) {
  const entry = findEntry(commandName);
  if (!entry || !pluginExists(entry.name)) {
    return replyAndRemember(m, lang, [t(lang, "assistant.unavailable")]);
  }

  let args = resolveArgs(pkg, rawArgs);
  // «@تيربو» في الطلب (رقم البوت أو LID) ليس هدفاً للأمر — كان يُضاف البوت نفسه «غير مسجل في واتساب»
  const ownIds = new Set([...botIdentifiers(sock).ids].map((id) => String(id).split("@")[0].replace(/\D/g, "")).filter(Boolean));
  if (ownIds.size) args = args.replace(/@?(\d{6,})/g, (match, number) => (ownIds.has(number) ? "" : match)).replace(/[ \t]{2,}/g, " ").trim();
  const structured = String(entry.usage || "").includes("|");
  // نماذج ضعيفة تنسخ قالب الاستعمال حرفياً («اسم_المجموعة|رقمك|0»): الخانات القالبية تُعامل كفارغة
  if (structured) args = args.split("|").map((part) => (PLACEHOLDER_ARG.test(part.trim()) ? "" : part.trim())).join("|").replace(/\|+$/, "");
  // «اضفني» · «ضيفني» · «add me»: الهدف هو المرسل نفسه (رقمه الحقيقي، لا LID)
  if (!/\d{6,}/.test(args) && SELF_TARGET.test(String(pkg?.request || m?.body || ""))) {
    const canonical = identityOf(m?.sender).canonical || "";
    const own = canonical.startsWith("pn:") ? canonical.slice(3) : String(m?.sender || "").endsWith("@s.whatsapp.net") ? String(m.sender).split("@")[0].split(":")[0] : "";
    if (own) {
      if (structured) {
        const parts = args.split("|");
        // الاسم: من النموذج، وإلا من كلام المستخدم («اسمها …» · «named …»)، وإلا اسم البوت
        const named = String(pkg?.request || m?.body || "").match(NAME_IN_TEXT)?.[1]?.trim();
        parts[0] = parts[0]?.trim() || named || brand.botName().replace(/\s*v?\d+(?:\.\d+)*$/i, "").trim();
        parts[1] = parts[1]?.trim() ? `${parts[1].trim()},${own}` : own;
        args = parts.join("|");
      } else if (entry.requirements?.target) args = `@${own} ${args}`.trim();
    }
  }
  // أمر يحتاج هدفاً بلا رقم: بطاقة جهة اتصال مقتبسة، أو بطاقة أرسلها نفس الشخص هنا قبل قليل («ابعت الكونتاكت» ثم «ضيفه»)
  // رد على بطاقة: رقم مرسل البطاقة أو رقم صاحب الطلب (من حلّ «العضو ده») ليس المقصود — البطاقة هي الهدف
  if (entry.requirements?.target && m?.quoted?.contacts?.length) {
    const notTargets = new Set([digitsOfJid(m.quoted.sender || m.quoted.key?.participant), digitsOfJid(m.sender)].filter(Boolean));
    args = args.replace(/@?(\d{6,})/g, (match, number) => (notTargets.has(number) ? "" : match)).replace(/[ \t]{2,}/g, " ").trim();
  }
  if (entry.requirements?.target && !/\d{6,}/.test(args)) {
    const cards = m?.quoted?.contacts?.length ? m.quoted.contacts : !m?.quoted ? recentContacts(m?.chat, m?.sender) : [];
    const numbers = [...new Set(cards.flatMap((card) => card.numbers || []))].filter((number) => !ownIds.has(number));
    if (numbers.length) args = `${numbers.join(" ")} ${args}`.trim();
  }
  const check = preflight(entry, m, args);
  // Permission Check: الفحص المسبق هنا، والفحوص الكاملة (مالك/مشرف/بريميوم/تسجيل/وضع/تبريد) في مسار البوت نفسه
  stepOf(m, "permission", check.ok ? "handler-checks" : check.reasonKey);
  if (!check.ok) {
    if (check.reasonKey === "assistant.needTarget") setPending(m, { kind: "command", command: entry.name, args, reason: "need-target" });
    return replyAndRemember(m, lang, [
      t(lang, check.reasonKey),
      UI.row(t(lang, "assistant.runningCommand"), UI.isolate(`${prefix}${entry.name}`), lang),
    ]);
  }

  if (reply && (ASKS_INPUT.test(String(reply)) || /[؟?]\s*$/.test(String(reply)))) reply = "";
  if (reply) {
    await m.reply(kernelCard(lang, [
      String(reply).slice(0, 500),
      UI.row(t(lang, "assistant.runningCommand"), UI.isolate(`${prefix}${entry.name}${args ? ` ${args}` : ""}`), lang),
    ], { withFooter: false })).catch((error) => { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:584"}); });
  }
  try { recordTurn(m, "assistant", `${reply || ""} → ${prefix}${entry.name} ${args}`.trim()); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:586",stage: "trim"}); }

  const mentions = (args.match(/@?(\d{6,})/g) || []).map((x) => jidFromDigits(x));
  stepOf(m, "tool", `command:${entry.name}`);
  const result = await deps.dispatch(m, sock, { command: entry.name, args, mentions });
  // Result Verification: نتيجة الأمر الحقيقية (نجح/حُجب/فشل) لا افتراض النجاح
  stepOf(m, "verify", result?.ok ? "ok" : String(result?.status || "failed"));
  return reportDispatch(m, lang, prefix, result);
}

/** AGENT — خطة حقيقية متعددة الخطوات (§14) */
async function runAgentDecision({ m, sock, lang, prefix, steps, reply, goal = "", approved = false, deps }) {
  stepOf(m, "permission", approved ? "approved" : "per-step");
  stepOf(m, "tool", `agent:${Array.isArray(steps) ? steps.length : 0}`);
  const run = await runAgent({ m, sock, steps, goal: goal || reply || "", prefix, approved, deps: { dispatch: deps.dispatch, tools: deps.tools, signal: m.__terbooTicket?.signal || null } });
  stepOf(m, "verify", String(run?.status || "unknown"));
  // «وقف» أثناء الخطة: رسالة الإيقاف أكّدت ذلك بالفعل — لا تقرير متأخر
  if (run.status === "cancelled") return "superseded";
  const tr = (key, vars) => t(lang, key, vars);

  if (run.status === "invalid") {
    return replyAndRemember(m, lang, [t(lang, "assistant.unavailable"), ...reportLines(run, { prefix, t: tr })]);
  }
  if (run.status === "needs-approval") {
    const planLines = run.steps.map((step, index) => UI.row(`${index + 1}`, UI.isolate(step.kind === "tool" ? step.tool : `${prefix}${step.name} ${step.args}`.trim()), lang)).join("\n");
    return replyAndRemember(m, lang, [
      t(lang, "kernel.agentPlan"),
      planLines,
      reply ? String(reply).slice(0, 300) : "",
      t(lang, "kernel.agentNeedsApproval", { steps: run.sensitive.map((s) => `${prefix}${s.name}`).join("، ") }),
      t(lang, "kernel.pendingConfirm"),
    ], { icon: "⚠️" });
  }

  const blocks = [
    t(lang, "kernel.agentReport"),
    reportLines(run, { prefix, t: tr }).join("\n"),
    run.status === "done"
      ? t(lang, "kernel.agentAllDone", { count: run.results.length })
      : t(lang, "kernel.agentStopped", { step: run.results.length }),
    run.rolledBack.length ? t(lang, "kernel.agentRolledBack", { count: run.rolledBack.filter((r) => r.ok).length }) : "",
  ];
  return replyAndRemember(m, lang, blocks, { icon: run.status === "done" ? "✅" : "⚠️" });
}

/** MEMORY_OPERATION — تحكّم المستخدم في ذاكرته (§37) */
/** وسائط الرسالة (أو المقتبسة) دون تنزيلها مسبقاً — تُنزَّل فقط إن احتاجها المحوّل */
function mediaInput(m) {
  const own = m?.isImage || m?.isVideo ? m : null;
  const quoted = m?.quoted && (m.quoted.isImage || m.quoted.isVideo) ? m.quoted : null;
  const source = own || quoted;
  const loader = source && typeof source.download === "function" ? () => source.download() : undefined;
  return {
    hasImage: Boolean(source?.isImage),
    hasVideo: Boolean(source?.isVideo),
    loadImage: source?.isImage ? loader : undefined,
    loadVideo: source?.isVideo ? loader : undefined,
  };
}

/** مدخل أداة من النموذج: مفاتيح معروفة ونصوص قصيرة فقط — لا كود ولا مفاتيح عشوائية (§23) */
function sanitizeToolInput(input = {}) {
  const out = {};
  for (const key of ["url", "query", "prompt", "name", "format", "ratio", "style"]) {
    const value = input?.[key];
    if (typeof value !== "string" || !value.trim()) continue;
    out[key] = value.trim().slice(0, key === "prompt" ? 800 : 500);
  }
  if (out.url && !/^https?:\/\/[^\s]+$/i.test(out.url)) delete out.url;
  if (out.format && !["mp3", "mp4"].includes(out.format)) delete out.format;
  return out;
}

/** TOOL — أداة من سجل الـscrapers: تحقق → صلاحية → تنفيذ (البلوقن أولاً) → إرسال (§22–§26) */
async function runToolDecision({ m, sock, lang, prefix, id, input = {}, deps }) {
  const entry = getScraper(id);
  if (!entry || entry.kind === "chat" || entry.kind === "agent") {
    return replyAndRemember(m, lang, [t(lang, "scraper.unknownTool")]);
  }
  const request = { ...mediaInput(m), ...sanitizeToolInput(input) };
  stepOf(m, "permission", entry.permission || "public");
  stepOf(m, "tool", `scraper:${entry.id}`);
  if (staleDecision(m)) return "superseded";
  beginResponse(m);
  try { await m.react?.("⏳"); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:666"}); }
  // Background Task Control Plane (§18 §19 §49): الأداة مهمة حقيقية (أولوية P2) قابلة للإلغاء والاستعلام.
  // تنتهي خلال نافذة الرد السريع ⇒ تُسلَّم كما هي؛ وإلا إشعار فوري برقم المهمة وتكمل في الخلفية.
  const who = taskOwner(m);
  const title = `${platformLabel(entry.platforms[0]) || entry.id}`;
  const task = enqueueTask({
    type: `tool:${entry.id}`, title, owner: who.owner, scope: who.scope, priority: TASK_PRIORITY.P2, persist: true,
    // مدخلات صغيرة تكفي لاستئنافها بعد إعادة التشغيل (رابط/بحث/وصف) — الوسائط المرفقة لا تُحفظ
    input: { id, url: request.url || "", query: request.query || "", prompt: request.prompt || "", name: request.name || "", format: request.format || "", lang },
    resumable: isReplayableTool(entry), tool: entry.id,
    run: async (ctx) => {
      ctx.progress(10, "start");
      const result = await (deps.runTool || runScraper)({ id, input: request, m, sock, lang, deps: { dispatch: deps.dispatch }, signal: ctx.signal });
      for (const item of result?.deliveries || []) ctx.artifact({ type: item.type || "media", url: item.url || "" });
      return { ...result, summary: result?.ok ? `${entry.id}: ${result?.deliveries?.length || 0} delivered` : `${entry.id}: failed` };
    },
  });
  const quick = await Promise.race([task.done.then((value) => ({ value }), (error) => ({ error })), new Promise((resolve) => { const timer = setTimeout(() => resolve(null), deps.fastWindowMs ?? FAST_WINDOW_MS); timer.unref?.(); })]);
  if (!quick) {
    stepOf(m, "verify", `background:${task.id}`);
    markFirstResponse(m);
    await m.reply(kernelCard(lang, [t(lang, "tasks.started", { title }), t(lang, "tasks.startedHint", { id: task.id })], { icon: "✦", withFooter: false })).catch((error) => { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:runToolDecision", stage: "ack" }); });
    task.done.then(
      (outcome) => finishTool({ m, sock, lang, prefix, entry, id, request, outcome, deps }),
      (error) => { if (error?.code !== "TASK_CANCELLED") m.reply(kernelCard(lang, [t(lang, "tasks.failed", { title })], { icon: "⚠️" })).catch((e) => noteFailure("ai-core", e, { where: "src/lib/terboo-ai-core.js:runToolDecision", stage: "background-fail" })); },
    );
    return "answered";
  }
  if (quick.error) {
    if (quick.error?.code === "TASK_CANCELLED") return "answered";
    throw quick.error;
  }
  return finishTool({ m, sock, lang, prefix, entry, id, request, outcome: quick.value, deps });
}

/**
 * نتيجة مهمة مستأنفة/معادة: الأداة تسلّم وسائطها بنفسها؛ النص (فيديو/مستند) يُرسل هنا؛
 * الفشل يُقال صراحة — لا نتيجة تضيع بصمت ولا نجاح شكلي.
 */
function deliverTaskOutcome(m, lang, title, done) {
  done.then(
    (out) => {
      if (out?.deliveries?.length || out?.via === "plugin") return null;
      if (out?.ok === false) return m.reply(kernelCard(lang, [t(lang, "tasks.failed", { title })], { icon: "⚠️" }));
      return out?.text ? m.reply(markRaw(String(out.text))) : null;
    },
    (error) => {
      if (error?.code === "TASK_CANCELLED") return null;
      const key = error?.messageKey && t(lang, error.messageKey) !== error.messageKey ? error.messageKey : "";
      return m.reply(kernelCard(lang, [t(lang, "tasks.failed", { title }), key ? t(lang, key, { platform: title }) : ""].filter(Boolean), { icon: "⚠️" }));
    },
  ).catch((error) => noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:deliverTaskOutcome", stage: "reply" }));
}

/** نتيجة أداة (فورية أو خلفية): ذاكرة العمل · تحقق · رد/تفاعل */
async function finishTool({ m, sock, lang, prefix, entry, id, request, outcome, deps }) {
  // ذاكرة العمل للمتابعات (حملها/الصوت بس/التاني)
  try {
    recordWork(m, { tool: { id, url: request.url, query: request.query, prompt: request.prompt, format: request.format, links: (outcome?.result?.items || []).map((item) => item.url) } });
  } catch (error) { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:runToolDecision", stage: "recordWork" }); }
  // Result Verification: تسليم فعلي أو نتيجة البلوقن الحقيقية — لا نجاح مزيّف
  stepOf(m, "verify", outcome?.via === "plugin" ? (outcome.result?.ok ? "plugin-ok" : "plugin-failed") : outcome?.ok ? `delivered:${outcome.deliveries?.length || 0}` : "failed");
  try { recordTurn(m, "assistant", `→ ${entry.id}${outcome.ok ? "" : " ✗"}`); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:670"}); }

  traceOf(m)?.mark("scraper");
  if (outcome.deliveries?.length || outcome.via === "plugin") markFirstResponse(m);
  // البلوقن الموجود رد بنفسه (نجاحاً أو خطأً) — لا رد مكرر
  if (outcome.via === "plugin") return reportDispatch(m, lang, prefix, outcome.result || {});
  if (outcome.ok) {
    try { await m.react?.("✅"); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:677"}); }
    return "answered";
  }
  try { await m.react?.("❌"); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:680"}); }
  const platform = platformLabel(entry.platforms[0]) || entry.id;
  return replyAndRemember(m, lang, [t(lang, outcome.messageKey || "scraper.failed", { platform })], { icon: "⚠️" });
}

async function runMemoryOperation({ m, lang, op, days = 30 }) {
  // ذاكرة المستخدم نفسه فقط (نطاقه) — لا صلاحية إضافية
  stepOf(m, "permission", "own-memory");
  stepOf(m, "tool", `memory:${op || "?"}`);
  let scope;
  try {
    scope = conversationScope(m);
  } catch {
    return replyAndRemember(m, lang, [t(lang, "kernel.memoryEmpty")]);
  }
  const operation = String(op || "show").toLowerCase();

  if (operation === "delete") {
    forget(scope);
    return replyAndRemember(m, lang, [t(lang, "kernel.memoryCleared")], { icon: "🧹" });
  }
  if (operation === "forget-last") {
    const removed = forgetLast(scope);
    return replyAndRemember(m, lang, [removed ? t(lang, "kernel.memoryForgotLast", { text: removed.text }) : t(lang, "kernel.memoryNothingToForget")], { icon: "🧹" });
  }
  if (operation === "forget-all") {
    const count = forgetUserEverywhere(m.sender);
    return replyAndRemember(m, lang, [t(lang, "kernel.memoryForgotAll", { count })], { icon: "🧹" });
  }
  if (operation === "disable") {
    setEnabled(scope, false);
    return replyAndRemember(m, lang, [t(lang, "kernel.memoryDisabled")]);
  }
  if (operation === "enable") {
    setEnabled(scope, true);
    return replyAndRemember(m, lang, [t(lang, "kernel.memoryEnabled")]);
  }
  if (operation === "ttl") {
    const value = Math.max(1, Math.min(3650, Number(days) || 30));
    setTTLDays(scope, value);
    return replyAndRemember(m, lang, [t(lang, "kernel.memoryTtl", { days: value })]);
  }
  if (operation === "allow-owner") {
    setOwnerInspection(m.sender, true);
    return replyAndRemember(m, lang, [t(lang, "kernel.memoryInspectAllowed")], { icon: "🔓" });
  }
  if (operation === "revoke-owner") {
    setOwnerInspection(m.sender, false);
    return replyAndRemember(m, lang, [t(lang, "kernel.memoryInspectRevoked")], { icon: "🔒" });
  }
  if (operation === "transparency") {
    return replyAndRemember(m, lang, [t(lang, "kernel.memoryTransparency"), t(lang, "kernel.memoryHint")], { icon: "🛡️" });
  }

  const snap = snapshot(scope);
  if (!snap || (!snap.facts.length && !snap.turns)) {
    return replyAndRemember(m, lang, [t(lang, "kernel.memoryEmpty"), t(lang, "kernel.memoryHint")]);
  }
  const facts = snap.facts.slice(0, 10).map((fact) => UI.bullet(`${fact.text}`, lang)).join("\n");
  return replyAndRemember(m, lang, [
    UI.row(t(lang, "kernel.memoryTurns"), String(snap.turns), lang),
    UI.row(t(lang, "kernel.memoryFacts"), String(snap.facts.length), lang),
    snap.topics?.length ? UI.row(t(lang, "kernel.memoryTopics"), snap.topics.slice(-3).map((topic) => topic.label).join(" · "), lang) : "",
    facts,
    t(lang, "kernel.memoryHint"),
  ]);
}

/** PROJECT_OPERATION — لوحة تحكّم المالك (§15–§18) */
async function runProjectOperation({ m, sock = null, lang, intent, deps }) {
  if (!isConfigOwner(m)) {
    stepOf(m, "permission", "denied:owner-only");
    return replyAndRemember(m, lang, [t(lang, "kernel.ownerOnly")], { icon: "⛔" });
  }
  stepOf(m, "permission", "config-owner");
  stepOf(m, "tool", `owner:${intent?.op || "?"}`);
  const tools = deps.tools || (await import("./terboo-ai-tools.js"));
  try {
    const result = await executeOwnerIntent({ m, intent, lang, tools, ask: deps.ask, sock });
    const file = intent?.target || intent?.a;
    if (file && !result.pending && result.icon !== "⛔") {
      try { recordWork(m, { file }); } catch (error) { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:runProjectOperation", stage: "recordWork" }); }
    }
    stepOf(m, "verify", result.pending ? "awaiting-approval" : result.icon === "⛔" || result.icon === "❌" ? "failed" : "ok");
    return replyAndRemember(m, lang, result.blocks, { icon: result.icon || "🛠️" });
  } catch (error) {
    stepOf(m, "verify", "error");
    return replyAndRemember(m, lang, [`${t(lang, "kernel.toolDenied")}\n${String(error.message).slice(0, 300)}`], { icon: "⛔" });
  }
}

/** قرار PROJECT_OPERATION من النموذج ← نيّة أداة آمنة */
function projectIntentFromDecision(decision, tools) {
  const op = String(decision.projectOp || "diagnostics").toLowerCase();
  const target = decision.path ? tools.resolveFileQuery(decision.path).path : null;
  const needsFile = ["read", "inspect", "syntax", "backup", "fix"];
  if (needsFile.includes(op) && !target) return null;
  switch (op) {
    case "read": return { op, target, from: 1, to: 40 };
    case "search": return decision.args || decision.path ? { op, query: String(decision.args || decision.path).slice(0, 80) } : null;
    case "list": return { op, target: decision.path || "." };
    case "test": return { op, name: String(decision.args || "syntax") };
    case "fix": return { op, target, request: String(decision.args || decision.reply || "").slice(0, 300) };
    case "compare": {
      const [a, b] = String(decision.args || "").split(/\s+/);
      const pa = tools.resolveFileQuery(a).path;
      const pb = tools.resolveFileQuery(b).path;
      return pa && pb ? { op, a: pa, b: pb } : null;
    }
    case "diagnostics": case "changes": case "audit": case "manifest": case "rollback":
      return { op };
    case "inspect": case "syntax": case "backup":
      return { op, target };
    default:
      return null;
  }
}

/** تنفيذ إجراء معلّق بعد موافقة صاحبه */
async function runPending({ m, sock, pkg, lang, prefix, pending, deps }) {
  if (pending.kind === "plan" || pending.kind === "rollback" || pending.kind === "rename") {
    if (!isConfigOwner(m)) return replyAndRemember(m, lang, [t(lang, "kernel.ownerOnly")], { icon: "⛔" });
    const tools = deps.tools || (await import("./terboo-ai-tools.js"));
    try {
      const result = await executeApprovedOwnerPending({ m, pending, lang, tools });
      return replyAndRemember(m, lang, result.blocks, { icon: result.icon || "🛠️" });
    } catch (error) {
      return replyAndRemember(m, lang, [`${t(lang, "kernel.toolDenied")}\n${String(error.message).slice(0, 300)}`], { icon: "⛔" });
    }
  }
  if (pending.kind === "agent") {
    return runAgentDecision({ m, sock, lang, prefix, steps: pending.steps, goal: pending.reason, approved: true, deps });
  }
  if (pending.kind === "choice") {
    const option = (pending.options || [])[0];
    if (!option || (pending.options || []).length > 1) {
      setPending(m, pending);
      return replyAndRemember(m, lang, [t(lang, "kernel.pickOption")], { icon: "❓" });
    }
    return runCommandDecision({ m, sock, pkg, lang, prefix, commandName: option.command, rawArgs: option.args, reply: "", deps });
  }
  return runCommandDecision({ m, sock, pkg, lang, prefix, commandName: pending.command, rawArgs: pending.args, reply: "", deps });
}

/**
 * المتابعات الحتمية (§11): رجوع · تنفيذ المعلّق · تكرار · نفس الأمر على هدف جديد
 * · اختيار رقم من خيارات · موافقة/إلغاء.
 * «كمل» و«خليها أبسط» تمر للنموذج مع تلميح صريح وسياق الإجابة السابقة.
 * @returns {Promise<string|null>} null إن لم تكن متابعة قابلة للحسم محلياً
 */
async function handlePending({ m, sock, pkg, lang, prefix, text, deps }) {
  const ref = pkg.reference || {};
  const pending = peekPending(m);

  if (pending) {
    // أزرار السياسة: terboo_pick_N (اختيار) · terboo_pick_yes (تنفيذ) · terboo_pick_no (إلغاء)
    const tapped = String(text || "").trim().match(/^terboo_pick_(\d{1,2}|yes|no)$/i);
    if (tapped) {
      const value = tapped[1].toLowerCase();
      if (value === "no") {
        takePending(m);
        return replyAndRemember(m, lang, [t(lang, "kernel.cancelled")], { icon: "✖️" });
      }
      if (value === "yes") {
        takePending(m);
        return runPending({ m, sock, pkg, lang, prefix, pending, deps });
      }
      const option = pending.kind === "choice" ? pending.options?.[Number(value) - 1] : null;
      if (option) {
        takePending(m);
        return runCommandDecision({ m, sock, pkg, lang, prefix, commandName: option.command, rawArgs: option.args, reply: "", deps });
      }
    }
    // «لا قصدي التاني» / «الأول» مع خيارات معروضة
    if (pending.kind === "choice" && ref.ordinal !== null && ref.ordinal !== undefined && pending.options?.[ref.ordinal]) {
      takePending(m);
      const option = pending.options[ref.ordinal];
      return runCommandDecision({ m, sock, pkg, lang, prefix, commandName: option.command, rawArgs: option.args, reply: "", deps });
    }
    const plain = normalizeIntentText(text);
    if (ref.followUp === "execute-pending" || APPROVE_RE.test(plain)) {
      takePending(m);
      return runPending({ m, sock, pkg, lang, prefix, pending, deps });
    }
    if (CANCEL_RE.test(plain)) {
      takePending(m);
      return replyAndRemember(m, lang, [t(lang, "kernel.cancelled")], { icon: "✖️" });
    }
    // إجراء ينتظر هدفاً: «ده» مع إشارة أو رد
    if (pending.kind === "command" && pending.reason === "need-target" && ref.target && ref.target.source !== "memory") {
      takePending(m);
      const args = String(pending.args || "").replace(/@?\d{6,}/, "").trim();
      return runCommandDecision({ m, sock, pkg, lang, prefix, commandName: pending.command, rawArgs: `@${ref.target.number} ${args}`.trim(), reply: "", deps });
    }
  }
  return null;
}

/**
 * الرجوع الحتمي لا يُفعَّل بكلمة «رجع» داخل جملة عادية («رجع البيت امتى؟»):
 * يلزم تعبير رجوع صريح أو فعل الرجوع وحده كرسالة كاملة.
 */
const STRICT_REVERT = [
  /(?:رجع|ارجع)\S*\s+(?:لي\s+)?(?:ال)?(?:نسخه|اصدار|رد|اجابه|كلام)/,
  /(?:النسخه|الاصدار|الرد|الاجابه)\s+(?:اللي|الي)\s+قبل/,
  /(?:خلي|خليه|خليها|رجعه|رجعها)\s+زي\s+(?:الاول|ما كان)/,
  /زي ما كان/,
  /الغي التعديل/,
  /^[\s\p{P}]*(?:لا[\s\p{P}]*)?(?:ارجع|رجع|رجعه|رجعها|رجعلي)[\s\p{P}]*$/u,
  /(?<![\p{L}])(?:undo|revert)(?![\p{L}])/iu,
  /go back to (?:the )?(?:previous|last|old|earlier|original)/i,
  /previous (?:version|answer|one)/i,
  /as (?:it was )?before/i,
  /(?<![\p{L}])(?:deshaz|revierte)(?![\p{L}])/iu,
  /versi[oó]n anterior|como (?:estaba )?antes/i,
];

function isStrictRevert(text) {
  const value = String(text || "").toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();
  return STRICT_REVERT.some((re) => re.test(value));
}

async function handleFollowUp({ m, sock, pkg, lang, prefix, text, deps }) {
  const ref = pkg.reference || {};
  const state = conversationState(m);

  if (ref.followUp === "revert" && isStrictRevert(text)) {
    // المالك بعد تعديل ملف حديث: التراجع عن الملف (بموافقة)
    if (isConfigOwner(m)) {
      const tools = deps.tools || (await import("./terboo-ai-tools.js"));
      const last = tools.lastChange();
      const mentionsCode = /(?:تعديل|ملف|كود|change|edit|file|code|cambio|archivo)/i.test(text);
      if (last && mentionsCode && Date.now() - (last.at || 0) < OWNER_REVERT_WINDOW_MS) {
        return runProjectOperation({ m, lang, intent: { op: "rollback" }, deps });
      }
    }
    const previous = previousAnswer(m, 1);
    if (!previous) return replyAndRemember(m, lang, [t(lang, "kernel.followRevertNone")]);
    await m.reply(markRaw(`${t(lang, "kernel.followRevertDone")}\n\n${previous.text}`)).catch((error) => { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:897",stage: "m.reply"}); });
    try { recordTurn(m, "assistant", previous.text); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:898",stage: "recordTurn"}); }
    return "answered";
  }

  if (ref.followUp === "repeat" && String(text).trim().length <= 50 && state.lastCommand?.command && pluginExists(state.lastCommand.command)) {
    await m.reply(kernelCard(lang, [
      t(lang, "kernel.repeatRunning"),
      UI.row(t(lang, "assistant.runningCommand"), UI.isolate(`${prefix}${state.lastCommand.command} ${state.lastCommand.args || ""}`.trim()), lang),
    ], { withFooter: false })).catch((error) => { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:906"}); });
    const result = await deps.dispatch(m, sock, { command: state.lastCommand.command, args: state.lastCommand.args || "" });
    return reportDispatch(m, lang, prefix, result);
  }

  if (ref.followUp === "apply-to-target" && state.lastCommand?.command && ref.target && ref.target.source !== "memory") {
    const base = String(state.lastCommand.args || "").replace(/@?\d{6,}/g, "").trim();
    const args = `@${ref.target.number}${base ? ` ${base}` : ""}`;
    await m.reply(kernelCard(lang, [
      t(lang, "kernel.targetRunning"),
      UI.row(t(lang, "assistant.runningCommand"), UI.isolate(`${prefix}${state.lastCommand.command} ${args}`), lang),
    ], { withFooter: false })).catch((error) => { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:917"}); });
    const result = await deps.dispatch(m, sock, {
      command: state.lastCommand.command,
      args,
      mentions: [jidFromDigits(ref.target.number)],
    });
    return reportDispatch(m, lang, prefix, result);
  }

  return null;
}

// ═══════════════════════════════════════════════
// المسار الاحتياطي: مطابقة محلية بلا أي مزوّد
// ═══════════════════════════════════════════════

async function runLocalFallback({ m, sock, pkg, lang, prefix, candidates, deps, gate = null }) {
  // طلب عن وسيط (صورة/صوت/فيديو/ملف): المعالجة الحقيقية للوسيط — لا أمر يشبه اسمه كلمة في الطلب
  // («اي الموجود في الصورة» كان يشغّل «.صورة» لتوليد الصور)
  if (gate && MEDIA_INTENTS.has(gate.intent) && !m.__terbooMediaTried && !m.__terbooTranscript) {
    m.__terbooMediaTried = true;
    const handled = await runMediaStrategy({ m, sock, db: deps.db || null, text: pkg?.request || m?.body || "", lang, gate: { ...gate, op: gate.intent === "VISION" && gate.op === "ask" ? "describe" : gate.op }, deps: { ...deps.media, ask: deps.ask }, recordUser: false });
    if (handled === "answered") return "answered";
    if (handled?.reroute) return replyAndRemember(m, lang, [t(lang, "assistant.aiBusy")]);
  }
  // تنفيذ أمر تلقائي بلا نموذج: فقط لطلب أمر صريح
  if (gate && gate.intent !== "COMMAND") {
    if (MEDIA_INTENTS.has(gate.intent)) {
      stepOf(m, "verify", "media-unavailable");
      return replyAndRemember(m, lang, [t(lang, "media.failed")]);
    }
  }
  // طلب محادثة/سؤال/كود والنموذج لا يرد: رد صريح — لا تنفيذ أمر تشابه اسمه كلمة في الطلب
  // («اكتبلي كود» كان يشغّل أداة المالك «.كود» لاستخراج JSON رسالة)
  if (gate && gate.intent !== "COMMAND") {
    // قرار JSON غير صالح/فارغ لكن المزوّد حيّ: محاولة ثانية بصيغة محادثة عادية (بلا JSON)
    if (!deps.skipComposeRetry) {
      const composed = await composeReply({ m, text: pkg?.request || m?.body || "", lang, ask: deps.ask, pkg, recordUser: false, recordAssistant: false, extraInstruction: NO_ACTION_INSTRUCTION }).catch((error) => { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:runLocalFallback", stage: "composeReply" }); return null; });
      if (staleDecision(m)) return "superseded";
      // لم يُنفَّذ شيء في هذا المسار: أي جملة تدّعي إجراءً تُحذف
      const safe = composed?.text && claimsAction(composed.text) ? withoutClaims(composed.text) : composed?.text;
      if (safe) {
        stepOf(m, "verify", "compose-retry");
        return replyChat(m, safe, lang);
      }
    }
    stepOf(m, "verify", "ai-unavailable");
    return replyAndRemember(m, lang, [t(lang, "assistant.aiBusy")]);
  }
  const best = candidates[0];
  const ownerTool = (entry) => entry?.category === "owner" || entry?.isOwner || entry?.permissions?.isOwner;

  if (best && best.score >= 12 && !ownerTool(best.entry)) {
    await m.reply(kernelCard(lang, [
      t(lang, "assistant.offlineMatch"),
      UI.row(t(lang, "assistant.runningCommand"), UI.isolate(`${prefix}${best.entry.name}`), lang),
    ], { withFooter: false })).catch((error) => { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:940"}); });
    return runCommandDecision({ m, sock, pkg, lang, prefix, commandName: best.entry.name, rawArgs: "", reply: "", deps });
  }

  if (candidates.length) {
    const top = candidates.slice(0, 3);
    setPending(m, { kind: "choice", options: top.map(({ entry }) => ({ command: entry.name, args: resolveArgs(pkg, "") })), reason: "suggestions" });
    const suggestions = top
      .map(({ entry }, index) => UI.menuItem(entry.name, entry.description || entry.category, { lang, index: index + 1, prefix }))
      .join("\n");
    return replyAndRemember(m, lang, [t(lang, "assistant.unsure"), suggestions, t(lang, "kernel.pickOption")]);
  }

  return replyAndRemember(m, lang, [t(lang, "assistant.unavailable")]);
}

// ═══════════════════════════════════════════════
// المدار الرئيسي — Orchestrator
// ═══════════════════════════════════════════════

function withDefaults(deps = {}) {
  return {
    ask: deps.ask || providerAsk,
    dispatch: deps.dispatch || dispatchCommand,
    tools: deps.tools || null,
    runTool: deps.runTool || null,
    rateLimit: deps.rateLimit !== false,
    fastWindowMs: Number.isFinite(deps.fastWindowMs) ? deps.fastWindowMs : FAST_WINDOW_MS,
    media: deps.media || {},
    reminders: deps.reminders || {},
  };
}

// ═══════════════════════════════════════════════
// متابعات العمل (v4 §18): «حملها» · «هات الصوت بس» · «الفيديو بقى» · «حمل التاني»
// · «افحصه» · «اقرأه» · «صلحه» · «الملف اللي فوق»
// ═══════════════════════════════════════════════

/** تطبيع خفيف للمطابقة: التشكيل والشدة والهمزات والتاء المربوطة */
function normFollow(text) {
  return String(text || "").replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
}
const DOWNLOAD_IT = /^(?:(?:طيب|تمام|اوك|ok)\s+)?(?:حملها|حمله|حملهم|نزلها|نزله|نزلهم|هاتها|هاته|جيبها|جيبه|download (?:it|that|this)|get it|descargalo|descárgalo|bajalo|bájalo)(?:\s+(?:بقي|بقى|بقا|لو سمحت|please|por favor))?[\s.!؟?]*$/iu;
const DOWNLOAD_NTH = /^(?:حمل|نزل|هات|download|get|descarga)\s+(?:ال)?(?:اول|تاني|ثاني|تالت|ثالث|first|second|third|primero|segundo|tercero)(?:\s+(?:واحد|one|uno))?[\s.!؟?]*$/iu;
const AUDIO_ONLY = /^(?:(?:هات|عايز|اريد|بدي|نزل|حمل)\s+)?(?:ال)?(?:صوت|اغنيه|mp3)(?:\s+(?:بس|فقط|بقي|بقى))?[\s.!؟?]*$|^(?:(?:just|only|get) )?(?:the )?audio(?: only)?[.!?]*$|^(?:solo )?(?:el )?audio[.!?]*$/iu;
const VIDEO_ONLY = /^(?:(?:هات|عايز|اريد|بدي|نزل|حمل)\s+)?(?:ال)?(?:فيديو|mp4)(?:\s+(?:بس|فقط|بقي|بقى))?[\s.!؟?]*$|^(?:(?:just|only|get) )?(?:the )?video(?: only)?[.!?]*$|^(?:solo )?(?:el )?v[ií]deo[.!?]*$/iu;
const urlIn = (text) => String(text || "").match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[)\].,،؛!?]+$/, "") || "";

/**
 * متابعة أداة: نفس الرابط بصيغة أخرى، أو «حملها» لرابط مقتبس/سابق/نتيجة بحث سابقة.
 * يمر على محلّل النية نفسه فتُختار الأداة بالقواعد ذاتها.
 * @returns {{id:string, input:Object, reason:string}|null}
 */
function workToolFollowUp(m, text, state = {}, ordinal = null) {
  if (urlIn(text)) return null;
  const value = normFollow(text);
  const format = AUDIO_ONLY.test(value) ? "mp3" : VIDEO_ONLY.test(value) ? "mp4" : "";
  const download = DOWNLOAD_IT.test(value) || DOWNLOAD_NTH.test(value);
  if (!format && !download) return null;
  const last = state.lastWork?.tool;
  const fromQuoted = urlIn(m?.quoted?.body || m?.quoted?.text);
  const fromList = download && last?.links?.length ? last.links[Math.min(Math.max(ordinal ?? 0, 0), last.links.length - 1)] : "";
  const url = fromQuoted || (DOWNLOAD_NTH.test(value) ? fromList : "") || last?.url || fromList;
  if (!url) return null;
  // كلمات النية داخلية (للموجّه لا للمستخدم): «download mp3» ⇒ صوت · «download mp4» ⇒ فيديو
  const tool = resolveScraperIntent(["download", format, url].filter(Boolean).join(" "), {});
  return tool ? { id: tool.id, input: tool.input, reason: format ? `variant:${format}` : "download-it" } : null;
}

const FILE_FOLLOW = [
  { op: "syntax", re: /^(?:افحصه|راجعه|افحصها|check it|verify it|revisalo|revísalo)[\s.!؟?]*$/iu },
  { op: "read", re: /^(?:اقراه|اعرضه|افتحه|وريني اياه|read it|show it|open it|leelo|léelo|muestralo|muéstralo)[\s.!؟?]*$/iu },
  { op: "fix", re: /^(?:صلحه|اصلحه|عالجه|fix it|arreglalo|arréglalo)(?<rest>.*)$/iu },
  { op: "backup", re: /^(?:اعمله باك ?اب|خد منه نسخه|back it up|respaldalo|respáldalo)[\s.!؟?]*$/iu },
  { op: "inspect", re: /^(?:معلوماته|تفاصيله|info about it|details of it)[\s.!؟?]*$/iu },
];
const FILE_ABOVE = /(?:ال)?ملف (?:اللي|الي) فوق|(?:ال)?ملف السابق|the (?:file|one) above|the previous file|el archivo de arriba|el archivo anterior/iu;

/** متابعة ملف للمالك: الضمير أو «الملف اللي فوق» ⇒ آخر ملف تعامل معه في هذه المحادثة */
function fileFollowUp(text, lastFile, tools) {
  if (!lastFile) return null;
  const value = normFollow(text);
  for (const { op, re } of FILE_FOLLOW) {
    const match = value.match(re);
    if (!match) continue;
    return {
      op, target: lastFile,
      ...(op === "read" ? { from: 1, to: 40 } : {}),
      ...(op === "fix" ? { request: String(match.groups?.rest || "").trim() } : {}),
    };
  }
  if (FILE_ABOVE.test(value)) {
    return parseOwnerIntent(value.replace(FILE_ABOVE, lastFile), tools) || { op: "read", target: lastFile, from: 1, to: 40 };
  }
  return null;
}

/**
 * المراحل الحتمية التي لا تحتاج نموذجاً: رفض · موافقة/إلغاء/متابعة
 * · ذاكرة · تحكّم المالك. يستعملها runKernel و Auto AI معاً.
 * @returns {Promise<string|null>} "answered" أو null
 */
async function preRoute({ m, sock, db, text, lang, pkg, deps: rawDeps }) {
  const deps = withDefaults(rawDeps);
  const prefix = config.command?.prefix || ".";
  const language = lang || replyLanguage(m, db, text);
  const context = pkg || buildContextPackage({ m, sock, db, text, lang: language });

  if (isForbiddenRequest(text)) {
    stepOf(m, "strategy", "refusal");
    stepOf(m, "permission", "refused");
    return replyAndRemember(m, language, [t(language, "kernel.refused")], { icon: "⛔" });
  }

  // محرك الإجراءات الحقيقية: أعضاء المجموعة (ضيف/اطرد/رجعه/خليه أدمن…) · دليل المجموعة (مين الأدمن؟)
  // · السيرفرات (عيد تشغيله) · نمط الاستخدام — بسياق الجلسة، وعبر البلوقنات الموجودة نفسها
  // الرد يبدأ من داخل المحرك ⇒ رسائل الدفعة السابقة لا تعود «بلا رد» فتُنفَّذ مرتين
  const acted = await runActionEngine({ m, sock, text, lang: language, burst: context.burst || [], deps: { dispatch: deps.dispatch, onRespond: () => beginResponse(m) } });
  if (acted) {
    beginResponse(m);
    try { recordTurn(m, "assistant", "[action]"); } catch (error) { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:preRoute", stage: "recordTurn:action" }); }
    return acted;
  }

  // موافقة/إلغاء/اختيار لإجراء معلّق
  const settled = await handlePending({ m, sock, pkg: context, lang: language, prefix, text, deps });
  if (settled) {
    stepOf(m, "strategy", "pending");
    return settled;
  }

  // الذاكرة بكلام طبيعي (قبل المتابعات: «رجع الذاكرة» تشغيل لا رجوع)
  const memoryIntent = parseMemoryIntent(text);
  if (memoryIntent) {
    stepOf(m, "capability", "memory-engine");
    stepOf(m, "strategy", "memory");
    return runMemoryOperation({ m, lang: language, op: memoryIntent.op, days: memoryIntent.days });
  }

  // تحكّم المالك بلغة طبيعية (ومتابعات الملف: «افحصه» · «الملف اللي فوق»)
  const state = conversationState(m);
  if (isConfigOwner(m)) {
    const tools = deps.tools || (await import("./terboo-ai-tools.js"));
    const intent = parseOwnerIntent(text, tools) || fileFollowUp(text, state.lastWork?.file?.path, tools);
    if (intent) {
      stepOf(m, "capability", "owner-tools");
      stepOf(m, "strategy", "owner");
      return runProjectOperation({ m, sock, lang: language, intent, deps: { ...deps, tools } });
    }
  }

  // متابعات الأدوات: «حملها» · «هات الصوت بس» · «حمل التاني» (§18)
  const workTool = workToolFollowUp(m, text, state, context.reference?.ordinal ?? null);
  if (workTool) {
    stepOf(m, "capability", "scraper-registry");
    stepOf(m, "strategy", ["followup-tool", workTool.reason].join(":"));
    return runToolDecision({ m, sock, lang: language, prefix, id: workTool.id, input: workTool.input, deps });
  }

  // المتابعات: رجوع · تكرار · نفس الأمر على هدف جديد
  const followed = await handleFollowUp({ m, sock, pkg: context, lang: language, prefix, text, deps });
  if (followed) stepOf(m, "strategy", "followup");
  return followed;
}

/**
 * النقطة الوحيدة التي يناديها handler للذكاء بلا بادئة.
 * @param {Object} m
 * @param {Object} sock
 * @param {Object} db
 * @param {{ask?:Function, dispatch?:Function, tools?:Object, rateLimit?:boolean}} [rawDeps] للاختبارات
 * @returns {Promise<"answered"|false>}
 */
async function runKernel(m, sock, db, rawDeps = {}) {
  if (db?.setting?.("aiAssistant") === false) return false;
  const engagement = shouldEngage(m, sock);
  // تحكّم المالك في كلام الذكاء بالمجموعة («متتكلمش هنا لحد ما اقولك اتكلم» · «متتكلمش مع ده» · «اتكلم»)
  if (m?.isGroup && m.body && !m.isCommand && !m.fromMe && !m.isBot) {
    const talk = await applyTalkControl(m, sock, db, { text: cleanRequestText(m, sock) || m.body, engaged: engagement.engaged, t, lang: replyLanguage(m, db, m.body), prefix: config.command?.prefix || ".", claim: () => claimAiMessage(m, "kernel") })
      .catch((error) => { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:runKernel", stage: "talk-control" }); return null; });
    if (talk?.handled) return talk.op === "duplicate" ? "duplicate" : "answered";
  }
  // ① Message — رسائل لا تخص الذكاء تخرج فوراً بلا أي قياس أو عمل
  if (!engagement.engaged) return false;
  // المالك أسكت الذكاء هنا أو طلب تجاهل هذا العضو
  if (talkBlock(m, db)) return false;
  // إعادة تسليم متأخرة لنفس الرسالة: لا معالجة ولا نداء مزوّد ثانٍ (§52)
  if (!claimAiMessage(m, "kernel")) return "duplicate";
  // قرار أساسي واحد لكل رسالة واردة عبر كل المسارات (Auto AI · النواة) (§83)
  if (!claimPrimary(m, "kernel")) return "duplicate";
  const trace = attachTrace(m, startTrace("kernel"));
  let outcome = false;
  try {
    outcome = await runKernelStages(m, sock, db, withDefaults(rawDeps), trace);
    return outcome;
  } finally {
    trace.mark("response");
    trace.step("response", String(outcome || "skipped"));
    trace.end(outcome || "skipped");
  }
}

async function runKernelStages(m, sock, db, deps, trace) {
  // نداء بالاسم وحده («تيربو» · «يا تربو») ⇒ يُرد عليه (الاسم نفسه هو الرسالة) بدل تجاهله
  const stripped = cleanRequestText(m, sock);
  const text = !stripped && nameTrigger(m.body) ? String(m.body).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH) : stripped;
  if ((!text || text.length < 2) && !isVoiceNote(m)) return false;
  // Smart Concurrency (§17): لا تأخير ثابت — ممرّ لكل شخص، إلغاء، تجميع، ضغط عكسي
  let lane = { status: "proceed", ticket: null, burst: [], cancelledPrevious: false };
  if (deps.rateLimit) {
    lane = await enterLane(m);
    if (lane.status === "duplicate") return "duplicate";
    // تجاوزتها رسالة أحدث قبل أن تبدأ: نصها يصل للقرار الأحدث كسياق دفعة — قرار واحد للتسلسل
    if (lane.status === "superseded") return "superseded";
    if (lane.status === "flood") {
      // إغراق فوق الطابور: إشارة مرئية بدل صمت
      await m.react?.("⏳").catch?.((error) => noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:runKernelStages", stage: "flood-react" }));
      return "answered";
    }
  }
  m.__terbooTicket = lane.ticket;
  try {
    return await runKernelDecision(m, sock, db, deps, trace, text, lane);
  } finally {
    lane.ticket?.release();
  }
}

async function runKernelDecision(m, sock, db, deps, trace, text, lane) {
  try {
    // ② Identity + لغة هذه الرسالة
    const lang = replyLanguage(m, db, text);
    // سياق الجلسة: وسائط/رابط/رسالة مقتبسة هذه الرسالة (لـ«اقرأ الملف» · «نزله» · «اطرده»)
    try { observeMessage(m); } catch (error) { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:observeMessage", stage: "context" }); }
    const prefix = config.command?.prefix || ".";
    trace.mark("parse");

    // ① Fast Intent Gate (§15 §16) — بلا نموذج: ما الذي يريده المستخدم؟
    const who = taskOwner(m);
    const lastTask = latestTask(who);
    // تفريغ ملاحظة صوتية أُعيد كطلب: يُصنَّف كنص مكتوب (لا يُعاد تفريغه)
    const gateMessage = m.__terbooTranscript ? { ...m, isAudio: false, ptt: false, isImage: false, isVideo: false, isDocument: false, isSticker: false, message: null } : m;
    const gate = classifyIntent({
      text, m: gateMessage, state: { ...conversationState(m), lastTask },
      isOwner: isConfigOwner(m), hasActiveTask: Boolean(lastTask && ACTIVE_TASK_STATES.includes(lastTask.status)),
    });
    m.__terbooIntent = gate;

    // «لا/خلاص/وقف» أثناء قرار جارٍ: أُلغي فعلاً في المتحكم ⇒ تأكيد واحد بلا نموذج (§85)
    if (lane.cancelledPrevious && isCancelText(text)) {
      trace.step("intent", "task_control:cancel-inflight");
      trace.step("strategy", "cancel");
      return replyAndRemember(m, lang, [t(lang, "tasks.cancelledReply")], { icon: "⏹️", withFooter: false });
    }
    // التحكم بالمهام بكلام طبيعي (§20 §47): انتقالات حالة حقيقية
    if (gate.intent === "TASK_CONTROL") {
      trace.step("intent", `task_control:${gate.op}`);
      trace.step("capability", "task-control-plane");
      trace.step("strategy", "deterministic");
      const control = controlTask({ m, lang, op: gate.op, taskId: gate.signals.taskId, text });
      stepOf(m, "verify", control.ok ? `ok:${control.op}` : `none:${control.op}`);
      if (control.done) deliverTaskOutcome(m, lang, control.title, control.done);
      return replyAndRemember(m, lang, control.blocks, { icon: control.icon, withFooter: false });
    }

    // التذكيرات (§21 §48): إنشاء/قائمة/إلغاء فوق المجدول الموجود — حتمي بلا نموذج ولا وعود كاذبة
    if (gate.intent === "AUTOMATION") {
      trace.step("intent", `automation:${gate.op || "schedule"}`);
      trace.step("capability", "scheduler");
      trace.step("strategy", "deterministic");
      const reminder = await handleReminder({ m, sock, lang, text, op: gate.op || "schedule", deps: deps.reminders || {} });
      stepOf(m, "verify", reminder.ok ? `ok:${reminder.op}` : `none:${reminder.op}`);
      try { recordTurn(m, "user", text); } catch (error) { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:reminders", stage: "recordTurn" }); }
      return replyAndRemember(m, lang, reminder.blocks, { icon: reminder.icon, withFooter: false });
    }

    // «اقرأهولي» على رسالة مقتبسة: النص المقتبس نفسه بصوت — بلا نموذج (§29)
    const quotedText = String(m.quoted?.text || m.quoted?.body || "").trim();
    if (gate.signals.voiceReply && quotedText && text.replace(GATE_PATTERNS.voiceReply, "").replace(/[\s!.،,؟?]+/g, "").length < 3) {
      trace.step("intent", "voice:read-quoted");
      trace.step("strategy", "tts");
      const sent = await sendVoiceReply({ m, sock, text: quotedText, lang, synthesize: deps.media?.synthesize });
      stepOf(m, "verify", sent ? "tts" : "tts:failed");
      if (sent) { markFirstResponse(m); return "answered"; }
      return replyAndRemember(m, lang, [t(lang, "media.ttsUnavailable")], { icon: "🔇", withFooter: false });
    }

    // الوسائط (§26–§33): رؤية حقيقية · OCR · تفريغ · فيديو · مستند — لا تظاهر بالفهم.
    // أولاً فقط للطلب الوسائطي الصريح (حتمي) أو السؤال عن الوسيط؛ غير ذلك («خليها كرتون»، «نفذ المطلوب»)
    // يقرّر النموذج (أداة تعديل؟) ثم تُستعمل الرؤية الحقيقية إن اختار محادثة عن الوسيط.
    const mediaIntent = MEDIA_INTENTS.has(gate.intent) && !m.__terbooTranscript;
    const mediaFirst = mediaIntent && (gate.deterministic || GATE_PATTERNS.question.test(text.trim()));
    if (mediaFirst) {
      trace.step("intent", `${gate.intent.toLowerCase()}:${gate.op || ""}`);
      const handled = await runMediaStrategy({ m, sock, db, text, lang, gate, deps: { ...deps.media, ask: deps.ask } });
      if (handled === "answered") {
        trace.step("strategy", "multimodal");
        return "answered";
      }
      // ملاحظة صوتية فُرِّغت فعلاً: التفريغ هو طلب المستخدم ⇒ نفس المسار كأنه كتبه
      if (handled?.reroute) {
        m.__terbooTranscript = String(handled.reroute).slice(0, MAX_TRANSCRIPT_LENGTH);
        trace.step("strategy", "voice-transcript");
        return runKernelDecision(m, sock, db, deps, trace, m.__terbooTranscript, lane);
      }
    }
    // ملاحظة صوتية لم يُعرف ما بها (لا وسيط قابل للتنزيل): لا شيء يُفهم ⇒ لا رد
    if (!text) return false;

    // v4 §10 ① Intent Understanding — بلا نموذج: رفض؟ ذاكرة؟ أداة واضحة (رابط منصة، «اعمل صورة»، «شغل»…)؟
    const media = mediaInput(m);
    const tool = resolveScraperIntent(text, { hasImage: media.hasImage, hasVideo: media.hasVideo });
    const fastTool = tool && tool.confidence >= TOOL_FAST_CONFIDENCE ? tool : null;
    trace.step("intent", isForbiddenRequest(text) ? "refusal" : fastTool ? `tool:${fastTool.id}` : parseMemoryIntent(text) ? "memory" : `open:${gate.intent.toLowerCase()}`);

    // ② Context Retrieval ③ Memory Retrieval (قبل تسجيل الرسالة الحالية)
    const pkg = buildContextPackage({ m, sock, db, text, lang });
    // رسائل الدفعة السابقة التي لم يُرد عليها: قرار واحد يفهم التسلسل (§17)
    if (lane.burst?.length) pkg.burst = lane.burst;
    trace.mark("context");
    trace.step("context", pkg.chat?.isGroup ? "group" : "private");
    try { recordTurn(m, "user", text); } catch (error) { noteFailure("ai-core", error, {where: "src/lib/terboo-ai-core.js:1071",stage: "recordTurn"}); }
    trace.mark("memory");
    trace.step("memory", `${pkg.memory?.turns?.length || 0}/${pkg.memory?.facts?.length || 0}`);

    // المراحل الحتمية: رفض · متابعة · ذاكرة · مالك (تسجّل استراتيجيتها بنفسها)
    const routed = await preRoute({ m, sock, db, text, lang, pkg, deps });
    trace.mark("routing");
    if (routed) return routed;

    // ④ Capability Discovery ⑤ Execution Strategy — أداة واضحة تُنفَّذ بلا نداء نموذج (§9 §22)
    if (fastTool) {
      trace.mark("intent");
      trace.step("capability", "scraper-registry");
      trace.step("strategy", "tool");
      return runToolDecision({ m, sock, lang, prefix, id: fastTool.id, input: fastTool.input, deps });
    }

    // طلب كود (§ code intelligence): توليد مباشر بلا قرار JSON — الكود داخل JSON يفسد مع النماذج الضعيفة،
    // واسم أمر يشبه «كود» لا علاقة له بكتابة الكود
    if (gate.intent === "CHAT" && gate.op === "code") {
      trace.mark("intent");
      trace.step("capability", "code");
      trace.step("strategy", "chat:code");
      const composed = await composeReply({ m, db, text, lang, ask: deps.ask, pkg, recordUser: false, recordAssistant: false, extraInstruction: codeInstruction(text) });
      trace.mark("provider");
      if (staleDecision(m)) return "superseded";
      if (composed?.text) {
        const answer = await replyChat(m, composed.text, lang);
        refreshSummaryInBackground(m, deps.ask, lang);
        return answer;
      }
      stepOf(m, "verify", "ai-unavailable");
      return replyAndRemember(m, lang, [t(lang, "assistant.aiBusy")]);
    }

    // مرشّحون ديناميكيون من كل السجل الحيّ ثم النموذج
    const candidates = shortlist(text, m, pkg);
    // أدوات المجموعة/الحظر المسموحة لهذا الشخص فعلاً (القرار المركزي يحدد ما يظهر للنموذج)
    try { pkg.groupTools = [await groupToolsForModel(m, sock, text), await messagingToolsForModel(m, sock, text), await sshToolsForModel(m, sock, text)].filter(Boolean).join("\n"); } catch (error) { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:groupTools", fallback: "no-group-tools" }); }
    trace.mark("intent");
    trace.step("capability", `commands:${candidates.length}`);
    const decision = await decide({ pkg, candidates, prefix, ask: deps.ask, trace });
    trace.mark("provider");
    // ألغاه المستخدم أو تجاوزته رسالة أحدث أثناء تفكير النموذج ⇒ لا تنفيذ ولا رد متأخر
    if (staleDecision(m)) return "superseded";

    if (!decision || typeof decision !== "object") {
      trace.step("strategy", "local-fallback");
      return runLocalFallback({ m, sock, pkg, lang, prefix, candidates, deps, gate });
    }

    let kind = String(decision.decision || "").toUpperCase();
    // أمر اختاره النموذج لرسالة ليست طلباً (جملة خبرية فيها كلمة تشبه اسم أمر — مثل تفريغ ملاحظة صوتية
    // يذكر «الفاتورة» فشُغّل «.فاتورة»): محادثة بدل تنفيذ
    if (kind === DECISIONS.COMMAND && gate.intent !== "COMMAND" && !looksLikeRequest(text, findEntry(decision.command || ""))) {
      trace.step("strategy", "command->chat:not-a-request");
      kind = DECISIONS.CHAT;
    }
    // سؤال عن صورة والنموذج اختار أداة «صورة لنص» (برومبت إنجليزي للمولّدات): رؤية حقيقية بلغة المستخدم بدلها
    const describeTool = (kind === DECISIONS.TOOL && DESCRIBE_TOOLS.has(String(decision.tool || "")))
      || (kind === DECISIONS.COMMAND && DESCRIBE_COMMANDS.has(findEntry(decision.command || "")?.name));
    // فقط لسؤال عن الصورة (استفهام أو ذكر «الصورة»)؛ «نفّذ المطلوب» + اختيار صريح للأداة يُحترم
    const asksAboutImage = GATE_PATTERNS.question.test(text.trim()) || /(?:^|\s)(?:ال)?(?:صوره|صورة|صور)(?=[\s،,.!؟?]|$)|\b(?:image|photo|picture|imagen|foto)\b/i.test(text);
    if (describeTool && mediaIntent && gate.intent === "VISION" && asksAboutImage && !/برومبت|prompt/i.test(text)) {
      trace.step("strategy", "describe-tool->vision");
      const handled = await runMediaStrategy({ m, sock, db, text, lang, gate: { ...gate, op: "describe" }, deps: { ...deps.media, ask: deps.ask }, recordUser: false });
      if (handled === "answered") {
        trace.step("strategy", "multimodal");
        return "answered";
      }
    }
    const confidence = Number(decision.confidence);
    trace.step("strategy", (kind || "CHAT").toLowerCase());
    storeFacts(m, decision.facts);

    // ⑤⑥⑦ Permission → Tool/Plugin → Result
    if (kind === DECISIONS.REFUSAL) {
      trace.step("permission", "refused");
      return replyAndRemember(m, lang, [String(decision.reply || t(lang, "kernel.refused")).slice(0, 600)], { icon: "⛔" });
    }

    if (kind === DECISIONS.CLARIFICATION) {
      const options = (Array.isArray(decision.options) ? decision.options : [])
        .filter((option) => option?.command && pluginExists(findEntry(option.command)?.name || ""))
        .slice(0, 3)
        .map((option) => ({ command: findEntry(option.command).name, args: resolveArgs(pkg, option.args) }));
      if (options.length) setPending(m, { kind: "choice", options, reason: "clarification" });
      else if (decision.command && findEntry(decision.command)) {
        setPending(m, { kind: "command", command: findEntry(decision.command).name, args: resolveArgs(pkg, decision.args), reason: "clarification" });
      }
      const optionLines = options.map((option, index) => UI.menuItem(`${option.command} ${option.args}`.trim(), "", { lang, index: index + 1, prefix })).join("\n");
      // Smart Button Engine: النموذج يقترح responseMode والسياسة تقرر (لا زر لخيار يحتاج نصاً/هدفاً/وسيطاً أو لا يملك صلاحيته)
      const policy = resolveResponseMode({ proposed: decision.responseMode, options, m });
      stepOf(m, "strategy", `ui:${policy.mode}`);
      const blocks = [String(decision.reply || t(lang, "kernel.needClarify")).slice(0, 600), optionLines];
      if (policy.mode === "buttons" || (policy.mode === "confirm" && options.length === 1)) {
        const buttons = policy.mode === "confirm"
          ? confirmButtons(lang)
          : policy.allowed.map((v, index) => ({ id: `terboo_pick_${options.indexOf(v.option) + 1}`, text: `${index + 1}. ${v.option.command}`.slice(0, 24) }));
        return replyWithButtons(m, sock, lang, blocks, buttons, { icon: "❓" });
      }
      return replyAndRemember(m, lang, blocks, { icon: "❓" });
    }

    if (kind === DECISIONS.MEMORY_OPERATION) {
      const days = Number(String(decision.args || decision.reply || "").match(/\d+/)?.[0]) || 30;
      return runMemoryOperation({ m, lang, op: decision.memoryOp, days });
    }

    if (kind === DECISIONS.PROJECT_OPERATION) {
      if (!isConfigOwner(m)) return replyAndRemember(m, lang, [t(lang, "kernel.ownerOnly")], { icon: "⛔" });
      const tools = deps.tools || (await import("./terboo-ai-tools.js"));
      const intent = projectIntentFromDecision(decision, tools);
      if (!intent) return replyAndRemember(m, lang, [String(decision.reply || t(lang, "kernel.toolDenied")).slice(0, 600)]);
      return runProjectOperation({ m, sock, lang, intent, deps: { ...deps, tools } });
    }

    if (kind === DECISIONS.AGENT && Array.isArray(decision.steps) && decision.steps.length) {
      return runAgentDecision({ m, sock, lang, prefix, steps: decision.steps, reply: decision.reply, goal: text, deps });
    }

    if (kind === DECISIONS.TOOL && decision.tool && (GROUP_TOOLS[String(decision.tool)] || MESSAGING_TOOLS[String(decision.tool)] || SSH_TOOLS[String(decision.tool)])) {
      return runGroupToolDecision({ m, sock, lang, id: String(decision.tool), input: decision.input || {}, text });
    }
    if (kind === DECISIONS.TOOL && decision.tool) {
      return runToolDecision({ m, sock, lang, prefix, id: String(decision.tool), input: decision.input || {}, deps });
    }

    if (kind === DECISIONS.COMMAND && decision.command) {
      // فحص اختيار النموذج بالترتيب الحتمي: مرشّح أول بمطابقة قوية (الاسم كاملاً/مرادف/اسم صريح)
      // والنموذج اختار أمراً أضعف بكثير ⇒ المرشّح الأول («انشيء مجموعة» ⇒ انشاء_مجموعة لا إنشاء_عشيرة)
      const chosen = findEntry(decision.command);
      const top = candidates[0];
      if (top && chosen && top.entry.name !== chosen.name) {
        // فقط مطابقة الاسم كاملاً/حرفياً (لا مرادف كلمة عامة مثل «أوامر» ⇒ القائمة)، وفارق كبير
        const strongTop = (top.reasons || []).some((reason) => ["exact", "name-phrase"].includes(reason));
        const chosenScore = candidates.find((candidate) => candidate.entry.name === chosen.name)?.score ?? 0;
        // أو: النموذج اختار «أخاً أطول» للأمر الأول بكلمة لم يقلها المستخدم («اضف العضو» ⇒ اضف_بريميوم بدل اضف)
        if ((strongTop && chosenScore < top.score * 0.5) || siblingWithUnsaidWord(top.entry.name, chosen.name, text)) {
          trace.step("strategy", "override:shortlist");
          decision.command = top.entry.name;
        }
      }
      // مقدمة تدّعي النجاح قبل التنفيذ («تم إنشاء…») لا تُعرض: نتيجة البلوقن الحقيقية هي ما يُبلَّغ
      if (decision.reply && ACTION_CLAIM.test(String(decision.reply))) decision.reply = "";
      if (Number.isFinite(confidence) && confidence < MIN_CONFIDENCE) {
        const entry = findEntry(decision.command);
        const pendingArgs = entry ? resolveArgs(pkg, decision.args) : "";
        if (entry) setPending(m, { kind: "command", command: entry.name, args: pendingArgs, reason: "low-confidence" });
        const blocks = [
          String(decision.reply || t(lang, "assistant.unsure")).slice(0, 600),
          entry ? UI.row(t(lang, "assistant.runningCommand"), UI.isolate(`${prefix}${entry.name}`), lang) : "",
          entry ? t(lang, "kernel.pendingConfirm") : "",
        ];
        // تأكيد بزرين (نعم/لا) فقط لأمر كامل المدخلات يملك المستخدم صلاحيته — وإلا نص كما كان
        const policy = entry ? resolveResponseMode({ proposed: decision.responseMode, options: [{ command: entry.name, args: pendingArgs }], m }) : { mode: "text" };
        if (policy.mode === "confirm") return replyWithButtons(m, sock, lang, blocks, confirmButtons(lang), {});
        return replyAndRemember(m, lang, blocks);
      }
      return runCommandDecision({
        m, sock, pkg, lang, prefix,
        commandName: decision.command,
        rawArgs: decision.args,
        reply: decision.reply,
        deps,
      });
    }

    // CHAT عن وسيط مرفق لم يُفهم بعد: الرؤية/الاستخراج الحقيقي بدل رد أعمى على وصف لم يُرَ
    if (mediaIntent && !mediaFirst) {
      const handled = await runMediaStrategy({ m, sock, db, text, lang, gate: { ...gate, op: gate.intent === "VISION" ? "describe" : gate.op }, deps: { ...deps.media, ask: deps.ask }, recordUser: false });
      if (handled === "answered") {
        trace.step("strategy", "multimodal");
        return "answered";
      }
    }

    // CHAT يدّعي تنفيذ إجراء («تم إنشاء المجموعة») لطلب تنفيذ ولم يُنفَّذ شيء: لا يُرسل الادعاء،
    // بل الأوامر الحقيقية المطابقة ليختار المستخدم (أو رد صريح بأنه لم يُنفَّذ)
    if (decision.reply && ACTION_CLAIM.test(String(decision.reply)) && looksLikeRequest(text)) {
      trace.step("strategy", "blocked:false-action-claim");
      stepOf(m, "verify", "false-claim-blocked");
      decision.reply = "";
      if (candidates.length) {
        const top = candidates.slice(0, 3);
        setPending(m, { kind: "choice", options: top.map(({ entry }) => ({ command: entry.name, args: resolveArgs(pkg, "") })), reason: "suggestions" });
        const suggestions = top.map(({ entry }, index) => UI.menuItem(entry.name, entry.description || entry.category, { lang, index: index + 1, prefix })).join("\n");
        return replyAndRemember(m, lang, [t(lang, "kernel.notExecuted"), suggestions, t(lang, "kernel.pickOption")], { icon: "❓" });
      }
      return replyAndRemember(m, lang, [t(lang, "kernel.notExecuted")], { icon: "❓" });
    }

    // كلام ليس طلباً والرد يدّعي إجراءً لم يحدث («تم إنشاء الفاتورة» رداً على تسجيل صوتي): إعادة صياغة بلا ادعاء
    if (decision.reply && claimsAction(decision.reply)) {
      trace.step("strategy", "rewrite:false-action-claim");
      const composed = await composeReply({ m, db, text, lang, ask: deps.ask, pkg, recordUser: false, recordAssistant: false, extraInstruction: NO_ACTION_INSTRUCTION }).catch((error) => { noteFailure("ai-core", error, { where: "src/lib/terboo-ai-core.js:runKernelDecision", stage: "rewrite-claim" }); return null; });
      const retried = normalizeProviderText(composed?.text);
      decision.reply = retried && !claimsAction(retried) ? retried : withoutClaims(retried || decision.reply);
      stepOf(m, "verify", decision.reply ? "false-claim-rewritten" : "false-claim-dropped");
    }

    // CHAT (أو أي قرار غير معروف يُعامَل كمحادثة)
    if (decision.reply) {
      const answer = await replyChat(m, decision.reply, lang);
      // «رد بصوت»: الرد النصي أولاً ثم نفس الرد كملاحظة صوتية (§29)
      if (gate.signals.voiceReply) {
        const sent = await sendVoiceReply({ m, sock, text: decision.reply, lang, synthesize: deps.media?.synthesize });
        stepOf(m, "verify", sent ? "tts" : "tts:failed");
      }
      refreshSummaryInBackground(m, deps.ask, lang);
      return answer;
    }

    return runLocalFallback({ m, sock, pkg, lang, prefix, candidates, deps, gate });
  } catch (error) {
    console.error("[AI Core] error:", error.message);
    return false;
  }
}

export {
  DECISIONS,
  // أسماء المزوّدين المهيّأين فقط (للوحات الحالة) — بلا مفاتيح، عبر النواة لا مباشرة
  providerNames as configuredProviders,
  looksLikeRequest,
  repairDecision,
  MEMORY_INTENTS,
  MIN_CONFIDENCE,
  buildInstruction,
  cleanRequestText,
  composeReply,
  decide,
  kernelAsk,
  defaultPersona,
  handleFollowUp,
  handlePending,
  isForbiddenRequest,
  isStrictRevert,
  nameTrigger,
  parseMemoryIntent,
  parseModelJson,
  preRoute,
  preflight,
  resolveArgs,
  rewriteAsCommand,
  runKernel,
  runMemoryOperation,
  shouldEngage,
  fileFollowUp,
  storeFacts,
  stripNameTrigger,
  workToolFollowUp,
};

export default { runKernel, composeReply, preRoute, shouldEngage, DECISIONS };
