let _canvas = null;
async function _getCanvas() {
  await registerFonts().catch((error) => { noteFailure("welcome-card", error, {where: "src/lib/terboo-welcome-card.js:3",stage: "registerFonts"}); }); // خطوط عربية/لاتينية قبل الرسم
  if (!_canvas) _canvas = await import("@napi-rs/canvas");
  return _canvas;
}
import { noteFailure } from "./terboo-failure-log.js";
import fs from "fs";
import path from "path";
import axios from "axios";
import { getFontStack, registerFonts } from "../../src/lib/terboo-fonts.js";
import { canvasText } from "./terboo-canvas-i18n.js";
const DEFAULT_AVATAR = "https://i.imgur.com/TuItj4L.png";

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

async function loadAvatarSafe(avatarUrl) {
  const { loadImage } = await _getCanvas();
  // الصورة الافتراضية المحلية (assets/image — المسار القديم assets/images احتياطاً)
  const localFallback = [
    path.join(process.cwd(), "assets", "image", "pp-kosong.jpg"),
    path.join(process.cwd(), "assets", "images", "pp-kosong.jpg"),
  ].find((file) => fs.existsSync(file)) || path.join(process.cwd(), "assets", "image", "pp-kosong.jpg");

  try {
    if (!avatarUrl) {
      if (fs.existsSync(localFallback)) {
        const buffer = fs.readFileSync(localFallback);
        return await loadImage(buffer);
      }
      return await loadImage(DEFAULT_AVATAR);
    }

    if (
      avatarUrl === localFallback ||
      (typeof avatarUrl === "string" && avatarUrl.includes("pp-kosong"))
    ) {
      if (fs.existsSync(localFallback)) {
        const buffer = fs.readFileSync(localFallback);
        return await loadImage(buffer);
      }
    }

    if (avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://")) {
      const response = await axios.get(avatarUrl, {
        responseType: "arraybuffer",
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      return await loadImage(Buffer.from(response.data));
    }

    if (fs.existsSync(avatarUrl)) {
      const buffer = fs.readFileSync(avatarUrl);
      return await loadImage(buffer);
    }

    if (fs.existsSync(localFallback)) {
      const buffer = fs.readFileSync(localFallback);
      return await loadImage(buffer);
    }

    return await loadImage(DEFAULT_AVATAR);
  } catch (err) {
    try {
      if (fs.existsSync(localFallback)) {
        const buffer = fs.readFileSync(localFallback);
        return await loadImage(buffer);
      }
      return await loadImage(DEFAULT_AVATAR);
    } catch (error) { noteFailure("welcome-card", error, {where: "src/lib/terboo-welcome-card.js:82",stage: "fs.existsSync"}); return null; }
  }
}

function drawHexagonPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const xPos = x + r * Math.cos(angle);
    const yPos = y + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(xPos, yPos);
    else ctx.lineTo(xPos, yPos);
  }
  ctx.closePath();
}

async function createWideDiscordCard(
  username,
  avatarUrl,
  groupName,
  memberCount,
  lang = "ar",
) {
  const { createCanvas } = await _getCanvas();
  const width = 1024;
  const height = 450;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#08080d";
  ctx.fillRect(0, 0, width, height);
  const bgGlow = ctx.createRadialGradient(width, height, 0, width, height, 600);
  bgGlow.addColorStop(0, "rgba(48, 43, 99, 0.6)");
  bgGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bgGlow;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x <= width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  const cardX = 50;
  const cardY = 50;
  const cardW = width - 100;
  const cardH = height - 100;
  ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 30);
  ctx.fill();
  ctx.stroke();
  const avatarSize = 180;
  const centerX = 200;
  const centerY = height / 2;
  ctx.save();
  ctx.shadowColor = "#7c5cff";
  ctx.shadowBlur = 40;
  ctx.beginPath();
  ctx.arc(centerX, centerY, avatarSize / 2 - 10, 0, Math.PI * 2);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
  ctx.save();
  drawHexagonPath(ctx, centerX, centerY, avatarSize / 2);
  ctx.clip();

  try {
    const avatar = await loadAvatarSafe(avatarUrl);
    if (avatar)
      ctx.drawImage(
        avatar,
        centerX - avatarSize / 2,
        centerY - avatarSize / 2,
        avatarSize,
        avatarSize,
      );
  } catch (e) {
    ctx.fillStyle = "#333";
    ctx.fillRect(
      centerX - avatarSize / 2,
      centerY - avatarSize / 2,
      avatarSize,
      avatarSize,
    );
  }
  ctx.restore();
  ctx.strokeStyle = "#7c5cff";
  ctx.lineWidth = 5;
  drawHexagonPath(ctx, centerX, centerY, avatarSize / 2 + 5);
  ctx.stroke();
  const textX = 350;
  const badge = canvasText(lang, "newUser");
  ctx.font = `bold 18px ${getFontStack(lang)}`;
  ctx.fillStyle = "rgba(0, 210, 255, 0.15)";
  ctx.beginPath();
  ctx.roundRect(textX, 120, Math.max(140, ctx.measureText(badge).width + 30), 36, 18);
  ctx.fill();

  ctx.fillStyle = "#7c5cff";
  ctx.fillText(badge, textX + 15, 144);
  ctx.font = `900 60px ${getFontStack(lang)}`;
  const nameMetric = ctx.measureText(username);

  // Bikin gradient khusus untuk teks
  const gradient = ctx.createLinearGradient(
    textX,
    0,
    textX + nameMetric.width,
    0,
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(1, "#c084fc");

  ctx.fillStyle = gradient;
  ctx.fillText(username, textX, 220);
  ctx.fillStyle = "#a0a0a0";
  ctx.font = `24px ${getFontStack(lang)}`;
  ctx.fillText(canvasText(lang, "joined", groupName), textX, 260);

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 20px ${getFontStack(lang)}`;
  ctx.fillText(canvasText(lang, "members", memberCount), textX, 320);
  ctx.beginPath();
  ctx.moveTo(width - 250, 350);
  ctx.lineTo(width - 50, 350);
  ctx.lineTo(width - 50, 340);
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 2;
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

async function createGoodbyeCard(username, avatarUrl, groupName, memberCount, lang = "ar") {
  const { createCanvas } = await _getCanvas();
  const width = 1024;
  const height = 450;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0d080b";
  ctx.fillRect(0, 0, width, height);

  const bgGlow = ctx.createRadialGradient(width, 0, 0, width, 0, 600);
  bgGlow.addColorStop(0, "rgba(180, 0, 0, 0.4)");
  bgGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bgGlow;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255, 50, 50, 0.08)";
  ctx.lineWidth = 1;
  const gridSize = 40;

  for (let x = 0; x <= width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const cardX = 50;
  const cardY = 50;
  const cardW = width - 100;
  const cardH = height - 100;

  ctx.fillStyle = "rgba(50, 0, 0, 0.3)";
  ctx.strokeStyle = "rgba(255, 0, 0, 0.3)";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 30);
  ctx.fill();
  ctx.stroke();

  const avatarSize = 180;
  const centerX = 200;
  const centerY = height / 2;

  ctx.save();
  ctx.shadowColor = "#ff5f6d";
  ctx.shadowBlur = 50;
  drawHexagonPath(ctx, centerX, centerY, avatarSize / 2 - 5);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawHexagonPath(ctx, centerX, centerY, avatarSize / 2);
  ctx.clip();

  try {
    const avatar = await loadAvatarSafe(avatarUrl);
    if (avatar)
      ctx.drawImage(
        avatar,
        centerX - avatarSize / 2,
        centerY - avatarSize / 2,
        avatarSize,
        avatarSize,
      );
  } catch (e) {
    ctx.fillStyle = "#300";
    ctx.fillRect(
      centerX - avatarSize / 2,
      centerY - avatarSize / 2,
      avatarSize,
      avatarSize,
    );
  }
  ctx.restore();

  ctx.strokeStyle = "#ff5f6d";
  ctx.lineWidth = 5;
  drawHexagonPath(ctx, centerX, centerY, avatarSize / 2 + 5);
  ctx.stroke();

  const textX = 350;

  const badge = canvasText(lang, "disconnected");
  ctx.font = `bold 18px ${getFontStack(lang)}`;
  ctx.fillStyle = "rgba(255, 0, 50, 0.15)";
  ctx.beginPath();
  ctx.roundRect(textX, 120, Math.max(160, ctx.measureText(badge).width + 30), 36, 18);
  ctx.fill();

  ctx.fillStyle = "#ff5f6d";
  ctx.fillText(badge, textX + 15, 144);

  ctx.font = `900 60px ${getFontStack(lang)}`;
  const nameMetric = ctx.measureText(username);

  const gradient = ctx.createLinearGradient(
    textX,
    0,
    textX + nameMetric.width,
    0,
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(1, "#ffb36b");

  ctx.fillStyle = gradient;
  ctx.fillText(username, textX, 220);

  ctx.fillStyle = "#c0a0a0";
  ctx.font = `24px ${getFontStack(lang)}`;
  ctx.fillText(canvasText(lang, "left", groupName), textX, 260);

  ctx.fillStyle = "#ffcccc";
  ctx.font = `bold 20px ${getFontStack(lang)}`;
  ctx.fillText(canvasText(lang, "remaining", memberCount), textX, 320);

  ctx.beginPath();
  ctx.moveTo(width - 250, 350);
  ctx.lineTo(width - 50, 350);
  ctx.lineTo(width - 50, 340);
  ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

async function createWelcomeCardV4(
  username,
  avatarUrl,
  groupName,
  memberCount,
  lang = "ar",
) {
  const { createCanvas } = await _getCanvas();
  const width = 1024;
  const height = 450;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background - Modern Dark Blue/Purple gradient
  const bgGradient = ctx.createLinearGradient(0, 0, width, height);
  bgGradient.addColorStop(0, "#08080d");
  bgGradient.addColorStop(0.5, "#131226");
  bgGradient.addColorStop(1, "#1d1838");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // Decorative circles
  ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
  ctx.beginPath();
  ctx.arc(width, 0, 300, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, height, 200, 0, Math.PI * 2);
  ctx.fill();

  // Glassmorphism Card
  ctx.save();
  const cardX = 50,
    cardY = 50,
    cardW = width - 100,
    cardH = height - 100;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 30);
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Avatar
  const avatarSize = 180;
  const avatarX = 150;
  const avatarY = height / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  try {
    const avatar = await loadAvatarSafe(avatarUrl);
    if (avatar)
      ctx.drawImage(
        avatar,
        avatarX - avatarSize / 2,
        avatarY - avatarSize / 2,
        avatarSize,
        avatarSize,
      );
  } catch {
    ctx.fillStyle = "#ccc";
    ctx.fillRect(
      avatarX - avatarSize / 2,
      avatarY - avatarSize / 2,
      avatarSize,
      avatarSize,
    );
  }
  ctx.restore();

  // Avatar Border
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2);
  ctx.strokeStyle = "#7c5cff";
  ctx.lineWidth = 5;
  ctx.stroke();

  // Text Info
  const textStart = 300;

  // Welcome Label
  ctx.font = `bold 30px ${getFontStack(lang)}`;
  ctx.fillStyle = "#7c5cff";
  ctx.fillText(canvasText(lang, "welcome"), textStart, 160);

  // Username
  ctx.font = `bold 60px ${getFontStack(lang)}`;
  ctx.fillStyle = "#ffffff";
  const cleanUsername =
    username.length > 15 ? username.substring(0, 15) + "..." : username;
  ctx.fillText(cleanUsername, textStart, 230);

  // Group Name
  ctx.font = `30px ${getFontStack(lang)}`;
  ctx.fillStyle = "#a0a0a0";
  ctx.fillText(canvasText(lang, "toGroup", groupName), textStart, 280);

  // Member Count Tag
  const tagY = 320;
  const tagText = canvasText(lang, "memberTag", memberCount);
  ctx.font = `bold 24px ${getFontStack(lang)}`;
  const tagWidth = ctx.measureText(tagText).width + 40;

  drawRoundedRect(ctx, textStart, tagY, tagWidth, 40, 20);
  ctx.fillStyle = "rgba(0, 210, 255, 0.15)";
  ctx.fill();
  ctx.strokeStyle = "#7c5cff";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#7c5cff";
  ctx.fillText(tagText, textStart + 20, tagY + 28);

  return canvas.toBuffer("image/png");
}

async function createGoodbyeCardV4(
  username,
  avatarUrl,
  groupName,
  memberCount,
  lang = "ar",
) {
  const { createCanvas } = await _getCanvas();
  const width = 1024;
  const height = 450;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background - Dark Red/Black gradient
  const bgGradient = ctx.createLinearGradient(0, 0, width, height);
  bgGradient.addColorStop(0, "#0d080b");
  bgGradient.addColorStop(0.5, "#24121a");
  bgGradient.addColorStop(1, "#140a10");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // Decorative circles
  ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
  ctx.beginPath();
  ctx.arc(width, 0, 300, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, height, 200, 0, Math.PI * 2);
  ctx.fill();

  // Glassmorphism Card
  ctx.save();
  const cardX = 50,
    cardY = 50,
    cardW = width - 100,
    cardH = height - 100;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 30);
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 50, 50, 0.1)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Avatar
  const avatarSize = 180;
  const avatarX = 150;
  const avatarY = height / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  try {
    const avatar = await loadAvatarSafe(avatarUrl);
    if (avatar)
      ctx.drawImage(
        avatar,
        avatarX - avatarSize / 2,
        avatarY - avatarSize / 2,
        avatarSize,
        avatarSize,
      );
  } catch {
    ctx.fillStyle = "#ccc";
    ctx.fillRect(
      avatarX - avatarSize / 2,
      avatarY - avatarSize / 2,
      avatarSize,
      avatarSize,
    );
  }
  ctx.restore();

  // Avatar Border
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2);
  ctx.strokeStyle = "#ff5f6d";
  ctx.lineWidth = 5;
  ctx.stroke();

  // Text Info
  const textStart = 300;

  // Goodbye Label
  ctx.font = `bold 30px ${getFontStack(lang)}`;
  ctx.fillStyle = "#ff5f6d";
  ctx.fillText(canvasText(lang, "goodbye"), textStart, 160);

  // Username
  ctx.font = `bold 60px ${getFontStack(lang)}`;
  ctx.fillStyle = "#ffffff";
  const cleanUsername =
    username.length > 15 ? username.substring(0, 15) + "..." : username;
  ctx.fillText(cleanUsername, textStart, 230);
  ctx.font = `30px ${getFontStack(lang)}`;
  ctx.fillStyle = "#a0a0a0";
  ctx.fillText(canvasText(lang, "fromGroup", groupName), textStart, 280);
  const tagY = 320;
  const tagText = canvasText(lang, "remainingTag", memberCount);
  ctx.font = `bold 24px ${getFontStack(lang)}`;
  const tagWidth = ctx.measureText(tagText).width + 40;

  drawRoundedRect(ctx, textStart, tagY, tagWidth, 40, 20);
  ctx.fillStyle = "rgba(255, 50, 50, 0.15)";
  ctx.fill();
  ctx.strokeStyle = "#ff5f6d";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#ff5f6d";
  ctx.fillText(tagText, textStart + 20, tagY + 28);

  return canvas.toBuffer("image/png");
}

// ═══════════════════════════════════════════════
// 🪪 بطاقة العضو (الترحيب/الوداع) — لوحة الهوية + طبقات حيّة وقت الإرسال
// ───────────────────────────────────────────────
// اللوحة (assets/image/cards/*-plate.jpg) مولّدة بحزمة الهوية: الشخصية · «TERBOO» · الشعار · إطار الصورة.
// فوقها يُرسم: صورة العضو في الإطار · اسمه الفعلي (دليل المجموعة ← المسجّل ← جهات الاتصال ← رقمه منسّقاً)
// · المجموعة · رقم العضو/المتبقون · التاريخ — بلغة المجموعة. الاسم يُطبَّع (NFKC) وتُزال منه الرموز التعبيرية
// والحروف التي لا يدعمها خط البوت فلا تظهر مربعات.
// ═══════════════════════════════════════════════

const PLATES = { welcome: path.join("assets", "image", "cards", "welcome-plate.jpg"), goodbye: path.join("assets", "image", "cards", "goodbye-plate.jpg") };
const CARD_COLORS = { welcome: ["#8b5cf6", "#22d3ee"], goodbye: ["#f43f5e", "#a855f7"] };
const plateCache = new Map();
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** اسم صالح للرسم: NFKC (حروف الزخرفة ⇒ عادية) · بلا رموز تعبيرية · فقط حروف يدعمها خط البوت */
function cleanDisplayName(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .replace(/[\p{Extended_Pictographic}\u200d\ufe0e\ufe0f\u20e3]/gu, "")
    .replace(/[^\p{Script=Latin}\p{Script=Arabic}\p{Script=Greek}\p{Script=Cyrillic}\p{Nd}\s'’.\-_&()|~+]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/** رقم دولي منسّق للعرض: 201016948771 ⇒ +20 101 694 8771 */
function formatPhone(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length < 8) return "";
  return d.length > 10 ? `+${d.slice(0, d.length - 10)} ${d.slice(-10, -7)} ${d.slice(-7, -4)} ${d.slice(-4)}` : `+${d}`;
}

/**
 * أفضل اسم معروف لعضو (بلا تخمين): دليل المجموعة (اسم واتساب · pushName رآه البوت · جهات الاتصال · المسجّل)
 * ثم قاعدة Terboo ثم رقمه منسّقاً؛ وإن لم يُعرف رقمه (LID) ⇒ null ليكتب المتصل «عضو جديد» بلغته.
 * @returns {Promise<{name:string|null, source:string}>}
 */
async function resolveMemberName(sock, groupJid, jid) {
  const good = (value) => {
    const name = cleanDisplayName(value);
    return name.length >= 2 && !/^[+\d\s-]+$/.test(name) ? name : "";
  };
  let identity = null;
  try {
    const { identityOf } = await import("./terboo-identity.js");
    identity = identityOf(String(jid || ""));
    const { getDirectory, memberByJid, namesOf } = await import("./terboo-group-directory.js");
    const g = await getDirectory(sock, groupJid).catch((error) => {
      noteFailure("welcome-card", error, { where: "terboo-welcome-card:resolveMemberName", stage: "getDirectory", fallback: "database" });
      return null;
    });
    let member = g ? memberByJid(g, jid) : null;
    if (!member && g?.departed) {
      member = [...g.departed.values()].find((x) => x.canonical === identity.canonical || (identity.pn && x.pn === identity.pn) || (identity.lid && x.lid === identity.lid)) || null;
    }
    const fromDirectory = member ? namesOf(member).map(good).find(Boolean) : "";
    if (fromDirectory) return { name: fromDirectory, source: "directory" };
  } catch (error) {
    noteFailure("welcome-card", error, { where: "terboo-welcome-card:resolveMemberName", stage: "directory", fallback: "database" });
  }
  try {
    const { getDatabase } = await import("./terboo-database.js");
    const user = getDatabase()?.getUser?.(identity?.pn || jid) || {};
    const fromDb = good(user.regName) || (/^(unknown|user|~ user)$/i.test(String(user.name || "")) ? "" : good(user.name));
    if (fromDb) return { name: fromDb, source: "database" };
  } catch (error) {
    noteFailure("welcome-card", error, { where: "terboo-welcome-card:resolveMemberName", stage: "database", fallback: "number" });
  }
  const digits = String(identity?.pn || (String(jid || "").endsWith("@s.whatsapp.net") ? jid : "")).split("@")[0];
  const phone = formatPhone(digits);
  return phone ? { name: phone, source: "number" } : { name: null, source: "unknown" };
}

async function plateOf(kind) {
  const { loadImage } = await _getCanvas();
  const file = path.join(process.cwd(), PLATES[kind] || PLATES.welcome);
  const stamp = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
  const cached = plateCache.get(kind);
  if (cached && cached.stamp === stamp) return cached.image;
  const image = stamp ? await loadImage(fs.readFileSync(file)) : null;
  plateCache.set(kind, { stamp, image });
  return image;
}

/** خط مناسب لنص (عربي ⇒ خط عربي) */
function fontFor(value, weight, size) {
  return getFontStack(ARABIC.test(value) ? "ar" : "en", weight, size);
}

/** أكبر مقاس يجعل النص في العرض المتاح؛ وإلا يُقصّ بنقاط */
function fitText(ctx, value, { weight, max, min, width }) {
  let size = max;
  ctx.font = fontFor(value, weight, size);
  while (size > min && ctx.measureText(value).width > width) {
    size -= 2;
    ctx.font = fontFor(value, weight, size);
  }
  let out = value;
  while (out.length > 1 && ctx.measureText(out).width > width) out = out.slice(0, -1);
  if (out !== value) out = `${out.trimEnd().slice(0, -1)}…`;
  return { text: out, size };
}

function drawText(ctx, value, x, y, { font, fill, alpha = 1, spacing = 0 }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.direction = ARABIC.test(value) ? "rtl" : "ltr";
  if (spacing && "letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
  if (ctx.direction === "rtl") {
    // محاذاة يسار ثابتة مع اتجاه عربي صحيح
    ctx.textAlign = "right";
    ctx.fillText(value, x + ctx.measureText(value).width, y);
  } else {
    ctx.fillText(value, x, y);
  }
  ctx.restore();
}

/** شريحة زجاجية برمز مرسوم (لا خطوط رموز تعبيرية على الخادم) */
function drawPill(ctx, x, y, label, icon, colors) {
  const h = 48;
  ctx.save();
  ctx.font = fontFor(label, 600, 19);
  ctx.direction = ARABIC.test(label) ? "rtl" : "ltr";
  const w = ctx.measureText(label).width + 88;
  ctx.restore();
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const cx = x + 28;
  const cy = y + h / 2;
  ctx.strokeStyle = colors[1];
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (icon === "users") {
    ctx.arc(cx - 3, cy - 5, 5, 0, Math.PI * 2);
    ctx.moveTo(cx - 12, cy + 10);
    ctx.quadraticCurveTo(cx - 3, cy - 2, cx + 6, cy + 10);
    ctx.moveTo(cx + 6, cy - 9);
    ctx.arc(cx + 6, cy - 4, 4, -Math.PI / 2, Math.PI / 2);
  } else {
    drawRoundedRect(ctx, cx - 10, cy - 9, 20, 19, 4);
    ctx.moveTo(cx - 10, cy - 3);
    ctx.lineTo(cx + 10, cy - 3);
    ctx.moveTo(cx - 5, cy - 13);
    ctx.lineTo(cx - 5, cy - 7);
    ctx.moveTo(cx + 5, cy - 13);
    ctx.lineTo(cx + 5, cy - 7);
  }
  ctx.stroke();
  ctx.restore();
  drawText(ctx, label, x + 50, y + 31, { font: fontFor(label, 600, 19), fill: "#ffffff", alpha: 0.9 });
  return w;
}

/**
 * يرسم بطاقة الترحيب/الوداع.
 * @param {{kind:"welcome"|"goodbye", name?:string|null, avatar?:string|Buffer, groupName?:string,
 *          memberCount?:number|string, lang?:string, timezone?:string, date?:Date}} input
 * @returns {Promise<Buffer>} JPEG 1280×720
 */
async function createMemberCard({ kind = "welcome", name = null, avatar = "", groupName = "", memberCount = 0, lang = "ar", timezone = "", date = new Date() } = {}) {
  const { createCanvas, loadImage } = await _getCanvas();
  const { MEMBER_CARD } = await import("./terboo-member-card-layout.js");
  const { width, height, avatar: A, text: T } = MEMBER_CARD;
  const colors = CARD_COLORS[kind] || CARD_COLORS.welcome;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const plate = await plateOf(kind);
  if (plate) ctx.drawImage(plate, 0, 0, width, height);
  else {
    ctx.fillStyle = "#050508";
    ctx.fillRect(0, 0, width, height);
  }

  // ── الصورة داخل الإطار (قص دائري · ملء بلا تشويه) ──
  const face = Buffer.isBuffer(avatar)
    ? await loadImage(avatar).catch((error) => {
      noteFailure("welcome-card", error, { where: "terboo-welcome-card:createMemberCard", stage: "avatar", fallback: "empty-frame" });
      return null;
    })
    : await loadAvatarSafe(avatar);
  ctx.save();
  ctx.shadowColor = colors[0];
  ctx.shadowBlur = 40;
  ctx.beginPath();
  ctx.arc(A.cx, A.cy, A.r, 0, Math.PI * 2);
  ctx.fillStyle = "#0d0d14";
  ctx.fill();
  ctx.restore();
  if (face) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(A.cx, A.cy, A.r, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max((A.r * 2) / face.width, (A.r * 2) / face.height);
    const fw = face.width * scale;
    const fh = face.height * scale;
    ctx.drawImage(face, A.cx - fw / 2, A.cy - fh / 2, fw, fh);
    if (kind === "goodbye") {
      ctx.fillStyle = "rgba(20,4,12,0.32)";
      ctx.fillRect(A.cx - A.r, A.cy - A.r, A.r * 2, A.r * 2);
    }
    ctx.restore();
  }
  const ring = ctx.createLinearGradient(A.cx - A.r, A.cy - A.r, A.cx + A.r, A.cy + A.r);
  ring.addColorStop(0, colors[0]);
  ring.addColorStop(1, colors[1]);
  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeStyle = ring;
  ctx.beginPath();
  ctx.arc(A.cx, A.cy, A.r + 3, 0, Math.PI * 2);
  ctx.stroke();
  // شارة الحالة: + للانضمام · سهم للمغادرة
  const bx = A.cx + A.r * 0.72;
  const by = A.cy + A.r * 0.72;
  ctx.beginPath();
  ctx.arc(bx, by, 25, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#050508";
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (kind === "goodbye") {
    ctx.moveTo(bx - 9, by);
    ctx.lineTo(bx + 9, by);
    ctx.moveTo(bx + 3, by - 7);
    ctx.lineTo(bx + 10, by);
    ctx.lineTo(bx + 3, by + 7);
  } else {
    ctx.moveTo(bx - 9, by);
    ctx.lineTo(bx + 9, by);
    ctx.moveTo(bx, by - 9);
    ctx.lineTo(bx, by + 9);
  }
  ctx.stroke();
  ctx.restore();

  // ── النصوص ──
  const textGrad = ctx.createLinearGradient(T.x, 0, T.x + 260, 0);
  textGrad.addColorStop(0, colors[0]);
  textGrad.addColorStop(1, colors[1]);
  const over = canvasText(lang, kind === "goodbye" ? "memberLeft" : "memberJoined");
  drawText(ctx, ARABIC.test(over) ? over : over.toUpperCase(), T.x, 232, { font: fontFor(over, 700, 18), fill: textGrad, spacing: ARABIC.test(over) ? 0 : 3.4 });
  const hello = canvasText(lang, kind === "goodbye" ? "farewell" : "hello");
  drawText(ctx, hello, T.x, 282, { font: fontFor(hello, 600, 32), fill: "#ffffff", alpha: 0.82 });
  const shown = cleanDisplayName(name) || canvasText(lang, "newcomer");
  const fitted = fitText(ctx, shown, { weight: 800, max: 70, min: 34, width: T.maxWidth });
  ctx.save();
  ctx.shadowColor = colors[0];
  ctx.shadowBlur = 24;
  drawText(ctx, fitted.text, T.x, 282 + 18 + fitted.size, { font: fontFor(fitted.text, 800, fitted.size), fill: "#ffffff" });
  ctx.restore();
  let y = 282 + 18 + fitted.size;
  const group = cleanDisplayName(groupName) || groupName || "";
  if (group) {
    const line = canvasText(lang, kind === "goodbye" ? "fromGroup" : "toGroup", group);
    const g = fitText(ctx, line, { weight: 500, max: 25, min: 18, width: T.maxWidth });
    y += 44;
    drawText(ctx, g.text, T.x, y, { font: fontFor(g.text, 500, g.size), fill: "#ffffff", alpha: 0.72 });
  }
  y += 26;
  const bar = ctx.createLinearGradient(T.x, 0, T.x + 72, 0);
  bar.addColorStop(0, colors[0]);
  bar.addColorStop(1, colors[1]);
  ctx.fillStyle = bar;
  drawRoundedRect(ctx, T.x + 2, y, 72, 4, 2);
  ctx.fill();
  y += 26;
  const count = String(memberCount ?? "").trim();
  let px = T.x;
  if (count) px += drawPill(ctx, px, y, canvasText(lang, kind === "goodbye" ? "remainingTag" : "memberTag", count), "users", colors) + 12;
  let day = "";
  try {
    // أرقام لاتينية في كل اللغات (قياس الشريحة دقيق ومتّسق مع باقي الهوية)
    day = date.toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "short", year: "numeric", ...(timezone ? { timeZone: timezone } : {}) });
  } catch {
    day = date.toISOString().slice(0, 10);
  }
  drawPill(ctx, px, y, day, "calendar", colors);

  return canvas.encode("jpeg", 90);
}

export {
  cleanDisplayName,
  createGoodbyeCard,
  createGoodbyeCardV4,
  createMemberCard,
  createWelcomeCardV4,
  createWideDiscordCard,
  formatPhone,
  resolveMemberName,
};
