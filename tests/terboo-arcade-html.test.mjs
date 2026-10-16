// ═══════════════════════════════════════════════
// 🧪 TERBOO ARCADE — HTML 3D · النقل · نظام التصميم · الـRenderers
// ───────────────────────────────────────────────
// • الهروب (escaping) ومدقق القوالب يرفض الوسوم/السمات/البروتوكولات الخطرة وحد الحجم
// • النقل: build → serialize → encode → WAProto validate → decode → verify لكل لعبة HTML
// • لا بيانات Meta مصطنعة أو مصادر/شهادات مرجعية · تحكم الخادم مستقل عن HTML
// • قوالب مقترحة: معلّقة حتى يعتمدها المالك
// • نظام التصميم (6 ثيمات · RTL/LTR · reduced-motion · لمس ≥ 44px · صوت no-op)
// • Text/Buttons/HTML من نفس View Model، بلا مولّد صور
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const H = await import("../src/lib/terboo-html-game.js");
const DS = await import("../src/lib/terboo-game-design-system.js");
const { loadArcade, arcadeContracts } = await import("../src/lib/terboo-arcade/index.js");
await loadArcade();
const E = await import("../src/lib/terboo-arcade/engine.js");
const R = await import("../src/lib/terboo-arcade/render.js");
const { memoryRepository } = await import("../src/lib/terboo-arcade/repository.js");
E.configure({ repository: memoryRepository(), wallet: { credit() {} } });

const A = "201000000201@s.whatsapp.net";

// 1) الهروب: اسم لاعب خبيث لا يصبح HTML
const evil = "<img src=x onerror=alert(1)><script>alert(2)</script>";
const html = H.buildGameHtml({ title: evil, icon: "🎮", state: "PLAYING", turn: 0, players: [{ name: evil }], board: { kind: "grid", cols: 1, cells: [{ t: evil }] }, panels: [{ label: evil, value: evil }], actions: [{ id: "x", label: evil }] }, { lang: "en" });
// الفحص بنيوي: النص المُهرَّب داخل قيمة سمة يحتوي " onerror=" حرفياً، وهو غير خطير.
// الخطر الحقيقي هو وسم أو سمة حدث **فعلية**، فنفحص أسماء الوسوم والسمات لا المستند كنص.
const tagsIn = (doc) => [...String(doc).matchAll(/<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g)]
  .map((m) => ({ tag: m[1].toLowerCase(), attrs: [...String(m[2]).matchAll(/([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g)].map((a) => a[1].toLowerCase()) }));
const emitted = tagsIn(html);
assert.ok(emitted.length > 0, "القالب يحتوي وسوماً");
assert.ok(!emitted.some((t) => ["img", "script", "iframe", "form", "input"].includes(t.tag)), "لا وسم خطير فعلي من نص المستخدم");
assert.ok(!emitted.some((t) => t.attrs.some((a) => /^on[a-z]+$/.test(a))), "لا سمة حدث فعلية");
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, "نص المستخدم مُهرَّب حرفياً وليس منفَّذاً");
assert.equal(H.validateTemplate(html).ok, true, "مخرجات البنّاء تمر من المدقق");

// 2) المدقق يرفض
const bad = {
  script: "<div><script>alert(1)</script></div>",
  iframe: "<iframe src='about:blank'></iframe>",
  handler: "<div onclick=\"x()\">a</div>",
  jsproto: "<a href=\"javascript:alert(1)\">a</a>",
  external: "<img src=\"https://evil.example/x.png\">",
  cssimport: "<style>@import url(foo.css)</style>",
  cssurl: "<div style=\"background:url(//evil.example/x)\"></div>",
  meta: "<meta http-equiv=\"refresh\" content=\"0\">",
  form: "<form><input name=a></form>",
  dataHtml: "<a href=\"data:text/html,<b>x</b>\">x</a>",
  huge: `<div>${"x".repeat(H.MAX_HTML_BYTES + 10)}</div>`,
};
for (const [name, sample] of Object.entries(bad)) assert.equal(H.validateTemplate(sample).ok, false, `مرفوض: ${name}`);

// 3) جسر الإجراءات والإرسال
assert.equal(H.ACTION_BRIDGE.enabled, false, "لا يُعلن جسر HTML بلا إثبات");
const priorHtmlTransport = process.env.TERBOO_ARCADE_HTML;
delete process.env.TERBOO_ARCADE_HTML;
// نقل HTML المضمَّن مطفأ افتراضياً: الترميز مُثبت (round-trip أدناه) لكن تصيير
// WhatsApp Android له غير مُثبت، ولا قناة تُعيد نقرة منه إلى الخادم.
assert.equal(H.resolveHtmlTransport(null), "off", "مطفأ افتراضياً (لا يُفترض تصيير غير مُثبت)");
assert.equal(H.resolveHtmlTransport("off"), "off", "الإيقاف من الإعداد محترم");
assert.equal(H.resolveHtmlTransport("rich"), "rich", "التفعيل الصريح من الإعداد يعمل");
process.env.TERBOO_ARCADE_HTML = "rich";
assert.equal(H.resolveHtmlTransport(null), "rich", "التفعيل الصريح من البيئة يعمل");
process.env.TERBOO_ARCADE_HTML = "off";
assert.equal(H.resolveHtmlTransport("rich"), "off", "البيئة تتغلب على الإعداد");
delete process.env.TERBOO_ARCADE_HTML;
if (priorHtmlTransport !== undefined) process.env.TERBOO_ARCADE_HTML = priorHtmlTransport;
const relayed = await H.relayTransport({ relayMessage: async () => "X" }, "x@s.whatsapp.net", { ok: true, message: {} });
assert.deepEqual(relayed, { relayed: false, reason: "client-rendering-unproven" }, "النقل لا يعمل دون تفعيل صريح");

// 4) النقل لكل لعبة HTML من View Model حقيقي
const REFERENCE_ONLY = /botMetadata|verificationMetadata|certificateChain|trusted_sources|richResponseSourcesMetadata/;
let transported = 0;
for (const c of arcadeContracts()) {
  // كل عقد لعبة يجب أن يملك عرض HTML، حتى لو كان uiMode القديم مختلفاً.
  const view = {
    gameId: c.id,
    title: c.name?.ar || c.id,
    icon: c.icon || "🎮",
    category: c.category,
    lang: "ar",
    state: "PLAYING",
    status: "اختبار HTML",
    turn: 0,
    marks: ["X", "O"],
    players: [{ name: "لاعب اختبار", mark: "X" }],
    board: { kind: "grid", cols: 3, cells: [{ t: "X", k: "x" }, { t: "▫️", k: "empty" }, { t: "O", k: "o" }] },
    actions: [],
    panels: [],
  };
  if (c.id === "wordle_ar") {
    view.board = { kind: "lines", lines: ["سجل نصي احتياطي"] };
    view.image = { kind: "grid", cols: 5, cells: [{ t: "ص", k: "color", c: "#22c55e" }] };
  }
  const page = R.htmlView(view);
  assert.match(page, /dir="rtl"/, `${c.id}: RTL للعربية`);
  if (c.id === "wordle_ar") assert.match(page, /kind-color/, "وردل يستخدم لوحة الألوان HTML وليس صورة");
  const t = H.encodeTransport(page, { sessionId: `session-${c.id}`, version: 1, nonce: "test-nonce" });
  assert.equal(t.ok, true, `${c.id}: ${JSON.stringify(t.stages)}`);
  assert.deepEqual(t.stages.map((s) => s.stage), ["build", "serialize", "validate", "encode", "decode", "verify"]);
  const payload = Buffer.from(t.message.richResponseMessage.unifiedResponse.data).toString("utf8");
  assert.doesNotMatch(payload, REFERENCE_ONLY, `${c.id}: لا بيانات تحقق/مصادر منسوخة`);
  const rich = JSON.parse(payload);
  assert.match(rich.response_id, /^[0-9a-f-]{36}$/i, "معرّف رد ديناميكي");
  assert.equal(rich.sections[0].view_model.primitive.__typename, "GenAIaeacdsnwHtmlPrimitive");
  assert.match(rich.sections[0].view_model.primitive.payload, /TERBOO ARCADE/);
  transported += 1;
}
assert.equal(transported, arcadeContracts().length, "كل ألعاب المحرك الموحّد لها عرض HTML");
// قالب خبيث لا يمر للنقل
assert.equal(H.encodeTransport(bad.script).ok, false);

// 5) قوالب مقترحة: معلّقة حتى اعتماد المالك
assert.equal(H.proposeTemplate({ kind: "fancy", html: bad.handler, by: "ai" }).ok, false, "قالب خطر يُرفض فوراً");
const proposed = H.proposeTemplate({ kind: "fancy", html: "<div class=\"x\">ok</div>", by: "ai" });
assert.equal(proposed.ok, true);
assert.ok(!H.htmlGameRegistry.has("fancy"), "غير مستعمل قبل الاعتماد");
assert.equal(H.approveTemplate(proposed.id, { isOwner: false }).ok, false, "غير المالك لا يعتمد");
assert.equal(H.approveTemplate(proposed.id, { isOwner: true }).ok, true);
assert.ok(H.htmlGameRegistry.has("fancy"));

// 6) نظام التصميم
assert.deepEqual(Object.keys(DS.THEMES).sort(), ["CLASSIC", "CYBER", "FANTASY", "MIDNIGHT", "MINIMAL", "NEON"]);
for (const id of Object.keys(DS.THEMES)) {
  const css = DS.cssFor(id);
  assert.match(css, /prefers-reduced-motion/, `${id}: reduced motion`);
  assert.match(css, /min-height:44px/, `${id}: هدف لمس`);
}
assert.equal(DS.dirOf("ar"), "rtl");
assert.equal(DS.dirOf("es"), "ltr");
assert.equal(DS.audio.play("win").played, false, "صوت no-op صريح");

// 7) Renderers من نفس View Model
const r = E.createRoom({ gameId: "connect4", chat: "render@s.whatsapp.net", isGroup: false, host: { jid: A, name: "A" }, vsAI: true });
const view = E.getView(r.room.roomId, { lang: "en" });
const text = R.textView(view);
assert.match(text, /Connect Four/, "نص بلغة اللاعب");
const ui = R.buttonsView(view, { prefix: ".", cmd: "اركيد", extra: ["surrender"] });
const ids = [...ui.buttons.map((b) => b.id), ...(ui.select?.sections || []).flatMap((s) => s.rows.map((x) => x.id))];
assert.ok(ids.filter((id) => id.startsWith(`.اركيد a ${r.room.roomId} ${r.room.nonce} `)).length === view.actions.length, "كل حركة زر بـnonce النسخة");
assert.ok(ids.every((id) => !/winner|score|admin/.test(id)), "الأزرار لا تحمل نتائج");
assert.equal(R.mediaView, undefined, "مولّد صور الألعاب أزيل بالكامل");
const catalog = H.buildArcadeCatalogHtml([{ id: "xo", icon: "❌", title: "إكس أو", description: "اختبار", category: "لوحات", mode: "جماعية", players: "2" }], { lang: "ar" });
assert.match(catalog, /ta-game-card/);
assert.equal(H.validateTemplate(catalog).ok, true, "كتالوج HTML ثلاثي الأبعاد يمر من المدقق");
const legacyCard = H.buildTextGameHtml({ gameId: "legacy-test", title: "عنوان <خبيث>", body: "حالة الاختبار", text: "*نتيجة*\nقيمة: 100", lang: "ar", theme: "FANTASY" });
assert.equal(H.validateTemplate(legacyCard).ok, true, "قوالب الألعاب القديمة آمنة");
assert.doesNotMatch(legacyCard, /<خبيث>/, "نصوص الألعاب القديمة تُهرّب قبل العرض");
// سياسة الصور الجديدة (§6): بطاقة اللعبة لا تحمل صورة إطلاقاً — لا رسالة صورة،
// ولا Base64 مضمَّن كبديل عنها. العرض نص وأزرار واتساب فقط.
const imageQuizCard = H.buildTextGameHtml({ gameId: "quiz-image", title: "خمن الصورة", text: "ما هذا؟", imageDataUrl: "data:image/jpeg;base64,aGVsbG8=" });
assert.doesNotMatch(imageQuizCard, /ta-asset-image|<img\b/i, "لا عنصر صورة في بطاقة اللعبة");
assert.doesNotMatch(imageQuizCard, /data:image\//i, "لا Base64 لصورة داخل بطاقة اللعبة");
assert.equal(H.validateTemplate(imageQuizCard).ok, true, "البطاقة بلا صورة تمر من المدقق");
// الحقل القديم أُلغي: تمريره لا يُعيد مسار الصور من الباب الخلفي
for (const c of arcadeContracts().slice(0, 8)) {
  const card = H.buildGameHtml({ gameId: c.id, icon: c.icon, title: c.name.ar, state: "PLAYING", turn: 0,
    players: [{ name: "A" }], board: { kind: "grid", cols: 2, cells: [{ t: "❌" }, { t: "⭕" }] },
    inlineImageDataUrl: "data:image/png;base64,iVBORw0KGgo=" }, { lang: "ar" });
  assert.doesNotMatch(card, /<img\b|data:image\//i, `${c.id}: لا صورة في بطاقة اللعبة`);
}
assert.equal((await H.relayHtmlGame({ relayMessage: async () => "X" }, "x@s.whatsapp.net", legacyCard, { transport: "off" })).reason, "transport-disabled");

console.log(`✅ terboo-arcade-html: هروب · مدقق (${Object.keys(bad).length} رفض) · نقل HTML primitive لـ${transported} لعبة · بلا انتحال · جسر الإجراءات غير مُعلن · قوالب بموافقة المالك · 6 ثيمات · renderers`);
process.exit(0);
