// ═══════════════════════════════════════════════
// 🎨 TERBOO ARCADE — نظام التصميم للألعاب
// ───────────────────────────────────────────────
// ثيمات: NEON · MIDNIGHT · CYBER · CLASSIC · MINIMAL · FANTASY
// رموز (tokens) موحّدة لبطاقات HTML ثلاثية الأبعاد مع النص والأزرار.
// مستجيب (شبكة مرنة · أهداف لمس ≥ 44px) · حركة مع احترام prefers-reduced-motion
// · مدير صوت بلا قناة صوت (no-op آمن) · اتجاه RTL/LTR حسب اللغة.
// أنماط مستخلصة من التصميم المرجعي (توهج نيون · حدود متدرجة · شارات لاعبين · حبة حالة)
// بلا أي معرّفات أو بيانات تحقق أو مصادر من الكود المرجعي.
// ═══════════════════════════════════════════════

import { getFontStack } from "./terboo-fonts.js";

const THEMES = Object.freeze({
  NEON: { id: "NEON", bg: "#0b0820", surface: "#151036", text: "#f4f1ff", muted: "#a59fd0", accent: "#ff3df2", accent2: "#29f0ff", stroke: "#3b2f80", win: "#39ff88", danger: "#ff4d6d", seats: ["#ff3df2", "#29f0ff", "#ffe14d", "#39ff88"], glow: true },
  MIDNIGHT: { id: "MIDNIGHT", bg: "#0a1022", surface: "#121b36", text: "#e8eeff", muted: "#8f9cc4", accent: "#6c8cff", accent2: "#b38cff", stroke: "#24315c", win: "#4dd9a6", danger: "#ff6b81", seats: ["#6c8cff", "#ff9f5a", "#4dd9a6", "#e66cff"], glow: false },
  CYBER: { id: "CYBER", bg: "#05070a", surface: "#0d1418", text: "#d9fff5", muted: "#6fa89a", accent: "#00ffa3", accent2: "#ffd400", stroke: "#123a30", win: "#00ffa3", danger: "#ff2e63", seats: ["#00ffa3", "#ffd400", "#ff2e63", "#3ab8ff"], glow: true },
  CLASSIC: { id: "CLASSIC", bg: "#f3ead8", surface: "#fffaf0", text: "#2b2118", muted: "#7a6a58", accent: "#b23a2a", accent2: "#2a5db2", stroke: "#c9b79a", win: "#2f8f4e", danger: "#b23a2a", seats: ["#b23a2a", "#2a5db2", "#d39b1d", "#2f8f4e"], glow: false },
  MINIMAL: { id: "MINIMAL", bg: "#ffffff", surface: "#f5f6f8", text: "#16181d", muted: "#6b7280", accent: "#111827", accent2: "#2563eb", stroke: "#d1d5db", win: "#059669", danger: "#dc2626", seats: ["#111827", "#2563eb", "#d97706", "#059669"], glow: false },
  FANTASY: { id: "FANTASY", bg: "#1b0f24", surface: "#2a1838", text: "#fff3dc", muted: "#cbb08a", accent: "#ffb547", accent2: "#9d7bff", stroke: "#4a2f5e", win: "#7dff9b", danger: "#ff5e7a", seats: ["#ffb547", "#9d7bff", "#5ee0ff", "#ff7ab8"], glow: true },
});

/** ثيم افتراضي حسب فئة اللعبة */
const CATEGORY_THEME = Object.freeze({ board: "NEON", puzzle: "MIDNIGHT", word: "CLASSIC", quiz: "CYBER", arcade: "NEON", party: "FANTASY", adventure: "FANTASY" });

function themeFor(name, category = "arcade") {
  const key = String(name || "").toUpperCase();
  return THEMES[key] || THEMES[CATEGORY_THEME[category]] || THEMES.NEON;
}

const RTL_LANGS = new Set(["ar", "fa", "he", "ur"]);
const dirOf = (lang) => (RTL_LANGS.has(String(lang || "").slice(0, 2)) ? "rtl" : "ltr");

/** CSS كامل للعرض HTML من رموز الثيم (لا موارد خارجية) */
function cssFor(theme, lang = "ar") {
  const t = themeFor(theme?.id || theme);
  const family = getFontStack(lang);
  const glow = t.glow ? `0 0 18px ${t.accent}55, 0 0 3px ${t.accent}` : "none";
  return [
    `:root{color-scheme:dark;--bg:${t.bg};--surface:${t.surface};--text:${t.text};--muted:${t.muted};--accent:${t.accent};--accent2:${t.accent2};--stroke:${t.stroke};--win:${t.win};--danger:${t.danger};--glow:${glow};--font:${family};}`,
    "*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}",
    `html{background:transparent}body{position:relative;margin:0;min-height:100%;overflow:hidden;background:radial-gradient(ellipse at 12% 0%,color-mix(in srgb,var(--accent) 24%,transparent),transparent 46%),radial-gradient(ellipse at 100% 82%,color-mix(in srgb,var(--accent2) 17%,transparent),transparent 42%),linear-gradient(145deg,var(--bg),color-mix(in srgb,var(--bg) 72%,#000));color:var(--text);font-size:14px;line-height:1.45;font-family:${family};isolation:isolate}`,
    "body:before,body:after{content:'';position:absolute;z-index:-1;pointer-events:none;border-radius:50%;filter:blur(2px)}",
    "body:before{width:230px;height:230px;top:-140px;left:-80px;background:radial-gradient(circle, color-mix(in srgb,var(--accent) 32%,transparent),transparent 70%)}",
    "body:after{width:210px;height:210px;bottom:-130px;right:-80px;background:radial-gradient(circle, color-mix(in srgb,var(--accent2) 25%,transparent),transparent 72%)}",
    ".ta-shell{width:100%;max-width:560px;margin:0 auto;padding:13px;perspective:1200px}",
    ".ta{position:relative;transform-style:preserve-3d;padding:16px;border-radius:25px;overflow:hidden;background:linear-gradient(145deg,rgba(255,255,255,.105),rgba(255,255,255,.025) 42%,rgba(0,0,0,.2)),linear-gradient(150deg,var(--surface),var(--bg));border:1px solid color-mix(in srgb,var(--accent) 30%,var(--stroke));box-shadow:0 24px 42px rgba(0,0,0,.42),0 9px 0 rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.18),inset 0 -1px 0 rgba(0,0,0,.45)}",
    ".ta:before{content:'';position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,transparent,var(--accent),var(--accent2),transparent);box-shadow:0 0 22px color-mix(in srgb,var(--accent) 65%,transparent)}",
    ".ta:after{content:'';position:absolute;inset:1px;border-radius:24px;pointer-events:none;background:linear-gradient(120deg,rgba(255,255,255,.075),transparent 22%,transparent 75%,rgba(255,255,255,.035));z-index:0}",
    ".ta>*{position:relative;z-index:1}",
    ".ta-head{display:flex;align-items:center;gap:11px;margin-bottom:14px;transform:translateZ(15px)}",
    ".ta-emblem{width:48px;height:48px;flex:0 0 48px;display:grid;place-items:center;border-radius:16px;font-size:25px;background:radial-gradient(circle at 30% 20%,rgba(255,255,255,.4),transparent 36%),linear-gradient(145deg,var(--accent),var(--accent2));color:#fff;text-shadow:0 2px 4px rgba(0,0,0,.35);box-shadow:0 8px 0 color-mix(in srgb,var(--accent) 45%,#000),0 14px 24px color-mix(in srgb,var(--accent) 30%,transparent),inset 0 1px 0 rgba(255,255,255,.45);transform:translateY(-2px) rotate(-3deg)}",
    ".ta-brand{flex:1;min-width:0}",
    ".ta-kicker{display:block;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);font-weight:900}",
    ".ta-title{display:block;margin-top:3px;font-size:clamp(17px,4vw,23px);font-weight:950;line-height:1.12;letter-spacing:.25px;background:linear-gradient(100deg,#fff 5%,var(--accent2) 68%,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:var(--glow);overflow-wrap:anywhere}",
    ".ta-pill{flex:none;max-width:34%;padding:7px 10px;border-radius:11px;border:1px solid color-mix(in srgb,var(--accent2) 44%,transparent);background:linear-gradient(150deg,color-mix(in srgb,var(--accent2) 17%,var(--surface)),rgba(0,0,0,.2));box-shadow:0 4px 0 rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.12);font-size:10px;font-weight:900;text-align:center;color:var(--text);overflow-wrap:anywhere}",
    ".ta-players{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:8px;margin-bottom:13px;transform:translateZ(8px)}",
    ".ta-chip{min-width:0;display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:14px;background:linear-gradient(145deg,rgba(255,255,255,.075),rgba(255,255,255,.018));border:1px solid var(--stroke);box-shadow:0 5px 0 rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.07);font-size:12px;font-weight:800;overflow-wrap:anywhere}",
    ".ta-chip.on{border-color:var(--accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent),0 6px 0 rgba(0,0,0,.22),0 0 22px color-mix(in srgb,var(--accent) 22%,transparent),inset 0 1px 0 rgba(255,255,255,.12)}",
    ".ta-dot{display:inline-block;width:9px;height:9px;flex:0 0 9px;border-radius:50%;background:var(--accent2);box-shadow:0 0 10px currentColor,inset 0 1px 1px rgba(255,255,255,.6)}",
    ".ta-board{position:relative;padding:9px;border-radius:19px;background:linear-gradient(135deg,var(--accent),var(--accent2) 48%,var(--accent));box-shadow:0 8px 0 color-mix(in srgb,var(--accent) 30%,#000),0 15px 25px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.5);transform:translateZ(9px);isolation:isolate}",
    ".ta-board:before{content:'';position:absolute;inset:2px;border-radius:15px;opacity:.55;background:linear-gradient(120deg,rgba(255,255,255,.25),transparent 22%,transparent 72%,rgba(255,255,255,.08));pointer-events:none;z-index:2}",
    ".ta-board-in{position:relative;display:grid;gap:5px;padding:7px;border-radius:13px;background:linear-gradient(150deg,color-mix(in srgb,var(--bg) 95%,#fff),var(--bg));box-shadow:inset 0 5px 16px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08)}",
    ".ta-cell{position:relative;min-width:0;min-height:44px;aspect-ratio:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2px;overflow:hidden;border-radius:11px;background:linear-gradient(145deg,color-mix(in srgb,var(--surface) 92%,#fff),var(--surface) 58%,color-mix(in srgb,var(--bg) 65%,#000));border:1px solid color-mix(in srgb,var(--stroke) 75%,#fff);box-shadow:0 4px 0 rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.12);font-size:clamp(14px,4.5vw,25px);font-weight:950;line-height:1.05;text-align:center;text-shadow:0 2px 3px rgba(0,0,0,.32);overflow-wrap:anywhere}",
    ".ta-cell:before{content:'';position:absolute;inset:0;background:linear-gradient(125deg,rgba(255,255,255,.09),transparent 35%);pointer-events:none}",
    ".ta-cell.kind-x{color:var(--accent);text-shadow:0 0 12px color-mix(in srgb,var(--accent) 85%,transparent),0 2px 3px #0008}",
    ".ta-cell.kind-o{color:var(--accent2);text-shadow:0 0 12px color-mix(in srgb,var(--accent2) 85%,transparent),0 2px 3px #0008}",
    ".ta-cell.kind-color{background:linear-gradient(145deg,color-mix(in srgb,var(--cell-color,var(--accent)) 70%,#fff),var(--cell-color,var(--accent)) 55%,color-mix(in srgb,var(--cell-color,var(--accent)) 70%,#000));border-color:color-mix(in srgb,var(--cell-color,var(--accent)) 65%,#fff);color:#fff;text-shadow:0 2px 4px #0008;box-shadow:0 4px 0 color-mix(in srgb,var(--cell-color,var(--accent)) 60%,#000),inset 0 1px 0 #ffffff70}",
    ".ta-cell.kind-disc,.ta-cell.kind-king{border-radius:50%;background:radial-gradient(circle at 30% 20%,#ffffff90,transparent 30%),linear-gradient(145deg,var(--accent2),color-mix(in srgb,var(--accent2) 25%,#000));box-shadow:0 4px 0 #0007,0 0 13px color-mix(in srgb,var(--accent2) 35%,transparent),inset 0 1px 0 #ffffff70}",
    ".ta-cell.kind-king{outline:2px solid #ffe36e;outline-offset:-5px}",
    ".ta-cell.kind-hit,.ta-cell.kind-sunk,.ta-cell.kind-mine{background:linear-gradient(145deg,#ff6b7b,#761d48);box-shadow:0 4px 0 #2a1021,0 0 13px #ff426655}",
    ".ta-cell.kind-miss{background:linear-gradient(145deg,#65d5f7,#194f9b);box-shadow:0 4px 0 #10294e}",
    ".ta-cell.kind-ship{background:linear-gradient(145deg,#c7d8eb,#50678f);color:#10182a}",
    ".ta-cell.kind-tile{background:linear-gradient(145deg,color-mix(in srgb,var(--cell-color,var(--accent2)) 25%,var(--surface)),var(--surface));font-variant-numeric:tabular-nums}",
    ".ta-cell.hl{border-color:var(--win);background:linear-gradient(145deg,color-mix(in srgb,var(--win) 25%,var(--surface)),var(--surface));box-shadow:0 4px 0 color-mix(in srgb,var(--win) 32%,#000),0 0 20px color-mix(in srgb,var(--win) 40%,transparent),inset 0 1px 0 rgba(255,255,255,.3)}",
    ".ta-cell.act{border-style:dashed;border-color:color-mix(in srgb,var(--accent2) 65%,var(--stroke))}",
    ".ta-cell.pop{animation:ta-pop .32s cubic-bezier(.2,1.5,.4,1)}",
    "@keyframes ta-pop{from{transform:translateY(6px) scale(.75);opacity:.25}to{transform:translateY(0) scale(1);opacity:1}}",
    ".ta-track-cell{font-size:clamp(9px,2.3vw,12px);min-height:22px;aspect-ratio:1;border-radius:5px;padding:1px}",
    ".ta-line{padding:8px 10px;border-radius:10px;background:linear-gradient(110deg,rgba(255,255,255,.055),rgba(0,0,0,.12));border:1px solid rgba(255,255,255,.055);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}",
    ".ta-lines{display:grid;gap:5px;padding:9px;border-radius:15px;background:linear-gradient(145deg,var(--bg),color-mix(in srgb,var(--surface) 70%,#000));border:1px solid var(--stroke);box-shadow:inset 0 5px 15px rgba(0,0,0,.4),0 5px 0 rgba(0,0,0,.18)}",
    ".ta-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(95px,1fr));gap:8px;margin-top:13px;transform:translateZ(5px)}",
    ".ta-panel{min-width:0;padding:10px 11px;border-radius:13px;background:linear-gradient(145deg,rgba(255,255,255,.08),rgba(255,255,255,.025));border:1px solid var(--stroke);box-shadow:0 5px 0 rgba(0,0,0,.21),inset 0 1px 0 rgba(255,255,255,.09);font-weight:850;font-size:13px;overflow-wrap:anywhere}",
    ".ta-panel b{display:block;margin-bottom:3px;color:var(--muted);font-size:10px;font-weight:700}",
    ".ta-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:13px}",
    ".ta-action-chip{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:34px;padding:7px 10px;border-radius:11px;border:1px solid color-mix(in srgb,var(--accent) 38%,var(--stroke));background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 17%,var(--surface)),color-mix(in srgb,var(--bg) 70%,#000));box-shadow:0 4px 0 rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.09);font-size:11px;font-weight:800;color:var(--text)}",
    ".ta-control-hint{display:flex;gap:8px;align-items:center;margin-top:12px;padding:10px 11px;border-radius:12px;border:1px solid color-mix(in srgb,var(--accent2) 28%,var(--stroke));background:linear-gradient(100deg,color-mix(in srgb,var(--accent2) 9%,transparent),rgba(255,255,255,.025));color:var(--muted);font-size:10px;font-weight:700;line-height:1.5}",
    ".ta-control-hint strong{color:var(--accent2);font-size:12px}",
    ".ta-catalog-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;perspective:1000px}",
    ".ta-game-card{min-width:0;padding:11px 10px 10px;border-radius:15px;background:linear-gradient(145deg,rgba(255,255,255,.085),rgba(255,255,255,.015) 62%,rgba(0,0,0,.2));border:1px solid color-mix(in srgb,var(--accent) 20%,var(--stroke));box-shadow:0 6px 0 rgba(0,0,0,.25),0 12px 18px rgba(0,0,0,.13),inset 0 1px 0 rgba(255,255,255,.1);transform:translateZ(3px)}",
    ".ta-game-top{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px}",
    ".ta-game-icon{width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;border-radius:12px;font-size:20px;background:radial-gradient(circle at 25% 20%,rgba(255,255,255,.4),transparent 42%),linear-gradient(145deg,var(--accent),var(--accent2));box-shadow:0 4px 0 color-mix(in srgb,var(--accent) 40%,#000),0 8px 14px rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.35)}",
    ".ta-game-index{color:var(--muted);font-size:8px;font-weight:900;letter-spacing:1px}",
    ".ta-game-card h3{margin:0 0 5px;font-size:12px;font-weight:900;line-height:1.35;color:var(--text);overflow-wrap:anywhere}",
    ".ta-game-card p{min-height:30px;margin:0;color:var(--muted);font-size:9px;line-height:1.5;overflow-wrap:anywhere}",
    ".ta-game-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:9px}",
    ".ta-game-tags span{padding:4px 6px;border-radius:7px;border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.16);color:var(--accent2);font-size:8px;font-weight:850}",
    ".ta-catalog-hint{margin-top:12px;padding:10px;border:1px solid var(--stroke);border-radius:12px;background:rgba(0,0,0,.13);color:var(--muted);font-size:10px;text-align:center}",
    ".ta-foot{margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07);text-align:center;color:var(--muted);font-size:9px;letter-spacing:2px;font-weight:800}",
    "@media(max-width:380px){.ta-shell{padding:7px}.ta{padding:12px;border-radius:20px}.ta-emblem{width:40px;height:40px;flex-basis:40px;border-radius:13px;font-size:22px}.ta-pill{padding:6px 7px;font-size:9px}.ta-board{padding:6px}.ta-board-in{gap:3px;padding:5px}.ta-cell{min-height:36px;border-radius:8px}.ta-players{grid-template-columns:repeat(auto-fit,minmax(105px,1fr))}.ta-actions{gap:5px}.ta-catalog-grid{gap:6px}.ta-game-card{padding:8px 7px}.ta-game-card p{font-size:8px}.ta-game-icon{width:31px;height:31px;flex-basis:31px}}",
    // (أُزيلت .ta-asset-frame/.ta-asset-image: لا صور داخل بطاقات الألعاب)
    "@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}",
  ].join("\n");
}

/** مدير صوت: واتساب لا يملك قناة صوت داخل العرض ⇒ كل نداء no-op آمن بنتيجة صريحة */
const CUES = Object.freeze(["move", "capture", "win", "lose", "draw", "dice", "tick", "error"]);
const audio = Object.freeze({
  cues: CUES,
  play(cue) {
    return { played: false, cue: CUES.includes(cue) ? cue : "unknown", reason: "no-audio-channel" };
  },
});

export { CATEGORY_THEME, CUES, RTL_LANGS, THEMES, audio, cssFor, dirOf, themeFor };
export default { THEMES, themeFor, cssFor, dirOf, audio };
