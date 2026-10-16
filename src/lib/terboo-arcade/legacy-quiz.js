// ═══════════════════════════════════════════════
// 🔁 TERBOO ARCADE — ترحيل ألعاب الأسئلة القديمة إلى العقد الموحّد
// ───────────────────────────────────────────────
// ألعاب `games.register` الـ22 كانت تعيش على محرك جلسات منفصل، تردّ نصاً،
// وترسل صورة السؤال كرسالة واتساب (hasImage) مع مسار رجوع إلى صورة عند فشل HTML.
//
// هذا الملف لا يبني محركاً ثانياً: يقرأ **نفس** تسجيلات `games.register`
// و**نفس** ملفات `src/data/*.json`، ويحوّلها إلى عقود `defineGame` فوق
// `questions.js::quizGame` — أي نفس محرك الأسئلة الذي تستخدمه ساحة المعلومات.
// بذلك ترث هذه الألعاب تلقائياً: الغرف · الأدوار · nonce · القفل · المكافآت ·
// رمز اللعب الموقّع · صفحة Mini App · الكتالوج — بلا أي تكرار.
//
// الخيارات (A–D) تُولَّد على الخادم من إجابات أخرى في **نفس** ملف البيانات،
// والإجابة الصحيحة لا تُرسَل إلى العميل أبداً قبل حسم السؤال (مُورَّثة من quizGame).
// صور الأسئلة لا تُرسَل كرسالة: تُحوَّل إلى رمز أصل موقّع يُعرض **داخل** الصفحة.
// ═══════════════════════════════════════════════

import { defineGame } from "./contract.js";
import { quizGame } from "./questions.js";
import { register } from "./locale.js";
import { checkAnswerAdvanced, getAllData } from "../terboo-game-data.js";
import { issueAssetToken } from "./assets.js";
import { noteFailure } from "../terboo-failure-log.js";

/** عدد أسئلة الجولة لكل لعبة مُرحَّلة */
const ROUND = 8;
/** أقصى عدد مرشحين نقرأه لتوليد البدائل (ملفات تصل إلى 1000 عنصر) */
const POOL = 400;

const norm = (value) => String(value ?? "").trim();

/** معرّف لاتيني مستقر للعقد من مرادف اللعبة القديم (العقد يرفض الأسماء العربية) */
function contractId(cfg) {
  const latin = (cfg.alias || []).map(norm).find((a) => /^[a-z][a-z0-9_]*$/i.test(a));
  const base = (latin || norm(cfg.gameType)).toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  return `q_${(base || "quiz").slice(0, 28)}`;
}

/**
 * يستخرج نص السؤال والإجابة والصورة من سجل بيانات قديم بحسب إعدادات اللعبة.
 * @returns {{prompt:string, answer:string, assetUrl:string}|null}
 */
function readRecord(row, cfg) {
  if (!row || typeof row !== "object") return null;
  const answer = norm(row[cfg.answerField]);
  if (!answer) return null;
  const prompt = cfg.questionField ? norm(row[cfg.questionField]) : "";
  // عنوان مصدر فقط — يُحوَّل لاحقاً إلى رمز موقّع يُعرض داخل الصفحة، ولا يُرسل أبداً
  const assetUrl = cfg.hasImage ? norm(row[cfg.imageField]) : "";
  return { prompt, answer, assetUrl };
}

/**
 * يبني أسئلة A–D من ملف البيانات القديم.
 * البدائل من إجابات حقيقية أخرى في نفس الملف ⇒ خيارات معقولة لا عشوائية بلا معنى.
 * يُستدعى داخل `init` فيحصل على `rng` الخادم المعرّف ⇒ قابل للاختبار وحتمي.
 */
function sourceFor(cfg) {
  return (rng) => {
    let rows = [];
    try {
      rows = getAllData(cfg.dataFile) || [];
    } catch (error) {
      noteFailure("arcade-legacy-quiz", error, { where: "terboo-arcade/legacy-quiz:source", stage: cfg.dataFile, fallback: "empty" });
      return [];
    }
    const records = rng.shuffle(rows.slice(0, POOL)).map((row) => readRecord(row, cfg)).filter(Boolean);
    // مجموعة إجابات فريدة للبدائل (لا تكرار نصي يجعل خياريْن صحيحين)
    const answers = [...new Set(records.map((r) => r.answer))];
    if (answers.length < 4) return [];
    const out = [];
    for (const record of records) {
      if (out.length >= ROUND) break;
      const pool = answers.filter((a) => a.toLowerCase() !== record.answer.toLowerCase());
      if (pool.length < 3) continue;
      const distractors = rng.shuffle(pool).slice(0, 3);
      // الإجابة في الموضع 0 هنا؛ quizGame يخلط المواضع على الخادم عبر shuffleOptions
      out.push({
        q: record.prompt || cfg.description || cfg.title,
        options: [record.answer, ...distractors],
        answer: 0,
        hint: record.answer.length > 2 ? `${record.answer.slice(0, 1)}…${record.answer.slice(-1)} (${record.answer.length})` : null,
        // عنوان المصدر فقط — يُحوَّل إلى رمز موقّع في العرض، ولا يصل للعميل خاماً
        asset: record.assetUrl || "",
      });
    }
    return out;
  };
}

/**
 * عقد أركيد كامل لكل لعبة أسئلة قديمة.
 * @param {Object} cfg تسجيل `games.register`
 * @returns {Object} عقد مطبَّع من defineGame
 */
function legacyQuizGame(cfg) {
  const id = contractId(cfg);
  // بنك النصوص يحتاج `g.<id>.name/.desc` وإلا عرضت القوائم المفتاح الخام.
  // العنوان والوصف عربيان في التسجيل القديم؛ نسجّلهما للغات الثلاث حتى لا يظهر مفتاح،
  // ونوسم غير العربية بأنها نص المصدر (لا ترجمة آلية مزعومة).
  register(`g.${id}`, {
    ar: { name: cfg.title, desc: cfg.description },
    en: { name: cfg.title, desc: cfg.description },
    es: { name: cfg.title, desc: cfg.description },
  });
  const base = quizGame({
    id,
    name: { ar: cfg.title, en: cfg.title, es: cfg.title },
    // الأمر العربي ومرادفاته القديمة تبقى كما هي ⇒ عادات المستخدمين لا تتعطل
    aliases: [...new Set([cfg.gameType, ...(cfg.alias || [])].map(norm).filter(Boolean))],
    icon: cfg.emoji,
    count: ROUND,
    timeMs: Math.max(20000, Math.min(120000, Number(cfg.timeout) || 60000)),
    source: sourceFor(cfg),
  });
  const innerView = base.view;
  const innerParse = base.parseInput;
  return defineGame({
    ...base,
    // عادة المستخدمين القديمة: كتابة **نص** الإجابة لا حرفها. نقبل الاثنين.
    // المطابقة تجري على الخادم مقابل خيارات الحالة الحقيقية ⇒ لا ثقة في نص العميل،
    // ولا تسريب: نعيد فهرس خيار موجود فعلاً أو null.
    parseInput(text, state, seat) {
      const letter = innerParse(text, state, seat);
      if (letter) return letter;
      const q = state?.qs?.[state.i];
      if (!q || !Array.isArray(q.options)) return null;
      const typed = norm(text);
      if (!typed || typed.length > 48) return null;
      for (let o = 0; o < q.options.length; o += 1) {
        const option = norm(q.options[o]);
        if (!option) continue;
        if (option.toLowerCase() === typed.toLowerCase()) return { id: "answer", payload: { o } };
        if (checkAnswerAdvanced(option, typed)?.status === "correct") return { id: "answer", payload: { o } };
      }
      return null;
    },
    cooldown: cfg.cooldown ?? 5,
    description: { ar: cfg.description, en: cfg.description, es: cfg.description },
    // عقد العرض: نضيف مرجع الأصل الموقّع (إن كانت اللعبة بصرية) فوق عرض quizGame
    view(state, ctx) {
      const view = innerView(state, ctx);
      const q = state.qs?.[state.i];
      if (!q?.asset) return view;
      const ref = issueAssetToken(q.asset, { sessionId: ctx?.sessionId || "" });
      // لا يُرسَل العنوان الأصلي أبداً؛ فقط رمز موقّع يفكّه الخادم
      return ref ? { ...view, asset: { kind: "image", ref, alt: "" } } : view;
    },
  });
}

/**
 * فحص رخيص: هل يكفي ملف البيانات لبناء أسئلة بأربعة خيارات؟
 * يقرأ الملف مرة واحدة (مخزَّن في terboo-game-data) ولا يبني أسئلة.
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function dataReady(cfg) {
  let rows = [];
  try {
    rows = getAllData(cfg.dataFile) || [];
  } catch (error) {
    noteFailure("arcade-legacy-quiz", error, { where: "terboo-arcade/legacy-quiz:dataReady", stage: cfg.dataFile, fallback: "legacy-text-path" });
    return { ok: false, reason: "data-read-failed" };
  }
  if (!Array.isArray(rows) || rows.length < 4) return { ok: false, reason: "no-data" };
  const answers = new Set();
  for (const row of rows.slice(0, POOL)) {
    const rec = readRecord(row, cfg);
    if (rec) answers.add(rec.answer.toLowerCase());
    if (answers.size >= 4) return { ok: true };
  }
  return { ok: false, reason: "too-few-unique-answers" };
}

/**
 * يحاول بناء عقد موحّد لتسجيل أسئلة قديم.
 * @returns {{ok:true, contract:Object}|{ok:false, reason:string}}
 */
function tryLegacyQuizContract(cfg) {
  const ready = dataReady(cfg);
  if (!ready.ok) return ready;
  try {
    return { ok: true, contract: legacyQuizGame(cfg) };
  } catch (error) {
    noteFailure("arcade-legacy-quiz", error, { where: "terboo-arcade/legacy-quiz:tryLegacyQuizContract", stage: cfg.gameType, fallback: "legacy-text-path" });
    return { ok: false, reason: String(error?.message || error).slice(0, 120) };
  }
}

/**
 * يرحّل كل تسجيلات الأسئلة القديمة الموجودة في السجل إلى العقد الموحّد.
 * إدراجها الفعلي يحدث وقت `games.register` (انظر terboo-games.js)؛ هذه الدالة
 * تخدم التدقيق والتقارير وتضمن عدم تخلّف أي تسجيل.
 * @returns {{migrated:string[], skipped:Array<{id:string, reason:string}>}}
 */
function migrateLegacyQuizzes(games) {
  const migrated = [];
  const skipped = [];
  for (const cfg of games.registry.values()) {
    const id = contractId(cfg);
    if (games.arcade.has(id)) { migrated.push(id); continue; }
    const made = tryLegacyQuizContract(cfg);
    if (!made.ok) { skipped.push({ id: cfg.gameType, reason: made.reason }); continue; }
    migrated.push(games.registerGame(made.contract).id);
  }
  return { migrated, skipped };
}

export { ROUND, contractId, dataReady, legacyQuizGame, migrateLegacyQuizzes, readRecord, sourceFor, tryLegacyQuizContract };
