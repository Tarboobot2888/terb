// عقد واجهة الموقع: خمسة أقسام مرئية فقط · عارضات الألعاب allowlist مطابقة
// لمحرّك الأركيد الحقيقي · لا حقن HTML من بيانات · روابط خارجية محصّنة ·
// كل مفتاح ترجمة مستعمل موجود في العربية والإنجليزية.
// يُنفَّذ على المصدر (TSX) بلا بناء ولا متصفح.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const ROOT = process.cwd();
const WEB = path.join(ROOT, "web", "src");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** كل ملفات الواجهة */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const files = walk(WEB);
assert.ok(files.length > 10, `عدد ملفات الواجهة غير منطقي: ${files.length}`);

// ── 1. لا حقن HTML ولا تنفيذ نصّ في أي ملف واجهة ────────────
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  assert.ok(!/dangerouslySetInnerHTML/.test(source), `حقن HTML في ${rel}`);
  assert.ok(!/\.innerHTML\s*=/.test(source), `إسناد innerHTML في ${rel}`);
  assert.ok(!/\beval\s*\(/.test(source), `eval في ${rel}`);
  assert.ok(!/new\s+Function\s*\(/.test(source), `new Function في ${rel}`);
}

// ── 2. خمسة أقسام مرئية فقط ─────────────────────────────────
const shell = read("web/src/components/Shell.tsx");
const sectionsBlock = shell.slice(shell.indexOf("export const SECTIONS"), shell.indexOf("];", shell.indexOf("export const SECTIONS")));
const sectionRoutes = [...sectionsBlock.matchAll(/route:\s*"([a-z]+)"/g)].map((m) => m[1]);
assert.deepEqual(
  sectionRoutes,
  ["ai", "games", "downloads", "search", "subbots"],
  "التنقّل الرئيسي يجب أن يكون AI · Games · Downloads · Search · Sub-bots فقط",
);

// التنقّل السفلي على الهاتف هو الأقسام نفسها (لا قسم سادس مخفي)
assert.ok(shell.includes("{SECTIONS.map"), "التنقّل السفلي يبني من نفس قائمة الأقسام");

// ── 3. لا صفحات أقسام ملغاة ولا مسارات لها ──────────────────
for (const gone of ["Dashboard", "Tools", "Media", "Commands", "Groups"]) {
  assert.ok(
    !fs.existsSync(path.join(WEB, "pages", `${gone}.tsx`)),
    `صفحة قسم ملغاة ما زالت موجودة: ${gone}.tsx`,
  );
}
const app = read("web/src/App.tsx");
const appRoutes = [...(app.match(/const ROUTES: Route\[\] = \[(.*?)\]/s)?.[1] || "").matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
assert.deepEqual(
  appRoutes.slice(0, 5),
  ["ai", "games", "downloads", "search", "subbots"],
  "الأقسام الخمسة أولاً في المسارات",
);
for (const extra of appRoutes.slice(5)) {
  assert.ok(["account", "owner"].includes(extra), `مسار غير مسموح كقسم: ${extra}`);
}
// الحساب والمالك يُفتحان من قائمة الحساب لا من التنقّل
assert.ok(!sectionRoutes.includes("account") && !sectionRoutes.includes("owner"), "الحساب/المالك ليسا قسمين");
assert.ok(shell.includes('role="menu"'), "قائمة الحساب موجودة في الشريط العلوي");

// ── 4. عارضات الألعاب: allowlist مطابق للمحرّك الحقيقي ───────
const boardSource = read("web/src/components/GameBoard.tsx");
const rendererBlock = boardSource.slice(
  boardSource.indexOf("const RENDERER: Record<string, Renderer> = {"),
  boardSource.indexOf("};", boardSource.indexOf("const RENDERER: Record<string, Renderer> = {")),
);
const renderers = new Map(
  [...rendererBlock.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*"(grid|lines|track)"/gm)].map((m) => [m[1], m[2]]),
);
assert.ok(renderers.size >= 20, `عدد العارضات غير منطقي: ${renderers.size}`);

// كل لعبة في المحرّك: معرّفها الحقيقي وأنواع لوحاتها
const gamesDir = path.join(ROOT, "src", "lib", "terboo-arcade", "games");
const engineGames = new Map();
for (const name of fs.readdirSync(gamesDir)) {
  if (!name.endsWith(".js") || name.startsWith("_")) continue;
  const source = fs.readFileSync(path.join(gamesDir, name), "utf8");
  const id = source.match(/^\s*id:\s*"([a-z][a-z0-9_]*)"/m)?.[1];
  if (!id) continue;
  const kinds = new Set([...source.matchAll(/kind:\s*"(grid|lines|track)"/g)].map((m) => m[1]));
  engineGames.set(id, kinds);
}
assert.ok(engineGames.size >= 20, `عدد ألعاب المحرّك غير منطقي: ${engineGames.size}`);

// (أ) لا عارض لمعرّف لا يوجد في المحرّك (allowlist لا يخترع ألعاباً)
for (const id of renderers.keys()) {
  assert.ok(engineGames.has(id), `عارض لمعرّف ليس في المحرّك: ${id}`);
}
// (ب) كل لعبة تبني لوحة لها عارض، ونوعه من أنواع لوحاتها الفعلية
for (const [id, kinds] of engineGames) {
  if (kinds.size === 0) continue;
  const renderer = renderers.get(id);
  assert.ok(renderer, `لعبة بلا عارض رسومي: ${id}`);
  assert.ok(kinds.has(renderer), `عارض ${id} = ${renderer} لا يطابق لوحاتها (${[...kinds].join("/")})`);
}
// (ج) الاحتياط النصّي موجود، ولا JSON خام في العرض
assert.ok(boardSource.includes("function TextView"), "عارض نصّي احتياطي مطلوب للعبة غير مُدرَجة");
assert.ok(!/JSON\.stringify/.test(boardSource), "لا JSON خام في عارض اللوحة");
const gamesPage = read("web/src/pages/Games.tsx");
assert.ok(!/JSON\.stringify/.test(gamesPage), "صفحة الألعاب لا تعرض JSON خاماً");
assert.ok(gamesPage.includes("GameBoardView"), "صفحة الألعاب تستعمل العارض الرسومي");
// اللون من بيانات اللعبة يُفحَص قبل أي استعمال في style
assert.ok(/function safeColor/.test(boardSource) && /\^#\(\?:\[0-9a-f\]/.test(boardSource), "لون اللعبة يُفحَص كـhex صالح");

// ── 5. الروابط الخارجية محصّنة ──────────────────────────────
for (const rel of ["web/src/pages/Search.tsx", "web/src/pages/Downloads.tsx"]) {
  const source = read(rel);
  const anchors = [...source.matchAll(/<a\b[^>]*>/gs)].map((m) => m[0]);
  for (const anchor of anchors) {
    if (!/target=\{?"_blank"/.test(anchor)) continue;
    assert.ok(/rel="noopener noreferrer nofollow"/.test(anchor), `رابط خارجي بلا تحصين في ${rel}: ${anchor.slice(0, 70)}`);
  }
  assert.ok(anchors.length > 0, `لا روابط في ${rel}`);
}

// ── 6. كل مفتاح ترجمة مستعمل موجود في اللغتين ───────────────
const i18n = read("web/src/lib/i18n.ts");
const arBlock = i18n.slice(i18n.indexOf("const ar: Dict = {"), i18n.indexOf("const en: Dict = {"));
const enBlock = i18n.slice(i18n.indexOf("const en: Dict = {"));
const keysOf = (block) => new Set([...block.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]));
const arKeys = keysOf(arBlock);
const enKeys = keysOf(enBlock);
assert.equal(arKeys.size, enKeys.size, "عدد مفاتيح العربية والإنجليزية يجب أن يتطابق");
for (const key of arKeys) assert.ok(enKeys.has(key), `مفتاح بلا إنجليزية: ${key}`);
for (const key of enKeys) assert.ok(arKeys.has(key), `مفتاح بلا عربية: ${key}`);

const used = new Set();
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(match[1]);
}
assert.ok(used.size > 40, `عدد المفاتيح المستعملة غير منطقي: ${used.size}`);
const missing = [...used].filter((key) => !arKeys.has(key));
assert.deepEqual(missing, [], `مفاتيح مستعملة بلا ترجمة: ${missing.join(", ")}`);

// ── 7. الأقسام الجديدة تنادي مسارات API حقيقية ───────────────
const downloadsPage = read("web/src/pages/Downloads.tsx");
for (const route of ["/downloads/platforms", "/downloads/resolve", "/downloads/jobs", "/downloads/history"]) {
  assert.ok(downloadsPage.includes(route), `صفحة التنزيلات لا تستعمل ${route}`);
}
const searchPage = read("web/src/pages/Search.tsx");
for (const route of ["/search/sources", "\"/search\""]) {
  assert.ok(searchPage.includes(route), `صفحة البحث لا تستعمل ${route}`);
}
const subbotsPage = read("web/src/pages/SubBots.tsx");
for (const route of ["/subbots", "/subbots/pair"]) {
  assert.ok(subbotsPage.includes(route), `صفحة البوتات الفرعية لا تستعمل ${route}`);
}
// التنصيب يرسل تأكيداً صريحاً، ولا يطلب رقماً من المستخدم
assert.ok(subbotsPage.includes("confirm: true"), "التنصيب يرسل تأكيداً صريحاً");
assert.ok(!/phone|number:\s*(url|input)/i.test(subbotsPage.replace(/maskedTarget|phoneMasked/g, "")), "لا يُطلب رقم من المستخدم للتنصيب");

// المسارات التي تستعملها الواجهة مسجَّلة فعلاً في الخادم
const routesIndex = read("src/web/http/routes/index.js");
for (const module of ["downloads", "search", "subbots", "games"]) {
  assert.ok(routesIndex.includes(`./${module}.js`), `مسار الخادم غير مسجَّل: ${module}`);
}

// ── 8. درج الجوال يظهر فعلاً ────────────────────────────────
// كان العطل: قائمة الدرج هي نفسها nav.sidebar، واستعلام الجوال يضع
// `.sidebar { display: none }`، فيُرسم صندوق الدرج ومحتواه مخفيّ.
// هذا العقد يمنع عودة العطل من جهتيه: الصنف في الهيكل، والاستثناء في الأنماط.
const DRAWER_CLASS = "sidebar--drawer";
const drawerNav = shell.match(/<nav className="([^"]*)"[^>]*>\{nav\}<\/nav>/);
assert.ok(drawerNav, "قائمة الدرج غير موجودة في Shell.tsx");
const drawerClasses = drawerNav[1].split(/\s+/).filter(Boolean);
assert.ok(drawerClasses.includes("sidebar"), "قائمة الدرج يجب أن تبقى .sidebar");
assert.ok(drawerClasses.includes(DRAWER_CLASS), `قائمة الدرج يجب أن تحمل .${DRAWER_CLASS}`);

const css = read("web/src/styles/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
// كل قاعدة تُخفي داخل استعلام جوال يجب ألّا تُطابق قائمة الدرج
const mobileBlocks = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g)];
assert.ok(mobileBlocks.length >= 1, "لا يوجد استعلام جوال في أنماط الموقع");
let guarded = 0;
for (const [, width, body] of mobileBlocks) {
  for (const [, selectors] of body.matchAll(/([^{}]+)\{([^{}]*display\s*:\s*none[^{}]*)\}/g)) {
    for (const selector of selectors.split(",").map((part) => part.trim()).filter(Boolean)) {
      // آخر مُركَّب في المحدِّد هو ما يُخفى فعلاً
      const target = selector.split(/\s+/).pop();
      if (!/(^|\.)sidebar(?![\w-])/.test(target)) continue;
      assert.ok(
        target.includes(`:not(.${DRAWER_CLASS})`) || target.includes(`.${DRAWER_CLASS}`),
        `قاعدة إخفاء عند ${width}px تُخفي قائمة الدرج أيضاً: ${selector}`,
      );
      guarded += 1;
    }
  }
}
assert.equal(guarded, 1, `عدد قواعد إخفاء الشريط الجانبي على الجوال غير متوقَّع: ${guarded}`);
// والصنف معرَّف فعلاً بأنماطه (لا صنف ميّت)
assert.ok(new RegExp(`\\.${DRAWER_CLASS}\\s*\\{`).test(css), `.${DRAWER_CLASS} بلا تعريف في الأنماط`);
// الدرج فوق التنقّل السفلي والخلفية
const zIndex = (name) => Number((css.match(new RegExp(`\\.${name}\\s*\\{[^}]*z-index:\\s*(\\d+)`)) || [])[1]);
assert.ok(zIndex("drawer") > zIndex("drawer-backdrop"), "الدرج تحت خلفيته");
assert.ok(zIndex("drawer") > zIndex("bottomnav"), "الدرج تحت التنقّل السفلي");

console.log(`✅ web-ui-contract: ${sectionRoutes.length} أقسام مرئية · ${renderers.size} عارض لعبة مطابق للمحرّك (${engineGames.size} لعبة) · ${used.size} مفتاح ترجمة مغطّى · لا حقن HTML · روابط خارجية محصّنة`);
