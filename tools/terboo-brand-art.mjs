// ═══════════════════════════════════════════════
// ✦ Terboo Brand Art — مكتبة رسم هوية Bot Terboo «Neon Shinobi» (SVG)
// ───────────────────────────────────────────────
// ما يُرسم بالكود فوق فن الشخصية، وكل النصوص بالإنجليزية:
//   • اللوحة: أوبسيديان #050508 + بنفسجي #a855f7 + سماوي #22d3ee + لمسات ماجنتا، ولون لكل قسم (THEMES).
//   • الشعار: T زاوي مندمج بفقاعة محادثة + قطع كاتانا (logoMark) و«BOT TERBOO» (wordmark · signature).
//   • الطباعة: عناوين Plus Jakarta Sans ExtraBold · نص Inter · كبسولات وفقرات متوازنة الأسطر.
//   • الأيقونات الخطية (ICONS) لشعارات الأقسام الهولوغرامية.
// كل شيء متّجه ومُولَّد من الكود (بذرة ثابتة ⇒ نفس الصورة في كل تشغيل).
// ═══════════════════════════════════════════════

const C = { base: "#050508", surface: "#101016", white: "#ffffff", silver: "#d6d9e6", ink: "#0d0d14", paper: "#f4f5fa", violet: "#a855f7", cyan: "#22d3ee", magenta: "#e879f9" };
const FONT = { display: "Plus Jakarta Sans ExtraBold", heading: "Plus Jakarta Sans", body: "Inter" };

/** أزواج التدرّج — لون لكل قسم */
const THEMES = {
  violet: ["#8b5cf6", "#22d3ee"],
  magenta: ["#a855f7", "#e879f9"],
  blue: ["#3b82f6", "#22d3ee"],
  green: ["#10b981", "#22d3ee"],
  teal: ["#14b8a6", "#22d3ee"],
  gold: ["#f59e0b", "#a855f7"],
  crimson: ["#f43f5e", "#a855f7"],
  indigo: ["#6366f1", "#a855f7"],
  // أسماء «Aurora» السابقة تبقى صالحة
  azure: ["#3b82f6", "#22d3ee"], mint: ["#10b981", "#22d3ee"], coral: ["#f43f5e", "#a855f7"], amber: ["#f59e0b", "#a855f7"], rose: ["#a855f7", "#e879f9"], lime: ["#10b981", "#22d3ee"],
};

/** مولّد عشوائي ثابت البذرة (mulberry32) */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n) => Math.round(n * 10) / 10;

/** قياس عرض النص (يُحقن من المولّد بقياس Canvas الحقيقي؛ والاحتياطي تقدير) */
let measure = (value, { size, family }) => String(value).length * size * (family === FONT.display ? 0.62 : 0.56);
function setMeasurer(fn) { measure = fn; }

function defs(uid, theme = "violet") {
  const [a, b] = THEMES[theme] || THEMES.violet;
  return `<defs>
    <linearGradient id="${uid}-brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    ${Object.entries(THEMES).map(([name, [ta, tb]]) => `<linearGradient id="${uid}-g-${name}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ta}"/><stop offset="1" stop-color="${tb}"/></linearGradient><radialGradient id="${uid}-o-${name}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${tb}" stop-opacity=".55"/><stop offset=".45" stop-color="${ta}" stop-opacity=".22"/><stop offset="1" stop-color="${ta}" stop-opacity="0"/></radialGradient>`).join("")}
    <linearGradient id="${uid}-text" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <radialGradient id="${uid}-orbA" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${a}" stop-opacity=".55"/><stop offset=".5" stop-color="${a}" stop-opacity=".18"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${uid}-orbB" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${b}" stop-opacity=".45"/><stop offset=".5" stop-color="${b}" stop-opacity=".14"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${uid}-orbW" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".10"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <linearGradient id="${uid}-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".55" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${uid}-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#fff" stop-opacity=".03"/></linearGradient>
    <linearGradient id="${uid}-stroke" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity=".06"/></linearGradient>
    <linearGradient id="${uid}-vfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.base}" stop-opacity="0"/><stop offset="1" stop-color="${C.base}" stop-opacity=".85"/></linearGradient>
    <radialGradient id="${uid}-gridmask" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <mask id="${uid}-fade"><rect width="100%" height="100%" fill="url(#${uid}-gridmask)"/></mask>
    <pattern id="${uid}-grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="1"/></pattern>
    <pattern id="${uid}-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="#fff" fill-opacity=".09"/></pattern>
    <pattern id="${uid}-grain" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".5" fill="#fff" fill-opacity=".035"/><circle cx="3.5" cy="3" r=".45" fill="#000" fill-opacity=".05"/></pattern>
    <filter id="${uid}-shadow" x="-40%" y="-40%" width="180%" height="190%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="18"/><feOffset dy="18"/><feComponentTransfer><feFuncA type="linear" slope=".55"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${uid}-soft" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="28"/></filter>
    <filter id="${uid}-blur" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>`;
}

/** خلفية «أورورا»: جرافيت + توهّجان ملوّنان + شبكة تتلاشى + حبيبات */
function background(w, h, { uid, seed = 1, grid = "lines", orbs = null } = {}) {
  const rand = rng(seed * 17 + 3);
  const m = Math.max(w, h);
  const spots = orbs || [
    { x: w * (0.68 + rand() * 0.2), y: h * (0.15 + rand() * 0.25), r: m * (0.55 + rand() * 0.15), fill: "orbA" },
    { x: w * (0.1 + rand() * 0.25), y: h * (0.75 + rand() * 0.2), r: m * (0.45 + rand() * 0.15), fill: "orbB" },
    { x: w * 0.5, y: h * 0.05, r: m * 0.4, fill: "orbW" },
  ];
  let out = `<rect width="${w}" height="${h}" fill="${C.base}"/>`;
  for (const s of spots) out += `<circle cx="${r1(s.x)}" cy="${r1(s.y)}" r="${r1(s.r)}" fill="url(#${uid}-${s.fill})"/>`;
  if (grid) out += `<rect width="${w}" height="${h}" fill="url(#${uid}-${grid === "dots" ? "dots" : "grid"})" mask="url(#${uid}-fade)"/>`;
  return out;
}

function finish(w, h, uid) {
  return `<rect width="${w}" height="${h}" fill="url(#${uid}-grain)"/>`;
}

/** مسار «سكويركل» (مستطيل بزوايا متصلة ناعمة) */
function squircle(x, y, s, k = 0.3) {
  const r = s * k;
  const c = r * 0.45;
  return `M${r1(x + r)} ${r1(y)} H${r1(x + s - r)} C${r1(x + s - c)} ${r1(y)} ${r1(x + s)} ${r1(y + c)} ${r1(x + s)} ${r1(y + r)} V${r1(y + s - r)} C${r1(x + s)} ${r1(y + s - c)} ${r1(x + s - c)} ${r1(y + s)} ${r1(x + s - r)} ${r1(y + s)} H${r1(x + r)} C${r1(x + c)} ${r1(y + s)} ${r1(x)} ${r1(y + s - c)} ${r1(x)} ${r1(y + s - r)} V${r1(y + r)} C${r1(x)} ${r1(y + c)} ${r1(x + c)} ${r1(y)} ${r1(x + r)} ${r1(y)} Z`;
}

// ═══════════════════════════════════════════════
// الأيقونات (خطية 24×24)
// ═══════════════════════════════════════════════

const ICONS = {
  crown: `<path d="M3 18h18M4 8l4 4 4-7 4 7 4-4-1.5 10h-13z"/>`,
  users: `<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.6 3-5.6 6-5.6s5.4 2 6 5.6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.6c2.6.2 4.2 2 4.7 4.8"/>`,
  wrench: `<path d="M14.5 6.5a4 4 0 0 0 5 5l-8.8 8.8a2 2 0 0 1-2.8-2.8l8.8-8.8a4 4 0 0 0-2.2-2.2z"/><path d="M19.5 4.5l-3 3"/>`,
  chip: `<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>`,
  sword: `<path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>`,
  smile: `<circle cx="12" cy="12" r="9"/><path d="M8 14c1 1.6 2.4 2.4 4 2.4s3-.8 4-2.4"/><path d="M9 9.5h.01M15 9.5h.01"/>`,
  scan: `<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10"/>`,
  download: `<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>`,
  gamepad: `<rect x="2" y="7" width="20" height="11" rx="5.5"/><path d="M7 10.5v4M5 12.5h4"/><circle cx="15.5" cy="11.5" r="1"/><circle cx="18" cy="14" r="1"/>`,
  sticker: `<path d="M5 3h10l6 6v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/><path d="M8 14c1.5 2 6.5 2 8 0"/><circle cx="9" cy="10" r=".8"/><circle cx="14" cy="10" r=".8"/>`,
  server: `<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>`,
  home: `<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>`,
  brush: `<path d="M19 3l2 2-9.5 9.5-2-2z"/><path d="M9.5 12.5c-2.5 0-4 1.5-4 4 0 1.5-1 2.5-2.5 2.5 1 1.5 3 2 5 2 3 0 4.5-2 4.5-4.5"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>`,
  bag: `<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>`,
  eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>`,
  shield: `<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>`,
  star: `<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>`,
  image: `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>`,
  cloud: `<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z"/>`,
  dice: `<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="16" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="8" cy="16" r="1"/>`,
  crescent: `<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>`,
  convert: `<path d="M4 7h13l-3-3M20 17H7l3 3"/>`,
  film: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>`,
  wave: `<path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4"/>`,
  sparkle: `<path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z"/>`,
  contacts: `<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7.5 18c.7-2.4 2.4-3.6 4.5-3.6s3.8 1.2 4.5 3.6"/>`,
  lock: `<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
  trophy: `<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>`,
  book: `<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>`,
  briefcase: `<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`,
  levelup: `<path d="M17 11l-5-5-5 5"/><path d="M17 18l-5-5-5 5"/>`,
  promote: `<path d="M12 19V5M5 12l7-7 7 7"/>`,
  demote: `<path d="M12 5v14M5 12l7 7 7-7"/>`,
  card: `<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4"/><path d="M14 10h4M14 14h3"/>`,
  cube: `<path d="M12 2l9 5v10l-9 5-9-5V7l9-5z"/><path d="M12 22V12M21 7l-9 5-9-5"/>`,
  fish: `<path d="M6.5 12c3-5 9-6 13 0-4 6-10 5-13 0z"/><path d="M6.5 12L3 9v6l3.5-3z"/><circle cx="16" cy="11" r=".9"/>`,
  rules: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>`,
  flask: `<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>`,
  grid: `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`,
  chat: `<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>`,
  bolt: `<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>`,
};

/** أيقونة تطبيق لامعة: ظل ملوّن · تدرّج · لمعة علوية · حد زجاجي · رمز أبيض */
function appIcon(name, cx, cy, size, { uid, theme = "violet", glow = true } = {}) {
  const x = cx - size / 2;
  const y = cy - size / 2;
  const s = (size * 0.5) / 24;
  const stroke = size < 90 ? 2.2 : 1.9;
  return `<g>
    ${glow ? `<ellipse cx="${r1(cx)}" cy="${r1(cy + size * 0.12)}" rx="${r1(size * 0.95)}" ry="${r1(size * 0.85)}" fill="url(#${uid}-o-${theme})"/>` : ""}
    <path d="${squircle(x, y, size)}" fill="url(#${uid}-g-${theme})"/>
    <path d="${squircle(x, y, size)}" fill="url(#${uid}-shine)"/>
    <path d="${squircle(x + 1, y + 1, size - 2)}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="${r1(Math.max(1, size * 0.008))}"/>
    <g transform="translate(${r1(cx - 12 * s)} ${r1(cy - 12 * s)}) scale(${r1(s * 1000) / 1000})" fill="none" stroke="#fff" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.grid}</g>
  </g>`;
}

/** الشعار: T زاوي مندمج بفقاعة محادثة زاوية + قطع كاتانا قطري · قلب أوبسيديان · حافة بنفسجية · لمعة سماوية */
function logoMark(cx, cy, size, { uid, glow = true } = {}) {
  const s = size / 100;
  const bubble = "M16 8 H84 L94 18 V60 L84 70 H42 L22 90 L25 70 H16 L6 60 V18 Z";
  return `<g transform="translate(${r1(cx - size / 2)} ${r1(cy - size / 2)}) scale(${r1(s * 1000) / 1000})">
    <defs>
      <linearGradient id="${uid}-lgO" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262636"/><stop offset="1" stop-color="#050508"/></linearGradient>
      <linearGradient id="${uid}-lgE" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient>
      <linearGradient id="${uid}-lgT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9bdd6"/></linearGradient>
    </defs>
    ${glow ? `<ellipse cx="50" cy="50" rx="70" ry="62" fill="url(#${uid}-orbA)"/>` : ""}
    <path d="${bubble}" fill="url(#${uid}-lgO)" stroke="url(#${uid}-lgE)" stroke-width="3.2" stroke-linejoin="round"/>
    <path d="M18 8 H58" stroke="${C.cyan}" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>
    <path d="M24 22 H76 L71 32 H29 Z" fill="url(#${uid}-lgT)"/>
    <path d="M44 32 H56 V50 L50 61 L44 50 Z" fill="url(#${uid}-lgT)"/>
    <path d="M99 3 L57 45" stroke="${C.base}" stroke-width="3"/>
    <path d="M97 3.5 L56.5 44" stroke="${C.violet}" stroke-width=".9" opacity=".9"/>
  </g>`;
}

// ═══════════════════════════════════════════════
// الطباعة
// ═══════════════════════════════════════════════

function text(x, y, value, { size, family = FONT.body, weight = 500, fill = C.white, opacity = 1, spacing = 0, anchor = "start" } = {}) {
  return `<text x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}" font-family="${family}" font-weight="${weight}" font-size="${r1(size)}" fill="${fill}" fill-opacity="${opacity}" letter-spacing="${r1(spacing)}">${esc(value)}</text>`;
}

/** عنوان كبير؛ يصغر تلقائياً ليتسع للعرض */
function headline(x, y, value, { size, maxWidth, fill = C.white, anchor = "start" } = {}) {
  let fs = size;
  while (fs > 12 && measure(value, { size: fs, family: FONT.display, weight: 800 }) > maxWidth) fs -= 2;
  return { svg: text(x, y, value, { size: fs, family: FONT.display, weight: 800, fill, anchor, spacing: -fs * 0.02 }), size: fs };
}

/** تسمية صغيرة بأحرف كبيرة وتباعد */
function label(x, y, value, { size, fill = C.white, opacity = 0.55, anchor = "start" } = {}) {
  return text(x, y, value.toUpperCase(), { size, family: FONT.body, weight: 600, fill, opacity, spacing: size * 0.18, anchor });
}

/** فقرة تلتف على عرض محدد، بأسطر متوازنة (لا كلمة يتيمة في سطر أخير) */
function wrapLines(value, size, width) {
  const lines = [];
  let line = "";
  for (const word of String(value).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, { size, family: FONT.body, weight: 500 }) > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function paragraph(x, y, value, { size, maxWidth, lineHeight = 1.45, opacity = 0.68, anchor = "start", maxLines = 3 } = {}) {
  let lines = wrapLines(value, size, maxWidth);
  if (lines.length > 1) {
    // أضيق عرض يحافظ على عدد الأسطر نفسه ⇒ أسطر متقاربة الطول
    let lo = maxWidth * 0.4;
    let hi = maxWidth;
    while (hi - lo > 4) { const mid = (lo + hi) / 2; if (wrapLines(value, size, mid).length > lines.length) lo = mid; else hi = mid; }
    lines = wrapLines(value, size, hi);
  }
  return { svg: lines.slice(0, maxLines).map((l, i) => text(x, y + i * size * lineHeight, l, { size, opacity, anchor })).join(""), height: Math.min(lines.length, maxLines) * size * lineHeight };
}

/** كبسولات زجاجية؛ تعيد العرض الكلي */
function chips(x, y, items, { uid, size = 22, gap = 12, anchor = "start", accentFirst = false } = {}) {
  const padX = size * 0.85;
  const h = size * 2;
  const widths = items.map((item) => measure(item, { size, family: FONT.body, weight: 600 }) + padX * 2);
  const total = widths.reduce((sum, wv) => sum + wv, 0) + gap * (items.length - 1);
  let cx = anchor === "middle" ? x - total / 2 : x;
  let out = "";
  items.forEach((item, i) => {
    const wv = widths[i];
    const accent = accentFirst && i === 0;
    out += `<rect x="${r1(cx)}" y="${r1(y)}" width="${r1(wv)}" height="${r1(h)}" rx="${r1(h / 2)}" fill="${accent ? `url(#${uid}-brand)` : `url(#${uid}-glass)`}" stroke="url(#${uid}-stroke)" stroke-width="1.2"/>`;
    out += text(cx + wv / 2, y + h / 2 + size * 0.36, item, { size, weight: 600, opacity: accent ? 1 : 0.86, anchor: "middle" });
    cx += wv + gap;
  });
  return { svg: out, width: total, height: h };
}

/** «BOT TERBOO» بأحرف كبيرة: BOT بتدرّج بنفسجي→سماوي · TERBOO أبيض */
function wordmark(x, y, size, { anchor = "start", fill = C.white, uid = "" } = {}) {
  const bot = uid ? `url(#${uid}-lgW)` : C.violet;
  const grad = uid ? `<defs><linearGradient id="${uid}-lgW" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient></defs>` : "";
  return `${grad}<text x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}" font-family="${FONT.display}" font-weight="800" font-size="${r1(size)}" letter-spacing="${r1(size * 0.12)}"><tspan fill="${bot}">BOT</tspan><tspan dx="${r1(size * 0.62)}" fill="${fill}">TERBOO</tspan></text>`;
}

/** شعار صغير + «BOT TERBOO» (توقيع الصور) */
function signature(x, y, size, { uid, anchor = "start" } = {}) {
  const spacing = size * 0.12;
  const wordWidth = measure("BOT", { size, family: FONT.display, weight: 800 }) + measure("TERBOO", { size, family: FONT.display, weight: 800 }) + size * 0.62 + spacing * 9;
  const markSize = size * 1.75;
  const total = markSize + size * 0.5 + wordWidth;
  const left = anchor === "middle" ? x - total / 2 : anchor === "end" ? x - total : x;
  return logoMark(left + markSize / 2, y - size * 0.36, markSize, { uid, glow: false }) + wordmark(left + markSize + size * 0.5, y, size, { uid: `${uid}s` });
}

/** بطاقة زجاجية */
function glassCard(x, y, w, h, { uid, radius = 22 } = {}) {
  return `<rect x="${r1(x)}" y="${r1(y + 10)}" width="${r1(w)}" height="${r1(h)}" rx="${radius}" fill="#000" opacity=".35" filter="url(#${uid}-blur)"/>
    <rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${radius}" fill="${C.surface}" fill-opacity=".78"/>
    <rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${radius}" fill="url(#${uid}-glass)" stroke="url(#${uid}-stroke)" stroke-width="1.4"/>`;
}

/** واجهة محادثة مصغّرة (لقطة منتج): رسائل المستخدم والبوت */
function chatMock(x, y, w, { uid, messages, title = "Bot Terboo", subtitle = "online" } = {}) {
  const pad = 22;
  const size = 21;
  let cursor = y + 92;
  let bubbles = "";
  for (const msg of messages) {
    const bot = msg.from === "bot";
    const maxW = w * 0.74;
    const lines = [];
    let line = "";
    for (const word of msg.text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, { size, family: FONT.body, weight: 500 }) > maxW - 36) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    const bw = Math.min(maxW, Math.max(...lines.map((l) => measure(l, { size, family: FONT.body, weight: 500 }))) + 36);
    const bh = lines.length * size * 1.4 + 26 + (msg.meta ? 14 : 0);
    const bx = bot ? x + pad : x + w - pad - bw;
    bubbles += `<rect x="${r1(bx)}" y="${r1(cursor)}" width="${r1(bw)}" height="${r1(bh)}" rx="18" fill="${bot ? "#1d1d27" : `url(#${uid}-brand)`}" ${bot ? 'stroke="#ffffff" stroke-opacity=".08"' : ""}/>`;
    lines.forEach((l, i) => { bubbles += text(bx + 18, cursor + 13 + size + i * size * 1.4 - 4, l, { size, opacity: bot ? 0.9 : 1 }); });
    if (msg.meta) bubbles += text(bx + bw - 14, cursor + bh - 10, msg.meta, { size: 13, opacity: 0.55, anchor: "end" });
    cursor += bh + 14;
  }
  const h = cursor - y + 10;
  return {
    svg: `${glassCard(x, y, w, h, { uid, radius: 28 })}
    ${logoMark(x + pad + 24, y + 42, 46, { uid, glow: false })}
    ${text(x + pad + 58, y + 38, title, { size: 21, family: FONT.heading, weight: 700 })}
    <circle cx="${r1(x + pad + 62)}" cy="${r1(y + 56)}" r="4.5" fill="#22c55e"/>
    ${text(x + pad + 72, y + 61, subtitle, { size: 15, opacity: 0.55 })}
    <rect x="${r1(x)}" y="${r1(y + 78)}" width="${r1(w)}" height="1" fill="#fff" fill-opacity=".08"/>
    ${bubbles}`,
    height: h,
  };
}

/** حلقات مدارية حول عنصر مركزي */
function orbits(cx, cy, r, { uid, count = 3, seed = 1 } = {}) {
  const rand = rng(seed * 5 + 9);
  let out = "";
  for (let i = 0; i < count; i += 1) {
    const rr = r * (1 + i * 0.36);
    out += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(rr)}" fill="none" stroke="#fff" stroke-opacity="${r1(0.1 - i * 0.025)}" stroke-width="1.4"/>`;
    const ang = -Math.PI / 2 + rand() * Math.PI;
    out += `<circle cx="${r1(cx + rr * Math.cos(ang))}" cy="${r1(cy + rr * Math.sin(ang))}" r="${r1(4 + rand() * 3)}" fill="url(#${uid}-brand)"/>`;
  }
  return out;
}

export { C, FONT, ICONS, THEMES, appIcon, background, chatMock, chips, defs, esc, finish, glassCard, headline, label, logoMark, orbits, paragraph, r1, rng, setMeasurer, signature, squircle, text, wordmark };
