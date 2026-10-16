import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import fs from "fs";
import path from "path";
import { getDatabase } from "../../src/lib/terboo-database.js";
import { getAssetBuffer } from "../../src/lib/terboo-asset-manager.js";
import {
  getCachedJid,
  isLid,
  isLidConverted,
  lidToJid,
} from "../../src/lib/terboo-lid.js";
import {
  getUserLanguage,
  t,
  formatNumber,
  getGenderLabel,
} from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import * as brand from "../../src/lib/terboo-brand.js";
import { retireCard } from "../../src/lib/terboo-flow.js";
import { sendCard, sendPrompt, uiImage } from "../../src/lib/terboo-ui-kit.js";
import config from "../../config.js";

const pluginConfig = {
  name: "daftar",
  alias: ["register", "registro"],
  category: "user",
  description: "التسجيل كمستخدم للبوت عبر جلسة ردود تفاعلية",
  usage: ".daftar",
  example: ".daftar",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 0,
  isEnabled: true,
  skipRegistration: true,
};

if (!global.registrationSessions) global.registrationSessions = {};

const SESSION_TIMEOUT = 300000;
const TOTAL_STEPS = 4;
const DEFAULT_REWARDS = { koin: 30000, energi: 300, exp: 300000 };
const REGISTRATION_IMAGE_CANDIDATES = [
  "terboo-daftar",
  "terboo",
];

// ── الكلمات المقبولة (تُحفظ القيم الداخلية كما هي، وتُقبل ثلاث لغات) ──
const CANCEL_WORDS = [
  "batal", "cancel", "batalkan",
  "إلغاء", "الغاء", "إلغاء التسجيل",
  "cancelar",
];
const CONFIRM_WORDS = [
  "ya", "y", "iya", "yes", "lanjut", "confirm",
  "نعم", "تأكيد", "تاكيد", "موافق",
  "si", "sí", "confirmar",
];
const REVISE_NAME_WORDS = [
  "revisi nama", "ubah nama", "edit nama",
  "تعديل الاسم", "تغيير الاسم",
  "edit name", "change name",
  "cambiar nombre", "editar nombre",
];
const REVISE_AGE_WORDS = [
  "revisi umur", "ubah umur", "edit umur", "revisi usia",
  "تعديل العمر", "تغيير العمر",
  "edit age", "change age",
  "cambiar edad", "editar edad",
];
const REVISE_GENDER_WORDS = [
  "revisi gender", "ubah gender", "edit gender", "revisi jk",
  "تعديل الجنس", "تغيير الجنس",
  "change gender", "edit gender",
  "cambiar genero", "cambiar género", "editar genero", "editar género",
];
const REVISE_VAGUE_WORDS = [
  "revisi", "ulang", "reset", "ulangi", "edit", "ubah",
  "تعديل", "تغيير",
  "editar", "cambiar",
];

/** الكلمة التي تُعرض للمستخدم بلغته (كل الصيغ أعلاه مقبولة على أي حال) */
const SHOWN_WORDS = {
  ar: { confirm: "نعم", name: "تعديل الاسم", age: "تعديل العمر", gender: "تعديل الجنس", cancel: "إلغاء" },
  en: { confirm: "yes", name: "edit name", age: "edit age", gender: "edit gender", cancel: "cancel" },
  es: { confirm: "sí", name: "editar nombre", age: "editar edad", gender: "editar género", cancel: "cancelar" },
};
const shownWord = (lang, key) => (SHOWN_WORDS[lang] || SHOWN_WORDS.ar)[key];

// ── بطاقة التسجيل الواحدة: أزرار داخلية (terboo_reg_*) تُعالج داخل جلسة التسجيل نفسها ──
const CARD_FLOW = "registration";
const REG_IDS = {
  terboo_reg_name: "name",
  terboo_reg_age: "age",
  terboo_reg_gender: "gender",
  terboo_reg_g_m: "male",
  terboo_reg_g_f: "female",
  terboo_reg_save: "save",
  terboo_reg_cancel: "cancel",
};
const UNKNOWN_NAMES = new Set(["user", "unknown", "~ user", "~user"]);

const MALE_PATTERN =
  /^(laki[-\s]?laki|cowok?|cowo|l|male|man|pria|ذكر|رجل|ولد|masculino|hombre|varon|varón|m)$/i;
const FEMALE_PATTERN =
  /^(perempuan|cewek?|cewe|p|female|woman|wanita|أنثى|انثى|امرأة|بنت|femenino|mujer|f)$/i;

// القيم المخزّنة في قاعدة البيانات لا تتغير إطلاقاً (توافق كامل مع البيانات الحالية)
const GENDER_MALE = "ذكر";
const GENDER_FEMALE = "أنثى";

/** عرض الجنس المخزّن بلغة المستخدم دون تغيير القيمة المحفوظة */
function displayGender(storedGender, lang) {
  return getGenderLabel(storedGender, lang);
}

function getRegistrationContextInfo() {
  return brand.channelContext();
}

function getRegistrationRewards() {
  return config.registration?.rewards || DEFAULT_REWARDS;
}

/** لغة المستخدم الحالية (العربية افتراضياً) */
function getLang(db, jid) {
  try {
    return getUserLanguage(db.getUser(jid));
  } catch {
    return "ar";
  }
}

async function getRegistrationImage() {
  for (const key of REGISTRATION_IMAGE_CANDIDATES) {
    const buf = getAssetBuffer(key);
    if (buf) return buf;
  }

  return null;
}

function normalizeRegistrationName(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSessionText(input) {
  return String(input || "")
    .trim()
    .toLowerCase();
}

function shouldBypassRegistrationAnswer(m) {
  if (!m?.isCommand) return false;
  const command = String(m.command || "").toLowerCase();
  return ["daftar", "register", "reg", "bataldaftar"].includes(command);
}

function getRegistrationSessionKey(jid) {
  let normalized = String(jid || "").trim();
  if (!normalized) return "";
  if (isLid(normalized) || isLidConverted(normalized)) {
    normalized = getCachedJid(normalized) || lidToJid(normalized) || normalized;
  }
  const digits = normalized.replace(/[^0-9]/g, "");
  return digits || normalized.toLowerCase();
}

function getRegistrationSessionEntry(jid) {
  const sessionKey = getRegistrationSessionKey(jid);
  if (sessionKey && global.registrationSessions?.[sessionKey]) {
    return {
      key: sessionKey,
      session: global.registrationSessions[sessionKey],
    };
  }
  const legacyKey = String(jid || "").trim();
  if (legacyKey && global.registrationSessions?.[legacyKey]) {
    return { key: legacyKey, session: global.registrationSessions[legacyKey] };
  }
  return { key: sessionKey, session: null };
}

function clearRegistrationSession(jid) {
  const { key, session } = getRegistrationSessionEntry(jid);
  if (!session) return false;
  if (session.timeout) clearTimeout(session.timeout);
  delete global.registrationSessions[key];
  return true;
}

function createRegistrationSession(jid, chatJid, { mode = "steps", name = null } = {}) {
  const sessionKey = getRegistrationSessionKey(jid);
  clearRegistrationSession(sessionKey);

  const session = {
    mode,
    step: mode === "card" ? "card" : "name",
    name,
    age: null,
    gender: null,
    chatJid,
    promptId: null,
    startedAt: Date.now(),
    timeout: setTimeout(() => {
      if (global.registrationSessions[sessionKey]) {
        delete global.registrationSessions[sessionKey];
      }
    }, SESSION_TIMEOUT),
  };

  global.registrationSessions[sessionKey] = session;
  return session;
}

function getQuotedMessageId(m) {
  return m.quoted?.id || m.quoted?.stanzaId || m.quoted?.key?.id || null;
}

function isReplyToSessionPrompt(m, session) {
  const quotedId = getQuotedMessageId(m);
  if (!session || m.chat !== session.chatJid || !m.quoted) return false;
  if (quotedId && session.promptId && quotedId === session.promptId)
    return true;
  if (m.quoted?.key?.fromMe) return true;
  return false;
}

async function sendRegistrationPrompt(sock, m, text, options = {}) {
  const image = options.useImage ? await getRegistrationImage() : null;
  if (image) {
    return await sock.sendMessage(
      m.chat,
      {
        image,
        caption: text,
        contextInfo: getRegistrationContextInfo(),
      },
      { quoted: m },
    );
  } else {
    return await m.reply(text);
  }
}

// ═══════════════════════════════════════════════
// بناء نصوص الواجهة (نفس المنطق، تصميم وترجمة جديدان)
// ═══════════════════════════════════════════════

function buildRewardLines(user, lang) {
  const rewards = getRegistrationRewards();

  if (user?.hasClaimedRegisterReward) {
    return [
      UI.sectionHeader(`🎁 ${t(lang, "registration.rewardsClaimedTitle")}`, lang),
      UI.bullet(`${t(lang, "registration.rewardsClaimed")}`, lang),
    ].join("\n");
  }

  return [
    UI.sectionHeader(`🎁 ${t(lang, "registration.rewardsTitle")}`, lang),
    UI.bullet(`💰 ${t(lang, "registration.rewardCoins", { amount: formatNumber(rewards.koin, lang) })}`, lang),
    UI.bullet(`⚡ ${t(lang, "registration.rewardEnergy", { amount: formatNumber(rewards.energi, lang) })}`, lang),
    UI.bullet(`⭐ ${t(lang, "registration.rewardExp", { amount: formatNumber(rewards.exp, lang) })}`, lang),
  ].join("\n");
}

function buildUserDataBlock(name, age, gender, lang) {
  return [
    UI.sectionHeader(`📋 ${t(lang, "registration.profileTitle")}`, lang),
    UI.row(`📛 ${t(lang, "registration.fieldName")}`, name || "-", lang),
    UI.row(
      `🎂 ${t(lang, "registration.fieldAge")}`,
      age ? `${formatNumber(age, lang)} ${t(lang, "registration.ageUnit")}` : "-",
      lang,
    ),
    UI.row(`👤 ${t(lang, "registration.fieldGender")}`, displayGender(gender, lang) || "-", lang),
  ].join("\n");
}

function buildFooter(lang) {
  return UI.footer(brand.botName(), brand.developerName(), lang);
}

// V6: التسجيل اختياري — لا «فتح وصول» ضمن فوائده، فقط الملف الشخصي والمكافآت
function buildWelcomeMessage(user, prefix, lang) {
  const benefits = [UI.sectionHeader(`🌟 ${t(lang, "registration.benefitsTitle")}`, lang)];
  benefits.push(UI.bullet(`🗂️ ${t(lang, "registration.benefitProfile")}`, lang));
  benefits.push(UI.bullet(`🎁 ${t(lang, "registration.benefitRewards")}`, lang));

  return UI.registrationCard({
    title: t(lang, "registration.welcomeTitle"),
    step: 1,
    total: TOTAL_STEPS,
    stepLabel: t(lang, "registration.stepLabel", { current: 1, total: TOTAL_STEPS }),
    blocks: [
      t(lang, "registration.welcomeIntro"),
      benefits.join("\n"),
      buildRewardLines(user, lang),
      [
        UI.sectionHeader(`📝 ${t(lang, "registration.step1Title")}`, lang),
        t(lang, "registration.step1Question"),
        UI.bullet(`${t(lang, "registration.step1Hint")}`, lang),
      ].join("\n"),
      [
        t(lang, "registration.replyHint"),
        t(lang, "registration.cancelHint", {
          word: UI.isolate(shownWord(lang, "cancel")),
          command: UI.isolate(`${prefix}bataldaftar`),
        }),
      ].join("\n"),
    ],
    footer: buildFooter(lang),
    lang,
  });
}

function buildStepMessage({ lang, step, icon, titleKey, blocks }) {
  return UI.registrationCard({
    title: t(lang, titleKey),
    step,
    total: TOTAL_STEPS,
    stepLabel: t(lang, "registration.stepLabel", { current: step, total: TOTAL_STEPS }),
    blocks: [...blocks, t(lang, "registration.replyHint")],
    footer: buildFooter(lang),
    lang,
  });
}

function buildAgePrompt(name, lang) {
  return buildStepMessage({
    lang,
    step: 2,
    titleKey: "registration.step2Title",
    blocks: [
      t(lang, "registration.step2Greeting", { name }),
      [
        `🎂 ${t(lang, "registration.step2Question")}`,
        UI.bullet(`${t(lang, "registration.step2Hint")}`, lang),
      ].join("\n"),
    ],
  });
}

function buildGenderPrompt(lang) {
  return buildStepMessage({
    lang,
    step: 3,
    titleKey: "registration.step3Title",
    blocks: [
      [
        `👤 ${t(lang, "registration.step3Question")}`,
        UI.bullet(`👨 ${t(lang, "registration.step3OptionMale")}`, lang),
        UI.bullet(`👩 ${t(lang, "registration.step3OptionFemale")}`, lang),
      ].join("\n"),
    ],
  });
}

function buildConfirmationPrompt(session, user, lang) {
  return UI.registrationCard({
    title: t(lang, "registration.step4Title"),
    step: 4,
    total: TOTAL_STEPS,
    stepLabel: t(lang, "registration.stepLabel", { current: 4, total: TOTAL_STEPS }),
    blocks: [
      t(lang, "registration.step4Question"),
      buildUserDataBlock(session.name, session.age, session.gender, lang),
      buildRewardLines(user, lang),
      [
        UI.sectionHeader(`🛠️ ${t(lang, "registration.confirmActions")}`, lang),
        UI.bullet(`${t(lang, "registration.confirmSave", { word: UI.isolate(shownWord(lang, "confirm")) })}`, lang),
        UI.bullet(`${t(lang, "registration.confirmEditName", { word: UI.isolate(shownWord(lang, "name")) })}`, lang),
        UI.bullet(`${t(lang, "registration.confirmEditAge", { word: UI.isolate(shownWord(lang, "age")) })}`, lang),
        UI.bullet(`${t(lang, "registration.confirmEditGender", { word: UI.isolate(shownWord(lang, "gender")) })}`, lang),
        UI.bullet(`${t(lang, "registration.confirmCancel", { word: UI.isolate(shownWord(lang, "cancel")) })}`, lang),
      ].join("\n"),
    ],
    footer: buildFooter(lang),
    lang,
  });
}

function buildEditPrompt(lang, titleKey, promptKey, extraLines = []) {
  return UI.card({
    title: t(lang, titleKey),
    icon: "🛠️",
    blocks: [
      [t(lang, promptKey), ...extraLines].join("\n"),
      t(lang, "registration.replyHint"),
    ],
    footer: buildFooter(lang),
    lang,
  });
}

function buildSuccessMessage({ name, age, gender, user, alreadyClaimedReward, lang, prefix }) {
  const level = Math.floor((user?.exp || 0) / 20000) + 1;

  return UI.card({
    title: t(lang, "registration.successTitle"),
    icon: "🎉",
    blocks: [
      t(lang, "registration.successGreeting", { name }),
      buildUserDataBlock(name, age, gender, lang),
      [
        UI.sectionHeader(`📊 ${t(lang, "registration.statsTitle")}`, lang),
        UI.row(`⭐ ${t(lang, "registration.fieldLevel")}`, formatNumber(level, lang), lang),
        UI.row(`✨ ${t(lang, "registration.fieldExp")}`, formatNumber(user?.exp || 0, lang), lang),
        UI.row(`🌐 ${t(lang, "registration.fieldLanguage")}`, t(lang, "meta.nativeName"), lang),
      ].join("\n"),
      buildRewardLines(alreadyClaimedReward ? { hasClaimedRegisterReward: true } : {}, lang),
      [
        t(lang, "registration.successReady", { bot: brand.botName() }),
        t(lang, "registration.successMenuHint", { command: UI.isolate(`${prefix}menu`) }),
      ].join("\n"),
    ],
    footer: buildFooter(lang),
    lang,
  });
}

// ═══════════════════════════════════════════════
// البطاقة الواحدة: الاسم · العمر · الجنس + [تعديل الاسم][تعديل العمر][تعديل الجنس][حفظ][إلغاء]
// كل تعديل يستبدل البطاقة (تُحذف القديمة بعد إرسال الجديدة) فتبقى بطاقة واحدة فقط.
// ═══════════════════════════════════════════════

/** اسم واتساب كقيمة مبدئية إن كان صالحاً */
function initialName(m) {
  const name = normalizeRegistrationName(m.originalPushName || m.pushName || "");
  if (name.length < 2 || name.length > 30 || UNKNOWN_NAMES.has(name.toLowerCase())) return null;
  return name;
}

function missingFields(session) {
  return ["name", "age", "gender"].filter((field) => !session[field]);
}

/** يرسل بطاقة التسجيل (أو يستبدل السابقة) */
async function sendRegistrationCard(sock, m, session, lang, { note = "" } = {}) {
  const db = getDatabase();
  const user = db.getUser(m.sender) || {};
  await retireCard(sock, m.sender, m.chat, `${CARD_FLOW}:prompt`);
  const image = uiImage("registration") ? "registration" : (await getRegistrationImage()) ? { key: "registration-asset", buffer: await getRegistrationImage() } : null;
  const sent = await sendCard(sock, m, {
    cardId: "registration",
    lang,
    title: t(lang, "registration.cardTitle"),
    icon: "📝",
    blocks: [
      t(lang, "registration.cardIntro"),
      buildUserDataBlock(session.name, session.age, session.gender, lang),
      buildRewardLines(user, lang),
      note,
    ],
    footer: buildFooter(lang),
    image,
    buttons: [
      { id: "terboo_reg_name", text: `📛 ${t(lang, "registration.btnName")}`, typed: shownWord(lang, "name") },
      { id: "terboo_reg_age", text: `🎂 ${t(lang, "registration.btnAge")}`, typed: shownWord(lang, "age") },
      { id: "terboo_reg_gender", text: `👤 ${t(lang, "registration.btnGender")}`, typed: shownWord(lang, "gender") },
      { id: "terboo_reg_save", text: `💾 ${t(lang, "registration.btnSave")}`, typed: shownWord(lang, "confirm") },
      { id: "terboo_reg_cancel", text: `✖️ ${t(lang, "registration.btnCancel")}`, typed: shownWord(lang, "cancel") },
    ],
    flow: CARD_FLOW,
  });
  session.promptId = sent?.key?.id || session.promptId;
  return sent;
}

/** طلب مدخل قصير (يُحذف عند تحديث البطاقة) */
async function askField(sock, m, session, lang, field) {
  session.step = `revise_${field}`;
  if (field === "gender") {
    return sendCard(sock, m, {
      cardId: "registration-gender",
      lang,
      text: `👤 ${t(lang, "registration.askGender")}`,
      buttons: [
        { id: "terboo_reg_g_m", text: `👨 ${t(lang, "registration.genderMale")}`, typed: t(lang, "registration.genderMale") },
        { id: "terboo_reg_g_f", text: `👩 ${t(lang, "registration.genderFemale")}`, typed: t(lang, "registration.genderFemale") },
      ],
      flow: `${CARD_FLOW}:prompt`,
    });
  }
  const text = field === "name"
    ? `📛 ${t(lang, "registration.askName")}\n${UI.bullet(t(lang, "registration.step1Hint"), lang)}`
    : `🎂 ${t(lang, "registration.askAge")}\n${UI.bullet(t(lang, "registration.step2Hint"), lang)}`;
  return sendPrompt(sock, m, { text, flow: CARD_FLOW });
}

/** حفظ التسجيل (نفس الحقول والمكافآت الأصلية) */
async function saveRegistration(m, sock, session, db, lang, prefix) {
  const currentUser = db.getUser(m.sender) || {};
  const rewards = getRegistrationRewards();
  const alreadyClaimedReward = Boolean(currentUser.hasClaimedRegisterReward);
  const now = new Date().toISOString();
  const registrationCount = Number(currentUser.registrationCount || 0) + 1;
  const finalName = session.name;
  const finalAge = session.age;
  const finalGender = session.gender;

  db.setUser(m.sender, {
    isRegistered: true,
    regName: finalName,
    regAge: finalAge,
    regGender: finalGender,
    registeredAt: currentUser.registeredAt || now,
    lastRegisteredAt: now,
    registrationCount,
    hasClaimedRegisterReward: true,
    unregisteredAt: null,
  });

  if (!alreadyClaimedReward) {
    db.updateKoin(m.sender, rewards.koin);
    db.updateEnergi(m.sender, rewards.energi);
    db.updateExp(m.sender, rewards.exp);
  }

  await db.save();
  clearRegistrationSession(m.sender);
  if (session.mode === "card") {
    await retireCard(sock, m.sender, m.chat, `${CARD_FLOW}:prompt`);
    await retireCard(sock, m.sender, m.chat, CARD_FLOW);
  }

  await sock.sendMessage(
    m.chat,
    {
      text: buildSuccessMessage({
        name: finalName,
        age: finalAge,
        gender: finalGender,
        user: db.getUser(m.sender) || {},
        alreadyClaimedReward,
        lang,
        prefix,
      }),
      contextInfo: getRegistrationContextInfo(),
    },
    { quoted: m },
  );

  await m.react("🎉");
  return true;
}

/**
 * أزرار/كلمات البطاقة الواحدة.
 * @returns {Promise<boolean>}
 */
async function handleCardAnswer(m, sock, session, db, lang, prefix, text, lowText) {
  const action = REG_IDS[lowText] || null;
  const is = (name, words = []) => action === name || words.includes(lowText);

  if (is("cancel", CANCEL_WORDS)) {
    clearRegistrationSession(m.sender);
    await retireCard(sock, m.sender, m.chat, `${CARD_FLOW}:prompt`);
    await retireCard(sock, m.sender, m.chat, CARD_FLOW);
    await m.reply(t(lang, "registration.cancelled", { command: UI.isolate(`${prefix}daftar`) }));
    return true;
  }
  if (action === "male" || action === "female") {
    session.gender = action === "male" ? GENDER_MALE : GENDER_FEMALE;
    session.step = "card";
    await sendRegistrationCard(sock, m, session, lang);
    return true;
  }
  if (is("name", REVISE_NAME_WORDS)) {
    await askField(sock, m, session, lang, "name");
    return true;
  }
  if (is("age", REVISE_AGE_WORDS)) {
    await askField(sock, m, session, lang, "age");
    return true;
  }
  if (is("gender", REVISE_GENDER_WORDS)) {
    await askField(sock, m, session, lang, "gender");
    return true;
  }
  if (is("save", CONFIRM_WORDS)) {
    const missing = missingFields(session);
    if (missing.length) {
      session.step = "card";
      await sendRegistrationCard(sock, m, session, lang, {
        note: `⚠️ ${t(lang, "registration.missing", { fields: missing.map((f) => t(lang, `registration.field${f[0].toUpperCase()}${f.slice(1)}`)).join(" · ") })}`,
      });
      return true;
    }
    return saveRegistration(m, sock, session, db, lang, prefix);
  }

  if (session.step === "revise_name") {
    const name = normalizeRegistrationName(text);
    if (name.length < 2 || name.length > 30) {
      await m.reply(t(lang, "registration.errName"));
      return true;
    }
    session.name = name;
  } else if (session.step === "revise_age") {
    const age = Number(text);
    if (!/^\d+$/.test(text) || Number.isNaN(age) || age < 1 || age > 100) {
      await m.reply(t(lang, "registration.errAge"));
      return true;
    }
    session.age = age;
  } else if (session.step === "revise_gender") {
    const gender = MALE_PATTERN.test(lowText) ? GENDER_MALE : FEMALE_PATTERN.test(lowText) ? GENDER_FEMALE : null;
    if (!gender) {
      await m.reply(t(lang, "registration.errGender"));
      return true;
    }
    session.gender = gender;
  } else {
    await m.reply(t(lang, "registration.cardHint"));
    return true;
  }
  session.step = "card";
  await sendRegistrationCard(sock, m, session, lang);
  return true;
}

// ═══════════════════════════════════════════════
// بدء التسجيل (نفس المنطق الأصلي، قابل للاستدعاء من طبقة الانضمام)
// ═══════════════════════════════════════════════

/**
 * يبدأ جلسة التسجيل الحالية ويرسل رسالة الترحيب.
 * تُستدعى من الأمر `.daftar` ومن بطاقة اختيار اللغة على حد سواء.
 */
async function startRegistration(m, sock) {
  const db = getDatabase();
  const user = db.getUser(m.sender);
  const lang = getUserLanguage(user);
  const prefix = m.prefix || config.command?.prefix || ".";

  if (user?.isRegistered) {
    return m.reply(
      UI.card({
        title: t(lang, "registration.already"),
        icon: "✅",
        blocks: [
          buildUserDataBlock(user.regName, user.regAge, user.regGender, lang),
          t(lang, "registration.alreadyHint", { command: UI.isolate(`${prefix}unreg`) }),
        ],
        footer: buildFooter(lang),
      }),
    );
  }

  if (getRegistrationSessionEntry(m.sender).session) {
    return m.reply(
      UI.card({
        title: t(lang, "registration.activeSession"),
        icon: "📝",
        blocks: [
          t(lang, "registration.activeSessionHint", {
            command: UI.isolate(`${prefix}bataldaftar`),
          }),
        ],
        footer: buildFooter(lang),
      }),
    );
  }

  // بطاقة واحدة رسمية (الاسم · العمر · الجنس) بدل سلسلة أسئلة
  const session = createRegistrationSession(m.sender, m.chat, { mode: "card", name: initialName(m) });
  const sent = await sendRegistrationCard(sock, m, session, lang);

  await m.react("📝").catch((error) => { noteFailure("plugin:user/daftar", error, {where: "plugins/user/daftar.js:473",stage: "m.react"}); });
  return sent;
}

async function handler(m, { sock }) {
  return startRegistration(m, sock);
}

// ═══════════════════════════════════════════════
// معالجة إجابات الجلسة (نفس التسلسل والتحقق الأصلي)
// ═══════════════════════════════════════════════

async function registrationAnswerHandler(m, sock) {
  if (!m.body) return false;
  if (shouldBypassRegistrationAnswer(m)) return false;

  const { session } = getRegistrationSessionEntry(m.sender);
  if (!session) return false;
  if (m.chat !== session.chatJid) return false;

  const text = m.body.trim();
  const lowText = normalizeSessionText(text);
  const db = getDatabase();
  const lang = getLang(db, m.sender);
  const prefix = m.prefix || config.command?.prefix || ".";

  if (session.mode === "card") {
    return handleCardAnswer(m, sock, session, db, lang, prefix, text, lowText);
  }

  if (CANCEL_WORDS.includes(lowText)) {
    clearRegistrationSession(m.sender);
    await m.reply(
      UI.errorCard(
        t(lang, "registration.step4Title"),
        t(lang, "registration.cancelled", { command: UI.isolate(`${prefix}daftar`) }),
        { footer: buildFooter(lang), lang },
      ),
    );
    return true;
  }

  if (session.step === "name") {
    const name = normalizeRegistrationName(text);

    if (name.length < 2 || name.length > 30) {
      await m.reply(t(lang, "registration.errName"));
      return true;
    }

    session.name = name;
    session.step = "age";

    const sent = await sendRegistrationPrompt(sock, m, buildAgePrompt(name, lang));

    session.promptId = sent?.key?.id || session.promptId;
    return true;
  }

  if (session.step === "age") {
    const age = Number(text);

    if (!/^\d+$/.test(text) || Number.isNaN(age) || age < 1 || age > 100) {
      await m.reply(t(lang, "registration.errAge"));
      return true;
    }

    session.age = age;
    session.step = "gender";

    const sent = await sendRegistrationPrompt(sock, m, buildGenderPrompt(lang));

    session.promptId = sent?.key?.id || session.promptId;
    return true;
  }

  if (session.step === "gender") {
    let gender = null;

    if (MALE_PATTERN.test(lowText)) {
      gender = GENDER_MALE;
    } else if (FEMALE_PATTERN.test(lowText)) {
      gender = GENDER_FEMALE;
    }

    if (!gender) {
      await m.reply(t(lang, "registration.errGender"));
      return true;
    }

    session.gender = gender;
    session.step = "confirm";

    const user = db.getUser(m.sender) || {};
    const sent = await sendRegistrationPrompt(
      sock,
      m,
      buildConfirmationPrompt(session, user, lang),
    );

    session.promptId = sent?.key?.id || session.promptId;
    return true;
  }

  if (session.step === "revise_name") {
    const name = normalizeRegistrationName(text);

    if (name.length < 2 || name.length > 30) {
      await m.reply(t(lang, "registration.errName"));
      return true;
    }

    session.name = name;
    session.step = "confirm";

    const user = db.getUser(m.sender) || {};
    const sent = await sendRegistrationPrompt(
      sock,
      m,
      buildConfirmationPrompt(session, user, lang),
    );

    session.promptId = sent?.key?.id || session.promptId;
    return true;
  }

  if (session.step === "revise_age") {
    const age = Number(text);

    if (!/^\d+$/.test(text) || Number.isNaN(age) || age < 1 || age > 100) {
      await m.reply(t(lang, "registration.errAge"));
      return true;
    }

    session.age = age;
    session.step = "confirm";

    const user = db.getUser(m.sender) || {};
    const sent = await sendRegistrationPrompt(
      sock,
      m,
      buildConfirmationPrompt(session, user, lang),
    );

    session.promptId = sent?.key?.id || session.promptId;
    return true;
  }

  if (session.step === "revise_gender") {
    let gender = null;

    if (MALE_PATTERN.test(lowText)) {
      gender = GENDER_MALE;
    } else if (FEMALE_PATTERN.test(lowText)) {
      gender = GENDER_FEMALE;
    }

    if (!gender) {
      await m.reply(t(lang, "registration.errGender"));
      return true;
    }

    session.gender = gender;
    session.step = "confirm";

    const user = db.getUser(m.sender) || {};
    const sent = await sendRegistrationPrompt(
      sock,
      m,
      buildConfirmationPrompt(session, user, lang),
    );

    session.promptId = sent?.key?.id || session.promptId;
    return true;
  }

  if (session.step === "confirm") {
    if (REVISE_NAME_WORDS.includes(lowText)) {
      session.step = "revise_name";

      const sent = await sendRegistrationPrompt(
        sock,
        m,
        buildEditPrompt(lang, "registration.editNameTitle", "registration.editNamePrompt", [
          UI.bullet(`${t(lang, "registration.step1Hint")}`, lang),
        ]),
      );

      session.promptId = sent?.key?.id || session.promptId;
      return true;
    }

    if (REVISE_AGE_WORDS.includes(lowText)) {
      session.step = "revise_age";

      const sent = await sendRegistrationPrompt(
        sock,
        m,
        buildEditPrompt(lang, "registration.editAgeTitle", "registration.editAgePrompt", [
          UI.bullet(`${t(lang, "registration.step2Hint")}`, lang),
        ]),
      );

      session.promptId = sent?.key?.id || session.promptId;
      return true;
    }

    if (REVISE_GENDER_WORDS.includes(lowText)) {
      session.step = "revise_gender";

      const sent = await sendRegistrationPrompt(
        sock,
        m,
        buildEditPrompt(lang, "registration.editGenderTitle", "registration.editGenderPrompt", [
          UI.bullet(`👨 ${t(lang, "registration.step3OptionMale")}`, lang),
          UI.bullet(`👩 ${t(lang, "registration.step3OptionFemale")}`, lang),
        ]),
      );

      session.promptId = sent?.key?.id || session.promptId;
      return true;
    }

    if (REVISE_VAGUE_WORDS.includes(lowText)) {
      await m.reply(t(lang, "registration.errEditTarget"));
      return true;
    }

    if (!CONFIRM_WORDS.includes(lowText)) {
      await m.reply(t(lang, "registration.errConfirm"));
      return true;
    }

    return saveRegistration(m, sock, session, db, lang, prefix);
  }

  return false;
}

export {
  pluginConfig as config,
  handler,
  startRegistration,
  registrationAnswerHandler,
  clearRegistrationSession,
};
