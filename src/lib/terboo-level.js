import { noteFailure } from "./terboo-failure-log.js";
import config from "../../config.js";
import { getFontStack, registerFonts } from "./terboo-fonts.js";
import { canvasText } from "./terboo-canvas-i18n.js";
import { getUserLanguage } from "./terboo-localization.js";
import fs from "node:fs";
import path from "node:path";

/** اتجاه النص: العربي RTL (علامات الترقيم في مكانها الصحيح) */
const dirOf = (text) => (/[\u0600-\u06FF]/.test(String(text)) ? "rtl" : "ltr");
/** خلفية البطاقة: لوحة هوية Terboo المحلية (بدل رابط خارجي قد يتغير محتواه) */
const BRAND_BACKGROUND = path.join(process.cwd(), "assets", "image", "cards", "welcome-plate.jpg");

// تسجيل خطوط المشروع قبل أي رسم على Canvas (§20)
registerFonts().catch((error) => { noteFailure("level", error, {where: "src/lib/terboo-level.js:7",stage: "registerFonts"}); });

const EXP_PER_LEVEL = 10000;

function calculateLevel(exp) {
  return Math.floor(exp / EXP_PER_LEVEL) + 1;
}

function expForLevel(level) {
  return (level - 1) * EXP_PER_LEVEL;
}

function getRole(level) {
  if (level >= 100) return "🐉 Mythic";
  if (level >= 80) return "⚔️ Legend";
  if (level >= 60) return "💜 Epic";
  if (level >= 40) return "💪 Grandmaster";
  if (level >= 20) return "🎖️ Master";
  if (level >= 10) return "⭐ Elite";
  return "🛡️ Warrior";
}

async function checkAndNotifyLevelUp(sock, m, db, user, oldExp, newExp) {
  const { createCanvas, loadImage, GlobalFonts } =
    await import("@napi-rs/canvas");
  /**
   * Fungsi untuk membuat gambar Level Up bertema Anime
   * @param {Object} data - Data user
   * @param {string} data.name - Nama user
   * @param {number} data.level - Level baru yang dicapai
   * @param {number} data.currentXp - XP saat ini
   * @param {number} data.requiredXp - Total XP yang dibutuhkan
   * @param {string} data.avatarUrl - URL foto profil user
   * @param {string} data.backgroundUrl - URL gambar background anime
   */
  async function generateLevelUpCard(data) {
    const width = 800;
    const height = 280;
    // يُرسم بإحداثياته نفسها لكن بمقاس 1280×448 (×1.6) ⇒ نصوص وحواف حادة فعلاً لا تكبير لاحق
    const SCALE = 1.6;
    const canvas = createCanvas(Math.round(width * SCALE), Math.round(height * SCALE));
    const ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(10, 10, width - 20, height - 20, 30);
    ctx.clip();
    try {
      const background = await loadImage(
        data.backgroundUrl || (fs.existsSync(BRAND_BACKGROUND) ? fs.readFileSync(BRAND_BACKGROUND) : ""),
      );
      const ratio = Math.max(
        width / background.width,
        height / background.height,
      );
      const x = (width - background.width * ratio) / 2;
      const y = (height - background.height * ratio) / 2;
      ctx.drawImage(
        background,
        x,
        y,
        background.width * ratio,
        background.height * ratio,
      );
    } catch (err) {
      ctx.fillStyle = "#111118";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, width - 20, height - 20);
    try {
      const avatar = await loadImage(data.avatarUrl).catch((error) => { noteFailure("level", error, {where: "src/lib/terboo-level.js:80",stage: "loadImage"}); return null; });
      if (avatar) {
        ctx.shadowColor = "#22d3ee";
        ctx.shadowBlur = 20;
        ctx.save();
        ctx.beginPath();
        ctx.arc(120, height / 2, 85, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatar, 35, height / 2 - 85, 170, 170);
        ctx.restore();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(120, height / 2, 85, 0, Math.PI * 2);
        ctx.stroke();
      }
    } catch (e) { noteFailure("level", e, {where: "src/lib/terboo-level.js:97",stage: "loadImage"}); }
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 5;
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 40px ${getFontStack(data.lang || "ar")}`;
    ctx.textAlign = "left"; // محاذاة ثابتة حتى مع RTL («start» في RTL = يمين)
    ctx.direction = dirOf(canvasText(data.lang, "levelUp"));
    ctx.fillText(canvasText(data.lang, "levelUp"), 230, 85);
    ctx.fillStyle = "#22d3ee";
    ctx.font = `italic 25px ${getFontStack(data.lang || "ar")}`;
    ctx.direction = dirOf(canvasText(data.lang, "congrats", data.name));
    ctx.fillText(canvasText(data.lang, "congrats", data.name), 230, 125);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = `italic bold 90px ${getFontStack(data.lang || "ar")}`;
    ctx.direction = "ltr";
    ctx.fillText(`${data.level}`, width - 50, 120);
    ctx.font = `bold 20px ${getFontStack(data.lang || "ar")}`;
    ctx.direction = dirOf(canvasText(data.lang, "level"));
    ctx.fillText(canvasText(data.lang, "level"), width - 55, 45);
    ctx.direction = "ltr";
    ctx.textAlign = "left";
    const barX = 230;
    const barY = 185;
    const barWidth = 520;
    const barHeight = 30;
    const progress = Math.min(data.currentXp / data.requiredXp, 1);
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, 15);
    ctx.fill();
    const barGrad = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    barGrad.addColorStop(0, "#7c5cff");
    barGrad.addColorStop(1, "#22d3ee");
    ctx.fillStyle = barGrad;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth * progress, barHeight, 15);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 16px ${getFontStack(data.lang || "ar")}`;
    const xpInfo = `${data.currentXp.toLocaleString()} / ${data.requiredXp.toLocaleString()} XP`;
    ctx.fillText(xpInfo, barX + 15, barY + 21);
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = `12px ${getFontStack(data.lang || "ar")}`;
    ctx.fillText(config.bot.name, 230, 245);
    return canvas.toBuffer("image/png");
  }
  const oldLevel = calculateLevel(oldExp);
  const newLevel = calculateLevel(newExp);

  if (newLevel > oldLevel) {
    user.rpg.level = newLevel;
    user.rpg.maxHealth = 100 + (newLevel - 1) * 10;
    user.rpg.maxMana = 100 + (newLevel - 1) * 5;
    user.rpg.maxStamina = 100 + (newLevel - 1) * 5;
    user.rpg.health = user.rpg.maxHealth;
    user.rpg.mana = user.rpg.maxMana;
    user.rpg.stamina = user.rpg.maxStamina;

    db.save();

    if (user.settings?.levelupNotif === false) {
      return { leveledUp: true, notified: false, oldLevel, newLevel };
    }

    const role = getRole(newLevel);
    const botName = config.bot?.name || "Bot Terboo";
    const saluranId = config.saluran?.id || "120363418715609508@newsletter";
    const saluranName = config.saluran?.name || botName;

    let ppBuffer = null;
    try {
      ppBuffer = await sock.profilePictureUrl(m.sender, "image");
    } catch (error) { noteFailure("level", error, {where: "src/lib/terboo-level.js:164",stage: "sock.profilePictureUrl"}); }

    const txt = `🎊 *SELAMAT @${m.sender.split("@")[0]}!*

Level kamu bertambah ${newLevel - oldLevel}
🥗 Level kamu sekarang *${newLevel}*

Sekarang kamu berada di rank *${role}*

Mau cek detail level? ketik _${m.prefix}level_

Sering seringlah berinteraksi dengan bot agar level kamu bertambah!`;

    const contextInfo = {
      mentionedJid: [m.sender],
      forwardingScore: 999,
      isForwarded: true,
    };

    const fakeQuoted = {
      key: {
        fromMe: false,
        participant: "0@s.whatsapp.net",
        remoteJid: "status@broadcast",
      },
      message: {
        contactMessage: {
          displayName: `✅ ${botName}`,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${botName}\nORG:Verified Bot\nEND:VCARD`,
        },
      },
    };
    await sock.sendMedia(
      m.chat,
      await generateLevelUpCard({
        name: m.pushName || String(m.sender || "").split("@")[0],
        lang: getUserLanguage(user),
        level: newLevel,
        currentXp: newExp,
        requiredXp: expForLevel(newLevel),
        avatarUrl:
          ppBuffer ||
          "https://ui-avatars.com/api/?name=K&background=00f2ff&color=fff&size=256",
      }),
      txt,
      m,
      {
        type: "image",
        contextInfo,
      },
    );

    return { leveledUp: true, notified: true, oldLevel, newLevel };
  }

  return { leveledUp: false, notified: false, oldLevel, newLevel: oldLevel };
}

async function addExpWithLevelCheck(sock, m, db, user, expAmount) {
  if (!user)
    return { leveledUp: false, notified: false, oldLevel: 1, newLevel: 1 };
  if (!user.rpg) user.rpg = {};

  const oldExp = user.exp || 0;
  const newExp = db.updateExp(m.sender, expAmount);
  user.exp = newExp;

  const result = await checkAndNotifyLevelUp(sock, m, db, user, oldExp, newExp);

  db.setUser(m.sender, { rpg: user.rpg });

  return result;
}

export {
  calculateLevel,
  expForLevel,
  getRole,
  checkAndNotifyLevelUp,
  addExpWithLevelCheck,
};
