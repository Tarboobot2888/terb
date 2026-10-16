import { noteFailure } from "./terboo-failure-log.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { chat as geminiChat } from "../scraper/geminiVision.js";
import { DeepSeekThinking } from "../scraper/deepseek.js";
import { GPT5 } from "../scraper/gpt5.js";
import { handleCodeReviewFlow } from "./terboo-code-review.js";
import { handleNaturalAIRequest } from "./terboo-natural-ai.js";
import { buildGroupMemoryContext } from "./terboo-ai-workspace.js";
import { handleAgentRequest } from "./terboo-agent-runner.js";
import { attachTrace, claimAiMessage, markFirstResponse, startTrace, traceOf } from "./terboo-latency.js";
import { claimPrimary } from "./terboo-concurrency.js";
import { claudeChat } from "./terboo-ai-providers.js";
import { userError } from "./terboo-error-guard.js";
import { getDatabase } from "./terboo-database.js";
import { pinterest } from "btch-downloader";
import config from "../../config.js";
import { shouldReplyAsBot } from "./terboo-bot-loop-guard.js";
import axios from "axios";
import path from "path";
import fs from "fs";
import { conversationScope, recordTurn, recordGroupMessage, groupContext as sharedGroupContext, remember } from "./terboo-ai-memory.js";
import { composeReply, nameTrigger, preRoute } from "./terboo-ai-core.js";
import { parseTalkControl, talkBlock } from "./terboo-ai-talk-control.js";
import { buildContextPackage, detectReplyLanguage } from "./terboo-ai-context.js";
import { getUserLanguage, t } from "./terboo-localization.js";
import { markRaw } from "./terboo-i18n/runtime.js";
import { dispatchCommand } from "./terboo-command-dispatch.js";
const execFileAsync = promisify(execFile);

const userCooldowns = new Map();
const COOLDOWN_MS = 3000;
const errorPatterns = new Map();
const successfulPatterns = new Map();
const MAX_PATTERN_ENTRIES = 300;
const PROVIDER_TIMEOUT_MS = 12_000;
/** صوت الرد الصوتي بلغة المستخدم (لا صوت بلغة ثابتة) */
const VOICES = { ar: "ar-EG-SalmaNeural", en: "en-US-AriaNeural" };

const ACTION_REGEX = /\[ACTION\s*:\s*(\w+)(?:\s+([^\]]*))?\]/gi;

/**
 * سياسة الرد. داخل المجموعات (v4 §23): لا رد على المحادثة العامة أبداً — منشن البوت أو الرد
 * على رسالته أو بدء الرسالة باسمه «تيربو» فقط، أياً كان الوضع المخزّن. «الكل» يبقى للخاص.
 */
function getReplyPolicy(autoai = {}, isGroup = true) {
  const modeInput = String(autoai.replyMode || "").toLowerCase();
  const scopeInput = String(autoai.replyScope || "").toLowerCase();
  const requestedMode = ["mention", "منشن", "رد", "اقتباس"].includes(modeInput) || autoai.alwaysReply === false ? "mention" : "all";
  const replyMode = isGroup ? "mention" : requestedMode;
  const replyScope = ["all", "كل", "الجميع"].includes(scopeInput) ? "all"
    : ["private", "خاص", "الخاص"].includes(scopeInput) ? "private"
      : ["groups", "group", "مجموعات", "مجموعة"].includes(scopeInput) ? "groups"
        : isGroup ? "groups" : "private";
  return { replyMode, replyScope, requestedMode, groupRule: isGroup };
}

function shouldAutoAIReply({ autoai = {}, isGroup = true, isMentioned = false, isBotQuoted = false } = {}) {
  const policy = getReplyPolicy(autoai, isGroup);
  const scopeAllowed = policy.replyScope === "all" || (policy.replyScope === "groups" && isGroup) || (policy.replyScope === "private" && !isGroup);
  if (!scopeAllowed) return { allowed: false, reason: "scope", ...policy };
  if (policy.replyMode === "mention" && !isMentioned && !isBotQuoted) return { allowed: false, reason: "mention-or-reply", ...policy };
  return { allowed: true, reason: "ok", ...policy };
}

function describeAutoAISkip(reason = "") {
  const labels = {
    "bot-message": "الرسالة صادرة من بوت؛ تم منع حلقة الردود.",
    "speaker-priority": "منع حارس أولوية المتحدث هذه الجلسة من الرد داخل المجموعة.",
    "rate-limit": "منع حد التكرار الرد مؤقتاً؛ انتظر 20 ثانية ثم أعد المحاولة.",
    "scope": "الرسالة خارج نطاق الرد المحدد.",
    "mention-or-reply": "وضع المنشن مفعّل؛ يجب منشن البوت أو الرد على رسالة سابقة منه.",
  };
  return labels[reason] || "لم يُسجّل سبب رفض.";
}

async function withProviderTimeout(operation, name) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`انتهت مهلة المزود ${name}`)), PROVIDER_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT_ACTIONS = `
ACTION TAGS (put them at the END of your reply, one per line, only when the user clearly asks):
[ACTION:KICK target=number]
[ACTION:ADD target=number]
[ACTION:PROMOTE target=number]
[ACTION:DEMOTE target=number]
[ACTION:WARN target=number]
[ACTION:LEAVE]
[ACTION:OPEN]
[ACTION:CLOSE]
[ACTION:TAGALL]
[ACTION:HIDETAG message=text to announce]
[ACTION:SETNAME name=new group name]
[ACTION:SETDESC desc=new group description]
[ACTION:DELETE]
[ACTION:STICKER]
[ACTION:ANTILINK mode=on|off]
[ACTION:INVITE]
[ACTION:MUTE]
[ACTION:UNMUTE]
[ACTION:BLOCK target=number]
[ACTION:UNBLOCK target=number]
[ACTION:PINS query=search words]
[ACTION:ALBUM query=search words]
[ACTION:POLL question=question options=option1,option2,option3]
[ACTION:PAYMENT amount=100 note=text]
[ACTION:PRODUCT title=name price=100 desc=description imageurl=https://...]
[ACTION:EVENT name=name desc=description location=place]
[ACTION:REMINDER time=seconds message=text]
[ACTION:REACT emoji=🔥]
[ACTION:CONTACT name=name number=digits]
[ACTION:LOCATION lat=30.04 lon=31.23 name=Cairo]
[ACTION:BUTTONS title=Title text=Description buttons=Button1|id1,Button2|id2]
[ACTION:CAROUSEL cards=Title1|Desc1|url1,Title2|Desc2|url2]
[ACTION:EPHEMERAL time=86400]
[ACTION:LEARNSTATS]

Every group/moderation action is executed by the bot's REAL command with its normal permission checks
(admin, bot admin, owner, cooldown). You never bypass permissions; if the user is not allowed, the bot says so.

RICH MESSAGES (use only when they really help):
[RICH:TABLE]
title: Table title
header: Col1 | Col2 | Col3
rows: A | B | C;; D | E | F
text: optional intro
footer: optional footer
[/RICH:TABLE]

[RICH:CODE]
language: javascript
title: Example
code: console.log("hello")
text: optional intro
[/RICH:CODE]
Supported languages: javascript/ts, python, go, lua, bash.

[RICH:LINK]
text: See {{IE_0}}first link{{/IE_0}} and {{IE_1}}second link{{/IE_1}}
urls: https://example.com/1, https://example.com/2
displayNames: Link 1, Link 2
[/RICH:LINK]

[RICH:LIST]
title: Bot info
rows: Name | ${config.bot?.name || "Bot Terboo"};; Developer | ${config.bot?.developer || "Terboo"}
[/RICH:LIST]

[RICH:STICKER]
url: https://iili.io/BPBdFuj.md.jpg
[/RICH:STICKER]
Emotion stickers: annoyed https://iili.io/BPBdFuj.md.jpg · surprised https://iili.io/BPBFwVR.jpg · confused https://iili.io/BPBqKwg.md.jpg

[RICH:LATEX]
formula: E = mc^2
[/RICH:LATEX]

RULES:
1. Run an action ONLY when the user explicitly asks for it; never on assumption.
2. For KICK/PROMOTE/DEMOTE/WARN use the number the user mentioned (@number) or replied to.
3. Do not use rich messages for greetings, small talk or simple questions.
4. Never send the same content both as a rich message and as plain text.
5. If the user sends an image, describe and analyse it.
6. Stay in the current persona, but ALWAYS answer in the user's own language.
7. When "project agent results" appear in the context, treat them as the only source of truth; never claim to have read or changed a file without an explicit result.
8. Project tools are for the owner only; never reveal file paths or contents to others, never apply changes without the owner's explicit approval, never use a shell, eval, secrets or keys.
  `;

/** رد احتياطي بلغة المستخدم حين تتعذر كل المزوّدات */
function getFallbackResponse(lang = "ar") {
  const list = t(lang, "autoai.fallback");
  const options = Array.isArray(list) && list.length ? list : ["…"];
  return options[Math.floor(Math.random() * options.length)];
}

function isOnCooldown(userId) {
  const lastTime = userCooldowns.get(userId);
  if (!lastTime) return false;
  return Date.now() - lastTime < COOLDOWN_MS;
}

function setCooldown(userId) {
  userCooldowns.set(userId, Date.now());
  while (userCooldowns.size > 5000) {
    userCooldowns.delete(userCooldowns.keys().next().value);
  }
}

function pruneMap(map, maxSize = MAX_PATTERN_ENTRIES) {
  while (map.size > maxSize) {
    map.delete(map.keys().next().value);
  }
}

function learnFromError(operation, error) {
  const message = error?.message?.split("\n")[0]?.slice(0, 120) || "unknown";
  const key = `${operation}:${message}`;
  const entry = errorPatterns.get(key) || { count: 0, lastAt: 0 };
  entry.count += 1;
  entry.lastAt = Date.now();
  errorPatterns.set(key, entry);
  pruneMap(errorPatterns);
  return entry.count;
}

function learnFromSuccess(operation) {
  const entry = successfulPatterns.get(operation) || { count: 0, lastAt: 0 };
  entry.count += 1;
  entry.lastAt = Date.now();
  successfulPatterns.set(operation, entry);
  pruneMap(successfulPatterns);
  return entry.count;
}

function getAutoAIHealth() {
  const success = [...successfulPatterns.entries()]
    .map(([operation, data]) => ({ operation, ...data, type: "success" }));
  const errors = [...errorPatterns.entries()]
    .map(([operation, data]) => ({ operation, ...data, type: "error" }));
  return [...success, ...errors]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

// سياق المجموعة العام يعيش في محرّك الذاكرة المركزي (نطاق group) —
// هذان الاسمان يبقيان كمحوّلين لمن يستعملهما أو يحقنهما في الاختبارات.
function rememberGroupMessage(message) {
  return recordGroupMessage(message);
}

function getGroupContext(chatId) {
  return sharedGroupContext(chatId).map((entry) => ({ sender: entry.sender, text: entry.text, time: entry.at }));
}

/**
 * «ذاكرة طويلة» Auto AI صارت محوّلاً للذاكرة المركزية (§6): لا مخزن ثانٍ.
 * عند تفعيل autoaiLongMemory تُحفظ الرسالة كسياق مهم منخفض الأولوية في
 * نطاق هذه المحادثة وحدها (مع التنقيح والدمج الدلالي ومدة الاحتفاظ).
 */
function saveLongTermMemoryIfEnabled(m, content) {
  const db = getDatabase();
  if (db?.setting?.("autoaiLongMemory") !== true) return null;
  const text = String(content || "").trim();
  if (text.length < 20) return null;
  try {
    return remember(conversationScope(m), { text: text.slice(0, 400), type: "important_context", confidence: 0.45, source: "autoai" });
  } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:252",stage: "remember"}); return null; }
}

// ========== NORMALIZE STRUCTURED RESPONSE ==========
// يدعم العربية والإنجليزية
function normalizeStructuredResponse(text) {
  let normalized = String(text || "")
    .replace(/\r\n?/g, "\n")
    .trim();

  normalized = normalized
    .replace(/^```(?:\w+)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  // ✨ Arab → Inggris Action Map
  const actionMap = {
    'طرد': 'KICK', 'إضافة': 'ADD', 'ترقية': 'PROMOTE', 'تخفيض': 'DEMOTE',
    'خروج': 'LEAVE', 'فتح': 'OPEN', 'إغلاق': 'CLOSE', 'منشن_الكل': 'TAGALL',
    'منشن_مخفي': 'HIDETAG', 'تغيير_الاسم': 'SETNAME', 'تغيير_الوصف': 'SETDESC',
    'حذف': 'DELETE', 'تحذير': 'WARN', 'ملصق': 'STICKER', 'مانع_الروابط': 'ANTILINK',
    'بحث_بينترست': 'PINS', 'استطلاع': 'POLL', 'دفع': 'PAYMENT', 'منتج': 'PRODUCT',
    'حدث': 'EVENT', 'ألبوم': 'ALBUM', 'تذكير': 'REMINDER', 'تفاعل': 'REACT',
    'جهة_اتصال': 'CONTACT', 'موقع': 'LOCATION', 'أزرار': 'BUTTONS',
    'بطاقات': 'CAROUSEL', 'دعوة': 'INVITE', 'مؤقت': 'EPHEMERAL',
    'كتم': 'MUTE', 'إلغاء_كتم': 'UNMUTE', 'حظر': 'BLOCK', 'إلغاء_حظر': 'UNBLOCK',
  };
  const paramMap = {
    'الهدف': 'target', 'الاسم': 'name', 'الوصف': 'desc',
    'الرسالة': 'message', 'الوضع': 'mode', 'البحث': 'query',
    'السؤال': 'question', 'الخيارات': 'options', 'المبلغ': 'amount',
    'ملاحظة': 'note', 'العنوان': 'title', 'السعر': 'price',
    'المكان': 'location', 'الوقت': 'time', 'الإيموجي': 'emoji',
    'الرقم': 'number', 'خط_العرض': 'lat', 'خط_الطول': 'lon',
    'النص': 'text', 'الأزرار': 'buttons', 'البطاقات': 'cards',
    'الرابط': 'imageurl',
  };

  normalized = normalized.replace(/\[\s*إجراء\s*:\s*(\w+)([^\]]*)\]/gi, (_, type, rest = "") => {
    const mappedType = actionMap[type] || type.toUpperCase();
    let mappedRest = rest;
    for (const [ar, en] of Object.entries(paramMap)) {
      mappedRest = mappedRest.replace(new RegExp(`${ar}=`, 'g'), `${en}=`);
    }
    return `[ACTION:${mappedType}${mappedRest}]`;
  });

  // ✨ Arab Rich Map
  const richMap = { 'جدول': 'TABLE', 'كود': 'CODE', 'رابط': 'LINK', 'قائمة': 'LIST', 'ملصق': 'STICKER', 'لاتكس': 'LATEX' };
  normalized = normalized
    .replace(/\[\s*منسق\s*:\s*(\w+)\s*\]/gi, (_, type) => `[RICH:${richMap[type] || type.toUpperCase()}]`)
    .replace(/\[\s*\/\s*منسق\s*:\s*(\w+)\s*\]/gi, (_, type) => `[/RICH:${richMap[type] || type.toUpperCase()}]`);

  // ✨ Arab Field Map
  const fieldMap = {
    'العنوان': 'title', 'الرأس': 'header', 'الصفوف': 'rows',
    'نص': 'text', 'تذييل': 'footer', 'اللغة': 'language',
    'الكود': 'code', 'الروابط': 'urls', 'أسماء_العرض': 'displayNames',
    'الحزمة': 'packname', 'الكاتب': 'author', 'الصيغة': 'formula',
  };
  for (const [ar, en] of Object.entries(fieldMap)) {
    normalized = normalized.replace(new RegExp(`^${ar}:`, 'gm'), `${en}:`);
  }

  // ✨ Inggris (Original) - Tetap support format lama
  normalized = normalized
    .replace(/\[\s*ACTION\s*:\s*(\w+)([^\]]*)\]/gi, (_, type, rest = "") => {
      return `[ACTION:${String(type || "").toUpperCase()}${rest}]`;
    })
    .replace(
      /\[\s*RICH\s*:\s*(TABLE|CODE|LINK|LIST|STICKER|LATEX)\s*\]/gi,
      (_, type) => {
        return `[RICH:${String(type || "").toUpperCase()}]`;
      },
    )
    .replace(
      /\[\s*\/\s*RICH\s*:\s*(TABLE|CODE|LINK|LIST|STICKER|LATEX)\s*\]/gi,
      (_, type) => {
        return `[/RICH:${String(type || "").toUpperCase()}]`;
      },
    );

  return normalized;
}

function parseActions(text) {
  const actions = [];
  let match;
  const regex = new RegExp(ACTION_REGEX.source, ACTION_REGEX.flags);
  while ((match = regex.exec(text)) !== null) {
    const type = match[1].toUpperCase();
    const paramsStr = match[2] || "";
    const params = {};
    const paramRegex = /(\w+)=(.+?)(?=\s+\w+=|$)/g;
    let pm;
    while ((pm = paramRegex.exec(paramsStr)) !== null) {
      params[pm[1]] = pm[2].trim();
    }
    actions.push({ type, params });
  }
  return actions;
}

function cleanActionTags(text) {
  return text.replace(ACTION_REGEX, "").trim();
}

function parseRichMessage(text) {
  const richRegex =
    /\[RICH\s*:\s*(TABLE|CODE|LINK|LIST|STICKER|LATEX)\s*\]\s*([\s\S]*?)\[\/RICH\s*:\s*\1\s*\]/gi;
  const results = [];
  let match;
  while ((match = richRegex.exec(text)) !== null) {
    const type = match[1].toUpperCase();
    const body = match[2].trim();
    const data = {};

    if (type === "CODE") {
      const codeMatch = body.match(/^language:\s*(.+)$/m);
      if (codeMatch) data.language = codeMatch[1].trim();
      const titleMatch = body.match(/^title:\s*(.+)$/m);
      if (titleMatch) data.title = titleMatch[1].trim();
      const textMatch = body.match(/^text:\s*(.+)$/m);
      if (textMatch) data.text = textMatch[1].trim();
      const footerMatch = body.match(/^footer:\s*(.+)$/m);
      if (footerMatch) data.footer = footerMatch[1].trim();

      const codeStartMatch = body.match(/^code:\s*([\s\S]*)/m);
      if (codeStartMatch) {
        let codeContent = codeStartMatch[1];
        const otherKeys = ["language:", "title:", "text:", "footer:"];
        for (const key of otherKeys) {
          const idx = codeContent.indexOf("\n" + key);
          if (idx !== -1) {
            codeContent = codeContent.slice(0, idx);
          }
        }
        data.code = codeContent.trim();
      }
    } else {
      for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) continue;
        const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
        const val = trimmed.slice(colonIdx + 1).trim();
        data[key] = val;
      }
    }

    results.push({ type, data });
  }
  return results;
}

function cleanRichTags(text) {
  return text
    .replace(
      /\[RICH\s*:\s*(TABLE|CODE|LINK|LIST|STICKER|LATEX)\s*\]\s*[\s\S]*?\[\/RICH\s*:\s*\1\s*\]/gi,
      "",
    )
    .trim();
}

// ========== SEND RICH MESSAGE ==========
async function sendRichMessage(rich, sock, jid, quoted) {
  try {
    if (rich.type === "TABLE") {
      const { title, header, rows, text, footer } = rich.data;
      if (!header || !rows) return false;

      const tableData = [title || "Table", header];
      const rowItems = rows.split(";;").map((r) => r.trim());
      for (const row of rowItems) {
        tableData.push(row);
      }

      await sock.sendTableV2(jid, tableData, quoted, {
        headerText: title || undefined,
        text: text || undefined,
        footer: footer || undefined,
      });
      return true;
    }

    if (rich.type === "CODE") {
      const { language, title, code, text, footer } = rich.data;
      if (!code) return false;

      await sock.sendCodeBlockV2(jid, code, quoted, {
        language: language || "javascript",
        title: title || undefined,
        text: text || undefined,
        footer: footer || undefined,
      });
      return true;
    }

    if (rich.type === "LINK") {
      const { text, urls, displayNames, footer } = rich.data;
      if (!text || !urls) return false;

      const urlList = urls
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean);
      const nameList = displayNames
        ? displayNames.split(",").map((n) => n.trim())
        : [];
      const links = urlList.map((u, i) => ({
        url: u,
        displayName: nameList[i] || `Link ${i + 1}`,
        sourceDisplayName: nameList[i] || `Source ${i + 1}`,
        sourceSubtitle: "",
      }));
      await sock.sendLinkV2(jid, text, links, quoted, {
        footer: footer || undefined,
      });
      return true;
    }

    if (rich.type === "LIST") {
      const { title, rows, footer } = rich.data;
      if (!rows) return false;

      const listData = rows.split(";;").map((r) => {
        const parts = r
          .trim()
          .split("|")
          .map((p) => p.trim());
        return parts;
      });

      await sock.sendList(jid, title || "List", listData, quoted, {
        footer: footer || undefined,
      });
      return true;
    }

    if (rich.type === "STICKER") {
      let { url, packname, author } = rich.data;
      if (!url) return false;

      url = url.replace(/[`*_\[\]()]/g, "").trim();
      console.log("[AutoAI Sticker] Parsed url:", JSON.stringify(url));

      let stickerInput = url;
      if (/^https?:\/\//.test(url)) {
        try {
          const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 30000,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });
          stickerInput = Buffer.from(res.data);
          console.log(
            "[AutoAI Sticker] Downloaded, size:",
            stickerInput.length,
          );
        } catch (e) {
          console.error("[AutoAI Sticker] Download failed:", e.message);
          return false;
        }
      } else {
        console.error(
          "[AutoAI Sticker] Invalid URL format:",
          JSON.stringify(url),
        );
        return false;
      }
      await sock.sendImageAsSticker(jid, stickerInput, quoted, {
        packname: packname || config.bot?.name || "Bot Terboo",
        author: author || "AutoAI",
      });
      return true;
    }

    if (rich.type === "LATEX") {
      const { formula } = rich.data;
      if (!formula) return false;
      try {
        await sock.sendLatex(jid, formula, quoted);
        return true;
      } catch (e) {
        console.error("[AutoAI Latex] Error:", e.message);
      }
      return false;
    }
  } catch (e) {
    console.error("[AutoAI RichMsg] Error:", e.message);
  }
  return false;
}

// ========== DETECT INTENT FROM MESSAGE ==========
function detectIntentFromMessage(msg, m) {
  const lower = msg.toLowerCase();
  const actions = [];

  const phoneMatch = msg.match(/(?:\+?62|0)[\s\-]?8[\d\s\-]{7,13}/g);
  const extractPhone = () => {
    if (!phoneMatch) return null;
    return phoneMatch[0].replace(/[\s\-\+]/g, "").replace(/^0/, "62");
  };

  // === GROUP MANAGEMENT (INDONESIA & ARAB) ===
  if (/\b(add|tambah|invite|masuk(?:kan|in)|أضف|اضافة|دعوة)\b.*\b(nomor|number|member|orang|رقم|عضو)\b/i.test(lower)) {
    const phone = extractPhone();
    if (phone) actions.push({ type: "ADD", params: { target: phone } });
  }
  if (/\b(kick|keluarkan|tendang|usir|remove|طرد|اطرد|أخرج)\b/i.test(lower) && !actions.some((a) => a.type === "KICK")) {
    actions.push({ type: "KICK", params: {} });
  }
  if (/\b(promote|jadikan?\s*admin|naikkan?|رقي|ترقية|اجعل)\b.*\b(admin|مشرف|ادمن)\b/i.test(lower) && !actions.some((a) => a.type === "PROMOTE")) {
    actions.push({ type: "PROMOTE", params: {} });
  }
  if (/\b(demote|turunkan?|copot\s*admin|انزل|نزل|تخفيض)\b.*\b(admin|مشرف|ادمن)\b/i.test(lower) && !actions.some((a) => a.type === "DEMOTE")) {
    actions.push({ type: "DEMOTE", params: {} });
  }
  if (/\b(leave|keluar|pergi|اخرج|غادر)\b.*\b(grup|group|مجموعة|قروب)\b/i.test(lower)) {
    actions.push({ type: "LEAVE", params: {} });
  }
  if (/\b(buka|open|افتح|فتح)\b.*\b(grup|group|مجموعة|قروب)\b/i.test(lower)) {
    actions.push({ type: "OPEN", params: {} });
  }
  if (/\b(tutup|close|kunci|lock|اغلق|أغلق|اقفل|سكر)\b.*\b(grup|group|مجموعة|قروب)\b/i.test(lower)) {
    actions.push({ type: "CLOSE", params: {} });
  }
  if (/\b(tag\s*all|tag\s*semua|mention\s*all|mention\s*semua|منشن\s*الكل|منشن\s*للجميع)\b/i.test(lower)) {
    actions.push({ type: "TAGALL", params: {} });
  }
  if (/\b(hidetag|hide\s*tag|announce|pengumuman|umumkan|منشن مخفي|إعلان|اعلان)\b/i.test(lower)) {
    const htMsg = msg.replace(/.*?(hidetag|hide\s*tag|announce|pengumuman|umumkan|منشن مخفي|إعلان|اعلان)\s*/i, "").trim();
    actions.push({ type: "HIDETAG", params: { message: htMsg || msg } });
  }
  if (/\b(ganti|ubah|rename|set|غير|غيير|عدل)\b.*\b(nama|name|اسم)\b.*\b(grup|group|مجموعة|قروب)\b/i.test(lower)) {
    const nameMatch = msg.match(/(?:jadi|ke|menjadi|إلى|:)\s*(.+)/i);
    if (nameMatch) actions.push({ type: "SETNAME", params: { name: nameMatch[1].trim() } });
  }
  if (/\b(ganti|ubah|set|غير|غيير|عدل)\b.*\b(desk|desc|deskripsi|وصف)\b/i.test(lower)) {
    const descMatch = msg.match(/(?:jadi|ke|menjadi|إلى|:)\s*(.+)/i);
    if (descMatch) actions.push({ type: "SETDESC", params: { desc: descMatch[1].trim() } });
  }
  if (/\b(hapus|delete|remove|احذف|امسح)\b.*\b(pesan|chat|message|رسالة)\b/i.test(lower)) {
    actions.push({ type: "DELETE", params: {} });
  }
  if (/\b(warn|warning|peringatan|peringati|حذر|تحذير|انذار)\b/i.test(lower)) {
    actions.push({ type: "WARN", params: {} });
  }
  if (/\b(sticker|stiker|jadikan?\s*sticker|jadiin\s*sticker|ملصق|استكر|حول)\b/i.test(lower)) {
    actions.push({ type: "STICKER", params: {} });
  }
  if (/\b(antilink|مانع الروابط|منع الروابط)\b.*\b(on|aktif|nyala|شغل|فعل|تفعيل)\b/i.test(lower)) {
    actions.push({ type: "ANTILINK", params: { mode: "on" } });
  } else if (/\b(antilink|مانع الروابط|منع الروابط)\b.*\b(off|mati|nonaktif|أوقف|ايقاف|تعطيل)\b/i.test(lower)) {
    actions.push({ type: "ANTILINK", params: { mode: "off" } });
  }

  // === PINTEREST SEARCH (INDONESIA & ARAB) ===
  if (/\b(cari(?:kan|in)?|kirim(?:kan|in)?|kasih|tolong|ابحث|بحث|هات|جيب|اعرض)\b.*\b(gambar|foto|image|pic|picture|صور|صورة)\b/i.test(lower) ||
      /\b(gambar|foto|صور|صورة)\b.*\b(tentang|dari|soal|عن|حول)\b/i.test(lower)) {
    const queryMatch =
      msg.match(/(?:gambar|foto|image|pic|picture|صور|صورة)\s+(?:tentang\s+|dari\s+|soal\s+|yang\s+|عن\s+|حول\s+)?(.+)/i) ||
      msg.match(/(?:cari(?:kan|in)?|kirim(?:kan|in)?|ابحث|بحث|هات|جيب)\s+(?:gambar|foto|صور|صورة)\s+(.+)/i);
    if (queryMatch) {
      const query = queryMatch[1].replace(/\b(dong|ya|yuk|pls|please|nih|ضروري|بسرعة)\b/gi, "").trim();
      if (query) actions.push({ type: "PINS", params: { query } });
    }
  }

  // === POLL (INDONESIA & ARAB) ===
  if (/\b(poll|voting|pilih|suara|jajak|pendapat|استطلاع|تصويت)\b/i.test(lower)) {
    const qm = msg.match(/(?:poll|voting|pilih|استطلاع|تصويت)\s+(.+)/i);
    if (qm) {
      const parts = qm[1].split(/\s*(?:\?|opsi|pilihan|خيارات)\s*/i);
      actions.push({ type: "POLL", params: { question: parts[0]?.trim() || "Vote!", options: (parts[1] || "Yes,No").replace(/\s+/g, "").trim() } });
    }
  }

  // === PAYMENT (INDONESIA & ARAB) ===
  if (/\b(bayar|payment|tagih|invoice|transfer|دفع|تسديد)\b/i.test(lower)) {
    const amt = msg.match(/\b(\d+)\s*(?:rb|ribu|k|K)?\b/);
    let amount = "10000";
    if (amt) {
      amount = amt[1];
      if (/\b(rb|ribu|k|K)\b/i.test(msg)) amount = String(parseInt(amount) * 1000);
    }
    const note = msg.replace(/\b(bayar|payment|tagih|invoice|transfer|دفع|تسديد)\b/gi, "").replace(/\d+/g, "").replace(/\b(rb|ribu|k|K)\b/gi, "").trim();
    actions.push({ type: "PAYMENT", params: { amount, note: note || "Pembayaran" } });
  }

  // === PRODUCT (INDONESIA & ARAB) ===
  if (/\b(produk|product|jual|barang|katalog|منتج|سلعة)\b/i.test(lower)) {
    const titleMatch = msg.match(/(?:produk|product|barang|منتج|سلعة)\s+(.+)/i);
    const priceMatch = msg.match(/\b(\d+)\s*(?:rb|ribu|k|K)?\b/);
    let price = "10000";
    if (priceMatch) {
      price = priceMatch[1];
      if (/\b(rb|ribu|k|K)\b/i.test(msg)) price = String(parseInt(price) * 1000);
    }
    actions.push({ type: "PRODUCT", params: { title: titleMatch?.[1]?.trim() || "Produk", price, desc: msg } });
  }

  // === EVENT (INDONESIA & ARAB) ===
  if (/\b(event|acara|meetup|kumpul|rapat|حدث|موعد)\b/i.test(lower)) {
    const nameMatch = msg.match(/(?:event|acara|meetup|حدث|موعد)\s+(.+)/i);
    actions.push({ type: "EVENT", params: { name: nameMatch?.[1]?.trim() || "Event", desc: msg, location: "" } });
  }

  // === ALBUM (INDONESIA & ARAB) ===
  if (/\b(album|galeri|koleksi|ألبوم)\s*(gambar|foto|صور|صورة)?\b/i.test(lower)) {
    const qm = msg.match(/(?:album|galeri|ألبوم)\s*(?:gambar|foto|صور)?\s+(.+)/i);
    actions.push({ type: "ALBUM", params: { query: qm?.[1]?.trim() || "nature" } });
  }

  // === REMINDER (العربية · English · Español · والكلمات الإندونيسية القديمة) ===
  // حدود كلمات يونيكود: \b في JavaScript لا يعمل مع الحروف العربية
  const REMIND_WORD = /(?<![\p{L}\p{N}_])(ingatkan|remind|reminder|pengingat|alarm|recordatorio|recuerdame|recuérdame|تذكير|ذكرني|منبه)(?![\p{L}\p{N}_])/giu;
  const REMIND_TIME = /(?<![\p{L}\p{N}_])(?:(?:in|en|dalam|بعد|داخل)\s*)?(\d+)\s*(detik|menit|jam|seconds?|secs?|minutes?|mins?|hours?|segundos?|minutos?|horas?|ثانية|ثواني|دقيقة|دقائق|ساعة|ساعات)(?![\p{L}\p{N}_])/iu;
  if (new RegExp(REMIND_WORD.source, "iu").test(lower)) {
    const tm = msg.match(REMIND_TIME);
    let seconds = 60;
    if (tm) {
      const unit = tm[2].toLowerCase();
      seconds = parseInt(tm[1]) * (/^(jam|hours?|horas?|ساعة|ساعات)$/.test(unit) ? 3600 : /^(menit|minutes?|mins?|minutos?|دقيقة|دقائق)$/.test(unit) ? 60 : 1);
    }
    const reminderMsg = msg.replace(new RegExp(REMIND_TIME.source, "giu"), "").replace(REMIND_WORD, "").replace(/\s{2,}/g, " ").trim();
    actions.push({ type: "REMINDER", params: { time: String(seconds), message: reminderMsg || "تذكير!" } });
  }

  // === REACT (INDONESIA & ARAB) ===
  if (/\b(reaksi|react|تفاعل|emoji)\s+([\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/u.test(lower)) {
    const em = msg.match(/([\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/u);
    if (em) actions.push({ type: "REACT", params: { emoji: em[1] } });
  }

  // === CONTACT ===
  if (/\b(kontak|contact|vcard|simpan\s*nomor|جهة اتصال)\b/i.test(lower)) {
    const nameMatch = msg.match(/(?:nama\s+)?(\w+)/i);
    const numMatch = msg.match(/(\d{10,15})/);
    if (numMatch) actions.push({ type: "CONTACT", params: { name: nameMatch?.[1] || "Contact", number: numMatch[1] } });
  }

  // === LOCATION ===
  if (/\b(lokasi|location|maps|peta|موقع|خرائط)\b/i.test(lower)) {
    actions.push({ type: "LOCATION", params: { lat: "-6.2", lon: "106.8", name: "Jakarta" } });
  }

  // === BUTTONS ===
  if (/\b(tombol|button|menu|pilihan|أزرار)\b/i.test(lower)) {
    const titleMatch = msg.match(/(?:tombol|button|أزرار)\s+(.+)/i);
    actions.push({ type: "BUTTONS", params: { title: titleMatch?.[1] || "Menu", text: msg, buttons: "Option1|id1,Option2|id2" } });
  }

  // === INVITE ===
  if (/\b(invite|undang|link\s*grup|دعوة|رابط)\b.*\b(grup|group|مجموعة|قروب)\b/i.test(lower)) {
    actions.push({ type: "INVITE" });
  }

  // === EPHEMERAL ===
  if (/\b(hilang|ephemeral|disappearing|مؤقت|اختفاء)\b.*?(\d+)\s*(detik|menit|jam|hari|ثانية|دقيقة|ساعة|يوم)\b/i.test(lower)) {
    const tm = msg.match(/(\d+)\s*(detik|menit|jam|hari|ثانية|دقيقة|ساعة|يوم)/i);
    let seconds = 86400;
    if (tm) {
      seconds = parseInt(tm[1]) * (tm[2] === "hari" || tm[2] === "يوم" ? 86400 : tm[2] === "jam" || tm[2] === "ساعة" ? 3600 : tm[2] === "menit" || tm[2] === "دقيقة" ? 60 : 1);
    }
    actions.push({ type: "EPHEMERAL", params: { time: String(seconds) } });
  }

  // === MUTE/UNMUTE ===
  if (/\b(mute|kmt|bisu|diam|كتم|اسكت)\b.*\b(grup|group|مجموعة|قروب)\b/i.test(lower)) actions.push({ type: "MUTE" });
  if (/\b(unmute|buka\s*suara|suarakan|فك الكتم|تكلم)\b.*\b(grup|group|مجموعة|قروب)\b/i.test(lower)) actions.push({ type: "UNMUTE" });

  // === BLOCK/UNBLOCK ===
  if (/\b(block|blokir|banned|حظر)\b/i.test(lower)) {
    const numMatch = msg.match(/(\d{10,15})/);
    if (numMatch) actions.push({ type: "BLOCK", params: { target: numMatch[1] } });
  }
  if (/\b(unblock|buka\s*blokir|فك الحظر)\b/i.test(lower)) {
    const numMatch = msg.match(/(\d{10,15})/);
    if (numMatch) actions.push({ type: "UNBLOCK", params: { target: numMatch[1] } });
  }

  return actions;
}

function mergeActions(aiActions, intentActions) {
  const merged = [...aiActions];
  const existingTypes = new Set(aiActions.map((a) => a.type));
  for (const action of intentActions) {
    if (!existingTypes.has(action.type)) {
      merged.push(action);
    }
  }
  return merged;
}

// ========== إجراءات تمر عبر البلوقن الحقيقي (§13) ==========
// أي إجراء يغيّر حالة المجموعة أو يمس عضواً لا يُنفَّذ هنا مباشرة:
// يُحوَّل إلى الأمر الحقيقي المقابل ويدخل مسار البوت الطبيعي بكل صلاحياته
// (Admin · BotAdmin · Owner · Cooldown · Energy · Registration).
const PLUGIN_ACTIONS = {
  KICK: { command: "kick", target: true },
  PROMOTE: { command: "promote", target: true },
  DEMOTE: { command: "demote", target: true },
  WARN: { command: "warn", target: true },
  BLOCK: { command: "block", target: true },
  UNBLOCK: { command: "unblock", target: true },
  ADD: { command: "add", number: true },
  OPEN: { command: "شات", args: () => "فتح" },
  CLOSE: { command: "شات", args: () => "قفل" },
  TAGALL: { command: "منشن", args: () => "الكل" },
  HIDETAG: { command: "ht", args: (params) => params.message || "" },
  SETNAME: { command: "setnamegc", args: (params) => params.name || "" },
  SETDESC: { command: "تغيير_الوصف", args: (params) => params.desc || "" },
  DELETE: { command: "delete" },
  ANTILINK: { command: "antilinkgc", args: (params) => (String(params.mode || "").toLowerCase() === "off" ? "إيقاف" : "تشغيل") },
  INVITE: { command: "linkgc" },
  MUTE: { command: "mute" },
  UNMUTE: { command: "unmute" },
  LEAVE: { command: "leave" },
};

/** لغة رسائل الإجراءات: لغة رسالة المستخدم نفسها */
function actionLanguage(m) {
  let stored = "ar";
  try { stored = getUserLanguage(getDatabase()?.getUser?.(m.sender)); } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:785",stage: "getUserLanguage"}); }
  return detectReplyLanguage(m?.body || "", stored);
}

/**
 * إجراءات الإدارة تُنفَّذ بالبلوقن الحقيقي عبر المسار الطبيعي (§13):
 * صلاحيات المشرف/البوت/المالك والتبريد والطاقة كما هي، والنتيجة
 * الحقيقية تُحفظ في الذاكرة المركزية (يتولاها dispatchCommand).
 */
async function dispatchPluginAction(action, m, sock) {
  const spec = PLUGIN_ACTIONS[action.type];
  const params = action.params || {};
  const lang = actionLanguage(m);
  const botNum = sock.user?.id?.split(":")[0];
  let target = "";
  if (spec.target || spec.number) {
    const mentioned = (m.mentionedJid || []).find((j) => !String(j).includes(botNum));
    const quoted = m.quoted?.sender && !m.quoted?.key?.fromMe ? m.quoted.sender : "";
    const raw = mentioned || params.target || params.number || quoted || "";
    target = String(raw).split("@")[0].replace(/[^0-9]/g, "");
    if (!target) return [{ ok: false, msg: t(lang, "autoai.targetRequired") }];
  }
  const args = [target && spec.target ? `@${target}` : target, spec.args ? spec.args(params) : ""].filter(Boolean).join(" ");
  const result = await dispatchCommand(m, sock, {
    command: spec.command,
    args,
    mentions: target && spec.target ? [`${target}@s.whatsapp.net`] : [],
  });
  // الحجب يرد عليه المسار الطبيعي نفسه (رسالة الصلاحية)، فلا نكرّره
  const alreadyExplained = !result.ok && result.replies?.length;
  return [{
    ok: result.ok || Boolean(alreadyExplained),
    msg: result.ok ? t(lang, "autoai.dispatched", { command: result.text }) : t(lang, "autoai.blocked", { command: `${spec.command}` }),
  }];
}

/** استخراج روابط صور Pinterest من نتيجة البحث */
function pinterestImages(data, limit) {
  const items = data?.result?.result?.result?.slice(0, limit) || [];
  return items
    .map((item) => item.image_url || item.images?.orig?.url || item.images?.["736x"]?.url)
    .filter(Boolean)
    .map((url) => ({ image: { url } }));
}

// ========== EXECUTE ACTION ==========
// إجراءات الإدارة ← البلوقن الحقيقي. الباقي إجراءات عرض (رسائل غنية) لا تمس صلاحيات أحد.
async function executeAction(action, m, sock) {
  if (PLUGIN_ACTIONS[action?.type]) return dispatchPluginAction(action, m, sock);
  const lang = actionLanguage(m);
  const params = action.params || {};
  const results = [];

  switch (action.type) {
    case "PINS":
    case "ALBUM": {
      const query = params.query;
      if (!query) return [{ ok: false, msg: t(lang, "autoai.queryMissing") }];
      try {
        const images = pinterestImages(await pinterest(query), action.type === "ALBUM" ? 10 : 5);
        if (!images.length) return [{ ok: false, msg: t(lang, "autoai.notFound", { query }) }];
        await sock.sendMessage(m.chat, { albumMessage: images }, { quoted: m });
        results.push({ ok: true, msg: t(lang, "autoai.sent") });
      } catch (e) {
        console.error("[AutoAI Action]", action.type, e?.message);
        results.push({ ok: false, msg: t(lang, "autoai.actionFailed", { action: action.type, error: userError(e, lang) }) });
      }
      break;
    }
    case "STICKER": {
      let stickerBuffer = null;
      if (m.isImage && m.download) stickerBuffer = await m.download();
      else if (m.quoted?.isImage && m.quoted?.download) stickerBuffer = await m.quoted.download();
      if (!stickerBuffer) return [{ ok: false, msg: t(lang, "autoai.stickerNeedImage") }];
      await sock.sendMessage(m.chat, { sticker: stickerBuffer, packname: config.bot?.name || "Bot Terboo", author: "Terboo AI" }, { quoted: m });
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    case "POLL": {
      const question = params.question || "?";
      const options = String(params.options || "").split(",").map((o) => o.trim()).filter(Boolean);
      if (options.length < 2) return [{ ok: false, msg: t(lang, "autoai.pollMin") }];
      await sock.sendMessage(m.chat, { poll: { name: question, values: options, selectableCount: 1 } }, { quoted: m });
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    case "PAYMENT": {
      const amount = parseInt(params.amount || "0", 10);
      if (!Number.isFinite(amount) || amount <= 0) return [{ ok: false, msg: t(lang, "autoai.queryMissing") }];
      await sock.sendMessage(m.chat, {
        requestPaymentMessage: {
          amount,
          currencyCode: config.payment?.currency || "EGP",
          noteMessage: { extendedTextMessage: { text: params.note || "" } },
          from: sock.user?.id || "0@s.whatsapp.net",
        },
      }, { quoted: m });
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    case "PRODUCT": {
      const price = parseInt(params.price || "0", 10);
      const imageUrl = params.imageurl || "";
      await sock.sendMessage(m.chat, {
        productMessage: {
          product: {
            productImage: imageUrl ? { url: imageUrl } : undefined,
            productId: `prod_${Date.now()}`,
            title: params.title || config.bot?.name || "Bot Terboo",
            description: params.desc || "",
            currencyCode: config.payment?.currency || "EGP",
            priceAmount1000: (Number.isFinite(price) ? price : 0) * 1000,
            retailerId: config.bot?.name || "terboo-shop",
            url: imageUrl || "",
            productImageCount: imageUrl ? 1 : 0,
          },
          businessOwnerJid: sock.user?.id || "0@s.whatsapp.net",
        },
      }, { quoted: m });
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    case "EVENT": {
      const startTime = Date.now() + 3600000;
      await sock.sendMessage(m.chat, {
        eventMessage: {
          event: {
            name: params.name || "Event",
            description: params.desc || "",
            startTime,
            endTime: startTime + 7200000,
            location: params.location ? { name: params.location } : undefined,
          },
        },
      }, { quoted: m });
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    case "REMINDER": {
      const seconds = parseInt(params.time || "60", 10);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) return [{ ok: false, msg: t(lang, "autoai.reminderMax") }];
      const message = params.message || "⏰";
      setTimeout(async () => {
        try {
          await sock.sendMessage(m.chat, {
            text: `⏰ *${t(lang, "autoai.reminderTitle")}*\n\n${message}\n\n> ${t(lang, "autoai.reminderFrom")}: @${m.sender.split("@")[0]}`,
            mentions: [m.sender],
          }, { quoted: m });
        } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:933",stage: "sock.sendMessage"}); }
      }, seconds * 1000);
      results.push({ ok: true, msg: t(lang, "autoai.reminderSet", { seconds }) });
      break;
    }
    case "REACT": {
      await sock.sendMessage(m.chat, { react: { key: m.quoted?.key || m.key, text: params.emoji || "👍" } });
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    case "CONTACT": {
      const name = params.name || "Contact";
      const number = String(params.number || params.target || "").replace(/[^0-9]/g, "");
      if (!number) return [{ ok: false, msg: t(lang, "autoai.targetRequired") }];
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL:+${number}\nEND:VCARD`;
      await sock.sendMessage(m.chat, { contacts: { displayName: name, contacts: [{ vcard }] } }, { quoted: m });
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    case "LOCATION": {
      const lat = parseFloat(params.lat);
      const lon = parseFloat(params.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [{ ok: false, msg: t(lang, "autoai.queryMissing") }];
      await sock.sendMessage(m.chat, { location: { degreesLatitude: lat, degreesLongitude: lon, name: params.name || "" } }, { quoted: m });
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    case "BUTTONS": {
      const btns = String(params.buttons || "").split(",").map((b) => b.trim()).filter(Boolean).map((b) => {
        const [display, id] = b.split("|");
        return { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: display?.trim() || "•", id: id?.trim() || display?.trim() || "opt" }) };
      });
      if (!btns.length) return [{ ok: false, msg: t(lang, "autoai.noCards") }];
      await sock.sendMessage(m.chat, {
        interactiveMessage: {
          title: params.title || config.bot?.name || "Bot Terboo",
          body: { text: params.text || "" },
          footer: { text: config.bot?.name || "Bot Terboo" },
          buttons: btns,
        },
      }, { quoted: m });
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    case "CAROUSEL": {
      const cards = String(params.cards || "").split(",").map((c) => {
        const [title, desc, url] = c.trim().split("|");
        return { title: title?.trim(), description: desc?.trim(), imageUrl: url?.trim() };
      }).filter((c) => c.title && c.imageUrl);
      if (!cards.length) return [{ ok: false, msg: t(lang, "autoai.noCards") }];
      const images = cards.map((c) => ({ image: { url: c.imageUrl }, caption: `*${c.title}*\n${c.description || ""}` }));
      await sock.sendMessage(m.chat, { albumMessage: images }, { quoted: m });
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    case "EPHEMERAL": {
      if (!m.isGroup) return [{ ok: false, msg: t(lang, "autoai.groupOnly") }];
      if (!m.isAdmin && !m.isOwner) return [{ ok: false, msg: t(lang, "autoai.notAdmin") }];
      if (m.isBotAdmin === false) return [{ ok: false, msg: t(lang, "autoai.notBotAdmin") }];
      const time = parseInt(params.time || "86400", 10);
      await sock.groupToggleEphemeral(m.chat, time);
      results.push({ ok: true, msg: t(lang, "autoai.ephemeral", { seconds: time }) });
      break;
    }
    case "LEARNSTATS": {
      if (!m.isOwner) return [{ ok: false, msg: t(lang, "autoai.ownerOnly") }];
      const health = getAutoAIHealth();
      const report = health.length
        ? health.map((entry) => `${entry.type === "error" ? "❌" : "✅"} ${entry.operation}: ${entry.count}`).join("\n")
        : t(lang, "autoai.statsEmpty");
      await m.reply(`🧠 *${t(lang, "autoai.statsTitle")}*\n\n${report}`);
      results.push({ ok: true, msg: t(lang, "autoai.sent") });
      break;
    }
    default:
      break;
  }

  return results;
}

// ========== HANDLE AUTO AI ==========
async function handleAutoAI(m, sock, dependencies = {}) {
  let handled = false;
  try {
    handled = await handleAutoAIStages(m, sock, dependencies);
    return handled;
  } finally {
    // القياس يُفتح فقط حين يشتغل الذكاء فعلاً على الرسالة (§51)
    const trace = traceOf(m);
    if (trace) {
      trace.mark("response");
      trace.step("response", handled ? "answered" : "skipped");
      trace.end(handled ? "answered" : "skipped");
    }
  }
}

async function handleAutoAIStages(m, sock, dependencies = {}) {
  if (!m?.chat) return false;
  const groupReplyDecision = m.isGroup ? shouldReplyAsBot(m, sock) : { allowed: true, reason: "" };

  const db = dependencies.db || getDatabase();
  // تحكّم المالك في كلام الذكاء: رسالة التحكّم تمر للنواة (تنفّذها وترد مرة واحدة)، والصمت/التجاهل يمنع الرد هنا
  if (m.isGroup && (talkBlock(m, db) || parseTalkControl(m.body))) return false;
  const chatProvider = dependencies.geminiChat || geminiChat;
  const naturalRequestHandler = dependencies.naturalRequestHandler || handleNaturalAIRequest;
  const codeReviewHandler = dependencies.codeReviewHandler || handleCodeReviewFlow;
  const rememberMessageHandler = dependencies.rememberGroupMessage || rememberGroupMessage;
  const saveLongTermMemoryHandler = dependencies.saveLongTermMemory || saveLongTermMemoryIfEnabled;
  const hasInjectedChatProvider = Boolean(dependencies.geminiChat);
  const routedProviders = {
    GeminiAPI: dependencies.aiProviders?.GeminiAPI || chatProvider,
    DeepSeek: dependencies.aiProviders?.DeepSeek || (hasInjectedChatProvider ? undefined : async ({ message, instruction }) => {
      // كائن {success, answer} لا نص — كان يصل للمستخدم «[object Object]»
      const result = await withProviderTimeout(() => DeepSeekThinking(`${instruction}\n\n${message}`), "DeepSeek");
      if (!result?.success || !String(result.answer || "").trim()) throw new Error(`deepseek_failed:${String(result?.error || result?.raw || result?.status || "").slice(0, 80)}`);
      return { text: String(result.answer).trim() };
    }),
    GPT: dependencies.aiProviders?.GPT || (hasInjectedChatProvider ? undefined : async ({ message, instruction, history }) => {
      const result = await withProviderTimeout(() => GPT5(`${instruction}\n\n${message}`, { history }), "GPT");
      if (!result?.status) throw new Error(result?.error || "تعذر رد مزود GPT");
      return { text: result.answer || "" };
    }),
    Claude: dependencies.aiProviders?.Claude || (hasInjectedChatProvider ? undefined : async (payload) => claudeChat(payload)),
  };
  if (!db?.db?.data) return false;
  if (!db.db.data.autoai) db.db.data.autoai = {};
  if (!db.db.data.autoai_global) db.db.data.autoai_global = { enabled: false };

  let autoai = db.db.data.autoai[m.chat];
  let isGlobalMode = false;
  if (autoai && autoai.enabled) {
    // per-group config is active, use it
  } else if (autoai && autoai.enabled === false) {
    // explicit opt-out from global
    return false;
  } else {
    // no per-group config, check global
    const globalCfg = db.db.data.autoai_global;
    if (!globalCfg.enabled) return false;
    isGlobalMode = true;
    if (!globalCfg.sessions) globalCfg.sessions = {};
    autoai = {
      enabled: true,
      alwaysReply: globalCfg.alwaysReply !== false,
      character: globalCfg.character || "global",
      characterName: globalCfg.characterName || "Global",
      instruction: globalCfg.instruction,
      responseType: globalCfg.responseType || "text",
      replyMode: globalCfg.replyMode,
      replyScope: globalCfg.replyScope,
      sessions: globalCfg.sessions,
    };
  }

  const botJid = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
  const botLid = sock.user?.lid || null;
  const botNumber = sock.user?.id?.split(":")[0] || "";
  const botFullId = sock.user?.id || "";

  if (m.isCommand && m.command === "autoai") return false;

  if (m.isCommand && !m.isOwner) {
    if (autoai.enableCommands) return false;
    return true;
  }
  if (!groupReplyDecision.allowed) {
    autoai.lastSkipReason = describeAutoAISkip(groupReplyDecision.reason);
    if (isGlobalMode) db.db.data.autoai_global.lastSkipReason = autoai.lastSkipReason;
    try { db.save(); } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:1096",stage: "db.save"}); }
    if (groupReplyDecision.reason === "rate-limit") await m.react("🤖").catch((error) => { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:1097",stage: "m.react"}); });
    return false;
  }

  const isBotJid = (jid) => {
    const candidate = String(jid || "");
    if (!candidate) return false;
    if (candidate === botJid || candidate === botLid || candidate === botFullId) return true;
    const jidUser = candidate.split("@")[0]?.split(":")[0];
    return Boolean(botNumber && (jidUser === botNumber || candidate.includes(botNumber)));
  };
  const rawContexts = [
    m.message?.extendedTextMessage?.contextInfo,
    m.message?.imageMessage?.contextInfo,
    m.message?.videoMessage?.contextInfo,
    m.message?.documentMessage?.contextInfo,
    m.message?.conversation?.contextInfo,
  ].filter(Boolean);
  const mentionedJids = [
    ...(Array.isArray(m.mentionedJid) ? m.mentionedJid : []),
    ...rawContexts.flatMap((context) => Array.isArray(context?.mentionedJid) ? context.mentionedJid : []),
  ];
  const bodyMention = Boolean(botNumber && String(m.body || "").includes(`@${botNumber}`));
  const isMentioned = mentionedJids.some(isBotJid) || bodyMention;

  let isBotQuoted = false;
  const quotedContext = rawContexts.find((context) => context?.quotedMessage || context?.participant);
  if (m.quoted || quotedContext) {
    const quotedSender = m.quoted?.sender || m.quoted?.key?.participant || quotedContext?.participant || "";
    const quotedFromMe = m.quoted?.fromMe || m.quoted?.key?.fromMe || quotedContext?.fromMe;
    isBotQuoted = Boolean(quotedFromMe || isBotJid(quotedSender));
  }

  // المناداة بالاسم في أول الرسالة («تيربو …») تعادل المنشن (v4 §23)
  const isNamed = nameTrigger(m.body);
  const replyPolicy = shouldAutoAIReply({ autoai, isGroup: Boolean(m.isGroup), isMentioned: isMentioned || isNamed, isBotQuoted });
  if (!replyPolicy.allowed) return false;

  const userMessage = m.body || "";
  const hasImage =
    m.isImage ||
    (m.quoted && (m.quoted.isImage || m.quoted.type === "imageMessage"));
  if (!userMessage && !hasImage) return false;

  const senderNumber = m.sender.split("@")[0];
  if (isOnCooldown(senderNumber)) return false;

  // ── النواة الواحدة (§5): لغة هذه الرسالة، حزمة السياق قبل تسجيلها، ثم تسجيلها مرة واحدة ──
  // إعادة تسليم متأخرة لنفس الرسالة: لا رد ثانٍ ولا نداء مزوّد (§52)
  if (!claimAiMessage(m, "autoai")) return true;
  // قرار أساسي واحد لكل رسالة عبر كل المسارات: إن ملكتها النواة فلا رد ثانٍ (§83)
  if (!claimPrimary(m, "autoai")) return true;
  const trace = attachTrace(m, startTrace("autoai"));
  const lang = actionLanguage(m);
  trace.mark("parse");
  trace.step("intent", hasImage ? "image-chat" : "chat");
  const contextPkg = buildContextPackage({ m, sock, db, text: userMessage, lang });
  trace.mark("context");
  trace.step("context", m.isGroup ? "group" : "private");
  try { recordTurn(m, "user", userMessage || "[image]"); } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:1154",stage: "recordTurn"}); }
  trace.mark("memory");
  trace.step("memory", `${contextPkg.memory?.turns?.length || 0}/${contextPkg.memory?.facts?.length || 0}`);

  // المراحل الحتمية للنواة: موافقة/إلغاء إجراء معلّق · الذاكرة · تحكّم المالك · المتابعات
  if (userMessage) {
    try {
      const routed = await preRoute({ m, sock, db, text: userMessage, lang, pkg: contextPkg, deps: dependencies.kernelDeps });
      if (routed) {
        setCooldown(senderNumber);
        return true;
      }
    } catch (routeError) {
      console.error("[AutoAI preRoute]", routeError.message);
    }
  }

  trace.mark("routing");
  trace.step("capability", ["agent", "natural", "providers"].join("+"));
  let precomputedAgentResult = null;
  try {
    precomputedAgentResult = await handleAgentRequest(m);
  } catch (agentError) {
    console.error("[AutoAI Agent]", agentError.message);
  }

  if (!precomputedAgentResult?.detected) {
    try {
      if (await naturalRequestHandler(m, sock, { db, healthEntries: dependencies.healthEntries || getAutoAIHealth() })) return true;
      if (await codeReviewHandler(m)) return true;
    } catch (reviewError) {
      console.error("[AutoAI Review]", reviewError?.message);
      await m.reply(`❌ ${t(lang, "autoai.reviewFailed", { error: userError(reviewError, lang) })}`);
      return true;
    }
  }

  trace.mark("intent");
  let agentContext = precomputedAgentResult?.context || "";
  const agentDetected = Boolean(precomputedAgentResult?.detected);
  if (precomputedAgentResult?.blocked) {
    agentContext += "\n\nDo not mention tools or results that are not available to this user, and keep the current persona style.";
  }

  try {
    await sock.sendPresenceUpdate("composing", m.chat);
    setCooldown(senderNumber);
    rememberMessageHandler(m);

    let imageBuffer = null;
    if (hasImage) {
      try {
        if (m.isImage && m.download) {
          imageBuffer = await m.download();
        } else if (m.quoted?.download) {
          imageBuffer = await m.quoted.download();
        }
      } catch (e) {
        console.log("[AutoAI] Image download failed:", e.message);
      }
    }

    // ── التعليمات: شخصية Auto AI + الإجراءات؛ السياق والذاكرة واللغة تبنيها النواة ──
    const aiMode = autoai.mode || "assistant";
    let fullInstruction = autoai.instruction || "";
    if (agentDetected) {
      fullInstruction += "\n\nYou are the persona interface on top of the unified project agent. When the user asks to search, analyse or check something, use the attached agent results. Do not say you lack file access when agent results are present, and never invent results. Keep the current persona style.";
    }
    fullInstruction += aiMode === "assistant"
      ? `\n\n${SYSTEM_PROMPT_ACTIONS}`
      : "\n\nOnly chat casually. Never output action tags. Address the user by name when it fits.";

    let aiResponse = "";
    trace.step("strategy", agentDetected ? "agent-chat" : "chat");
    trace.step("permission", precomputedAgentResult?.blocked ? "agent-blocked" : "chat");
    trace.step("tool", "provider");
    try {
      const composed = await composeReply({
        m,
        db,
        text: userMessage,
        lang,
        pkg: contextPkg,
        persona: fullInstruction,
        extraInstruction: agentContext ? `Project agent results:\n${agentContext}` : "",
        providers: routedProviders,
        imageBuffer,
        recordUser: false,
        recordAssistant: false,
        throwOnError: true,
      });
      trace.mark("provider").providerResult(composed);
      trace.step("verify", composed?.text ? `text:${composed.provider || "?"}` : "fallback");
      aiResponse = composed?.text || getFallbackResponse(lang);
      autoai.lastError = "";
      if (isGlobalMode) db.db.data.autoai_global.lastError = "";
      learnFromSuccess(composed?.provider || "AIRouter");
    } catch (apiError) {
      console.error("[AutoAI API Error]", apiError.message);
      learnFromError("AIRouter", apiError);
      autoai.lastError = String(apiError.message || apiError).slice(0, 180);
      if (isGlobalMode) db.db.data.autoai_global.lastError = autoai.lastError;
      aiResponse = getFallbackResponse(lang);
      trace.step("verify", "provider-error");
    }

    const normalizedAiResponse = normalizeStructuredResponse(aiResponse);
    let actions = [];
    let richMessages = [];
    let cleanResponse = normalizedAiResponse;

    if (aiMode === "assistant") {
      const aiActions = parseActions(normalizedAiResponse);
      const intentActions = detectIntentFromMessage(userMessage, m);
      actions = mergeActions(aiActions, intentActions);
      richMessages = parseRichMessage(normalizedAiResponse);
      cleanResponse = cleanRichTags(cleanActionTags(normalizedAiResponse));
    }

    // الرد المنظَّف (بلا وسوم إجراءات) يُحفظ في نطاق هذه المحادثة وحدها
    try { if (cleanResponse) recordTurn(m, "assistant", cleanResponse); } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:1274",stage: "recordTurn"}); }
    db.save();

    await sock.sendPresenceUpdate("paused", m.chat);
    // لا تأخير «كتابة» مصطنع بعد جاهزية الرد (§9): الرد يُرسل فوراً

    if (autoai.responseType === "voice") {
      try {
        await sock.sendPresenceUpdate("recording", m.chat);
        const tempDir = path.join(process.cwd(), "temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const voice = VOICES[lang] || VOICES.ar;
        const apiUrl = `https://firefly.maiku.my.id/api/crikk?apikey=${config.APIkey.firefly}&text=${encodeURIComponent(cleanResponse.substring(0, 500))}&voice=${voice}`;
        const response = await axios.get(apiUrl);
        
        if (!response.data?.status || !response.data?.data?.audio) {
          throw new Error(t(lang, "autoai.voiceFailed"));
        }
        
        const audioRes = await axios.get(response.data.data.audio, {
          responseType: "arraybuffer",
          timeout: 30000
        });

        const mp3Path = path.join(tempDir, `autoai_${Date.now()}.mp3`);
        fs.writeFileSync(mp3Path, Buffer.from(audioRes.data));

        const oggPath = mp3Path.replace(".mp3", ".ogg");
        try {
          // وسائط ثابتة بلا shell (§43): لا تمر أي قيمة عبر مفسّر أوامر
          await execFileAsync(
            "ffmpeg",
            ["-y", "-i", mp3Path, "-c:a", "libopus", "-b:a", "64k", "-ac", "1", "-ar", "48000", oggPath],
            { timeout: 30000, shell: false },
          );
        } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:1310",stage: "shell"}); }

        let audioBuffer;
        let mime = "audio/mpeg";
        if (fs.existsSync(oggPath)) {
          audioBuffer = fs.readFileSync(oggPath);
          mime = "audio/ogg; codecs=opus";
          try {
            fs.unlinkSync(oggPath);
          } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:1319",stage: "fs.unlinkSync"}); }
        } else {
          audioBuffer = fs.readFileSync(mp3Path);
        }
        try {
          fs.unlinkSync(mp3Path);
        } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:1325",stage: "fs.unlinkSync"}); }

        await sock.sendMessage(
          m.chat,
          {
            audio: audioBuffer,
            mimetype: mime,
            ptt: true,
          },
          { quoted: m },
        );

        await sock.sendPresenceUpdate("paused", m.chat);
      } catch {
        await m.reply(markRaw(cleanResponse));
      }
    } else {
      let richSent = false;
      let stickerSent = false;
      if (richMessages.length > 0) {
        for (const rich of richMessages) {
          const sent = await sendRichMessage(rich, sock, m.chat, m);
          if (sent) {
            if (rich.type === "STICKER") {
              stickerSent = true;
            } else {
              richSent = true;
            }
          }
        }
      }
      if ((!richSent || stickerSent) && cleanResponse) {
        await m.reply(markRaw(cleanResponse));
      }
    }
    markFirstResponse(m);

    // صيانة الذاكرة بعد وصول الرد، لا قبله (§13)
    setImmediate(() => {
      try { saveLongTermMemoryHandler(m, userMessage); } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:1364",stage: "saveLongTermMemoryHandler"}); }
    });

    for (const action of actions) {
      try {
        const results = await executeAction(action, m, sock);
        for (const r of results) {
          if (!r.ok) {
            await m.reply(`⚠️ ${r.msg}`);
          }
        }
      } catch (e) {
        console.error("[AutoAI Action Error]", action.type, e.message);
        console.error("[AutoAI Action]", action.type, e?.message);
        await m.reply(`❌ ${t(lang, "autoai.actionFailed", { action: action.type, error: userError(e, lang) })}`);
      }
    }

    return true;
  } catch (error) {
    console.error("[AutoAI Error]", error.message);
    learnFromError("AutoAI:Main", error);
    if (autoai) {
      autoai.lastError = String(error.message || error).slice(0, 180);
      if (isGlobalMode) db.db.data.autoai_global.lastError = autoai.lastError;
      try { db.save(); } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:1389",stage: "db.save"}); }
    }
    await sock.sendPresenceUpdate("paused", m.chat);
    try {
      await m.reply(getFallbackResponse(lang));
    } catch (error) { noteFailure("auto-ai", error, {where: "src/lib/terboo-auto-ai.js:1394",stage: "m.reply"}); }
    return true;
  }
}

function isAutoAIEnabled(chatId) {
  const db = getDatabase();
  if (!db?.db?.data?.autoai) return false;
  return db.db.data.autoai[chatId]?.enabled || false;
}

function getAutoAICharacter(chatId) {
  const db = getDatabase();
  if (!db?.db?.data?.autoai) return null;
  return db.db.data.autoai[chatId]?.characterName || null;
}

function clearUserSession(chatId, senderNumber) {
  const db = getDatabase();
  if (!db?.db?.data?.autoai?.[chatId]?.sessions?.[senderNumber]) return false;
  delete db.db.data.autoai[chatId].sessions[senderNumber];
  db.save();
  return true;
}

export { handleAutoAI, isAutoAIEnabled, getAutoAICharacter, clearUserSession, getReplyPolicy, shouldAutoAIReply, describeAutoAISkip };
