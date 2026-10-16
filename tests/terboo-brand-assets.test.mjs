// ═══════════════════════════════════════════════
// 🧪 Terboo Brand Assets (§68 §69)
// ───────────────────────────────────────────────
// البيان docs/terboo-asset-manifest.json يطابق الملفات الفعلية:
//   • كل مسار ./assets/… في config.js موجود (لا مسار مكسور).
//   • كل صورة مولّدة بنفس اسمها ومقاسها المسجّل، وبصمتها مطابقة للملف على القرص.
//   • الأصول الوظيفية (ورق magernulis الأصلي · قالب الميم) محفوظة كما هي.
//   • صورة لكل قسم · صور shuffle من الهوية · ورق الكتابة بمقاس الأمر.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/terboo-asset-manifest.json"), "utf8"));
const sharp = (await import("sharp")).default;

assert.equal(manifest.summary.brokenReferences.length, 0, `مسارات مكسورة: ${manifest.summary.brokenReferences}`);
const config = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
for (const [, rel] of config.matchAll(/["'`]\.\/(assets\/[^"'`]+)["'`]/g)) assert.ok(fs.existsSync(path.join(ROOT, rel)), `config.js يشير إلى ملف غير موجود: ${rel}`);

const generated = manifest.assets.filter((a) => a.status === "generated");
assert.ok(generated.length >= 20, `صور الهوية المولّدة ${generated.length}`);
for (const asset of generated) {
  const file = path.join(ROOT, asset.path);
  assert.ok(fs.existsSync(file), `${asset.path} غائب`);
  const buffer = fs.readFileSync(file);
  assert.equal(crypto.createHash("sha256").update(buffer).digest("hex"), asset.sha256, `${asset.path}: الملف لا يطابق البيان (أعد تشغيل tools/terboo-brand-assets.mjs)`);
  const meta = await sharp(buffer).metadata();
  assert.equal(`${meta.width}x${meta.height}`, `${asset.width}x${asset.height}`, `${asset.path}: المقاس تغيّر`);
}
for (const kept of ["assets/kertas/magernulis1.jpg", "assets/meme/Drake-Hotline-Bling.jpg"]) {
  assert.equal(manifest.assets.find((a) => a.path === kept)?.status, "kept", `${kept} يجب أن يبقى كما هو`);
}

// «Neon Shinobi»: صورة لكل قسم في قائمة الأقسام + احتياطي، وكلها 1280×720 (720p خفيف وواضح)
const sections = generated.filter((a) => a.path.startsWith("assets/image/sections/"));
const categories = new Set();
for (const dir of fs.readdirSync(path.join(ROOT, "plugins"))) {
  for (const file of fs.readdirSync(path.join(ROOT, "plugins", dir)).filter((f) => f.endsWith(".js"))) {
    const match = fs.readFileSync(path.join(ROOT, "plugins", dir, file), "utf8").match(/^\s*category:\s*["']([^"']+)["']/m);
    if (match) categories.add(match[1]);
  }
}
for (const cat of [...categories, "default"]) assert.ok(sections.some((a) => a.path === `assets/image/sections/${cat}.jpg`), `قسم بلا صورة: ${cat}`);
assert.ok(sections.every((a) => a.width === 1280 && a.height === 720), "مقاس صور الأقسام 1280×720");
// الصور التي تُرسل كاملة في نطاق 720–1080 (الضلع الأقصر)، والضلع الأطول لا يتجاوز 1280؛ والمضمَّنة مصغّرةً (jpegThumbnail) تبقى صغيرة
const dims = (rel) => generated.find((a) => a.path === `assets/image/${rel}`);
for (const rel of ["terboo-banner.jpg", "terboo-landscape.jpg", "terboo-rules.jpg", "terboo-daftar.png", "terboo-promote.png", "terboo-demote.png", "pp-kosong.jpg"]) {
  const { width, height } = dims(rel);
  assert.ok(Math.min(width, height) >= 720 && Math.min(width, height) <= 1080 && Math.max(width, height) <= 1280, `${rel}: ${width}x${height} خارج 720–1080`);
}
for (const rel of ["terboo.png", "terboo2.jpg", "terboo-games.jpg", "terboo-winner.jpg", "terboo-rpg.jpg", "terboo-levelup.jpg", "terboo-minecraft.jpg", "terboo-fishit.jpg"]) assert.ok(Math.max(dims(rel).width, dims(rel).height) <= 1100 && dims(rel).bytes < 400_000, `${rel}: صورة مصغّرة كبيرة`);
assert.ok(generated.filter((a) => a.path.startsWith("assets/image/shuffle/")).every((a) => a.width <= 800), "صور الردود مصغّرات");

// صور الردود العشوائية التي يختارها البوت: كلها من حزمة الهوية. صور الأشخاص القديمة قد تبقى
// في نسخة فُكّ التحديث فوقها، لكنها مستبعدة من الاختيار (انظر RETIRED_SHUFFLE أدناه).
const { RETIRED_SHUFFLE, shuffleImages, randomShuffleImage } = await import("../src/lib/terboo-asset-manager.js");
const shuffle = shuffleImages().map((file) => path.basename(file));
assert.ok(shuffle.length >= 6 && shuffle.every((f) => /^terboo-shuffle-\d+\.jpg$/.test(f)), `shuffle: ${shuffle}`);
assert.ok(shuffle.every((f) => generated.some((a) => a.path === `assets/image/shuffle/${f}`)));

// ورق الكتابة اليدوية بالمقاس الذي يكتب عليه الأمر (نص من x=344 حتى 944 والتاريخ عند 806)
const kertas = generated.find((a) => a.path === "assets/image/terboo-kertas.jpg");
assert.deepEqual([kertas.width, kertas.height], [1024, 784]);
assert.ok(generated.some((a) => a.path === "assets/image/terboo-banner.jpg" && a.width === 1280 && a.height === 720), "لافتة القائمة 1280×720");

// قائمة الأقسام تختار صورة القسم، والقسم المجهول يعود للافتراضية
const { sectionImage } = await import("../src/lib/terboo-asset-manager.js");
assert.equal(sectionImage("ai").name, "ai");
assert.equal(sectionImage("../../config").name, "default");
assert.equal(sectionImage("قسم-غير-موجود").name, "default");
// صور الخلط القديمة (أشخاص حقيقيون) لا تُختار إن بقيت من نسخة سابقة، وصور المالك المضافة تبقى
assert.equal(RETIRED_SHUFFLE.size, 4);
const os = await import("node:os");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-shuffle-"));
fs.mkdirSync(path.join(tmp, "assets/image/shuffle"), { recursive: true });
const oldPhoto = Buffer.from("legacy copied photo");
fs.writeFileSync(path.join(tmp, "assets/image/shuffle/20032df7383ca92b7861a7081f2abe2d.jpg"), oldPhoto);
fs.writeFileSync(path.join(tmp, "assets/image/shuffle/owner-added.jpg"), Buffer.from("owner image"));
RETIRED_SHUFFLE.add(crypto.createHash("sha256").update(oldPhoto).digest("hex"));
const cwd = process.cwd();
process.chdir(tmp);
assert.deepEqual(shuffleImages().map((f) => path.basename(f)), ["owner-added.jpg"]);
for (let i = 0; i < 10; i += 1) assert.equal(randomShuffleImage().toString(), "owner image");
process.chdir(cwd);
fs.rmSync(tmp, { recursive: true, force: true });
assert.equal(shuffleImages().length, shuffle.length, "صور الهوية كلها صالحة");

// «Neon Shinobi»: كل نص مرسوم في الصور بالإنجليزية (اسم ملف القسم «عام» مفتاح لا نص معروض)
const generator = fs.readFileSync(path.join(ROOT, "tools/terboo-brand-assets.mjs"), "utf8");
const block = (start) => generator.slice(generator.indexOf(start), generator.indexOf("\n]", generator.indexOf(start)));
const code = (text) => text.split("\n").filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join("\n");
const ARABIC = /[\u0600-\u06FF]/;
assert.doesNotMatch(code(block("const SPEC = [")), ARABIC, "نص عربي في صور config.assets");
assert.doesNotMatch(code(block("const SHUFFLE = [")), ARABIC, "نص عربي في صور shuffle");
assert.doesNotMatch(code(block("const SECTION_DATA = [")).replace(/^\s*\["[^"]*",/gm, "["), ARABIC, "نص عربي في صور الأقسام");
assert.doesNotMatch(code(fs.readFileSync(path.join(ROOT, "tools/terboo-brand-art.mjs"), "utf8")), ARABIC, "نص عربي في مكتبة الرسم");
for (const layout of ["layoutWide", "layoutSquare", "layoutPortrait", "layoutThumb", "layoutPaper", "layoutAvatar", "layoutType"]) {
  assert.ok(generator.includes(`function ${layout}(`), `${layout} غائب`);
  const start = generator.indexOf(`function ${layout}(`);
  assert.doesNotMatch(code(generator.slice(start, generator.indexOf("\n}\n", start))), ARABIC, `نص عربي في ${layout}`);
}
// مشاهد Canva: الشخصية الرئيسية موجودة، وكل صورة تحمل مشهداً موجوداً فعلاً
assert.ok(fs.existsSync(path.join(ROOT, "tools/brand-art/shinobi/master.jpg")), "الشخصية الرئيسية غائبة");
for (const asset of generated.filter((a) => a.art)) {
  assert.ok(fs.existsSync(path.join(ROOT, `tools/brand-art/shinobi/${asset.art}.jpg`)), `${asset.path}: مشهد غائب ${asset.art}`);
  assert.ok(fs.existsSync(path.join(ROOT, `tools/brand-art/shinobi/${asset.art}-mask.png`)), `${asset.path}: قناع الشخصية غائب ${asset.art}`);
}
for (const file of fs.readdirSync(path.join(ROOT, "tools/brand-art/shinobi")).filter((f) => /^[a-z]+\.jpg$/.test(f))) {
  const meta = await sharp(path.join(ROOT, "tools/brand-art/shinobi", file)).metadata();
  assert.equal(`${meta.width}x${meta.height}`, "2160x2160", `${file}: مشهد غير مكبّر`);
}
// الاسم الكبير خلف الشخصية بخطه المرخّص
assert.ok(fs.existsSync(path.join(ROOT, "assets/fonts/terboo/Anton-Regular.ttf")) && fs.existsSync(path.join(ROOT, "assets/fonts/terboo/Anton-OFL.txt")), "خط الاسم Anton");
assert.match(generator, /const NAME = "TERBOO"/);
assert.ok(generated.filter((a) => a.art).length >= 60, "صور بلا مشهد الشخصية");

// نطاق 720–1080 الواضح: كل صورة تُرسل كاملة · المصغّرات (jpegThumbnail ≤ 300) مستثناة · قالب الكتابة بمقاسه
const THUMBS = /^(terboo\.png|terboo-(rpg|levelup|minecraft|fishit)\.jpg)$/;
for (const asset of generated.filter((a) => /\.(jpe?g|png|webp)$/.test(a.path) && !THUMBS.test(path.basename(a.path)) && !/kertas/.test(a.path) && !/shuffle\//.test(a.path))) {
  const long = Math.max(asset.width, asset.height);
  const short = Math.min(asset.width, asset.height);
  assert.ok(long <= 1280 && short <= 1080 && short >= 720, `${asset.path}: ${asset.width}x${asset.height} خارج 720–1080`);
}
// البطاقات على خلفيات خارجية مجهولة المقاس تُوضع داخل الحدود بوضوح
const { fitDisplayImage } = await import("../src/lib/terboo-asset-manager.js");
const sized = async (w, h) => sharp(await fitDisplayImage(await sharp({ create: { width: w, height: h, channels: 3, background: "#123" } }).jpeg().toBuffer())).metadata();
assert.deepEqual(await sized(3000, 2000).then((m) => [m.width, m.height]), [1280, 853], "كبيرة ⇒ تُصغَّر");
assert.deepEqual(await sized(400, 300).then((m) => [m.width, m.height]), [960, 720], "صغيرة ⇒ ضلعها الأقصر 720");
assert.deepEqual(await sized(1280, 720).then((m) => [m.width, m.height]), [1280, 720], "داخل الحدود ⇒ كما هي");

console.log(`✅ terboo-brand-assets: ${generated.length} صورة هوية (${sections.length} قسم · ${shuffle.length} shuffle) · ${manifest.summary.kept} أصل محفوظ · 0 مسار مكسور`);
