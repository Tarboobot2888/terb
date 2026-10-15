import config from "../../config.js";
import { getDatabase } from "./terboo-database.js";
import { getUserLanguage, t } from "./terboo-localization.js";
import { findParticipant, isBot, sameUser } from "./terboo-identity.js";
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

function formatAfkDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} يوم ${hours % 24} ساعة`;
  if (hours > 0) return `${hours} ساعة ${minutes % 60} دقيقة`;
  if (minutes > 0) return `${minutes} دقيقة`;
  return `${seconds} ثانية`;
}

function checkPermission(m, pluginConfig) {
  // قاعدة البيانات مطلوبة فقط لقراءة لغة المستخدم وصلاحياته الإضافية؛
  // غيابها (استدعاء مبكر أو اختبار) لا يجوز أن يُسقط فحص الصلاحيات نفسه.
  let db = null;
  try {
    db = getDatabase();
  } catch {
    db = null;
  }
  const user = db?.getUser?.(m.sender) || {};
  // رسائل الصلاحيات تتبع لغة المستخدم، مع الحفاظ على نص config كاحتياط للعربية
  const lang = getUserLanguage(user);
  const msg = (key, fallback) =>
    lang === "ar" ? fallback || t(lang, key) : t(lang, key);
  let hasAccess = false;
  if (user.access && m.command) {
    const accessFound = user.access.find(
      (a) => a.cmd === m.command.toLowerCase(),
    );
    if (accessFound) {
      if (accessFound.expired === null || accessFound.expired > Date.now()) {
        hasAccess = true;
      } else {
        user.access = user.access.filter(
          (a) => a.cmd !== m.command.toLowerCase(),
        );
        db.setUser(m.sender, user);
      }
    }
  }

  // المالك المعتمد من config.owner.number لا يخضع لأي قيود أمر؛ قد تبقى
  // متطلبات واتساب التقنية مثل صلاحية البوت لتنفيذ حذف/طرد قائمة بذاتها.
  if (m.isOwner) return { allowed: true, reason: "" };

  if (pluginConfig.isOwner && !m.isOwner && !hasAccess) {
    return {
      allowed: false,
      reason: msg("common.ownerOnly", config.messages?.ownerOnly),
    };
  }

  if (pluginConfig.isPartner && !m.isPartner && !m.isOwner && !hasAccess) {
    return { allowed: false, reason: "🤝 Partner only!" };
  }

  if (
    pluginConfig.isPremium &&
    !m.isPremium &&
    !m.isOwner &&
    !m.isPartner &&
    !hasAccess
  ) {
    return {
      allowed: false,
      reason: msg("common.premiumOnly", config.messages?.premiumOnly),
    };
  }

  if (pluginConfig.isGroup && !m.isGroup) {
    return {
      allowed: false,
      reason: msg("common.groupOnly", config.messages?.groupOnly),
    };
  }

  if (pluginConfig.isPrivate && m.isGroup) {
    return {
      allowed: false,
      reason: msg("common.privateOnly", config.messages?.privateOnly),
    };
  }

  if (
    pluginConfig.isAdmin &&
    m.isGroup &&
    !m.isAdmin &&
    !m.isOwner &&
    !hasAccess
  ) {
    return {
      allowed: false,
      reason: msg("common.adminOnly", config.messages?.adminOnly),
    };
  }

  if (pluginConfig.isBotAdmin && m.isGroup && !m.isBotAdmin) {
    return {
      allowed: false,
      reason: msg("common.botAdminOnly", config.messages?.botAdminOnly),
    };
  }

  if (m.isGroup) {
    const group = db.getGroup(m.chat);
    if (group) {
      if (pluginConfig.category === "game" && group.game === false) {
        if (!m.isAdmin && !m.isOwner && !hasAccess) {
          return {
            allowed: false,
            reason: "🎮 Fitur Game sedang dinonaktifkan di grup ini oleh Admin!",
          };
        }
      }
      if (pluginConfig.category === "rpg" && group.rpg === false) {
        if (!m.isAdmin && !m.isOwner && !hasAccess) {
          return {
            allowed: false,
            reason: "⚔️ Fitur RPG sedang dinonaktifkan di grup ini oleh Admin!",
          };
        }
      }
    }
  }

  return { allowed: true, reason: "" };
}

function checkMode(m, getActiveJadibots) {
  const db = getDatabase();
  const dbMode = db.setting("botMode");
  const configuredMode = config?.mode || config?.config?.mode || "public";
  const mode = dbMode || configuredMode;

  const onlyGc = db.setting("onlyGc");
  const onlyPc = db.setting("onlyPc");
  const selfAdmin = db.setting("selfAdmin");
  const publicAdmin = db.setting("publicAdmin");
  const botAfk = db.setting("botAfk");

  if (botAfk && botAfk.active) {
    if (m.fromMe || m.isOwner) {
      return { allowed: true };
    }
    const duration = formatAfkDuration(Date.now() - botAfk.since);
    return {
      allowed: false,
      isAfk: true,
      afkMessage:
        `💤 *البوت غائب (AFK)*\n\n` +
        `❋ 📋 *معلومات*\n` +
        `> ◈ 📝 السبب: ${botAfk.reason || "AFK"}\n` +
        `> ◈ ⏱️ منذ: ${duration}\n` +
        `\n\n` +
        `> Bot tidak bisa menerima perintah saat ini\n` +
        `> Mohon tunggu sampai owner mengaktifkan kembali`,
    };
  }

  if (onlyGc && !m.isGroup && !m.isOwner) return { allowed: false };
  if (onlyPc && m.isGroup && !m.isOwner) return { allowed: false };

  const onlyThisGroup = db.setting("onlyThisGroup");
  if (onlyThisGroup && m.isGroup && !m.isOwner) {
    if (typeof onlyThisGroup === "string" && m.chat !== onlyThisGroup) {
      return { allowed: false };
    } else if (typeof onlyThisGroup === "object" && m.chat !== onlyThisGroup.jid) {
      return {
        allowed: false,
        isOnlyThisGroup: true,
        onlyThisGroupMessage:
          `🔒 *Akses Ditolak*\n\n` +
          `Maaf, saat ini bot kami hanya bisa diakses dan digunakan secara eksklusif di Grup Utama (*${onlyThisGroup.name}*).\n\n` +
          `Silakan bergabung ke grup utama kami melalui tautan berikut:\n` +
          `🔗 ${onlyThisGroup.link}\n\n` +
          `Setelah bergabung, Anda bebas menggunakan semua fitur bot. Terima kasih!`
      };
    }
  }

  const selfGroups = db.setting("selfGroups") || [];
  if (m.isGroup && selfGroups.includes(m.chat)) {
    if (m.fromMe) return { allowed: true };
    if (m.isOwner) return { allowed: true };
    return { allowed: false, isSelfGroup: true };
  }

  const publicGroups = db.setting("publicGroups") || [];
  if (m.isGroup && publicGroups.includes(m.chat)) {
    return { allowed: true };
  }

  if (mode === "self") {
    if (m.fromMe) return { allowed: true };
    if (m.isOwner) return { allowed: true };

    const activeJadibots = getActiveJadibots();
    if (activeJadibots.length > 0) {
      let jadibotList = "";
      activeJadibots.forEach((jb, i) => {
        jadibotList += `> ◈ ${i + 1}. @${jb.id}\n`;
      });
      const mentions = activeJadibots.map((jb) => jb.id + "@s.whatsapp.net");
      return {
        allowed: false,
        hasJadibots: true,
        jadibotMessage:
          `🤖 *الوضع الخاص*\n\n` +
          `Bot utama sedang dalam mode private.\n` +
          `Kamu bisa menggunakan bot turunan kami:\n\n` +
          `❋ 📱 *البوتات المتاحة*\n` +
          `${jadibotList}` +
          `\n\n` +
          `> Pilih salah satu bot di atas untuk akses fitur.`,
        jadibotMentions: mentions,
      };
    }

    return { allowed: false };
  }

  if (mode === "public") {
    const onlyAdmin = db.setting("onlyAdmin");

    if (onlyAdmin) {
      if (m.fromMe || m.isOwner) return { allowed: true };
      if (!m.isGroup) return { allowed: true };
      if (m.isGroup && m.isAdmin) return { allowed: true };
      return { allowed: false };
    }

    if (selfAdmin) {
      if (m.fromMe || m.isOwner) return { allowed: true };
      if (m.isGroup && m.isAdmin) return { allowed: true };
      return { allowed: false };
    }

    if (publicAdmin) {
      if (m.fromMe || m.isOwner) return { allowed: true };
      if (!m.isGroup) return { allowed: true };
      if (m.isGroup && m.isAdmin) return { allowed: true };
      return { allowed: false };
    }

    return { allowed: true };
  }

  return { allowed: true };
}

/**
 * حماية هدف إجراء إداري (طرد/خفض/كتم/إنذار…) — طبقة واحدة لكل البلوقنات وللذكاء (§6 §57).
 * مطابقة هوية دقيقة PN/LID: البوت نفسه · المنفّذ نفسه · مالك البوت · مشرف (لإجراءات الإزالة)
 * · العضوية في المجموعة.
 * @param {Object} m رسالة المنفّذ (مُسلسلة)
 * @param {Object} sock
 * @param {string} targetJid
 * @param {{protectAdmins?:boolean, protectOwner?:boolean, requireMember?:boolean, isOwner?:Function}} [options]
 * @returns {{ok:boolean, reasonKey?:string, participant?:Object|null}}
 */
function checkTarget(m, sock, targetJid, { protectAdmins = true, protectOwner = true, requireMember = true, isOwner = config.isOwner } = {}) {
  if (!targetJid) return { ok: false, reasonKey: "group.noTarget", participant: null };
  if (isBot(targetJid, sock)) return { ok: false, reasonKey: "group.cantBot", participant: null };
  if (sameUser(targetJid, m.sender)) return { ok: false, reasonKey: "group.cantSelf", participant: null };
  // المالك محمي من أي مشرف؛ المالك نفسه فقط يملك قراره
  if (protectOwner && !m.isOwner && typeof isOwner === "function" && isOwner(targetJid)) return { ok: false, reasonKey: "group.cantOwner", participant: null };
  const participant = m.isGroup ? findParticipant(m.groupMetadata?.participants || m.groupMembers || [], targetJid) : null;
  if (m.isGroup && requireMember && !participant) return { ok: false, reasonKey: "group.notMember", participant: null };
  if (protectAdmins && participant?.admin) return { ok: false, reasonKey: "group.cantAdmin", participant };
  return { ok: true, participant };
}

export { levenshtein, formatAfkDuration, checkPermission, checkMode, checkTarget };
