#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🥷 Terboo Brand Pack — «Neon Shinobi / Cyber Sentinel» (كل النصوص بالإنجليزية)
// ───────────────────────────────────────────────
// حملة صور واحدة لكل البوت بشخصية ثابتة: نينجا سايبر أصلي (شعر أسود مدبّب · قناع أسود ·
// عينان بنفسجيتان متوهّجتان · درع تكتيكي أسود · كاتانتان متقاطعتان) في عالم أوبسيديان بنفسجي/سماوي.
//
//   • الفن: مشاهد Canva AI مربعة بلا نصوص، مولّدة بالشخصية الرئيسية (master) مرجعاً، مكبّرة ×4
//     بـ Real-ESRGAN إلى 2160 (tools/brand-art/shinobi/<key>.jpg) ومعها قناع الشخصية (<key>-mask.png).
//     القسم الذي لم يُولَّد مشهده بعد يأخذ أقرب مشهد للونه بقلب/تقريب مختلف.
//   • الطبقات: المشهد ← اسم «TERBOO» الكبير (Anton) ← الشخصية مقصوصة بقناعها ← النصوص؛
//     موضع الاسم يُحسب من القناع فلا يختفي حرف خلف الرأس.
//   • الطباعة والشعار بالكود (دقة إملائية تامة): سطر علوي · عنوان · سطر وصف · تذييل
//     «BOT TERBOO • AI ASSISTANT»، وشعار T زاوي مندمج بفقاعة محادثة وقطع كاتانا.
//   • الدقة 720–1080 (خفيفة وواضحة): الأفقية 1280×720 · المربعة 1080 · الطولية ضلعها الأطول 1280، وما يُضمَّن مصغّرةً
//     داخل الرسائل يبقى بمقاسه؛ وكل صورة تُرسم بضعف مقاسها ثم تُصغَّر وتُوضَّح.
//
//   node tools/terboo-brand-assets.mjs              ← يولّد الصور + البيان
//   node tools/terboo-brand-assets.mjs --manifest   ← البيان فقط
//   node tools/terboo-brand-assets.mjs --out <dir>  ← معاينة في مجلد آخر (لا يمس assets)
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const fonts = await import(path.join(ROOT, "src/lib/terboo-fonts.js"));
(fonts.ensureSvgFontConfig || fonts.default?.ensureSvgFontConfig)?.();
const sharp = (await import("sharp")).default;
const A = await import(path.join(ROOT, "tools/terboo-brand-art.mjs"));
const { MEMBER_CARD } = await import(path.join(ROOT, "src/lib/terboo-member-card-layout.js"));
const { C, FONT } = A;

// ── قياس النص الحقيقي بـ Canvas ──
const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");
const FONT_DIR = path.join(ROOT, "assets/fonts/terboo");
GlobalFonts.registerFromPath(path.join(FONT_DIR, "PlusJakartaSans-ExtraBold.ttf"), FONT.display);
for (const w of ["Medium", "SemiBold", "Bold"]) GlobalFonts.registerFromPath(path.join(FONT_DIR, `PlusJakartaSans-${w}.ttf`), FONT.heading);
for (const w of ["Medium", "SemiBold", "Bold"]) GlobalFonts.registerFromPath(path.join(FONT_DIR, `Inter-${w}.ttf`), FONT.body);
const probe = createCanvas(10, 10).getContext("2d");
A.setMeasurer((value, { size, family, weight = 500 }) => {
  probe.font = `${weight} ${size}px "${family}"`;
  return probe.measureText(String(value)).width;
});

// ── فن Canva (مشاهد الشخصية) ──
// كل مشهد 2160×2160: مولّد في Canva (1080) ومكبّر ×4 بـ Real-ESRGAN (anime 6B) ثم مصغّر ناعماً،
// ومعه قناع الشخصية <key>-mask.png (BiRefNet) لرسم الاسم الكبير خلفها.
const ART_DIR = path.join(ROOT, "tools/brand-art/shinobi");
const sceneExists = (key) => Boolean(key) && fs.existsSync(path.join(ART_DIR, `${key}.jpg`));
const hashOf = (value) => parseInt(crypto.createHash("md5").update(String(value)).digest("hex").slice(0, 8), 16);
/** مشاهد قريبة من لون الصورة حين لم يُولَّد مشهدها الخاص بعد */
const THEME_SCENES = { blue: ["group", "main"], teal: ["group", "ai"], gold: ["owner", "main"], green: ["ai", "master"], crimson: ["master", "main"], magenta: ["main", "master"], violet: ["main", "master", "ai"], indigo: ["ai", "master"] };
/** المشهد الفعلي: الخاص بالصورة إن وُجد، وإلا مشهد من لونها بقلب/تقريب يختلف من صورة لأخرى */
function resolveScene(spec) {
  if (sceneExists(spec.art)) return { key: spec.art, flip: false, zoom: 1 };
  const pool = (THEME_SCENES[spec.theme] || THEME_SCENES.violet).filter(sceneExists);
  const h = hashOf(spec.file);
  return { key: pool.length ? pool[h % pool.length] : "master", flip: Boolean(h & 16), zoom: h & 32 ? 1.14 : 1 };
}

const hrefCache = new Map();
function fileHref(file, mime) {
  if (!hrefCache.has(file)) hrefCache.set(file, fs.existsSync(file) ? `data:${mime};base64,${fs.readFileSync(file).toString("base64")}` : null);
  return hrefCache.get(file);
}
const artHref = (key) => fileHref(path.join(ART_DIR, `${key}.jpg`), "image/jpeg");
const maskHref = (key) => fileHref(path.join(ART_DIR, `${key}-mask.png`), "image/png");

/** شبكة القناع (N×N، 0..1) لحساب ما تغطيه الشخصية من حروف الاسم */
const GRID = 192;
const gridCache = new Map();
async function maskGrid(key) {
  if (!gridCache.has(key)) {
    const file = path.join(ART_DIR, `${key}-mask.png`);
    gridCache.set(key, fs.existsSync(file) ? await sharp(file).extractChannel(0).resize(GRID, GRID, { fit: "fill" }).raw().toBuffer() : null);
  }
  return gridCache.get(key);
}

/** موضع المشهد: مربع (x,y,size) مع تقريب حول الرأس وقلب أفقي */
function place(scene, x, y, size) {
  const D = size * scene.zoom;
  return { ...scene, x, y, size, D, x0: x + (size - D) * 0.5, y0: y + (size - D) * 0.3 };
}
const sceneTransform = (P) => (P.flip ? `translate(${A.r1(P.x0 + P.D)} ${A.r1(P.y0)}) scale(-1 1)` : `translate(${A.r1(P.x0)} ${A.r1(P.y0)})`);
const FADES = {
  left: ['x1="0" y1="0" x2="1" y2="0"', 0, 0.32],
  bottom: ['x1="0" y1="1" x2="0" y2="0"', 0, 0.4],
  top: ['x1="0" y1="0" x2="0" y2="1"', 0, 0.16],
};
/** قناع تلاشٍ لحواف المشهد؛ عدة اتجاهات تتضاعف (مثل يسار + أعلى) */
function fadeDefs(P, id, fade) {
  const list = (Array.isArray(fade) ? fade : [fade]).filter((f) => FADES[f]);
  if (!list.length) return "";
  const box = `x="${A.r1(P.x)}" y="${A.r1(P.y)}" width="${A.r1(P.size)}" height="${A.r1(P.size)}"`;
  let defs = "";
  list.forEach((f, i) => {
    const [dir, from, to] = FADES[f];
    defs += `<linearGradient id="${id}-g${i}" ${dir}><stop offset="${from}" stop-color="#fff" stop-opacity="0"/><stop offset="${to}" stop-color="#fff" stop-opacity="1"/></linearGradient>`;
    const inner = i > 0 ? ` mask="url(#${id}-m${i - 1})"` : "";
    defs += `<mask id="${i === list.length - 1 ? id : `${id}-m${i}`}" maskUnits="userSpaceOnUse" ${box}><g${inner}><rect ${box} fill="url(#${id}-g${i})"/></g></mask>`;
  });
  return `<defs>${defs}</defs>`;
}
const hasFade = (fade) => (Array.isArray(fade) ? fade.length > 0 : fade && fade !== "none");
/** طبقة المشهد الكاملة (الخلفية + الشخصية) */
function artLayer(P, uid, { fade = "none", opacity = 1 } = {}) {
  const href = artHref(P.key);
  if (!href) return "";
  const id = `${uid}-af`;
  const clip = `<defs><clipPath id="${uid}-ac"><rect x="${A.r1(P.x)}" y="${A.r1(P.y)}" width="${A.r1(P.size)}" height="${A.r1(P.size)}"/></clipPath></defs>`;
  return `${clip}${fadeDefs(P, id, fade)}<g clip-path="url(#${uid}-ac)"${hasFade(fade) ? ` mask="url(#${id})"` : ""} opacity="${opacity}"><g transform="${sceneTransform(P)}"><image width="${A.r1(P.D)}" height="${A.r1(P.D)}" href="${href}" preserveAspectRatio="none"/></g></g>`;
}
/** الشخصية وحدها فوق الاسم + توهّج حافتها بلون القسم */
function cutoutLayer(P, uid, theme, { fade = "none" } = {}) {
  const href = artHref(P.key);
  const mask = maskHref(P.key);
  if (!href || !mask) return "";
  const [a] = A.THEMES[theme] || A.THEMES.violet;
  const id = `${uid}-cf`;
  const cut = `<defs><mask id="${uid}-cm" maskUnits="userSpaceOnUse" x="${A.r1(P.x)}" y="${A.r1(P.y)}" width="${A.r1(P.size)}" height="${A.r1(P.size)}"><g transform="${sceneTransform(P)}"><image width="${A.r1(P.D)}" height="${A.r1(P.D)}" href="${mask}" preserveAspectRatio="none"/></g></mask>
    <filter id="${uid}-rim" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${A.r1(P.size * 0.012)}"/></filter></defs>`;
  const open = `<g clip-path="url(#${uid}-ac)"${hasFade(fade) ? ` mask="url(#${id})"` : ""}>`;
  const rim = `<g filter="url(#${uid}-rim)" opacity=".7"><rect x="${A.r1(P.x)}" y="${A.r1(P.y)}" width="${A.r1(P.size)}" height="${A.r1(P.size)}" fill="${a}" mask="url(#${uid}-cm)"/></g>`;
  const figure = `<g mask="url(#${uid}-cm)"><g transform="${sceneTransform(P)}"><image width="${A.r1(P.D)}" height="${A.r1(P.D)}" href="${href}" preserveAspectRatio="none"/></g></g>`;
  return `${cut}${fadeDefs(P, id, fade)}${open}${rim}${figure}</g>`;
}

// ── الاسم الكبير خلف الشخصية: «TERBOO» بخط Anton · تدرّج · قطع كاتانا ──
const NAME = "TERBOO";
const NAME_FONT = "Anton";
GlobalFonts.registerFromPath(path.join(FONT_DIR, "Anton-Regular.ttf"), NAME_FONT);
const NAME_SPACING = 0.025;
const nameMetrics = (() => {
  probe.font = `100px "${NAME_FONT}"`;
  const advances = [...NAME].map((ch) => probe.measureText(ch).width + NAME_SPACING * 100);
  const cap = probe.measureText("T").actualBoundingBoxAscent;
  return { advances: advances.map((a) => a / 100), width: advances.reduce((s, a) => s + a, 0) / 100 - NAME_SPACING, cap: cap / 100 };
})();

/**
 * أفضل موضع وحجم للاسم داخل نطاق: لا يختفي حرف كاملاً خلف الشخصية، وهي تغطي جزءاً منه (عمق)،
 * والأكبر والأعلى أفضل عند التساوي. minX/maxX حدود أفقية (عمود النص في الأفقي).
 */
function placeName(P, grid, { cx, width, top, bottom, shift = 0, minX = -Infinity, maxX = Infinity }) {
  const sample = (X, Y) => {
    if (!grid) return 0;
    let u = (X - P.x0) / P.D;
    const v = (Y - P.y0) / P.D;
    if (P.flip) u = 1 - u;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
    return grid[Math.floor(v * GRID) * GRID + Math.floor(u * GRID)] / 255;
  };
  let best = null;
  const steps = 20;
  for (const scaleW of [1, 0.9, 0.8]) {
    const wNow = width * scaleW;
    const size = wNow / nameMetrics.width;
    const capH = size * nameMetrics.cap;
    for (let si = -4; si <= 4; si += 1) {
      const x = cx - wNow / 2 + (shift * width * si) / 2;
      if (x < minX || x + wNow > maxX) continue;
      for (let k = 0; k <= steps; k += 1) {
        const yTop = top + ((bottom - capH - top) * k) / steps;
        if (yTop + capH > bottom + 0.5) continue;
        let lx = x;
        const vis = nameMetrics.advances.map((adv) => {
          const lw = adv * size;
          let covered = 0;
          for (let i = 0; i < 7; i += 1) for (let j = 0; j < 7; j += 1) covered += sample(lx + lw * (0.08 + 0.84 * (i / 6)), yTop + capH * (j / 6)) > 0.5 ? 1 : 0;
          lx += lw;
          return 1 - covered / 49;
        });
        const min = Math.min(...vis);
        const occluded = 1 - vis.reduce((sum, v) => sum + v, 0) / vis.length;
        const score = min + 0.2 * (1 - occluded) - (occluded < 0.05 ? 0.3 : 0) - 0.04 * (k / steps) - 0.015 * Math.abs(si) + 0.12 * scaleW;
        if (!best || score > best.score) best = { score, x, yTop, size, capH, min, occluded };
      }
    }
  }
  return best;
}

/** أفرغ موضع (أقل تغطية بالشخصية) من مواضع مرشّحة — لشعار القسم */
function emptySpot(P, grid, candidates, r) {
  const cover = ([cx, cy]) => {
    if (!grid) return 0;
    let total = 0, n = 0;
    for (let i = -3; i <= 3; i += 1) for (let j = -3; j <= 3; j += 1) {
      let u = (cx + (r * 1.3 * i) / 3 - P.x0) / P.D;
      const v = (cy + (r * 1.3 * j) / 3 - P.y0) / P.D;
      if (P.flip) u = 1 - u;
      n += 1;
      if (u >= 0 && u < 1 && v >= 0 && v < 1) total += grid[Math.floor(v * GRID) * GRID + Math.floor(u * GRID)] / 255;
    }
    return total / n;
  };
  return candidates.map((c, i) => ({ c, score: cover(c) + i * 0.04 })).sort((x, y) => x.score - y.score)[0].c;
}

/**
 * موضع المشهد والاسم معاً: إن غطّى الرأس حروف الاسم يُنزَل المشهد قليلاً (مع تلاشٍ علوي)
 * فيمر الاسم خلف أعلى الرأس كغلاف مجلة — يُفضَّل أقل إنزال يحقق قراءة كل الحروف.
 */
function stage(o, at, band, drops = [0, 0.05, 0.1, 0.15]) {
  let best = null;
  for (const drop of drops) {
    const P = at(drop);
    const spot = placeName(P, o.grid, band);
    const score = spot.score - drop * 0.8;
    if (!best || score > best.score) best = { P, spot, score, drop };
  }
  return best;
}

/** رسم الاسم بألوان الهوية (أبيض ← بنفسجي)؛ لون القسم في التوهّج فقط · ظل حدّي مُزاح · قطع كاتانا · لمعة القطع */
function nameLayer(spot, uid, theme, { opacity = 0.92 } = {}) {
  if (!spot) return "";
  const [a] = A.THEMES[theme] || A.THEMES.violet;
  const { x, yTop, size, capH } = spot;
  const base = yTop + capH;
  const width = nameMetrics.width * size;
  const id = `${uid}-nm`;
  const t = (attrs) => `<text x="${A.r1(x)}" y="${A.r1(base)}" font-family="${NAME_FONT}" font-size="${A.r1(size)}" letter-spacing="${A.r1(NAME_SPACING * size)}" ${attrs}>${NAME}</text>`;
  // ضربة الكاتانا: خط مائل صاعد يقسم الحروف بفجوة رفيعة
  const g = size * 0.028;
  const sx0 = x - width * 0.04, sy0 = base - capH * 0.2, sx1 = x + width * 1.04, sy1 = yTop + capH * 0.34;
  const above = `M${A.r1(x - width)} ${A.r1(yTop - capH)} H${A.r1(x + width * 2)} V${A.r1(sy1 - g)} L${A.r1(sx0)} ${A.r1(sy0 - g)} L${A.r1(x - width)} ${A.r1(sy0 - g)} Z`;
  const below = `M${A.r1(x - width)} ${A.r1(sy0 + g)} L${A.r1(sx0)} ${A.r1(sy0 + g)} L${A.r1(sx1)} ${A.r1(sy1 + g)} L${A.r1(x + width * 2)} ${A.r1(sy1 + g)} V${A.r1(base + capH)} H${A.r1(x - width)} Z`;
  return `<defs>
    <linearGradient id="${id}-f" gradientUnits="userSpaceOnUse" x1="0" y1="${A.r1(yTop)}" x2="0" y2="${A.r1(base)}"><stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#e9d5ff"/><stop offset=".72" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.violet}" stop-opacity=".18"/></linearGradient>
    <linearGradient id="${id}-s" gradientUnits="userSpaceOnUse" x1="${A.r1(sx0)}" y1="0" x2="${A.r1(sx1)}" y2="0"><stop offset="0" stop-color="${C.cyan}" stop-opacity="0"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/></linearGradient>
    <clipPath id="${id}-c"><path d="${above}"/><path d="${below}"/></clipPath>
    <filter id="${id}-b" x="-20%" y="-40%" width="140%" height="180%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${A.r1(size * 0.07)}"/></filter>
  </defs><g opacity="${opacity}">
    ${t(`fill="${a}" opacity=".5" filter="url(#${id}-b)"`)}
    ${t(`fill="none" stroke="${C.cyan}" stroke-opacity=".35" stroke-width="${A.r1(size * 0.006)}" transform="translate(${A.r1(size * 0.03)} ${A.r1(-size * 0.025)})"`)}
    <g clip-path="url(#${id}-c)">${t(`fill="url(#${id}-f)"`)}${t(`fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="${A.r1(size * 0.004)}"`)}</g>
    <path d="M${A.r1(sx0)} ${A.r1(sy0)} L${A.r1(sx1)} ${A.r1(sy1)}" stroke="url(#${id}-s)" stroke-width="${A.r1(Math.max(1, size * 0.006))}" stroke-linecap="round"/>
  </g>`;
}

/** شعار القسم الهولوغرامي: حلقات HUD بلون القسم ورمزه في الوسط */
function emblem(icon, cx, cy, r, uid, theme) {
  const [a, b] = A.THEMES[theme] || A.THEMES.violet;
  const s = (r * 0.9) / 24;
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const ang = (i / 24) * Math.PI * 2;
    const r0 = r * (i % 6 === 0 ? 1.08 : 1.13), r1 = r * 1.18;
    return `<line x1="${A.r1(cx + Math.cos(ang) * r0)}" y1="${A.r1(cy + Math.sin(ang) * r0)}" x2="${A.r1(cx + Math.cos(ang) * r1)}" y2="${A.r1(cy + Math.sin(ang) * r1)}" stroke="${b}" stroke-opacity="${i % 6 === 0 ? 0.9 : 0.4}" stroke-width="${A.r1(r * 0.02)}"/>`;
  }).join("");
  return `<g>
    <circle cx="${A.r1(cx)}" cy="${A.r1(cy)}" r="${A.r1(r * 1.9)}" fill="url(#${uid}-o-${theme})"/>
    <circle cx="${A.r1(cx)}" cy="${A.r1(cy)}" r="${A.r1(r)}" fill="${C.base}" fill-opacity=".55" stroke="url(#${uid}-g-${theme})" stroke-width="${A.r1(r * 0.04)}"/>
    <circle cx="${A.r1(cx)}" cy="${A.r1(cy)}" r="${A.r1(r * 0.8)}" fill="none" stroke="${a}" stroke-opacity=".55" stroke-width="${A.r1(r * 0.012)}" stroke-dasharray="${A.r1(r * 0.12)} ${A.r1(r * 0.06)}"/>
    <path d="M${A.r1(cx - r * 1.32)} ${A.r1(cy)} A${A.r1(r * 1.32)} ${A.r1(r * 1.32)} 0 0 1 ${A.r1(cx)} ${A.r1(cy - r * 1.32)}" fill="none" stroke="${b}" stroke-width="${A.r1(r * 0.03)}" stroke-linecap="round"/>
    ${ticks}
    <g transform="translate(${A.r1(cx - 12 * s)} ${A.r1(cy - 12 * s)}) scale(${A.r1(s * 1000) / 1000})" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${A.ICONS[icon] || A.ICONS.grid}</g>
  </g>`;
}

/** تدرّج أوبسيديان (غطاء لقراءة النص) */
function scrim(x, y, w, h, uid, dir = "right", { from = 0.96, to = 0 } = {}) {
  const id = `${uid}-s${Math.round(x)}${Math.round(y)}${dir}`;
  const g = { right: 'x1="0" y1="0" x2="1" y2="0"', down: 'x1="0" y1="0" x2="0" y2="1"', up: 'x1="0" y1="1" x2="0" y2="0"' }[dir];
  return `<defs><linearGradient id="${id}" ${g}><stop offset="0" stop-color="${C.base}" stop-opacity="${from}"/><stop offset=".55" stop-color="${C.base}" stop-opacity="${A.r1((from + to) / 2)}"/><stop offset="1" stop-color="${C.base}" stop-opacity="${to}"/></linearGradient></defs><rect x="${A.r1(x)}" y="${A.r1(y)}" width="${A.r1(w)}" height="${A.r1(h)}" fill="url(#${id})"/>`;
}

/** جمرات وجزيئات ضوء خافتة */
function embers(w, h, seed, { count = 46, area = [0, 0, 1, 1] } = {}) {
  const rand = A.rng(seed * 11 + 5);
  let out = "";
  for (let i = 0; i < count; i += 1) {
    const x = w * (area[0] + rand() * (area[2] - area[0]));
    const y = h * (area[1] + rand() * (area[3] - area[1]));
    const r = 0.6 + rand() * 1.8;
    const color = rand() > 0.7 ? C.cyan : rand() > 0.4 ? C.violet : C.magenta;
    out += `<circle cx="${A.r1(x)}" cy="${A.r1(y)}" r="${A.r1(r * 2.6)}" fill="${color}" opacity="${A.r1(0.05 + rand() * 0.08)}"/><circle cx="${A.r1(x)}" cy="${A.r1(y)}" r="${A.r1(r)}" fill="${color}" opacity="${A.r1(0.35 + rand() * 0.5)}"/>`;
  }
  return out;
}

/** دخان/ضباب سفلي ناعم */
function smoke(w, h, uid, seed) {
  const rand = A.rng(seed * 7 + 3);
  let out = `<defs><radialGradient id="${uid}-smk" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#b8a6ff" stop-opacity=".10"/><stop offset="1" stop-color="#b8a6ff" stop-opacity="0"/></radialGradient></defs>`;
  for (let i = 0; i < 6; i += 1) out += `<ellipse cx="${A.r1(w * rand())}" cy="${A.r1(h * (0.86 + rand() * 0.16))}" rx="${A.r1(w * (0.22 + rand() * 0.2))}" ry="${A.r1(h * (0.08 + rand() * 0.06))}" fill="url(#${uid}-smk)"/>`;
  return out;
}

/** خط زخرفي متدرّج تحت العنوان */
const accentBar = (x, y, w, uid) => `<rect x="${A.r1(x)}" y="${A.r1(y)}" width="${A.r1(w)}" height="3" rx="1.5" fill="url(#${uid}-text)"/>`;

const FOOTER = "BOT TERBOO • AI ASSISTANT";

// ═══════════════════════════════════════════════
// التخطيطات
// ═══════════════════════════════════════════════

/** أفقي 1280×720 (يُصدَّر 1280×720): الشخصية يميناً والاسم الكبير خلفها · النص يساراً */
function layoutWide(w, h, o) {
  const { uid } = o;
  let s = A.defs(uid, o.theme) + `<rect width="${w}" height="${h}" fill="${C.base}"/>`;
  s += `<circle cx="${A.r1(w * 0.72)}" cy="${A.r1(h * 0.46)}" r="${A.r1(h * 0.8)}" fill="url(#${uid}-orbA)"/>`;
  const size = h * 1.06;
  const { P, spot, drop } = stage(o, (d) => place(o.scene, w - size * 0.97, -h * 0.03 + d * size, size), { cx: w * 0.76, width: w * 0.42, top: h * 0.07, bottom: h * 0.64, shift: 0.1, minX: w * 0.53, maxX: w * 0.985 });
  const fade = drop ? ["left", "top"] : "left";
  s += artLayer(P, uid, { fade });
  s += nameLayer(spot, uid, o.theme);
  s += cutoutLayer(P, uid, o.theme, { fade });
  s += scrim(0, 0, w * 0.64, h, uid, "right", { from: 0.97, to: 0 });
  s += smoke(w, h, uid, o.seed || 1) + embers(w, h, o.seed || 1, { area: [0.35, 0.05, 1, 0.95] });
  if (o.icon) {
    const r = h * 0.068;
    const [ex, ey] = emptySpot(P, o.grid, [[w * 0.6, h * 0.8], [w * 0.92, h * 0.82], [w * 0.92, h * 0.56], [w * 0.58, h * 0.6]], r);
    s += emblem(o.icon, ex, ey, r, uid, o.theme);
  }
  s += A.signature(84, 92, 21, { uid });
  const top = o.lines ? 228 : 262;
  s += A.text(84, top, o.overline, { size: 16, weight: 700, fill: `url(#${uid}-text)`, spacing: 3.4 });
  let y = top + 86;
  const lines = o.lines || [o.title];
  lines.forEach((line, i) => {
    const grad = o.lines && i === lines.length - 1;
    s += A.headline(84, y, line, { size: o.lines ? 70 : 88, maxWidth: 610, fill: grad ? `url(#${uid}-text)` : C.white }).svg;
    y += o.lines ? 78 : 0;
  });
  if (o.lines) y -= 20;
  s += accentBar(86, y + 26, 64, uid);
  const para = A.paragraph(84, y + 70, o.copy, { size: 24, maxWidth: 540, maxLines: 2, opacity: 0.76 });
  s += para.svg;
  if (o.chips) s += A.chips(84, y + 80 + para.height, o.chips, { uid, size: 17, accentFirst: true }).svg;
  s += A.text(84, h - 56, FOOTER, { size: 13, weight: 600, opacity: 0.45, spacing: 2.6 });
  return s + A.finish(w, h, uid);
}

/**
 * صورة القسم (1280×720): هوية البوت (الشعار · الشخصية · «TERBOO» الكبير) + ما يدل على القسم بوضوح:
 * أيقونة القسم في بلاطة بلونه · رقم القسم وعدد أوامره الفعلي · العنوان والوصف · قدرات حقيقية من أوامره
 * · اسم القسم كبيراً مفرّغاً في الخلفية · شريط جانبي وتوهّج بلون القسم.
 */
function layoutSection(w, h, o) {
  const { uid } = o;
  const [a] = A.THEMES[o.theme] || A.THEMES.violet;
  let s = A.defs(uid, o.theme) + `<rect width="${w}" height="${h}" fill="${C.base}"/>`;
  s += `<circle cx="${A.r1(w * 0.72)}" cy="${A.r1(h * 0.46)}" r="${A.r1(h * 0.8)}" fill="url(#${uid}-orbA)"/>`;
  const size = h * 1.06;
  const { P, spot, drop } = stage(o, (d) => place(o.scene, w - size * 0.97, -h * 0.03 + d * size, size), { cx: w * 0.78, width: w * 0.38, top: h * 0.07, bottom: h * 0.6, shift: 0.1, minX: w * 0.57, maxX: w * 0.985 });
  const fade = drop ? ["left", "top"] : "left";
  s += artLayer(P, uid, { fade });
  s += nameLayer(spot, uid, o.theme);
  s += cutoutLayer(P, uid, o.theme, { fade });
  s += scrim(0, 0, w * 0.66, h, uid, "right", { from: 0.97, to: 0 });
  // توهّج بلون القسم خلف عمود النص
  s += `<circle cx="${A.r1(w * 0.06)}" cy="${A.r1(h * 0.98)}" r="${A.r1(h * 0.62)}" fill="url(#${uid}-orbA)" opacity=".55"/>`;
  // اسم القسم كبيراً مفرّغاً — يدل على القسم من النظرة الأولى
  const word = String(o.title || "").toUpperCase();
  probe.font = `100px "${NAME_FONT}"`;
  const unit = probe.measureText(word).width / 100 + NAME_SPACING * word.length;
  // داخل عمود النص فقط (لا يعبر الشخصية) وفوق التذييل
  const wordSize = Math.min(150, 560 / Math.max(unit, 0.01));
  s += `<text x="80" y="${A.r1(h - 92)}" font-family="${NAME_FONT}" font-size="${A.r1(wordSize)}" letter-spacing="${A.r1(NAME_SPACING * wordSize)}" fill="${a}" fill-opacity=".07" stroke="${a}" stroke-opacity=".38" stroke-width="1.6">${A.esc(word)}</text>`;
  s += smoke(w, h, uid, o.seed || 1) + embers(w, h, o.seed || 1, { area: [0.4, 0.05, 1, 0.95] });
  if (o.icon) {
    const r = h * 0.075;
    const [ex, ey] = emptySpot(P, o.grid, [[w * 0.92, h * 0.82], [w * 0.62, h * 0.82], [w * 0.92, h * 0.56]], r);
    s += emblem(o.icon, ex, ey, r, uid, o.theme);
  }
  // شريط جانبي بلون القسم
  s += `<rect x="0" y="0" width="6" height="${h}" fill="url(#${uid}-brand)"/>`;
  s += A.signature(84, 92, 21, { uid });
  // بلاطة القسم + رقمه وعدد أوامره
  const tile = 92;
  s += A.appIcon(o.icon || "grid", 84 + tile / 2, 196, tile, { uid, theme: o.theme });
  s += A.text(84 + tile + 26, 186, o.overline, { size: 17, weight: 700, fill: `url(#${uid}-text)`, spacing: 3.6 });
  const meta = o.commands ? `${o.commands} COMMANDS` : "BOT TERBOO";
  s += A.text(84 + tile + 26, 218, meta, { size: 15, weight: 600, opacity: 0.6, spacing: 2.4 });
  s += A.headline(84, 342, o.title, { size: 84, maxWidth: 640, fill: C.white }).svg;
  s += accentBar(86, 372, 72, uid);
  const para = A.paragraph(84, 418, o.copy, { size: 25, maxWidth: 600, maxLines: 2, opacity: 0.8 });
  s += para.svg;
  if (o.chips?.length) s += A.chips(84, 418 + para.height + 4, o.chips, { uid, size: 18, accentFirst: true }).svg;
  s += A.text(84, h - 56, FOOTER, { size: 13, weight: 600, opacity: 0.45, spacing: 2.6 });
  return s + A.finish(w, h, uid);
}

/**
 * لوحة بطاقة الترحيب/الوداع (1280×720): الهوية كاملة (الشخصية · «TERBOO» · الشعار · التذييل) وإطار HUD
 * فارغ لصورة العضو؛ الاسم والصورة والمجموعة والعدد والتاريخ تُرسم وقت الإرسال (src/lib/terboo-welcome-card.js).
 */
function layoutPlate(w, h, o) {
  const { uid } = o;
  const [a, b] = A.THEMES[o.theme] || A.THEMES.violet;
  const { cx, cy, r } = MEMBER_CARD.avatar;
  let s = A.defs(uid, o.theme) + `<rect width="${w}" height="${h}" fill="${C.base}"/>`;
  s += `<circle cx="${A.r1(w * 0.74)}" cy="${A.r1(h * 0.46)}" r="${A.r1(h * 0.8)}" fill="url(#${uid}-orbA)"/>`;
  const size = h * 1.06;
  const { P, spot, drop } = stage(o, (d) => place(o.scene, w - size * 0.95, -h * 0.03 + d * size, size), { cx: w * 0.8, width: w * 0.34, top: h * 0.07, bottom: h * 0.6, shift: 0.1, minX: w * 0.62, maxX: w * 0.985 });
  const fade = drop ? ["left", "top"] : "left";
  s += artLayer(P, uid, { fade });
  s += nameLayer(spot, uid, o.theme);
  s += cutoutLayer(P, uid, o.theme, { fade });
  s += scrim(0, 0, w * 0.7, h, uid, "right", { from: 0.98, to: 0 });
  s += `<rect width="${A.r1(w * 0.62)}" height="${h}" fill="url(#${uid}-grid)" mask="url(#${uid}-fade)" opacity=".7"/>`;
  s += `<circle cx="${A.r1(cx)}" cy="${A.r1(cy)}" r="${A.r1(r * 2.3)}" fill="url(#${uid}-orbA)"/>`;
  s += smoke(w, h, uid, o.seed || 1) + embers(w, h, o.seed || 1, { area: [0.02, 0.05, 1, 0.95], count: 60 });
  // إطار HUD حول موضع الصورة: حلقة متقطعة · قوس متدرّج · علامات
  const ticks = Array.from({ length: 48 }, (_, i) => {
    const ang = (i / 48) * Math.PI * 2;
    const r0 = r * (i % 4 === 0 ? 1.2 : 1.24), r1 = r * 1.3;
    return `<line x1="${A.r1(cx + Math.cos(ang) * r0)}" y1="${A.r1(cy + Math.sin(ang) * r0)}" x2="${A.r1(cx + Math.cos(ang) * r1)}" y2="${A.r1(cy + Math.sin(ang) * r1)}" stroke="${i % 4 === 0 ? b : a}" stroke-opacity="${i % 4 === 0 ? 0.9 : 0.35}" stroke-width="2"/>`;
  }).join("");
  s += `<circle cx="${A.r1(cx)}" cy="${A.r1(cy)}" r="${A.r1(r * 1.1)}" fill="none" stroke="${a}" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="10 7"/>`;
  s += `<path d="M${A.r1(cx - r * 1.38)} ${A.r1(cy)} A${A.r1(r * 1.38)} ${A.r1(r * 1.38)} 0 0 1 ${A.r1(cx + r * 0.98)} ${A.r1(cy - r * 0.98)}" fill="none" stroke="url(#${uid}-brand)" stroke-width="4" stroke-linecap="round"/>`;
  s += `<path d="M${A.r1(cx + r * 1.38)} ${A.r1(cy)} A${A.r1(r * 1.38)} ${A.r1(r * 1.38)} 0 0 1 ${A.r1(cx - r * 0.98)} ${A.r1(cy + r * 0.98)}" fill="none" stroke="url(#${uid}-brand)" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>`;
  s += ticks;
  s += `<rect x="0" y="0" width="6" height="${h}" fill="url(#${uid}-brand)"/>`;
  s += A.signature(84, 92, 21, { uid });
  s += A.text(84, h - 56, FOOTER, { size: 13, weight: 600, opacity: 0.45, spacing: 2.6 });
  return s + A.finish(w, h, uid);
}

/** باقات VPS: عنوان هادئ + شبكة بطاقات (المواصفات والسعر من terboo-vps-plans.js حرفياً) */
function layoutPlans(w, h, o) {
  const { uid } = o;
  let s = A.defs(uid, o.theme) + `<rect width="${w}" height="${h}" fill="${C.base}"/>`;
  s += `<circle cx="${A.r1(w * 0.8)}" cy="${A.r1(h * 0.2)}" r="${A.r1(h * 0.75)}" fill="url(#${uid}-orbA)"/>`;
  const size = h * 0.92;
  const P = place(o.scene, w - size * 0.86, -h * 0.06, size);
  s += artLayer(P, uid, { fade: ["left", "top"], opacity: 0.55 });
  s += scrim(0, 0, w, h, uid, "right", { from: 0.98, to: 0.55 });
  s += scrim(0, h * 0.36, w, h * 0.64, uid, "down", { from: 0.2, to: 0.92 });
  s += embers(w, h, o.seed || 3, { count: 26, area: [0.5, 0.05, 1, 0.4] });
  s += A.signature(64, 70, 18, { uid });
  s += A.text(64, 134, o.overline, { size: 14, weight: 700, fill: `url(#${uid}-text)`, spacing: 3 });
  s += A.headline(64, 196, o.title, { size: 56, maxWidth: 700 }).svg;
  s += accentBar(66, 218, 56, uid);
  s += A.text(64, 254, o.copy, { size: 19, opacity: 0.74 });
  const plans = o.plans || [];
  const cols = 4;
  const rows = Math.ceil(plans.length / cols);
  const gap = 18;
  const top = 288;
  const bottom = h - 70;
  const cw = (w - 128 - gap * (cols - 1)) / cols;
  const ch = rows === 1 ? 196 : Math.min(172, (bottom - top - gap * (rows - 1)) / rows);
  const y0 = rows === 1 ? top + (bottom - top - ch) / 2 - 12 : top;
  plans.forEach((p, i) => {
    const x = 64 + (i % cols) * (cw + gap);
    const y = y0 + Math.floor(i / cols) * (ch + gap);
    s += A.glassCard(x, y, cw, ch, { uid, radius: 18 });
    s += `<rect x="${A.r1(x)}" y="${A.r1(y)}" width="4" height="${A.r1(ch)}" rx="2" fill="url(#${uid}-text)"/>`;
    s += A.text(x + 22, y + 40, `${p.cpu} vCPU · ${p.ramGb} GB RAM`, { size: 20, family: FONT.display, weight: 800 });
    s += A.text(x + 22, y + 68, `${p.diskGb} GB${p.storage ? ` ${p.storage}` : ""} · ${p.bandwidth}`, { size: 15, opacity: 0.78 });
    s += A.text(x + 22, y + 92, `${p.ipv4} IPv4 · ${p.ipv6} IPv6`, { size: 14, opacity: 0.6 });
    s += A.text(x + 22, y + ch - 24, `$${p.priceUsd}`, { size: 30, family: FONT.display, weight: 800, fill: `url(#${uid}-text)` });
    s += A.text(x + cw - 20, y + ch - 26, `${p.priceEgp} EGP`, { size: 17, weight: 700, opacity: 0.85, anchor: "end" });
  });
  s += A.text(64, h - 34, FOOTER, { size: 12, weight: 600, opacity: 0.45, spacing: 2.4 });
  return s + A.finish(w, h, uid);
}

/** مربع (وأفقي 4:3): الشخصية تملأ الإطار والاسم الكبير خلفها · العنوان في الثلث السفلي */
function layoutSquare(w, h, o) {
  const { uid } = o;
  const u = Math.min(w, h);
  const small = u < 400;
  let s = A.defs(uid, o.theme) + `<rect width="${w}" height="${h}" fill="${C.base}"/>`;
  const { P, spot, drop } = stage(o, (d) => place(o.scene, 0, d * w, w), { cx: w / 2, width: w * 0.86, top: h * (small ? 0.04 : 0.13), bottom: h * 0.62, shift: 0.06 });
  const fade = drop ? "top" : "none";
  s += artLayer(P, uid, { fade });
  s += nameLayer(spot, uid, o.theme);
  s += cutoutLayer(P, uid, o.theme, { fade });
  s += scrim(0, h * 0.42, w, h * 0.58, uid, "down", { from: 0, to: 0.97 });
  if (!small) s += scrim(0, 0, w, h * 0.2, uid, "up", { from: 0, to: 0.65 });
  s += embers(w, h, o.seed || 2, { count: small ? 14 : 30, area: [0, 0.1, 1, 0.7] });
  if (!small) s += A.signature(u * 0.06, u * 0.085, u * 0.026, { uid });
  if (!small && o.overline) s += A.text(w / 2, h * 0.735, o.overline, { size: u * 0.022, weight: 700, fill: `url(#${uid}-text)`, spacing: u * 0.005, anchor: "middle" });
  s += A.headline(w / 2, h * (small ? 0.86 : 0.815), o.title, { size: u * (small ? 0.13 : 0.098), maxWidth: w * 0.88, anchor: "middle" }).svg;
  if (!small && o.copy) s += A.paragraph(w / 2, h * 0.872, o.copy, { size: u * 0.03, maxWidth: w * 0.8, anchor: "middle", maxLines: 1, opacity: 0.78 }).svg;
  if (!small) s += A.text(w / 2, h * 0.952, FOOTER, { size: u * 0.017, weight: 600, opacity: 0.45, spacing: u * 0.004, anchor: "middle" });
  else s += A.text(w / 2, h * 0.95, "BOT TERBOO", { size: u * 0.04, weight: 700, opacity: 0.55, spacing: u * 0.01, anchor: "middle" });
  return s + A.finish(w, h, uid);
}

/** عمودي: الشخصية أعلى والاسم الكبير خلفها · العنوان في الثلث السفلي · الشعار أعلى */
function layoutPortrait(w, h, o) {
  const { uid } = o;
  let s = A.defs(uid, o.theme) + `<rect width="${w}" height="${h}" fill="${C.base}"/>`;
  s += `<circle cx="${w / 2}" cy="${A.r1(h * 0.38)}" r="${A.r1(w * 0.85)}" fill="url(#${uid}-orbA)"/>`;
  const { P, spot } = stage(o, (d) => place(o.scene, -w * 0.06, h * 0.04 + d * w, w * 1.12), { cx: w / 2, width: w * 0.88, top: h * 0.09, bottom: h * 0.58, shift: 0.06 });
  s += artLayer(P, uid, { fade: ["bottom", "top"] });
  s += nameLayer(spot, uid, o.theme);
  s += cutoutLayer(P, uid, o.theme, { fade: ["bottom", "top"] });
  s += scrim(0, 0, w, h * 0.16, uid, "up", { from: 0, to: 0.75 });
  s += smoke(w, h * 0.78, uid, o.seed || 3) + embers(w, h, o.seed || 3, { area: [0, 0.08, 1, 0.66] });
  s += A.signature(w / 2, 70, 21, { uid, anchor: "middle" });
  s += A.text(w / 2, h * 0.705, o.overline, { size: 16, weight: 700, fill: `url(#${uid}-text)`, spacing: 3.4, anchor: "middle" });
  s += A.headline(w / 2, h * 0.775, o.title, { size: 84, maxWidth: w * 0.88, anchor: "middle" }).svg;
  s += accentBar(w / 2 - 32, h * 0.8, 64, uid);
  s += A.paragraph(w / 2, h * 0.845, o.copy, { size: 23, maxWidth: w * 0.8, anchor: "middle", maxLines: 2, opacity: 0.78 }).svg;
  s += A.text(w / 2, h * 0.962, FOOTER, { size: 13, weight: 600, opacity: 0.45, spacing: 2.6, anchor: "middle" });
  return s + A.finish(w, h, uid);
}

/** مصغّرة 267×200 (صورة مصغّرة داخل الرسائل: تبقى بمقاسها وتُرسم بضعف الدقة) */
function layoutThumb(w, h, o) {
  const { uid } = o;
  let s = A.defs(uid, o.theme) + `<rect width="${w}" height="${h}" fill="${C.base}"/>`;
  if (o.logo) {
    s += `<circle cx="${w / 2}" cy="${h * 0.42}" r="${h * 0.6}" fill="url(#${uid}-orbA)"/>`;
    s += A.logoMark(w / 2, h * 0.4, h * 0.44, { uid, glow: false });
    s += A.wordmark(w / 2, h * 0.86, h * 0.1, { anchor: "middle", uid });
    return s + embers(w, h, 4, { count: 12 }) + A.finish(w, h, uid);
  }
  const { P, spot, drop } = stage(o, (d) => place(o.scene, 0, -h * 0.16 + d * w, w), { cx: w / 2, width: w * 0.86, top: h * 0.03, bottom: h * 0.62, shift: 0.06 });
  const fade = drop ? "top" : "none";
  s += artLayer(P, uid, { fade });
  s += nameLayer(spot, uid, o.theme);
  s += cutoutLayer(P, uid, o.theme, { fade });
  s += scrim(0, h * 0.45, w, h * 0.55, uid, "down", { from: 0, to: 0.96 });
  s += A.headline(w / 2, h * 0.89, o.title, { size: h * 0.15, maxWidth: w * 0.9, anchor: "middle" }).svg;
  return s + A.finish(w, h, uid);
}

/** ورق الكتابة اليدوية: وظيفي (الحبر داكن ⇒ ورق فاتح) · الأسطر على خطوط الأمر (y=142+28k · النص من x=344 · التاريخ عند 806) */
function layoutPaper(w, h, o) {
  const { uid } = o;
  let s = A.defs(uid, "violet") + `<rect width="${w}" height="${h}" fill="${C.paper}"/>`;
  for (let x = 344; x < w - 40; x += 28) s += `<line x1="${x}" y1="122" x2="${x}" y2="${h - 24}" stroke="#7c5cff" stroke-opacity=".045" stroke-width="1"/>`;
  for (let y = 142 + 7; y < h - 30; y += 28) s += `<line x1="60" y1="${y}" x2="${w - 40}" y2="${y}" stroke="#c7cbe6" stroke-width="1.1"/>`;
  s += `<path d="M0 0 H760 L728 118 H0 Z" fill="#0b0b12"/><path d="M760 0 L728 118" stroke="url(#${uid}-text)" stroke-width="3"/>`;
  s += `<rect y="118" width="${w}" height="2" fill="url(#${uid}-text)" opacity=".8"/>`;
  s += `<line x1="322" y1="120" x2="322" y2="${h}" stroke="#a855f7" stroke-opacity=".45" stroke-width="2"/>`;
  for (let k = 0; k < 6; k += 1) s += `<circle cx="34" cy="${170 + k * 110}" r="9" fill="#e6e8f4" stroke="#cdd1ea" stroke-width="2"/>`;
  s += A.logoMark(78, 60, 64, { uid, glow: false });
  s += A.text(124, 56, "TERBOO NOTES", { size: 30, family: FONT.display, weight: 800, fill: C.white, spacing: 3 });
  s += A.text(124, 86, "BOT TERBOO • AI ASSISTANT", { size: 12, weight: 600, fill: "#a7a9c4", spacing: 2.4 });
  s += `<rect x="790" y="52" width="200" height="60" rx="8" fill="#ffffff" stroke="#c9b8ff" stroke-width="1.5"/>`;
  s += `<path d="M${w - 70} ${h - 22} h48 v-48" fill="none" stroke="#a855f7" stroke-opacity=".5" stroke-width="2"/>`;
  s += `<g opacity=".05">${A.logoMark(w - 210, h - 210, 300, { uid: `${uid}w`, glow: false })}</g>`;
  return s;
}

/** صورة شخصية افتراضية: الشخصية في المنتصف · بلا نص */
function layoutAvatar(w, h, o) {
  const { uid } = o;
  return A.defs(uid, "violet") + `<rect width="${w}" height="${h}" fill="${C.base}"/>` + artLayer(place({ key: "master", flip: false, zoom: 1 }, 0, 0, w), uid)
    + `<defs><radialGradient id="${uid}-vg" cx=".5" cy=".45" r=".72"><stop offset=".62" stop-color="${C.base}" stop-opacity="0"/><stop offset="1" stop-color="${C.base}" stop-opacity=".85"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#${uid}-vg)"/>`;
}

/** صورة طباعية (shuffle 04): الشخصية خافتة خلف «Ask. Download. Create. Play.» */
function layoutType(w, h, o) {
  const { uid } = o;
  let s = A.defs(uid, o.theme) + `<rect width="${w}" height="${h}" fill="${C.base}"/>`;
  s += artLayer(place(o.scene, w * 0.18, h * 0.05, w * 0.95), uid, { opacity: 0.55 });
  s += scrim(0, 0, w * 0.8, h, uid, "right", { from: 0.92, to: 0 });
  s += embers(w, h, 9, { count: 26 });
  s += A.signature(w * 0.08, w * 0.11, w * 0.026, { uid });
  ["Ask.", "Download.", "Create.", "Play."].forEach((word, i) => { s += A.headline(w * 0.08, h * (0.36 + i * 0.145), word, { size: w * 0.12, maxWidth: w * 0.84, fill: i % 2 ? `url(#${uid}-text)` : C.white }).svg; });
  s += A.text(w * 0.08, h * 0.95, FOOTER, { size: w * 0.017, weight: 600, opacity: 0.45, spacing: w * 0.004 });
  return s + A.finish(w, h, uid);
}

// ═══════════════════════════════════════════════
// المواصفات (العناوين والأوصاف حرفياً من موجز الحملة)
// ═══════════════════════════════════════════════

/** صور config.assets (الاسم والصيغة كما هي) */
const SPEC = [
  { file: "assets/image/terboo.png", w: 267, h: 200, role: "logo lockup (thumbnails)", layout: "thumb", theme: "violet", logo: true },
  { file: "assets/image/terboo2.jpg", w: 736, h: 1076, role: "flagship brand poster", layout: "portrait", theme: "violet", art: "main", overline: "WHATSAPP AI ASSISTANT", title: "Bot Terboo", copy: "Ask anything, download media, create images and play games." },
  { file: "assets/image/terboo3.jpg", w: 320, h: 320, out: [720, 720], role: "hero icon", layout: "square", theme: "violet", art: "master", title: "Terboo", copy: "AI assistant for modern chats." },
  { file: "assets/image/terboo-v8.jpg", w: 736, h: 1087, role: "campaign poster", layout: "portrait", theme: "violet", art: "ai", overline: "POWERED BY AI", title: "Smarter Chats", copy: "Fast answers, smart tools and creative power." },
  { file: "assets/image/terboo-landscape.jpg", w: 1280, h: 720, out: [1280, 720], role: "prayer times", layout: "wide", theme: "gold", art: "islamic", overline: "DAILY REMINDER", title: "Prayer Times", copy: "On-time reminders for every prayer, right in your chat." },
  { file: "assets/image/terboo-games.jpg", w: 736, h: 1076, role: "games menu", layout: "portrait", theme: "magenta", art: "game", overline: "PLAY TOGETHER", title: "Games", copy: "Quizzes, puzzles, challenges and more." },
  { file: "assets/image/terboo-rpg.jpg", w: 267, h: 200, role: "RPG", layout: "thumb", theme: "crimson", art: "rpg", title: "RPG" },
  { file: "assets/image/-rpg.jpg", w: 633, h: 633, out: [720, 720], role: "RPG card (legacy name)", layout: "square", theme: "crimson", art: "rpg", overline: "RANKED HERO", title: "RPG", copy: "Adventure and progression." },
  { file: "assets/image/terboo-levelup.jpg", w: 267, h: 200, role: "level up", layout: "thumb", theme: "green", art: "levelup", title: "Level Up" },
  { file: "assets/image/terboo-winner.jpg", w: 720, h: 720, role: "winner", layout: "square", theme: "gold", art: "winner", overline: "VICTORY", title: "Winner", copy: "Congratulations." },
  { file: "assets/image/terboo-store.png", w: 736, h: 736, role: "store", layout: "square", theme: "gold", art: "store", overline: "PREMIUM", title: "Store", copy: "Shop and unlock premium features." },
  { file: "assets/image/terboo-rules.jpg", w: 736, h: 736, out: [1080, 1080], role: "group rules", layout: "square", theme: "blue", art: "group", overline: "COMMUNITY", title: "Group Rules", copy: "Please read the rules before you begin." },
  { file: "assets/image/terboo-promote.png", w: 534, h: 400, out: [1280, 959], role: "promote (group notice header)", layout: "square", theme: "green", art: "promote", overline: "ADMIN UPDATE", title: "Promoted", copy: "A new admin joins the team." },
  { file: "assets/image/terboo-demote.png", w: 736, h: 1087, out: [867, 1280], role: "demote (group notice header)", layout: "portrait", theme: "crimson", art: "demote", overline: "ADMIN UPDATE", title: "Demoted", copy: "This member is no longer an admin." },
  { file: "assets/image/terboo-daftar.png", w: 720, h: 720, out: [1080, 1080], role: "registration", layout: "square", theme: "violet", art: "register", overline: "IDENTITY CONFIRMED", title: "Registered", copy: "Welcome aboard." },
  { file: "assets/image/terboo-minecraft.jpg", w: 267, h: 200, role: "Minecraft", layout: "thumb", theme: "green", art: "minecraft", title: "Minecraft" },
  { file: "assets/image/terboo-fishit.jpg", w: 267, h: 200, role: "fishing game", layout: "thumb", theme: "blue", art: "fishing", title: "Fishing" },
  { file: "assets/image/terboo-kertas.jpg", w: 1024, h: 784, role: "handwriting paper (text drawn at x 344–944, y 78–)", layout: "paper" },
  { file: "assets/image/test.webp", w: 320, h: 320, out: [720, 720], role: "test image", layout: "square", theme: "indigo", art: "test", title: "Test", copy: "Tested tools. Ready to use." },
  { file: "assets/image/pp-kosong.jpg", w: 1200, h: 1200, out: [1080, 1080], role: "default avatar", layout: "avatar" },
  { file: "assets/image/cards/welcome-plate.jpg", w: 1280, h: 720, out: [1280, 720], role: "welcome card background (avatar, name, group and count drawn at send time)", layout: "plate", theme: "violet", art: "main", seed: 301 },
  { file: "assets/image/cards/goodbye-plate.jpg", w: 1280, h: 720, out: [1280, 720], role: "goodbye card background (avatar, name, group and count drawn at send time)", layout: "plate", theme: "crimson", art: "master", seed: 307 },
  { file: "assets/image/terboo-banner.jpg", w: 1280, h: 720, out: [1280, 720], role: "main menu header", layout: "wide", theme: "violet", art: "main", overline: "BOT TERBOO", title: "Main Menu", copy: "Every section and command in one place." },
];

/** الأقسام: [مفتاح الملف · العنوان · سطر الوصف · اللون · مفتاح المشهد] */
const SECTION_DATA = [
  ["ai", "AI Assistant", "Think faster. Create more. Ask anything.", "violet", "ai"],
  ["anime", "Anime", "Anime-inspired creativity, stories and visuals.", "magenta", "anime"],
  ["asupan", "Clips", "Quick visual content, ready to share.", "violet", "asupan"],
  ["canvas", "Canvas", "Create, remix and design with style.", "violet", "canvas"],
  ["cecan", "Pictures", "Discover, create and transform visuals.", "magenta", "cecan"],
  ["cloud", "Terboo Cloud", "Your servers and panels in one place.", "blue", "cloud"],
  ["cek", "Checks", "Verify details in seconds.", "green", "cek"],
  ["clan", "Clans", "Create teams, tribes and communities.", "crimson", "clan"],
  ["convert", "Convert", "Transform files with a single command.", "teal", "convert"],
  ["date", "Date", "Dates, calendars and time utilities.", "violet", "date"],
  ["default", "All Sections", "One command hub. Every capability.", "violet", "main"],
  ["downloader", "Downloads", "Download media fast and clean.", "blue", "downloader"],
  ["ephoto", "Photo Effects", "Apply bold effects to photos.", "magenta", "ephoto"],
  ["fun", "Fun", "Lightweight entertainment for every chat.", "magenta", "fun"],
  ["game", "Games", "Play quick interactive games anywhere.", "magenta", "game"],
  ["group", "Groups", "Manage groups, members and access.", "blue", "group"],
  ["info", "Info", "Useful information at a glance.", "blue", "info"],
  ["islamic", "Islamic", "Prayer tools and faith-friendly utilities.", "gold", "islamic"],
  ["kerja", "Jobs", "Work, tasks and useful productivity tools.", "green", "kerja"],
  ["linode", "Linode", "Manage cloud infrastructure and services.", "teal", "linode"],
  ["main", "Main", "The core of the Bot Terboo experience.", "violet", "main"],
  ["media", "Media", "Media tools for modern chats.", "crimson", "media"],
  ["nsfw", "Restricted", "Restricted tools and protected access.", "crimson", "nsfw"],
  ["owner", "Owner", "Advanced control for the owner.", "gold", "owner"],
  ["panel", "Panel", "Manage configuration, services and access.", "blue", "panel"],
  ["photo", "Photos", "Photo tools, edits and visual utilities.", "blue", "photo"],
  ["primbon", "Horoscope", "Explore signs, symbols and fun readings.", "indigo", "primbon"],
  ["pushkontak", "Contacts", "Connect, organize and manage contacts.", "green", "pushkontak"],
  ["random", "Random", "Discover something unexpected.", "green", "random"],
  ["religi", "Islamic", "Faith, reflection and respectful utilities.", "gold", "islamic"],
  ["rpg", "RPG", "Adventure, combat, ranks and progression.", "crimson", "rpg"],
  ["search", "Search", "Find what you need in seconds.", "violet", "search"],
  ["sekolah", "School", "Learning tools for everyday study.", "blue", "sekolah"],
  ["stalker", "LookUp", "Lookup public information and signals.", "indigo", "stalker"],
  ["sticker", "Stickers", "Turn ideas into expressive stickers.", "magenta", "sticker"],
  ["store", "Store", "Explore premium features and tools.", "gold", "store"],
  ["tools", "Tools", "Practical tools for everyday tasks.", "green", "tools"],
  ["tts", "Text to Speech", "Turn text into clear expressive voice.", "blue", "tts"],
  ["turnamen", "Tournaments", "Run brackets, matches and competitions.", "gold", "turnamen"],
  ["user", "Account", "Your profile, settings and access.", "indigo", "user"],
  ["utility", "Utility", "Handy functions for daily use.", "green", "utility"],
  ["vps", "VPS", "Manage virtual servers and infrastructure.", "blue", "vps"],
  ["عام", "General", "General commands and everyday essentials.", "indigo", "general"],
];
/** رمز الشعار الهولوغرامي لكل قسم */
const SECTION_ICON = {
  ai: "chip", anime: "sparkle", asupan: "film", canvas: "brush", cecan: "image", cloud: "cloud", cek: "scan", clan: "shield", convert: "convert", date: "calendar",
  default: "grid", downloader: "download", ephoto: "sparkle", fun: "smile", game: "gamepad", group: "users", info: "info", islamic: "crescent",
  kerja: "briefcase", linode: "cloud", main: "home", media: "film", nsfw: "lock", owner: "crown", panel: "server", photo: "image", primbon: "star",
  pushkontak: "contacts", random: "dice", religi: "crescent", rpg: "sword", search: "search", sekolah: "book", stalker: "eye", sticker: "sticker",
  store: "bag", tools: "wrench", tts: "wave", turnamen: "trophy", user: "user", utility: "bolt", vps: "server", "عام": "chat",
};
/** قدرات حقيقية من أوامر كل قسم (تظهر كشرائح على صورته) */
const SECTION_CHIPS = {
  ai: ["Chat AI", "Image AI", "Upscale"], anime: ["Anime feed", "Auto posts"], asupan: ["TikTok picks", "Random videos"],
  canvas: ["Chat cards", "Story cards", "Call cards"], cecan: ["Photo sets", "By country"], cloud: ["My VPS", "Panels", "Plans"],
  cek: ["Personality", "Luck", "Fun tests"], clan: ["Create clans", "Clan wars", "Members"], convert: ["Audio FX", "Smart stickers"],
  date: ["Calendar", "Time"], default: ["AI", "Tools", "Downloads"], downloader: ["Social video", "Spotify", "MediaFire"],
  ephoto: ["Photo effects", "Filters"], fun: ["Matchmaking", "Lucky draw", "Confessions"], game: ["Tic-tac-toe", "Guess games", "Riddles"],
  group: ["Moderation", "Word filter", "Attendance"], info: ["Weather", "Earthquakes", "Football"], islamic: ["Quran text", "Quran audio"],
  kerja: ["Jobs", "Productivity"], linode: ["Server details"], main: ["Menu", "Status", "Leaderboard"], media: ["Music"],
  nsfw: ["Restricted"], owner: ["Broadcast", "Premium", "Bot control"], panel: ["Servers", "Users", "Themes"], photo: ["Name art"],
  primbon: ["Horoscope", "Name meaning", "Dreams"], pushkontak: ["Contact push"], random: ["Quotes", "Memes"],
  religi: ["Prayer times", "Quran", "Names of Allah"], rpg: ["Mining", "Fishing", "Farming"], search: ["Wikipedia", "Pinterest", "Songs"],
  sekolah: ["Study", "Learning"], stalker: ["TikTok", "Instagram", "GitHub"], sticker: ["Text stickers", "Emoji mix", "Quote cards"],
  store: ["Products", "Stock", "Orders"], tools: ["Compress", "Enhance", "Screenshots"], tts: ["Voices", "Speak"],
  turnamen: ["Brackets", "Matches"], user: ["Profile", "Level", "Language"], utility: ["Quick checks"], vps: ["Create", "List", "Power"],
  "عام": ["AI", "Tools", "Games"],
};
/** عدد الأوامر الفعلي لكل قسم (من البلوقنات نفسها) */
const COMMAND_COUNTS = (() => {
  const counts = {};
  for (const dir of fs.readdirSync(path.join(ROOT, "plugins"))) {
    const folder = path.join(ROOT, "plugins", dir);
    if (!fs.statSync(folder).isDirectory()) continue;
    for (const file of fs.readdirSync(folder).filter((f) => f.endsWith(".js"))) {
      const hit = fs.readFileSync(path.join(folder, file), "utf8").match(/^\s*category:\s*["']([^"']+)["']/m);
      if (hit) counts[hit[1]] = (counts[hit[1]] || 0) + 1;
    }
  }
  return counts;
})();
const SECTIONS = SECTION_DATA.map(([cat, title, copy, theme, artKey], i) => ({
  file: `assets/image/sections/${cat}.jpg`, w: 1280, h: 720, out: [1280, 720], role: `section image: ${cat}`, layout: "section",
  cat, title, copy, theme, art: artKey, icon: SECTION_ICON[cat] || "grid", overline: `SECTION ${String(i + 1).padStart(2, "0")}`, seed: 40 + i * 3,
  chips: SECTION_CHIPS[cat] || [], commands: cat === "default" ? Object.values(COMMAND_COUNTS).reduce((sum, n) => sum + n, 0) : COMMAND_COUNTS[cat] || 0,
}));

/** صور الواجهات الجديدة (assets/image/ui): اللغة · التسجيل · النمط · اللوحات · VPS · الباقات · الذكاء · العام */
const UI_DATA = [
  ["language", "WELCOME", "Choose Your Language", "Arabic · English · Spanish", "violet", "master", "chat"],
  ["registration", "YOUR ACCOUNT", "Create Your Account", "Name, age and gender in one simple card.", "violet", "register", "user"],
  ["usage", "PERSONALIZE", "Your Experience", "Tell Terboo how you will use it.", "indigo", "main", "grid"],
  ["panel", "MY PANELS", "Panel Control", "Connect and manage your own game panels.", "blue", "panel", "server"],
  ["vps", "TERBOO VPS", "VPS Control", "Power, security and control for your server.", "blue", "vps", "cloud"],
  ["plans", "TERBOO VPS", "VPS Plans", "Standard and Economy plans with clear pricing.", "gold", "owner", "star"],
  ["ai", "TERBOO AI", "Ask Anything", "Understand, create and get things done.", "violet", "ai", "chip"],
  ["general", "GENERAL MODE", "Everyday Terboo", "AI, tools, downloads and games in one chat.", "indigo", "general", "sparkle"],
];
const UI_CARDS = UI_DATA.map(([name, overline, title, copy, theme, art, icon], i) => ({
  file: `assets/image/ui/${name}.jpg`, w: 1280, h: 720, out: [1280, 720], role: `ui card: ${name}`, layout: "wide",
  overline, title, copy, theme, art, icon, seed: 140 + i * 5,
}));
const PLAN_CARDS = [];

/** صور الردود العشوائية (srt) */
const SHUFFLE = [
  { layout: "square", theme: "violet", art: "main", overline: "BOT TERBOO", title: "Your AI on WhatsApp", copy: "Ask anything. Create, explore and play." },
  { layout: "square", theme: "violet", art: "general", overline: "ONE CHAT", title: "Everything in One Chat", copy: "AI, downloads, games, stickers and more." },
  { layout: "square", theme: "violet", art: "chat", overline: "START HERE", title: "Just Ask.", copy: "One prompt can start almost anything." },
  { layout: "type", theme: "green", art: "master" },
  { layout: "square", theme: "gold", art: "owner", overline: "PREMIUM", title: "Premium Experience", copy: "More power. More possibilities." },
  { layout: "square", theme: "blue", art: "group", overline: "COMMUNITIES", title: "Made for Groups", copy: "Built for communities and group chats." },
  { layout: "square", theme: "violet", art: "ai", overline: "INTELLIGENCE", title: "Powered by AI", copy: "Fast, creative and intelligent." },
  { layout: "square", theme: "green", art: "tools", overline: "UTILITIES", title: "Everyday Tools", copy: "Practical utilities for every chat." },
].map((o, i) => ({ file: `assets/image/shuffle/terboo-shuffle-${String(i + 1).padStart(2, "0")}.jpg`, w: 800, h: 800, role: "random reply image (srt)", seed: 90 + i * 7, ...o }));

const LAYOUTS = { plans: layoutPlans, plate: layoutPlate, section: layoutSection, wide: layoutWide, square: layoutSquare, portrait: layoutPortrait, thumb: layoutThumb, paper: layoutPaper, avatar: layoutAvatar, type: layoutType };

/** أصول وظيفية تُترك كما هي */
const KEPT = [
  { glob: /^assets\/kertas\//, reason: "functional: original handwriting paper (magernulis)" },
  { glob: /^assets\/meme\//, reason: "functional: meme template and its font" },
  { glob: /^assets\/fonts\//, reason: "fonts (Plus Jakarta Sans, Inter, Cairo, Noto Sans Arabic, JetBrains Mono and feature fonts)" },
  { glob: /^assets\/audio\/|^assets\/video\//, reason: "media used by existing commands" },
  { glob: /^assets\/terboo-font\.ttf$/, reason: "legacy font used by existing canvas code" },
];

const ALL = [...SPEC, ...SECTIONS, ...UI_CARDS, ...PLAN_CARDS, ...SHUFFLE];

async function render(spec, outRoot) {
  const uid = `u${crypto.createHash("md5").update(spec.file).digest("hex").slice(0, 6)}`;
  const scene = resolveScene(spec);
  const grid = await maskGrid(scene.key);
  let body = LAYOUTS[spec.layout](spec.w, spec.h, { ...spec, uid, scene, grid });
  // كل صورة تُرسم بضعف مقاسها ثم تُصغَّر (lanczos + توضيح خفيف) ⇒ نصوص وحواف واضحة بدقة 720–1080
  const [ow, oh] = spec.out || [spec.w, spec.h];
  const ss = 2;
  const scale = (ow * ss) / spec.w;
  body = body.replace(`<pattern id="${uid}-grain" `, `<pattern id="${uid}-grain" patternTransform="scale(${A.r1((1 / scale) * 100) / 100})" `);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${ow * ss}" height="${oh * ss}" viewBox="0 0 ${spec.w} ${spec.h}" preserveAspectRatio="none">${body}</svg>`;
  let img = sharp(Buffer.from(svg), { limitInputPixels: false }).resize(ow, oh, { kernel: "lanczos3" });
  if (spec.layout !== "paper") img = img.sharpen({ sigma: 0.55, m1: 0.6, m2: 1.2 });
  const ext = path.extname(spec.file).toLowerCase();
  // ‎4:4:4 لنصوص الصور الكاملة؛ الصورة الرمزية بلا نص ⇒ 4:2:0 (أخف بلا فرق مرئي)
  const full = Boolean(spec.out) && spec.layout !== "avatar";
  img = ext === ".png" ? img.png({ compressionLevel: 9, palette: ow * oh > 200_000, quality: 95, dither: 1, effort: 8 })
    : ext === ".webp" ? img.webp({ quality: 90 })
      : img.flatten({ background: C.base }).jpeg({ quality: spec.layout === "paper" ? 92 : 90, mozjpeg: true, chromaSubsampling: full ? "4:4:4" : "4:2:0" });
  const buffer = await img.toBuffer();
  const target = path.join(outRoot, spec.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  return buffer;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function referencesOf(file) {
  const base = path.basename(file);
  if (/^assets\/image\/sections\//.test(file)) return ["plugins/main/فئة.js"];
  if (/^assets\/image\/shuffle\//.test(file)) return ["src/lib/terboo-serialize.js"];
  if (/^assets\/image\/ui\//.test(file)) return ["src/lib/terboo-ui-kit.js"];
  try {
    return execFileSync("grep", ["-rlFw", "--include=*.js", "--include=*.mjs", "--", base, "src", "plugins", "case", "config.js", "index.js"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();
  } catch (error) {
    // grep يخرج بـ1 حين لا يجد شيئاً (الجواب: لا مراجع)؛ غير ذلك خطأ حقيقي يُرمى
    if (error?.status === 1) return [];
    throw error;
  }
}

async function manifest() {
  const generated = new Map(ALL.map((s) => [s.file, s]));
  const assets = [];
  for (const abs of walk(path.join(ROOT, "assets")).sort()) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const buffer = fs.readFileSync(abs);
    const isImage = /\.(png|jpe?g|webp|gif)$/i.test(rel);
    const meta = isImage ? await sharp(buffer).metadata() : null;
    const spec = generated.get(rel);
    const kept = KEPT.find((k) => k.glob.test(rel));
    const artUsed = spec && !spec.logo && spec.layout !== "paper" ? (spec.layout === "avatar" ? "master" : resolveScene(spec).key) : null;
    assets.push({
      path: rel,
      status: spec ? "generated" : "kept",
      role: spec?.role || kept?.reason || "other",
      ...(artUsed ? { art: artUsed } : {}),
      ...(meta ? { width: meta.width, height: meta.height, format: meta.format } : {}),
      bytes: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      referencedBy: referencesOf(rel),
    });
  }
  const art = fs.existsSync(ART_DIR) ? fs.readdirSync(ART_DIR).filter((f) => f.endsWith(".jpg")).sort() : [];
  const out = {
    $comment: "Generated by tools/terboo-brand-assets.mjs — do not edit by hand.",
    generatedAt: new Date().toISOString(),
    brand: {
      name: "Bot Terboo", style: "Neon Shinobi / Cyber Sentinel — one signature cyber-shinobi character, the giant TERBOO name (Anton) behind him, English-only text",
      palette: { obsidian: C.base, violet: C.violet, cyan: C.cyan, magenta: C.magenta, ...Object.fromEntries(Object.entries(A.THEMES).slice(0, 8).map(([k, v]) => [k, v.join(" → ")])) },
      fonts: { display: "Plus Jakarta Sans ExtraBold (assets/fonts/terboo)", body: "Inter (assets/fonts/terboo)", name: "Anton (assets/fonts/terboo) — the giant TERBOO behind the character" },
      mark: "Original angular T fused with a speech-bubble outline and a katana-cut slash: obsidian core, electric-violet edge, cyan highlight. Wordmark: BOT TERBOO.",
      canvaArt: art.map((f) => `tools/brand-art/shinobi/${f} (Canva AI with the master character as reference, upscaled x4 by Real-ESRGAN anime 6B to 2160px; character mask by BiRefNet)`),
      rule: "config.assets names and formats are unchanged. Images the bot sends as full pictures stay within 720-1080 (sections, menu banner, prayer and UI cards 1280x720; rules, registration and default avatar 1080x1080; promote 1280x959; demote 867x1280); images it embeds as message thumbnails keep a small size (WhatsApp thumbnail limit). Every image is rendered at 2x, then downscaled (lanczos) and lightly sharpened. The handwriting paper stays 1024x784 (the size the command writes on).",
    },
    summary: {
      total: assets.length,
      generated: assets.filter((a) => a.status === "generated").length,
      kept: assets.filter((a) => a.status === "kept").length,
      sections: SECTIONS.length,
      ui: UI_CARDS.length + PLAN_CARDS.length,
      shuffle: SHUFFLE.length,
      scenes: art.length,
      brokenReferences: brokenReferences(),
    },
    assets,
  };
  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "docs/terboo-asset-manifest.json"), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

/** كل مسار ./assets/… مذكور في config.js موجود فعلاً */
function brokenReferences() {
  const config = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  return [...new Set([...config.matchAll(/["'`]\.\/(assets\/[^"'`]+)["'`]/g)].map((m) => m[1]))].filter((p) => !fs.existsSync(path.join(ROOT, p)));
}

const outIndex = process.argv.indexOf("--out");
const outRoot = outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : ROOT;
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
if (!process.argv.includes("--manifest")) {
  if (outRoot === ROOT) {
    // صور shuffle القديمة المنقولة (أسماء md5) تُزال؛ صور المالك المضافة بأسماء أخرى تبقى
    const dir = path.join(ROOT, "assets/image/shuffle");
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (!SHUFFLE.some((s) => s.file.endsWith(`/${name}`)) && /^[0-9a-f]{32}\.jpg$/.test(name)) fs.rmSync(path.join(dir, name));
  }
  // 3 صور معاً (librsvg يرسم كل صورة في خيط واحد)
  const queue = ALL.filter((spec) => !only || spec.file.includes(only));
  const jobs = Number(process.env.TERBOO_RENDER_JOBS || 3);
  await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await render(queue.shift(), outRoot); }));
}
if (outRoot === ROOT) {
  const out = await manifest();
  console.log(`✅ docs/terboo-asset-manifest.json: ${out.summary.total} أصل · ${out.summary.generated} مولّد (${out.summary.sections} قسم · ${out.summary.shuffle} shuffle · ${out.summary.scenes} مشهد Canva) · ${out.summary.kept} محفوظ · مسارات مكسورة: ${out.summary.brokenReferences.length}`);
} else {
  console.log(`✅ معاينة: ${ALL.length} صورة في ${outRoot}`);
}

export { ALL, PLAN_CARDS, SECTIONS, SHUFFLE, SPEC, UI_CARDS };
