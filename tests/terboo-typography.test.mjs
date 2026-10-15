// اختبار Typography (§28 §29)
//
// • العربية: Noto Sans Arabic · English/Español: Plus Jakarta Sans (Inter/Manrope احتياط معتمد).
// • الخطوط تُطبَّق فعلاً: قياس النص بخط الهوية يختلف عن خط النظام الاحتياطي.
// • لا خط قديم مسجّل (Zahraaa كخط عام، CartoonVibes، Epep، Levelup، ArialNarrow، Poppins، Arial).
// • كل ملف يرسم نصاً على Canvas يمر بسجل الخطوط المركزي.
// • خط اليد الوحيد الخاص موثّق ومحصور في بلوقن «كتابة يدوية» ويحتاط بالعربية.
// • بطاقات حقيقية تُرسم بالخطوط (الترحيب/الوداع).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const fonts = await import("../src/lib/terboo-fonts.js");
const { GlobalFonts, createCanvas } = await import("@napi-rs/canvas");

// ═══ 1. التسجيل المركزي ═══
const result = await fonts.registerFonts();
assert.equal(result.primaryReady, true, "Noto Sans Arabic و Plus Jakarta Sans جاهزان");
const families = new Set((GlobalFonts.families || []).map((entry) => entry.family));
for (const family of ["Terboo Arabic", "Terboo Latin", "Terboo Arabic Alt", "Terboo Latin Alt", "Manrope"]) {
  assert.ok(families.has(family), `العائلة غير مسجّلة: ${family}`);
}
for (const legacy of ["Zahraaa", "CartoonVibes", "Epep", "Levelup", "ArialNarrow", "Poppins", "Arial"]) {
  assert.ok(!families.has(legacy), `خط قديم ما زال مسجّلاً: ${legacy}`);
}

// ═══ 2. الملفات الصحيحة لكل لغة وبالأوزان الرقمية ═══
assert.match(fonts.getFontFile("ar", 700), /NotoSansArabic-Bold\.ttf$/);
assert.match(fonts.getFontFile("en", 700), /PlusJakartaSans-Bold\.ttf$/);
assert.match(fonts.getFontFile("es", "Regular"), /PlusJakartaSans-Regular\.ttf$/);
assert.match(fonts.getFontFile("en", 500), /PlusJakartaSans-Medium\.ttf$/, "الوزن الرقمي يُترجم لاسمه");
assert.match(fonts.getSvgFontStack("ar"), /^Noto Sans Arabic, /);
assert.match(fonts.getSvgFontStack("es"), /^Plus Jakarta Sans, /);
assert.match(fonts.getFontStack("ar", 700, 40), /^700 40px "Terboo Arabic"/);
assert.match(fonts.getFontStack("en", 400, 20), /^400 20px "Terboo Latin"/);

// ═══ 3. الخط يُطبَّق فعلاً (لا اسم بلا أثر) ═══
{
  const ctx = createCanvas(10, 10).getContext("2d");
  const width = (font, text) => { ctx.font = font; return ctx.measureText(text).width; };
  const arabicText = "مرحباً بك في بوت طربو";
  const spanishText = "Configuración rápida: ñandú, pingüino";
  assert.notEqual(width(fonts.getFontStack("ar", 700, 40), arabicText), width('700 40px "No Such Font XYZ"', arabicText), "العربية بخط الهوية لا بخط النظام");
  assert.notEqual(width(fonts.getFontStack("es", 700, 40), spanishText), width('700 40px "No Such Font XYZ"', spanishText), "الإسبانية بخط الهوية لا بخط النظام");
  assert.ok(width(fonts.getFontStack("es", 700, 40), "ñ") > 0, "حروف الإسبانية مرسومة");
}

// ═══ 4. خط اليد الخاص: موثّق ومحصور ويحتاط بالعربية ═══
{
  assert.ok(fonts.SPECIAL_FONTS.handwriting.reason, "سبب الاستثناء موثّق");
  const stack = await fonts.getSpecialFontStack("handwriting", "ar", 20);
  assert.match(stack, /"Terboo Handwriting", "Terboo Arabic"/, "خط اليد ثم احتياط العربية");
  const users = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && fs.readFileSync(full, "utf8").includes("getSpecialFontStack(\"handwriting\"")) users.push(path.relative(process.cwd(), full));
    }
  };
  walk(path.join(process.cwd(), "plugins"));
  assert.deepEqual(users, ["plugins/tools/كتابة_يدوية.js"], "خط اليد لا يُستعمل خارج بلوقنه");
}

// ═══ 5. كل رسم نصّي على Canvas يمر بسجل الخطوط المركزي ═══
{
  const offenders = [];
  // استثناء تقني موثّق: صور الكود تحتاج خطاً ثابت العرض ولا توجد نسخة monospace من الخطوط المعتمدة
  const TECHNICAL = new Set(["src/lib/terboo-carbon.js"]);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        const code = fs.readFileSync(full, "utf8");
        const rel = path.relative(process.cwd(), full).split(path.sep).join("/");
        if (/\.(?:fillText|strokeText)\(/.test(code) && !code.includes("terboo-fonts") && !TECHNICAL.has(rel)) offenders.push(rel);
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  walk(path.join(process.cwd(), "plugins"));
  assert.deepEqual(offenders, [], `ملفات ترسم نصاً بلا سجل الخطوط:\n${offenders.join("\n")}`);
  assert.match(fs.readFileSync("src/lib/terboo-carbon.js", "utf8"), /monospace/, "الاستثناء التقني ما زال كما وُثّق");
}

// ═══ 6. بطاقات حقيقية تُرسم ═══
{
  const cards = await import("../src/lib/terboo-welcome-card.js");
  const welcome = await cards.createWideDiscordCard("كريم ñandú", null, "مجموعة المطورين", 128);
  const goodbye = await cards.createGoodbyeCard("Karim", null, "Grupo de diseño", 127);
  for (const image of [welcome, goodbye]) {
    const buffer = Buffer.isBuffer(image) ? image : image?.buffer || image;
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 5000, "بطاقة مرسومة فعلاً");
    assert.equal(buffer.subarray(1, 4).toString(), "PNG", "صيغة PNG صالحة");
  }
}

// ═══ 7. SVG (sharp/librsvg) يستعمل خطوط الهوية فعلاً — v4 §35 ═══
// قبل v4: محرّك SVG لا يعرف إلا خطوط النظام، فكانت الصورة نفسها بايت-ببايت مع عائلة غير موجودة.
{
  const sharp = (await import("sharp")).default;
  const crypto = await import("node:crypto");
  assert.ok(fonts.SVG_FONTCONFIG && fs.existsSync(fonts.SVG_FONTCONFIG), "إعداد fontconfig لخطوط SVG غير موجود");
  assert.equal(process.env.FONTCONFIG_FILE, fonts.SVG_FONTCONFIG);
  assert.match(fs.readFileSync(fonts.SVG_FONTCONFIG, "utf8"), /assets\/fonts\/terboo<\/dir>/);
  const render = async (family) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><rect width="600" height="160" fill="#fff"/><text x="20" y="100" font-family="${family}" font-size="64" fill="#000">تيربو Terboo</text></svg>`;
    return crypto.createHash("sha1").update(await sharp(Buffer.from(svg)).png().toBuffer()).digest("hex");
  };
  const missing = await render("NoSuchFamilyTerboo");
  for (const family of [fonts.SVG_FAMILY.arabic, fonts.SVG_FAMILY.latin, fonts.SVG_FAMILY.arabicAlt, fonts.SVG_FAMILY.latinAlt]) {
    assert.notEqual(await render(family), missing, `${family} لا يُستعمل داخل SVG (يرسم بخط النظام)`);
  }
  // بطاقات SVG الحقيقية صالحة بعد تسجيل الخطوط (كانت بطاقة الاقتباس XML مكسوراً: font-family=""Terboo …"")
  await fonts.registerFonts();
  const { quoteImage } = await import("../src/lib/terboo-quote.js");
  const { bratImage } = await import("../src/lib/terboo-brat.js");
  const { fakeCardImage } = await import("../src/lib/terboo-fake-card.js");
  const svgs = {
    quote: quoteImage({ name: "تيربو", text: "مرحبا Terboo ñ" }),
    brat: bratImage("تيربو Terboo"),
    fakeCard: await fakeCardImage({ title: "بطاقة", name: "Terboo" }),
  };
  for (const [name, value] of Object.entries(svgs)) {
    const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
    if (text.trimStart().startsWith("<svg")) {
      assert.doesNotMatch(text, /font-family=""/, `${name}: font-family مكسور`);
      assert.match(text, /Noto Sans Arabic|Plus Jakarta Sans/, `${name}: لا يستعمل عائلات الهوية`);
      const png = await sharp(Buffer.from(text)).png().toBuffer();
      assert.equal(png.subarray(1, 4).toString(), "PNG", `${name}: لا يُرسم`);
    } else {
      assert.equal(Buffer.from(value).subarray(1, 4).toString(), "PNG", `${name}: صورة غير صالحة`);
    }
  }
}

console.log(`✅ terboo-typography: Noto Sans Arabic + Plus Jakarta Sans مطبّقان فعلاً في Canvas و SVG · صفر خطوط قديمة مسجّلة · Canvas عبر السجل المركزي`);
process.exit(0);
