import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import config from "../../config.js";
import { getDatabase } from "../../src/lib/terboo-database.js";
import { getRole } from "./مستوى.js";
import fs from "fs";
import { getDevice } from "@whiskeysockets/baileys";
import { isLid, isLidConverted, getCachedJid, resolveAnyLidToJid } from "../../src/lib/terboo-lid.js";
import {
  getUserLanguage,
  t,
  formatNumber as formatLocaleNumber,
  formatDate as formatLocaleDate,
  formatDateTime as formatLocaleDateTime,
  getGenderLabel,
  getRoleLabel,
} from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import { sendMenu } from "../../src/lib/terboo-menu-send.js";
import { f } from "../../src/lib/terboo-http.js";
import * as brand from "../../src/lib/terboo-brand.js";

const pluginConfig = {
  name: "بروفايل",
  alias: ["me", "profil", "myprofile", "my", "stats", "status", "حسابي", "perfil"],
  category: "user",
  description: "عرض الملف الشخصي مع إحصائيات RPG",
  usage: ".بروفايل [@user]",
  example: ".بروفايل",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const EXP_PER_LEVEL = 10000;

function formatNumber(num, lang = "ar") {
  if (num === undefined || num === null) return "0";
  return formatLocaleNumber(num, lang);
}

function getLevelBar(current, target) {
  const totalBars = 10;
  const filledBars = Math.min(Math.floor((current / target) * totalBars), totalBars);
  const emptyBars = totalBars - filledBars;
  return "▰".repeat(filledBars) + "▱".repeat(emptyBars);
}

function generateMetaCard(data) {
  const {
    phone, userName, regName, regAge, regGender,
    isRegistered, isOwnerUser, isPremiumUser, isBanned,
    registeredAt, clanId, spouse, role, level, totalExp,
    health, maxHealth, mana, maxMana, stamina, maxStamina,
    levelBar, expProgress, koin, bank, energi, energiStatus,
    exists, canonicalJid, lid, isGroup, isLidTarget, isBot,
    deviceId, avatarStatus, bio, bioDate, isBiz,
    bizDescription, bizWebsite, bizEmail, bizAddress,
    bizCategories, bizVerified, products, collectionsCount,
    botJid, botPlatform, runtime, inventoryItems, unlockedFeatures,
    lang = "ar", language,
  } = data;

  const yes = t(lang, "common.yes");
  const no = t(lang, "common.no");
  const dash = "-";

  const accountLines = [
    UI.sectionHeader(`👤 ${t(lang, "profile.accountSection")}`, lang),
    UI.row(`📛 ${t(lang, "profile.name")}`, userName || t(lang, "common.user"), lang),
  ];
  if (isRegistered) {
    accountLines.push(UI.row(`📝 ${t(lang, "profile.registeredName")}`, regName || dash, lang));
    accountLines.push(UI.row(`🎂 ${t(lang, "profile.age")}`, regAge ? `${formatNumber(regAge, lang)} ${t(lang, "registration.ageUnit")}` : dash, lang));
    accountLines.push(UI.row(`⚧ ${t(lang, "profile.gender")}`, getGenderLabel(regGender, lang), lang));
  }
  accountLines.push(UI.row(`🏷 ID`, `@${phone}`, lang));
  accountLines.push(UI.row(
    `👑 ${t(lang, "profile.role")}`,
    isOwnerUser ? `👑 ${t(lang, "common.owner")}` : isPremiumUser ? `💎 ${t(lang, "common.premium")}` : `🆓 ${t(lang, "common.member")}`,
    lang,
  ));
  accountLines.push(UI.row(`🌐 ${t(lang, "profile.language")}`, t(lang, "meta.nativeName"), lang));
  accountLines.push(UI.row(`📝 ${t(lang, "profile.registered")}`, isRegistered ? t(lang, "profile.registeredYes") : t(lang, "profile.registeredNo"), lang));
  if (isBanned) accountLines.push(UI.row(`🚫 Ban`, yes, lang));
  if (registeredAt) accountLines.push(UI.row(`📅 ${t(lang, "profile.registered")}`, formatLocaleDate(registeredAt, lang), lang));
  if (clanId) accountLines.push(UI.row(`🏰 Clan`, clanId, lang));
  if (spouse) accountLines.push(UI.row(`💍`, `@${String(spouse).split("@")[0]}`, lang));

  const statsLines = [
    UI.sectionHeader(`⚔️ ${t(lang, "profile.statsSection")}`, lang),
    UI.row(`🎖 ${t(lang, "menu.fieldRank")}`, getRoleLabel(role, lang), lang),
    UI.row(`📊 ${t(lang, "profile.level")}`, formatNumber(level, lang), lang),
    UI.row(`✨ ${t(lang, "profile.exp")}`, UI.isolate(`${formatNumber(totalExp, lang)} XP`), lang),
    UI.row(`❤️ HP`, UI.isolate(`${health} / ${maxHealth}`), lang),
    UI.row(`💧 MP`, UI.isolate(`${mana} / ${maxMana}`), lang),
    UI.row(`⚡ SP`, UI.isolate(`${stamina} / ${maxStamina}`), lang),
    UI.quote(`${levelBar} ${expProgress}`, lang),
  ];

  const walletLines = [
    UI.sectionHeader(`💰 ${t(lang, "profile.coins")}`, lang),
    UI.row(`🪙 ${t(lang, "profile.coins")}`, String(koin), lang),
    UI.row(`🏦 Bank`, UI.isolate(String(bank, lang)), lang),
    UI.row(`⚡ ${t(lang, "profile.energy")}`, String(energiStatus), lang),
  ];

  const waLines = [
    UI.sectionHeader(`📱 WhatsApp`, lang),
    UI.row(`📞`, UI.isolate(`+${phone}`), lang),
    UI.row(`✅`, exists ? yes : no, lang),
    UI.row(`🆔 JID`, UI.isolate(canonicalJid || dash), lang),
    UI.row(`🔗 LID`, UI.isolate(lid || dash), lang),
    UI.row(`📂`, isGroup ? "Group" : isLidTarget ? "LID" : "WhatsApp", lang),
    UI.row(`🤖 Bot`, isBot ? yes : no, lang),
    UI.row(`📱 Device`, UI.isolate(deviceId || dash), lang),
  ];

  const bioLines = [
    UI.sectionHeader(`ℹ️ Bio`, lang),
    UI.row(`🖼`, avatarStatus, lang),
    UI.row(`📝`, bio || dash, lang),
    UI.row(`🕐`, bioDate || dash, lang),
  ];

  const bizLines = [UI.sectionHeader(`🏢 Business`, lang), UI.row(`💼`, isBiz ? "WhatsApp Business" : "WhatsApp")];
  if (isBiz) {
    bizLines.push(UI.row(`📄`, bizDescription || dash, lang));
    bizLines.push(UI.row(`🌐`, UI.isolate(bizWebsite || dash, lang)));
    bizLines.push(UI.row(`📧`, UI.isolate(bizEmail || dash, lang)));
    bizLines.push(UI.row(`📍`, bizAddress || dash, lang));
    bizLines.push(UI.row(`🏷`, bizCategories || dash, lang));
    bizLines.push(UI.row(`✓`, bizVerified ? yes : no, lang));
    if (products > 0 || collectionsCount > 0) {
      bizLines.push(UI.row(`📦`, formatNumber(products, lang, lang)));
      bizLines.push(UI.row(`📚`, formatNumber(collectionsCount, lang, lang)));
    }
  }

  const botLines = [
    UI.sectionHeader(`🤖 ${t(lang, "menu.botSection")}`, lang),
    UI.row(`🆔`, UI.isolate(botJid || dash), lang),
    UI.row(`💻`, UI.isolate(botPlatform || dash), lang),
    UI.row(`⚙️ Node`, UI.isolate(runtime), lang),
  ];

  const blocks = [
    accountLines.join("\n"),
    statsLines.join("\n"),
    walletLines.join("\n"),
    waLines.join("\n"),
    bioLines.join("\n"),
    bizLines.join("\n"),
    botLines.join("\n"),
  ];

  if (inventoryItems && inventoryItems.length > 0) {
    blocks.push([
      UI.sectionHeader(`🎒 Inventory`, lang),
      ...inventoryItems.map(([item, qty]) => UI.row(item, formatNumber(qty, lang), lang)),
    ].join("\n"));
  }

  if (unlockedFeatures && unlockedFeatures.length > 0) {
    blocks.push([
      UI.sectionHeader(`🔓 Features`, lang),
      ...unlockedFeatures.map((fitur) => UI.bullet(fitur, lang)),
    ].join("\n"));
  }

  return UI.card({
    title: t(lang, "profile.title"),
    icon: "👤",
    blocks,
    footer: UI.footer(brand.botName(), brand.developerName(), lang),
    lang,
  });
}

async function handler(m, { sock }) {
  const db = getDatabase();
  const target = m.mentionedJid?.[0] || m.quoted?.sender || m.sender;

  const user = db.getUser(target) || db.setUser(target);

  const isLidTarget = target.endsWith('@lid');
  const isGroup = target.endsWith('@g.us');

  const resolvedJid = isLidTarget && sock.getJid ? sock.getJid(target) : target;
  const phone = resolvedJid.split('@')[0].split(':')[0];
  const deviceId = m.quoted?.key?.id?.split('/')[0] || m.key?.id?.split('/')[0] || (resolvedJid.match(/:(\d+)@/) || [])[1] || null;

  const safe = async (fn) => {
    try { return await fn(); } catch (error) { noteFailure("plugin:user/profile", error, {where: "plugins/user/profile.js:195",stage: "fn"}); return null; }
  };

  const [
    onWa,
    ppUrl,
    statusRes,
    bizProfile,
    catalogRes,
    collections,
    lidFromJid,
    contactQuery,
    deviceInfo,
  ] = await Promise.all([
    safe(() => sock.onWhatsApp(phone)),
    safe(() => sock.profilePictureUrl(resolvedJid, 'image')),
    safe(() => sock.fetchStatus(resolvedJid)),
    safe(() => sock.getBusinessProfile(resolvedJid)),
    safe(() => sock.getCatalog({ jid: resolvedJid, limit: 5 })),
    safe(() => sock.getCollections(resolvedJid, 5)),
    safe(() => sock.getLidFromJid(resolvedJid)),
    safe(() => sock.getContact(resolvedJid)),
    safe(() => getDevice(resolvedJid, sock)),
  ]);

  const exists = onWa?.[0]?.exists ?? false;
  const canonicalJid = onWa?.[0]?.jid || resolvedJid;

  // ✅ LID حقيقي من 3 مصادر
  let realLid = null;
  if (m.key?.participant && m.key.participant.endsWith('@lid')) {
    realLid = m.key.participant;
  }
  if (!realLid && lidFromJid) {
    realLid = lidFromJid;
  }
  if (!realLid && onWa?.[0]?.lid) {
    realLid = onWa[0].lid;
  }
  // لو مفيش LID حقيقي، نشوف الكاش
  if (!realLid) {
    const cached = getCachedJid(target);
    if (cached && cached.endsWith('@lid')) realLid = cached;
  }

  const isBot = deviceInfo?.isBot || contactQuery?.isBot || false;
  const statusObj = Array.isArray(statusRes) ? statusRes[0] : statusRes;
  const status = statusObj?.status?.status || statusObj?.status || null;
  const statusTs = statusObj?.status?.setAt || statusObj?.setAt || null;

  const isBiz = !!bizProfile && Object.keys(bizProfile).length > 0;
  const products = catalogRes?.products?.length || 0;
  const collectionsCount = collections?.collections?.length || 0;

  const lang = getUserLanguage(db.getUser(m.sender));
  const fmtDate = (ts) => {
    if (!ts) return null;
    const d = ts instanceof Date ? ts : new Date(Number(ts) * (String(ts).length <= 10 ? 1000 : 1));
    return isNaN(d) ? null : formatLocaleDateTime(d, lang);
  };

  if (!user.rpg) user.rpg = {};
  const userExp = user.exp || 0;
  const userLevel = Math.floor(userExp / EXP_PER_LEVEL) + 1;
  user.rpg.level = userLevel;
  user.rpg.health = user.rpg.health || 100;
  user.rpg.maxHealth = 100 + (userLevel - 1) * 10;
  user.rpg.mana = user.rpg.mana || 100;
  user.rpg.maxMana = 100 + (userLevel - 1) * 5;
  user.rpg.stamina = user.rpg.stamina || 100;
  user.rpg.maxStamina = 100 + (userLevel - 1) * 5;

  const currentLevelExp = (userLevel - 1) * EXP_PER_LEVEL;
  const levelUpExp = userLevel * EXP_PER_LEVEL;
  const expInLevel = userExp - currentLevelExp;
  const expNeeded = levelUpExp - currentLevelExp;
  const role = getRole(userLevel);
  const isOwnerUser = config.isOwner(target);
  const isPremiumUser = config.isPremium(target);

  let ppMedia = null;
  try {
    const profilePicUrl = await sock.profilePictureUrl(target, "image");
    if (profilePicUrl) ppMedia = { url: profilePicUrl };
    else throw new Error("لا توجد صورة");
  } catch {
    const fallbackUrl = config.assets["pp-kosong"];
    ppMedia = fallbackUrl ? { url: fallbackUrl } : { url: "https://i.imgur.com/TuItj4L.png" };
  }

  const inventoryItems = user.inventory
    ? Object.entries(user.inventory).filter(([_, qty]) => qty > 0)
    : [];

  const unlockedFeatures = user.unlockedFeatures || [];

  const cardData = {
    lang,
    language: user.language || null,
    phone,
    userName:
      user.name && user.name !== "Unknown"
        ? user.name
        : m.pushName || t(lang, "common.user"),
    regName: user.regName,
    regAge: user.regAge,
    regGender: user.regGender,
    isRegistered: user.isRegistered,
    isOwnerUser,
    isPremiumUser,
    isBanned: user.isBanned,
    registeredAt: user.registeredAt,
    clanId: user.clanId,
    spouse: user.rpg?.spouse,
    role,
    level: user.rpg.level,
    totalExp: userExp,
    health: user.rpg.health,
    maxHealth: user.rpg.maxHealth,
    mana: user.rpg.mana,
    maxMana: user.rpg.maxMana,
    stamina: user.rpg.stamina,
    maxStamina: user.rpg.maxStamina,
    levelBar: getLevelBar(expInLevel, expNeeded),
    expProgress: `${formatNumber(expInLevel, lang)} / ${formatNumber(expNeeded, lang)} XP`,
    koin: formatNumber(user.koin || 0, lang),
    bank: formatNumber(user.rpg?.bank || 0, lang),
    energi: user.energi,
    energiStatus: isOwnerUser || isPremiumUser ? `∞ ${t(lang, "profile.unlimited")}` : formatNumber(user.energi || 0, lang),
    exists,
    canonicalJid,
    lid: realLid || '-',
    isGroup,
    isLidTarget,
    isBot,
    deviceId,
    avatarStatus: ppUrl ? t(lang, "common.yes") : t(lang, "common.no"),
    bio: status,
    bioDate: fmtDate(statusTs),
    isBiz,
    bizDescription: bizProfile?.description,
    bizWebsite: (bizProfile?.website || []).join(', '),
    bizEmail: bizProfile?.email,
    bizAddress: bizProfile?.address,
    bizCategories: (bizProfile?.categories || []).map(c => c.name || c).join(', '),
    bizVerified: bizProfile?.isProfileLinked,
    products,
    collectionsCount,
    botJid: sock.user?.id,
    botPlatform: sock.authState?.creds?.platform || process.platform,
    runtime: process.version,
    inventoryItems,
    unlockedFeatures
  };

  const caption = generateMetaCard(cardData);
  const mentions = [target];
  if (user.rpg?.spouse) mentions.push(user.rpg.spouse);

  // صورة الحساب كرأس + أزرار قائمة «profile» من السجل المركزي — عبر طبقة التسليم الموحّدة (بدائل تلقائية حتى النص)
  const prefix = m.prefix || config.command?.prefix || ".";
  const avatar = await avatarBuffer(ppMedia);
  await sendMenu(sock, m, {
    menuId: "profile",
    ctx: { lang, prefix, isOwner: Boolean(m.isOwner), isGroup: Boolean(m.isGroup) },
    text: caption,
    footer: UI.footer(brand.botName(), brand.developerName(), lang),
    media: avatar ? { type: "image", buffer: avatar } : null,
    mentions,
  });
}

/** صورة الحساب كـBuffer (رابط واتساب عبر طبقة HTTP الموحّدة، أو ملف الأصول المحلي) أو null */
async function avatarBuffer(ppMedia) {
  const source = String(ppMedia?.url || "");
  if (!source) return null;
  try {
    if (/^https?:\/\//i.test(source)) {
      const data = await f(source, "arrayBuffer");
      return data ? Buffer.from(data) : null;
    }
    return fs.existsSync(source) ? fs.readFileSync(source) : null;
  } catch (error) {
    noteFailure("plugin:user/profile", error, { where: "plugins/user/profile.js:avatarBuffer", stage: "avatar", fallback: "no-image" });
    return null;
  }
}

export { pluginConfig as config, handler };