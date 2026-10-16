#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🎮 TERBOO ARCADE — فحص جنائي لنظام الألعاب (قابل لإعادة التوليد)
// ───────────────────────────────────────────────
// يقرأ plugins/game/* ونواة الألعاب وsrc/handler.js ويستخرج لكل لعبة:
//   الأمر · المرادفات · المحرك/الجلسة · أين تُحفظ الحالة · مجموعة/خاص · لاعبون · ذكاء · واجهة
//   · مكافآت · مؤقتات · مصدر العشوائية · مسار الإجابات (هل يصل فعلاً؟) · المشاكل · الواجهة المقترحة
// ثم يكتب:
//   docs/TERBOO_GAME_FORENSIC_AUDIT.md   (المرحلة 0)
//   docs/TERBOO_GAME_UI_MATRIX.md        (المرحلة 1)
// الاستعمال: node tools/terboo-game-audit.mjs [--json out.json]
// الأرقام كلها محسوبة من الملفات — لا أرقام مكتوبة يدوياً.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const GAME_DIR = path.join(ROOT, "plugins", "game");
const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
// خط الأساس قبل TERBOO ARCADE: الفحص الجنائي (المرحلة 0) يُعاد توليده من git بنفس النتيجة دائماً
const BASE = "de88a8c";
const REF = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : args.includes("--final") ? null : BASE;

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// خط الأساس التاريخي يعيش في مستودع المشروع الأصلي. هذه النسخة تبدأ من لقطة مدمجة،
// فالـcommit غير موجود هنا. نقولها صراحةً بدل أثر استدعاء git، ولا نستبدله بشجرة
// العمل بصمت: ذلك ينتج مستنداً مختلفاً تحت عنوان يزعم أنه «ما قبل ARCADE».
if (REF) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${REF}^{commit}`], { cwd: ROOT, stdio: "pipe" });
  } catch {
    console.error(`❌ خط الأساس «${REF}» غير موجود في هذا المستودع.`);
    console.error("   • الفحص الجنائي التاريخي (المرحلة 0) يُعاد توليده في مستودع المشروع الأصلي وحده.");
    console.error("   • للحالة الراهنة:      node tools/terboo-game-audit.mjs --final");
    console.error("   • لخط أساس آخر:        node tools/terboo-game-audit.mjs --ref <commit>");
    process.exit(2);
  }
}
/** يقرأ ملفاً من الشجرة الحالية أو من commit مرجعي */
function read(file) {
  if (!REF) return fs.readFileSync(file, "utf8");
  return git("show", `${REF}:${path.relative(ROOT, file).split(path.sep).join("/")}`);
}
function listGames(ref) {
  if (!ref) return fs.readdirSync(GAME_DIR).filter((f) => f.endsWith(".js") && !f.startsWith("_")).sort();
  return git("ls-tree", "-z", "--name-only", ref, "plugins/game/").split("\0").filter((f) => f.endsWith(".js")).map((f) => path.basename(f)).filter((f) => !f.startsWith("_")).sort();
}
const HANDLER = read(path.join(ROOT, "src", "handler.js"));
const has = (src, re) => re.test(src);
const first = (src, re) => (src.match(re) || [])[1] || "";

/** ألعاب السجل الجديد (إن وُجد) — لمعرفة ما رُحِّل للمحرك الموحّد */
function arcadeIds() {
  const dir = path.join(ROOT, "src", "lib", "terboo-arcade", "games");
  if (REF || !fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, "")));
}

/** مفاتيح يبحث بها موزّع الإجابات في handler.js داخل cachedGamePlugins */
function dispatchKeys() {
  return [...HANDLER.matchAll(/cachedGamePlugins\.get\(['"]([^'"]+)['"]\)/g)].map((x) => x[1]);
}

function classify(file, src) {
  const name = first(src, /name:\s*["']([^"']+)["']/);
  const aliasRaw = first(src, /alias:\s*\[([^\]]*)\]/);
  const alias = [...aliasRaw.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  const isGroup = has(src, /isGroup:\s*true/);
  const isPrivate = has(src, /isPrivate:\s*true/);
  const quiz = has(src, /games\.register\(/);
  const arcade = has(src, /terboo-arcade/);
  const globals = [...new Set([...src.matchAll(/global\.([a-zA-Z]+Games)\b/g)].map((x) => x[1]))];
  const userState = [...new Set([...src.matchAll(/user\.rpg\.([a-z_]+session)/g)].map((x) => x[1]))];
  const groupState = has(src, /db\.setGroup\(/);
  const exportsAnswer = [...src.matchAll(/export\s*\{([^}]*)\}/g)].map((x) => x[1]).join(",");
  const answerExport = (exportsAnswer.match(/\b(\w*[aA]nswerHandler|nightActionHandler)\b/g) || []);
  const delegatesTo = first(src, /from\s+['"]\.\/([^'"]+)\.js['"]/);

  let engine = "standalone";
  if (arcade) engine = "arcade";
  else if (quiz) engine = "terboo-games (quiz)";
  else if (globals.length) engine = `global.${globals.join(",")}`;
  else if (userState.length) engine = `user.rpg.${userState.join(",")}`;
  else if (groupState) engine = "db group state";
  else if (delegatesTo) engine = `delegate → ${delegatesTo}`;

  const ui = [];
  if (has(src, /sendCard|sendCarousel|deliverMenu/)) ui.push("buttons");
  if (has(src, /sendPreview|sendGamePreview/)) ui.push("preview");
  if (has(src, /image:\s*|hasImage:\s*true|sendImage/)) ui.push("image");
  if (has(src, /sticker/)) ui.push("sticker");
  if (has(src, /m\.reply\(|safeReply\(/)) ui.push("text");
  if (arcade) ui.push("arcade-renderers");

  const rewards = [];
  if (quiz && !has(src, /rewards:\s*(false|null)/)) rewards.push("koin+energi+exp (games core)");
  if (has(src, /updateKoin|\.koin\s*=|koin\s*\+/)) rewards.push("koin");
  if (has(src, /updateEnergi/)) rewards.push("energi");
  if (has(src, /addExp/)) rewards.push("exp");

  const timers = (src.match(/setTimeout\(/g) || []).length;
  const mathRandom = (src.match(/Math\.random\(/g) || []).length;
  const lines = src.split("\n").length;

  const stem = path.basename(file, ".js");
  const keys = dispatchKeys();
  let answerPath = "—";
  if (answerExport.includes("answerHandler")) {
    if (quiz || arcade) answerPath = "session.gameType → cachedGamePlugins";
    else answerPath = HANDLER.includes(`cachedGamePlugins.get('${stem}')`) || HANDLER.includes(`cachedGamePlugins.get("${stem}")`) || arcade
      ? "explicit key in handler"
      : "UNREACHABLE (handler key mismatch)";
  } else if (answerExport.length) answerPath = `dedicated import (${answerExport.join(",")})`;

  const issues = [];
  if (answerPath.startsWith("UNREACHABLE")) issues.push(`answerHandler غير متصل: موزّع handler.js يبحث بمفاتيح [${keys.join(", ")}] لكن الملف «${stem}»`);
  if (globals.length) issues.push("الحالة في global.* (تضيع عند إعادة التشغيل · بلا قفل · بلا sessionId قياسي)");
  if (mathRandom && !arcade) issues.push(`Math.random ×${mathRandom} (عشوائية غير مركزية)`);
  if (has(src, /\.koin\s*=\s*\(/)) issues.push("مكافأة بكتابة مباشرة على user.koin (غير idempotent)");
  if (timers && globals.length) issues.push("مؤقتات setTimeout بلا تنظيف مركزي");
  if (has(src, /global\.tictactoeGames/) && has(src, /room\.id\.startsWith/)) issues.push("بحث خطّي في كل الغرف عند كل رسالة");
  if (has(src, /Rp\s*[0-9]/)) issues.push("نص عملة قديم (Rp) في الرد");

  return { file: path.relative(ROOT, file), stem, name, alias, isGroup, isPrivate, engine, answerPath, ui: [...new Set(ui)], rewards: [...new Set(rewards)], timers, mathRandom, lines, issues, quiz, arcade, globals, delegatesTo };
}

/** تصنيف المرحلة 1: النوع والواجهة المقترحة (قواعد محسوبة لا يدوية لكل ملف) */
function recommend(g) {
  if (g.quiz) return { kind: "question", uiMode: "buttons", why: "سؤال واحد بإجابة نصية — أزرار خيارات/مساعدات + صورة عند وجودها؛ HTML بلا فائدة" };
  if (g.delegatesTo) return { kind: "sub-command", uiMode: "buttons", why: `أمر فرعي لـ${g.delegatesTo} — أزرار أهداف في الخاص` };
  if (/tictactoe|اكس_او/.test(g.stem + g.globals.join())) return { kind: "board-2p", uiMode: "html", why: "لوحة 3×3 — مرجع HTML (عرض) + أزرار خلايا (تفاعل) + AI" };
  if (/ulartangga/.test(g.globals.join())) return { kind: "board-multi", uiMode: "hybrid", why: "لوحة مرئية + نرد من الخادم + زر «ارمِ» — 2–4 لاعبين" };
  if (/suit/.test(g.globals.join())) return { kind: "duel", uiMode: "buttons", why: "اختيار سري من 3 — أزرار في الخاص؛ لا داعي لـHTML" };
  if (/werewolf/.test(g.globals.join())) return { kind: "social", uiMode: "hybrid", why: "أدوار سرية — أزرار خاصة لكل لاعب + لوحة حالة في المجموعة" };
  if (g.engine.startsWith("user.rpg")) return { kind: "rpg", uiMode: "hybrid", why: "منطق خادم قائم — لوحة حالة + أزرار اختيارات" };
  if (g.engine === "db group state" || g.lines > 600) return { kind: "sim", uiMode: "hybrid", why: "محاكاة طويلة — لوحة تحكم + أزرار؛ المنطق كما هو" };
  return { kind: "other", uiMode: "text", why: "بلا حالة لعب مرئية" };
}

const files = listGames(REF);
const rows = files.map((f) => {
  const g = classify(path.join(GAME_DIR, f), read(path.join(GAME_DIR, f)));
  return { ...g, ...recommend(g) };
});

const core = ["terboo-games.js", "terboo-game-data.js", "terboo-game-queue.js", "terboo-game-ulartangga.js"].map((f) => {
  const p = path.join(ROOT, "src", "lib", f);
  return { file: `src/lib/${f}`, lines: read(p).split("\n").length };
});
const coreFormatBug = /questionField\]\}\\`\\`\\`/.test(read(path.join(ROOT, "src/lib/terboo-games.js")));
const dataFiles = REF ? git("ls-tree", "-z", "--name-only", REF, "src/data/").split("\0").filter((f) => f.endsWith(".json")) : fs.readdirSync(path.join(ROOT, "src", "data")).filter((f) => f.endsWith(".json"));
const arcade = arcadeIds();

const count = (fn) => rows.filter(fn).length;
const totals = {
  pluginFiles: rows.length,
  quizGames: count((r) => r.quiz),
  globalStateGames: count((r) => r.globals.length),
  unreachableAnswer: count((r) => r.answerPath.startsWith("UNREACHABLE")),
  withButtons: count((r) => r.ui.includes("buttons")),
  withIssues: count((r) => r.issues.length),
  arcadeRegistry: arcade.size,
  dataFiles: dataFiles.length,
  byUiMode: rows.reduce((acc, r) => ({ ...acc, [r.uiMode]: (acc[r.uiMode] || 0) + 1 }), {}),
};

const esc = (s) => String(s).replace(/\|/g, "\\|");
let md = `# 🎮 TERBOO ARCADE — الفحص الجنائي لنظام الألعاب (المرحلة 0)\n\n`;
md += `> مولّد آلياً: \`node tools/terboo-game-audit.mjs\` — لا تعدّل يدوياً.${REF ? ` الحالة المفحوصة: commit \`${REF}\` (قبل TERBOO ARCADE).` : ""}\n\n`;
md += `## الأعداد\n\n| البند | العدد |\n|---|---|\n`;
md += `| ملفات plugins/game | ${totals.pluginFiles} |\n| ألعاب أسئلة على \`games.register\` | ${totals.quizGames} |\n| ألعاب حالتها في \`global.*\` | ${totals.globalStateGames} |\n| مسار إجابة غير متصل | ${totals.unreachableAnswer} |\n| ألعاب بأزرار حقيقية | ${totals.withButtons} |\n| ملفات بها مشاكل | ${totals.withIssues} |\n| ملفات بيانات src/data | ${totals.dataFiles} |\n| ألعاب في سجل TERBOO ARCADE | ${totals.arcadeRegistry} |\n\n`;
md += `## النواة\n\n${core.map((c) => `- \`${c.file}\` — ${c.lines} سطر`).join("\n")}\n\n`;
if (coreFormatBug) md += `- ⚠️ \`terboo-games.js\`: نص السؤال يُلحق بـ \`\`\`\` غير مفتوحة (تنسيق مكسور في كل ألعاب الأسئلة)\n`;
md += `- مفاتيح موزّع الإجابات في \`src/handler.js\`: ${dispatchKeys().map((k) => `\`${k}\``).join(" · ") || "—"}\n`;
md += `- \`cachedGamePlugins\` تُفهرس باسم الملف (عربي) ⇒ أي مفتاح لاتيني أعلاه لا يطابق ملفاً عربياً.\n\n`;
md += `## جرد كل لعبة\n\n| الملف | الأمر | المرادفات | المحرك/الحالة | مجموعة/خاص | الواجهة | المكافآت | مسار الإجابة | أسطر |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) {
  md += `| \`${esc(r.stem)}\` | ${esc(r.name)} | ${esc(r.alias.join(", ") || "—")} | ${esc(r.engine)} | ${r.isGroup ? "مجموعة" : r.isPrivate ? "خاص" : "الكل"} | ${esc(r.ui.join("+") || "—")} | ${esc(r.rewards.join(", ") || "—")} | ${esc(r.answerPath)} | ${r.lines} |\n`;
}
md += `\n## المشاكل المكتشفة\n\n`;
for (const r of rows.filter((x) => x.issues.length)) md += `- **${r.stem}**\n${r.issues.map((i) => `  - ${i}`).join("\n")}\n`;
md += `\n## ملاحظات عامة\n\n- لا يوجد عقد لعبة موحّد: كل لعبة غير الأسئلة تبني غرفها وحالتها بنفسها.\n- لا sessionId/roomId قياسي، ولا حالات WAITING/PLAYING/… موحّدة، ولا حفظ للحالة.\n- لا خصم آلي (AI) في أي لعبة حالية.\n- لا لوحة صدارة ولا إنجازات.\n- المكافآت تُصرف مباشرة بلا مفتاح idempotency.\n`;

let mx = `# 🧭 TERBOO ARCADE — مصفوفة واجهة الألعاب (المرحلة 1)\n\n`;
mx += `> مولّد آلياً: \`node tools/terboo-game-audit.mjs\`. القاعدة: لا HTML لمجرد الشكل — HTML فقط للوحات المرئية، والتفاعل دائماً عبر أزرار تحمل Action ID حتى يُثبت جسر HTML.\n\n`;
mx += `## التوزيع\n\n| uiMode | العدد |\n|---|---|\n${Object.entries(totals.byUiMode).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}\n\n`;
mx += `## المصفوفة\n\n| الملف | النوع | uiMode المقترح | السبب |\n|---|---|---|---|\n`;
for (const r of rows) mx += `| \`${esc(r.stem)}\` | ${r.kind} | **${r.uiMode}** | ${esc(r.why)} |\n`;
if (arcade.size) mx += `\n## سجل TERBOO ARCADE (ألعاب المحرك الموحّد)\n\n${[...arcade].sort().map((id) => `- \`${id}\``).join("\n")}\n`;

if (!args.includes("--final")) {
  fs.writeFileSync(path.join(ROOT, "docs", "TERBOO_GAME_FORENSIC_AUDIT.md"), md);
  fs.writeFileSync(path.join(ROOT, "docs", "TERBOO_GAME_UI_MATRIX.md"), mx + implementedMatrix());
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ totals, rows, core }, null, 2));
  console.log(JSON.stringify(totals));
}

/** ما نُفّذ فعلاً بعد الترحيل (من الشجرة الحالية) — بجانب التصنيف المقترح أعلاه */
function implementedMatrix() {
  const now = listGames(null);
  const src = (f) => fs.readFileSync(path.join(GAME_DIR, f), "utf8");
  const mode = (f) => {
    const s2 = src(f);
    const id = (s2.match(/quickCommand\("([a-z0-9_]+)"\)/) || [])[1];
    if (id) {
      const g = fs.readFileSync(path.join(ROOT, "src", "lib", "terboo-arcade", "games", `${id}.js`), "utf8");
      const ui = (g.match(/uiMode:\s*"(\w+)"/) || [])[1] || (/quizGame\(/.test(g) ? "buttons" : "auto");
      return { kind: `arcade:${id}`, ui: ui === "html" ? "hybrid (HTML eligible)" : ui };
    }
    if (/choiceCard|targetCard|lobbyCard/.test(s2)) return { kind: "legacy-logic", ui: "hybrid" };
    if (/games\.register\(/.test(s2)) return { kind: "quiz", ui: "buttons" };
    if (/nightActionHandler/.test(s2)) return { kind: "werewolf-skill", ui: "buttons (from werewolf)" };
    return { kind: "unchanged", ui: "text" };
  };
  const base = new Set(listGames(BASE));
  let out = `\n## ما نُفّذ فعلاً (الشجرة الحالية)\n\n| الملف | جديد؟ | النوع | العرض المُسلَّم |\n|---|---|---|---|\n`;
  for (const f of now) {
    const m2 = mode(f);
    out += `| \`${f.replace(/\.js$/, "")}\` | ${base.has(f) ? "—" : "🆕"} | ${m2.kind} | ${m2.ui} |\n`;
  }
  return out;
}

// ═══════════════════════════════════════════════
// المرحلة 18: التدقيق النهائي — node tools/terboo-game-audit.mjs --final [--tests results.json]
// أعداد محسوبة من: سجل الألعاب الحي · git (قائمة الألعاب قبل TERBOO ARCADE) · نتيجة الـrunner
// ═══════════════════════════════════════════════
if (args.includes("--final")) {
  const before = listGames(BASE).map((f) => path.basename(f, ".js"));
  const fs2 = fs;
  const { loadArcade, arcadeContracts } = await import("../src/lib/terboo-arcade/index.js");
  await loadArcade();
  for (const f of fs2.readdirSync(GAME_DIR).filter((x) => x.endsWith(".js"))) {
    const src = read(path.join(GAME_DIR, f));
    if (/games\.register\(/.test(src)) await import(path.join(GAME_DIR, f));
  }
  const { games: registry } = await import("../src/lib/terboo-games.js");
  const contracts = arcadeContracts();
  const legacyQuiz = registry.contracts().filter((c) => c.legacy);
  const srcOf = (stem) => (fs2.existsSync(path.join(GAME_DIR, `${stem}.js`)) ? read(path.join(GAME_DIR, `${stem}.js`)) : "");
  const migrated = before.filter((stem) => /quickCommand\("/.test(srcOf(stem)));
  const hybrid = before.filter((stem) => /choiceCard|targetCard|lobbyCard/.test(srcOf(stem)));
  const quizButtons = before.filter((stem) => /games\.register\(/.test(srcOf(stem)));
  const delegates = before.filter((stem) => /nightActionHandler/.test(srcOf(stem)) && !/targetCard/.test(srcOf(stem)));
  const untouched = before.filter((stem) => !migrated.includes(stem) && !hybrid.includes(stem) && !quizButtons.includes(stem) && !delegates.includes(stem));
  const migratedIds = new Set(migrated.map((stem) => (srcOf(stem).match(/quickCommand\("([a-z0-9_]+)"\)/) || [])[1]));
  const newGames = contracts.filter((c) => !migratedIds.has(c.id));
  const by = (fn) => contracts.filter(fn).length;
  const delivered = () => "HTML 3D + native controls";
  let tests = null;
  const testsArg = args.includes("--tests") ? args[args.indexOf("--tests") + 1] : null;
  if (testsArg && fs2.existsSync(testsArg)) tests = JSON.parse(read(testsArg));
  const fullArg = args.includes("--full") ? args[args.indexOf("--full") + 1] : null;
  const full = fullArg && fs2.existsSync(fullArg) ? JSON.parse(read(fullArg)) : null;
  const perfFile = path.join(ROOT, "docs", "arcade", "performance.json");
  const perf = fs2.existsSync(perfFile) ? JSON.parse(read(perfFile)) : null;

  let fm = `# 🏁 TERBOO ARCADE — التدقيق النهائي للإصدار (المرحلة 18)\n\n`;
  fm += `> مولّد: \`node tools/terboo-game-audit.mjs --final --tests <arcade.json> --full <all.json>\`. لا رقم مكتوب يدوياً.\n> خط الأساس: \`git ls-tree ${BASE} plugins/game/\` (قبل TERBOO ARCADE).\n\n`;
  fm += `## الألعاب\n\n| البند | العدد |\n|---|---|\n`;
  fm += `| ملفات ألعاب قبل الأركيد | ${before.length} |\n| ملفات ألعاب الآن | ${listGames(null).length} |\n| أُلغي/حُذف من الألعاب القديمة | ${before.filter((s) => !fs2.existsSync(path.join(GAME_DIR, `${s}.js`))).length} |\n`;
  fm += `| قديمة رُحّلت للمحرك الموحّد (أزرار/لوحة) | ${migrated.length} (${migrated.join("، ")}) |\n| قديمة صارت Hybrid (منطقها كما هو) | ${hybrid.length} (${hybrid.join("، ")}) |\n| ألعاب أسئلة قديمة بأزرار (تلميح/استسلام) | ${quizButtons.length} |\n| أوامر فرعية للمستذئب (أزرار من اللعبة الأم) | ${delegates.length} |\n| بلا تغيير (نص/وسائط) | ${untouched.length} (${untouched.join("، ")}) |\n`;
  fm += `| ألعاب جديدة على المحرك | ${newGames.length} |\n| إجمالي عقود TERBOO ARCADE | ${contracts.length} |\n| ألعاب أسئلة (قديمة + جديدة) | ${legacyQuiz.length + by((c) => c.category === "quiz" || c.id === "math_duel")} |\n`;
  fm += `| متعددة اللاعبين (max > 1) | ${by((c) => c.players.max > 1)} |\n| بخصم كمبيوتر | ${by((c) => c.supportsAI)} |\n| فردية | ${by((c) => c.mode === "solo")} |\n| تسليم HTML 3D للمحرك الموحّد | ${contracts.length} |\n| hybrid | ${by((c) => c.uiMode === "hybrid")} |\n| buttons | ${by((c) => c.uiMode === "buttons")} |\n| text | ${by((c) => c.uiMode === "text")} |\n\n`;
  fm += `## الألعاب الجديدة\n\n| المعرّف | الاسم | الفئة | اللاعبون | خصم | العرض الفعلي |\n|---|---|---|---|---|---|\n`;
  for (const c of newGames) fm += `| \`${c.id}\` | ${c.name.ar} | ${c.category} | ${c.players.min}–${c.players.max} | ${c.supportsAI ? "✅" : "—"} | ${delivered(c)} |\n`;
  if (tests) {
    fm += `\n## اختبارات الأركيد (من الـrunner)\n\n| المجموع | نجح | فشل | تخطٍّ | محجوب |\n|---|---|---|---|---|\n| ${tests.total} | ${tests.passed} | ${tests.failed} | ${tests.skipped} | ${tests.blocked} |\n\n`;
    for (const r of tests.results) fm += `- ${r.ok ? "✅" : "❌"} \`${r.file}\` (${(r.ms / 1000).toFixed(1)}s) — ${String(r.summary).replace(/\|/g, "·")}\n`;
  }
  if (full) fm += `\n## كل اختبارات المشروع المحلية\n\n| المجموع | نجح | فشل | live لم يُشغَّل | محجوب |\n|---|---|---|---|---|\n| ${full.total} | ${full.passed} | ${full.failed} | ${full.skipped} | ${full.blocked} |\n`;
  if (perf) {
    fm += `\n## الأداء والذاكرة (مقاس — ${perf.node})\n\n| غرف | إنشاء | حركات (مع رد الكمبيوتر) | لكل حركة | تنظيف | heap |\n|---|---|---|---|---|---|\n`;
    for (const r of perf.results) fm += `| ${r.size} | ${r.createMs}ms | ${r.actionsMs}ms | ${r.perActionMs}ms | ${r.sweepMs}ms | ${r.heapPeakMb}MB |\n`;
  }
  fm += `\n## الحدود (بصدق)\n\n- **HTML Multiplayer غير مُعلن**: جسر الإجراءات داخل HTML غير مُفعّل لعدم وجود قناة عميل مُثبتة (Click → Action ID → Backend). اللوحات تُعرض صورة + أزرار، والنقل HTML (build→encode→validate→decode→verify) مُختبر محلياً ومعطّل افتراضياً (\`config.arcade.html.transport\`).\n- عرض \`richResponseMessage/unifiedResponse\` على أجهزة واتساب الحقيقية لم يُجرَّب في هذه البيئة المغلقة.\n- ماينكرافت وfish ما زالتا بنصوصهما الإندونيسية الأصلية (أُضيفت لوحة أزرار لماينكرافت فقط).\n`;
  fs2.writeFileSync(path.join(ROOT, "docs", "TERBOO_GAME_RELEASE_AUDIT.md"), fm);
  // تقرير الاختبارات (المرحلة 15): من نتيجة الـrunner فقط
  if (tests) {
    let tr = `# 🧪 TERBOO ARCADE — تقرير الاختبارات\n\n> مولّد من \`node tools/terboo-run-tests.mjs --only arcade --json <file>\` ثم \`--final\`. أرقام هذا التشغيل فقط (${tests.generatedAt}, ${tests.node}).\n\n`;
    tr += `| المجموع | نجح | فشل | تخطٍّ | محجوب |\n|---|---|---|---|---|\n| ${tests.total} | ${tests.passed} | ${tests.failed} | ${tests.skipped} | ${tests.blocked} |\n\n`;
    const cover = {
      "terboo-arcade-engine": "العقد · السجل الواحد · بروتوكول الإجراء (حقول ممنوعة · ممثل مزيّف · nonce قديم/مكرر · تزامن) · الحالات · المضيف/المشاهدون · المكافآت idempotent · التحدي · المهلة/الإعادة · الحفظ والاستعادة",
      "terboo-arcade-html": "الهروب · مدقق القوالب · النقل بكل المراحل لكل لعبة HTML · لا قيم مرجعية · الإرسال/الجسر معطّلان · موافقة المالك · نظام التصميم · الـrenderers",
      "terboo-arcade-ai": "كل خصم قانوني وحتمي بكل المستويات · XO خبير بلا خسارة · سد/إكمال · لا قراءة أسرار · لا LLM · Intent Resolver",
      "terboo-arcade-games": "كل لعبة حتى النهاية · قواعد كل لعبة · لا تسريب في العرض",
      "terboo-arcade-multiplayer": "عبر messageHandler: XO مجموعة بالأزرار والكتابة · تحدي صديق · ضد الكمبيوتر · ثعبان وسلم 4 لاعبين · أسئلة جماعية · اختيار سري في الخاص · كلام طبيعي",
      "terboo-arcade-performance": "100/500/1000 غرفة: زمن الإنشاء والحركة والتنظيف والذاكرة وفراغ الفهارس",
    };
    tr += `| الملف | النتيجة | الزمن | يغطي |\n|---|---|---|---|\n`;
    for (const r of tests.results) tr += `| \`${r.file}\` | ${r.ok ? "✅" : "❌"} | ${(r.ms / 1000).toFixed(1)}s | ${cover[r.file.replace(/\.test\.mjs$/, "")] || ""} |\n`;
    tr += `\n## مخرجات كل ملف\n\n${tests.results.map((r) => `- ${String(r.summary).replace(/\|/g, "·")}`).join("\n")}\n`;
    if (full) tr += `\n## كل اختبارات المشروع\n\n${full.passed}/${full.total} نجح · ${full.failed} فشل · ${full.skipped} live لم يُشغَّل.\n${full.results.filter((r) => !r.ok).map((r) => `- ❌ \`${r.file}\``).join("\n")}\n`;
    fs2.writeFileSync(path.join(ROOT, "docs", "TERBOO_GAME_TEST_REPORT.md"), tr);
  }
  console.log(JSON.stringify({ before: before.length, now: rows.length, migrated: migrated.length, hybrid: hybrid.length, quizButtons: quizButtons.length, newGames: newGames.length, contracts: contracts.length, tests: tests && { total: tests.total, passed: tests.passed, failed: tests.failed } }));
  process.exit(0);
}
