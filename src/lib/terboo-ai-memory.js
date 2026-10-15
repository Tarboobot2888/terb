// ═══════════════════════════════════════════════
// 🧠 Terboo Memory Engine — محرّك الذاكرة المركزي الوحيد
// ───────────────────────────────────────────────
// كل أنظمة الذكاء في البوت (النواة، Auto AI، الوكيل، مساحة العمل) تكتب
// وتقرأ من هنا فقط. لا ذاكرة ثانية لأي مسار (§6).
//
// النطاقات (معزولة بنيوياً):
//   private:user  ← محادثة شخص في الخاص                 data.private[user]
//   group:user    ← محادثة شخص داخل مجموعة بعينها        data.groups[gid].members[user]
//   group         ← معرفة مشتركة للمجموعة + سياقها العام  data.groups[gid].group
//   user          ← هوية وتفضيلات الشخص التي تتبعه         data.users[user]
//   global        ← معرفة عامة عن البوت                    data.global
//   system        ← معرفة تشغيلية مسمّاة (الوكيل، التدقيق)  data.system[name]
//
// ضمانة عدم التسريب:
//   التخزين مُشجَّر؛ سجل العضو لا يُوصَل إليه إلا عبر مجموعته، ولا توجد دالة
//   تعيد سجلات أكثر من شخص. بناء نطاق ناقص المعرّفات يرمي خطأ بدل التخمين.
//   نطاق user لا يحمل إلا الهوية والتفضيلات (ما يصح أن يتبع صاحبه)، أما
//   حقائق المحادثات فتبقى في نطاق محادثتها (§7).
//
// محتوى كل سجل (§6 §9):
//   shortTerm · summary · longTerm (حقائق مصنّفة بأهمية وثقة وTTL)
//   events · preferences · tasks · topics (خيوط موضوعية للربط الدلالي)
//   relationship · lastCommand · lastTarget · lastResult · pending · answers
//   (والمجموعة وحدها: context — السياق العام الحديث للمجموعة)
//
// الخصوصية (§22 §37):
//   تنقيح إجباري للأسرار · استرجاع بالصلة لا بالكامل · عرض/حذف/إيقاف/TTL
//   · نسيان آخر معلومة · المالك لا يرى ذاكرة أحد إلا بإذن صريح منه مع سجل تدقيق.
// ═══════════════════════════════════════════════

import { containsSecret, redactSecrets } from "./terboo-secrets.js";
import { noteFailure } from "./terboo-failure-log.js";
import fs from "fs";
import path from "path";

// ── حدود السعة ────────────────────────────────
const LIMITS = {
  shortTerm: 14,       // أدوار محادثة محفوظة حيّة
  longTerm: 80,        // حقائق مخزّنة لكل سجل
  events: 30,          // أحداث مهمّة
  preferences: 40,     // تفضيلات متعلّمة
  tasks: 20,           // مهام سابقة أو جارية
  topics: 24,          // خيوط موضوعية
  answers: 6,          // نسخ الإجابات الأخيرة (للرجوع)
  groupContext: 12,    // آخر رسائل عامة في المجموعة
  summaryChars: 900,   // طول الملخّص
  turnChars: 700,      // طول الدور الواحد
  factChars: 300,      // طول الحقيقة الواحدة
};

const FLUSH_MS = 4000;
const GROUP_CONTEXT_TTL_MS = 30 * 60 * 1000;
const VALID_SCOPES = new Set(["private:user", "group:user", "group", "user", "global", "system"]);

/** أنواع الحقائق المصنّفة (§4 §9) */
const MEMORY_TYPES = [
  "fact",
  "preference",
  "identity",
  "decision",
  "task",
  "project",
  "relationship",
  "important_context",
];

/** أهمية افتراضية لكل نوع — تدخل في ترتيب الاسترجاع والإزاحة */
const TYPE_IMPORTANCE = {
  identity: 0.9,
  project: 0.8,
  decision: 0.75,
  task: 0.7,
  preference: 0.7,
  relationship: 0.6,
  important_context: 0.65,
  fact: 0.5,
};

// ═══════════════════════════════════════════════
// التنقيح — لا تُحفظ الأسرار إطلاقاً
// ═══════════════════════════════════════════════

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z\-_]{20,}/g,                       // Google
  /\bgsk_[0-9A-Za-z]{20,}/g,                        // Groq
  /\bsk-[0-9A-Za-z\-_]{16,}/g,                      // OpenAI-style
  /\bcov_live_[0-9A-Za-z\-_]{10,}/g,                // Covenant
  /\bghp_[0-9A-Za-z]{20,}/g,                        // GitHub
  /\bxox[baprs]-[0-9A-Za-z\-]{10,}/g,               // Slack
  /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/gi,         // Authorization
  /\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{5,}/g, // JWT
  /(?:password|passwd|كلمة\s*(?:ال)?مرور|contraseña)\s*[:=]\s*\S+/gi,
  /(?:api[_\- ]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{12,}["']?/gi,
];

const REDACTED = "[تم حجب بيانات حسّاسة]";

/** إزالة أي سر محتمل من نص قبل تخزينه أو إرساله لنموذج */
function redact(text) {
  let value = redactSecrets(String(text ?? ""));
  for (const pattern of SECRET_PATTERNS) {
    value = value.replace(pattern, REDACTED);
  }
  return value;
}

/** هل يبدو هذا النص حاملاً لسر؟ (يُستعمل لرفض التخزين نهائياً) */
function looksSecret(text) {
  const value = String(text ?? "");
  if (containsSecret(value)) return true;
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

// ═══════════════════════════════════════════════
// اللغة: تطبيع وتجذير خفيف للعربية والإنجليزية والإسبانية
// ═══════════════════════════════════════════════

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // áéíóúñü ← للمطابقة فقط
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "انا", "انت", "هو", "هي", "في", "علي", "على", "من", "الي", "الى", "عن", "مع", "ده", "دي", "دا",
  "اللي", "ان", "او", "ما", "لا", "يا", "كان", "بس", "كده", "ايه", "مش", "هل", "the", "a", "an",
  "i", "im", "is", "am", "are", "to", "of", "in", "on", "and", "or", "my", "me", "it", "that",
  "el", "la", "los", "las", "de", "en", "y", "mi", "yo", "es", "un", "una", "que",
]);

/** تجذير خفيف: يكفي للربط الدلالي دون مكتبات خارجية */
function stem(word) {
  let w = String(word || "");
  if (!w) return w;
  if (/[؀-ۿ]/.test(w)) {
    if (w.length > 4 && w.startsWith("وال")) w = w.slice(3);
    else if (w.length > 4 && w.startsWith("بال")) w = w.slice(3);
    else if (w.length > 3 && w.startsWith("ال")) w = w.slice(2);
    else if (w.length > 4 && (w.startsWith("و") || w.startsWith("ف"))) w = w.slice(1);
    for (const suffix of ["ات", "ين", "ون", "يه", "ه"]) {
      if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
        w = w.slice(0, -suffix.length);
        break;
      }
    }
    return w;
  }
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
  }
  return w;
}

/** كلمات النص بعد التطبيع والتجذير وإزالة الكلمات الشائعة */
function stems(text) {
  const out = new Set();
  for (const token of normalizeText(text).split(" ")) {
    if (token.length < 2 || STOP_WORDS.has(token)) continue;
    out.add(stem(token));
  }
  return out;
}

/**
 * عناقيد دلالية صغيرة للربط بين الكلام المتباعد (§9):
 * «أنا شغال على مشروع استضافة» ثم بعد فترة «خلصت السيرفرات»
 * ← كلاهما في عنقود hosting فيُربطان بنفس الخيط.
 */
const TOPIC_CLUSTERS = {
  hosting: ["استضافه", "سيرفر", "سيرفرات", "سرفر", "خادم", "خوادم", "هوست", "هوستنج", "دومين", "دومينات", "بانل", "ريسلر", "vps", "hosting", "host", "server", "servers", "domain", "cpanel", "panel", "reseller", "servidor", "servidores", "alojamiento", "dominio"],
  bot: ["بوت", "بلوقن", "بلجن", "بلوجن", "سكربت", "واتساب", "امر", "اوامر", "bot", "plugin", "plugins", "script", "whatsapp", "command", "commands", "comando"],
  study: ["امتحان", "امتحانات", "مذاكره", "دراسه", "كليه", "جامعه", "مدرسه", "درس", "exam", "exams", "study", "college", "university", "school", "examen", "estudio", "universidad"],
  work: ["شغل", "وظيفه", "مدير", "شركه", "مرتب", "انترفيو", "job", "work", "company", "manager", "salary", "interview", "trabajo", "empresa", "jefe"],
  design: ["تصميم", "لوجو", "شعار", "بوستر", "design", "logo", "poster", "diseño", "diseno"],
  money: ["فلوس", "مصاريف", "سعر", "اسعار", "دفع", "تحويل", "money", "price", "payment", "pay", "dinero", "precio", "pago"],
  health: ["دكتور", "مستشفي", "علاج", "دوا", "تعبان", "doctor", "hospital", "medicine", "sick", "medico", "enfermo"],
  travel: ["سفر", "رحله", "طياره", "طيران", "فيزا", "travel", "trip", "flight", "visa", "viaje", "vuelo"],
  web: ["موقع", "تطبيق", "ابلكيشن", "صفحه", "website", "site", "app", "application", "page", "sitio", "aplicacion"],
  game: ["لعبه", "العاب", "جيم", "game", "games", "gaming", "juego", "juegos"],
};

const CLUSTER_STEMS = Object.fromEntries(
  Object.entries(TOPIC_CLUSTERS).map(([name, words]) => [name, new Set(words.map((w) => stem(normalizeText(w))))]),
);

/** العناقيد التي يلمسها نص */
function clustersOf(stemSet) {
  const hits = [];
  for (const [name, words] of Object.entries(CLUSTER_STEMS)) {
    for (const s of stemSet) {
      if (words.has(s)) {
        hits.push(name);
        break;
      }
    }
  }
  return hits;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function numbersOf(text) {
  return (String(text).match(/\d+/g) || []).join(",");
}

// ═══════════════════════════════════════════════
// المخزن
// ═══════════════════════════════════════════════

function emptyRecord(scope, key) {
  const now = Date.now();
  return {
    scope,
    key,
    createdAt: now,
    updatedAt: now,
    enabled: true,
    ttlDays: 0,           // 0 = بلا انتهاء
    shortTerm: [],
    summary: { text: "", at: 0, folded: 0, kind: "rolling", aiAt: 0 },
    longTerm: [],
    events: [],
    preferences: {},
    tasks: [],
    topics: [],
    relationship: {},
    lastCommand: null,
    lastTarget: null,
    lastResult: null,
    pending: null,
    answers: [],
  };
}

/** يكمل الحقول الناقصة في سجلات أُنشئت بإصدار أقدم من المحرّك */
function normalizeRecord(record, scope, key) {
  if (!record || typeof record !== "object") return emptyRecord(scope, key);
  const base = emptyRecord(record.scope || scope, record.key || key);
  for (const field of Object.keys(base)) {
    if (record[field] === undefined) record[field] = base[field];
  }
  if (!record.summary || typeof record.summary !== "object") record.summary = base.summary;
  return record;
}

function emptyStore() {
  return {
    version: 3,
    private: {},                                  // user → record
    groups: {},                                   // gid → { group, members: {} }
    users: {},                                    // user → record (هوية وتفضيلات فقط)
    global: emptyRecord("global", "global"),
    system: {},                                   // name → record
    migrations: {},
  };
}

class MemoryStore {
  constructor() {
    this.dir = null;
    this.file = null;
    this.data = emptyStore();
    this.dirty = false;
    this.timer = null;
    this.ready = false;
  }

  /** يُستدعى مرة واحدة عند الإقلاع (أو تلقائياً عند أول استعمال) */
  init(baseDir) {
    if (this.ready && !baseDir) return this;
    const root = baseDir || path.join(process.cwd(), "database", "memory");
    this.dir = root;
    this.file = path.join(root, "terboo-memory.json");
    this.data = emptyStore();
    try {
      if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
      // ملف الإصدار السابق (v2) يُنقل مرة واحدة إلى الاسم الجديد حتى لا تُفقد الذاكرة
      const previousFile = path.join(root, "tarboo-memory.json");
      if (!fs.existsSync(this.file) && fs.existsSync(previousFile)) {
        fs.renameSync(previousFile, this.file);
      }
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (raw && typeof raw === "object") {
          const obj = (value) => (value && typeof value === "object" ? value : {});
          this.data = {
            version: 3,
            private: obj(raw.private),
            groups: obj(raw.groups),
            users: obj(raw.users),
            global: normalizeRecord(raw.global, "global", "global"),
            system: obj(raw.system),
            migrations: obj(raw.migrations),
          };
        }
      }
    } catch (error) {
      console.error("[Memory] تعذّر تحميل الذاكرة، سيُبدأ سجل جديد:", error.message);
      this.data = emptyStore();
    }
    this.ready = true;
    return this;
  }

  touch() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_MS);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  flush() {
    if (!this.dirty || !this.file) return false;
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), "utf8");
      fs.renameSync(tmp, this.file);
      this.dirty = false;
      return true;
    } catch (error) {
      console.error("[Memory] تعذّر حفظ الذاكرة:", error.message);
      return false;
    }
  }
}

const store = new MemoryStore();

function ensureReady() {
  if (!store.ready) store.init();
  return store;
}

// ═══════════════════════════════════════════════
// المفاتيح والعزل
// ═══════════════════════════════════════════════

/** أرقام المعرّف فقط: 2012…@s.whatsapp.net → 2012… */
function digitsOf(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9a-z]/gi, "");
}

/**
 * بناء وصف نطاق مُتحقَّق منه.
 * يرمي خطأ إن نقص معرّف مطلوب — لا يوجد نطاق «تقريبي».
 * @returns {{scope:string, group:string, user:string, name:string, key:string}}
 */
function scopeOf(kind, { userJid = "", chatJid = "", isGroup = false, name = "" } = {}) {
  if (!VALID_SCOPES.has(kind)) throw new Error(`نطاق ذاكرة غير معروف: ${kind}`);
  const user = digitsOf(userJid);
  const group = isGroup || String(chatJid).endsWith("@g.us") ? digitsOf(chatJid) : "";

  if (kind === "global") return { scope: kind, group: "", user: "", name: "", key: "global" };

  if (kind === "system") {
    const clean = String(name || "").trim().replace(/[^\p{L}\p{N}_:.-]/gu, "").slice(0, 80);
    if (!clean) throw new Error("system يتطلب اسماً");
    return { scope: kind, group: "", user: "", name: clean, key: `system:${clean}` };
  }

  if (kind === "user") {
    if (!user) throw new Error("user يتطلب معرّف مستخدم");
    return { scope: kind, group: "", user, name: "", key: `user:${user}` };
  }

  if (kind === "private:user") {
    if (!user) throw new Error("private:user يتطلب معرّف مستخدم");
    if (group) throw new Error("private:user لا يُستعمل داخل مجموعة");
    return { scope: kind, group: "", user, name: "", key: `private:${user}` };
  }

  if (kind === "group") {
    if (!group) throw new Error("group يتطلب معرّف مجموعة");
    return { scope: kind, group, user: "", name: "", key: `group:${group}` };
  }

  // group:user
  if (!group) throw new Error("group:user يتطلب معرّف مجموعة");
  if (!user) throw new Error("group:user يتطلب معرّف مستخدم");
  return { scope: kind, group, user, name: "", key: `group:${group}:${user}` };
}

/**
 * نطاق المحادثة الصحيح لهذه الرسالة.
 * في المجموعة: group:user دائماً — لا يُقرأ سجل الخاص إطلاقاً.
 * في الخاص  : private:user.
 */
function conversationScope(m) {
  const isGroup = Boolean(m?.isGroup);
  return scopeOf(isGroup ? "group:user" : "private:user", {
    userJid: m?.sender,
    chatJid: m?.chat,
    isGroup,
  });
}

/** الوصول للسجل مع إنشائه عند اللزوم */
function getRecord(descriptor, { create = true } = {}) {
  const db = ensureReady().data;
  const { scope, group, user, name, key } = descriptor;

  if (scope === "global") {
    db.global = normalizeRecord(db.global, "global", "global");
    return db.global;
  }

  if (scope === "system") {
    if (!db.system[name] && create) db.system[name] = emptyRecord(scope, key);
    return db.system[name] ? normalizeRecord(db.system[name], scope, key) : null;
  }

  if (scope === "user") {
    if (!db.users[user] && create) db.users[user] = emptyRecord(scope, key);
    return db.users[user] ? normalizeRecord(db.users[user], scope, key) : null;
  }

  if (scope === "private:user") {
    if (!db.private[user] && create) db.private[user] = emptyRecord(scope, key);
    return db.private[user] ? normalizeRecord(db.private[user], scope, key) : null;
  }

  if (!db.groups[group]) {
    if (!create) return null;
    db.groups[group] = { group: emptyRecord("group", `group:${group}`), members: {} };
  }
  const bucket = db.groups[group];
  if (!bucket.members) bucket.members = {};

  if (scope === "group") {
    bucket.group = normalizeRecord(bucket.group, "group", `group:${group}`);
    if (!Array.isArray(bucket.group.context)) bucket.group.context = [];
    return bucket.group;
  }

  if (!bucket.members[user] && create) bucket.members[user] = emptyRecord(scope, key);
  return bucket.members[user] ? normalizeRecord(bucket.members[user], scope, key) : null;
}

// ═══════════════════════════════════════════════
// انتهاء الصلاحية
// ═══════════════════════════════════════════════

function expired(item, record, now) {
  if (item?.ttl && now - (item.at || 0) > item.ttl) return true;
  if (record?.ttlDays > 0 && now - (item?.at || 0) > record.ttlDays * 86400000) return true;
  return false;
}

/** تنظيف العناصر المنتهية داخل سجل */
function purge(record) {
  if (!record) return record;
  const now = Date.now();
  const before = record.longTerm.length + record.events.length + record.tasks.length;
  record.longTerm = record.longTerm.filter((item) => !expired(item, record, now));
  record.events = record.events.filter((item) => !expired(item, record, now));
  record.tasks = record.tasks.filter((item) => !expired(item, record, now));
  if (record.ttlDays > 0) {
    record.shortTerm = record.shortTerm.filter(
      (turn) => now - (turn.at || 0) <= record.ttlDays * 86400000,
    );
  }
  if (Array.isArray(record.context)) {
    record.context = record.context.filter((entry) => now - (entry.at || 0) <= GROUP_CONTEXT_TTL_MS);
  }
  if (record.longTerm.length + record.events.length + record.tasks.length !== before) store.touch();
  return record;
}

// ═══════════════════════════════════════════════
// التصنيف والاستخراج (§9)
// ═══════════════════════════════════════════════

// \b في JavaScript مبنية على \w اللاتينية ولا تصلح حدوداً للعربية،
// فنستعمل نظرة خلفية/أمامية على أي حرف بعلم u.
// العربية تلصق أدوات العطف (و/ف) ببداية الكلمة: «وهو»، «فقررت».
const WORD_START = "(?<![\\p{L}\\p{N}])[وف]?";
const WORD_END = "(?![\\p{L}\\p{N}])";

/** بناء تعبير «كلمة كاملة» يعمل مع العربية والإنجليزية والإسبانية معاً */
function wordRe(words) {
  return new RegExp(`${WORD_START}(?:${words.join("|")})${WORD_END}`, "iu");
}

const CLASSIFIERS = [
  { type: "identity", re: wordRe(["اسمي", "انا اسمي", "my name is", "me llamo", "i am called", "mi nombre es"]) },
  { type: "preference", re: wordRe(["افضل", "بحب", "احب", "بفضل", "اكره", "prefer", "i like", "i love", "i hate", "me gusta", "prefiero", "odio"]) },
  { type: "decision", re: wordRe(["قررت", "قررنا", "اتفقنا", "هنعمل", "we decided", "i decided", "decidimos", "decidi", "let'?s go with"]) },
  { type: "task", re: wordRe(["فكرني", "ذكرني", "لازم اعمل", "محتاج اعمل", "todo", "remind me", "i need to", "tarea", "pendiente", "recuerdame"]) },
  { type: "project", re: wordRe(["مشروع", "مشروعي", "بوت", "سكربت", "شغال علي", "شغال على", "بشتغل علي", "بشتغل على", "repo", "project", "working on", "proyecto", "trabajando en"]) },
  { type: "relationship", re: wordRe(["اخويا", "اختي", "صاحبي", "زميلي", "زميل", "مديري", "مراتي", "جوزي", "my friend", "my brother", "my sister", "my boss", "mi amigo", "mi hermano", "mi jefe"]) },
];

/** تصنيف حقيقة نصياً عند غياب تصنيف صريح */
function classify(text) {
  const value = String(text || "");
  for (const { type, re } of CLASSIFIERS) {
    if (re.test(value)) return type;
  }
  return "fact";
}

/** عبارات لا تستحق الحفظ كحقيقة (تحية، سؤال عابر، أمر قصير) */
const TRIVIAL = /^(?:[\s\p{P}\p{S}]*|اهلا|أهلا|سلام|السلام عليكم|ازيك|عامل ايه|تمام|شكرا|ok|okay|hi|hello|thanks|hola|gracias)[\s\p{P}\p{S}]*$/iu;

/**
 * استخراج حتمي لما يستحق البقاء من رسالة المستخدم (يعمل بلا أي مزوّد).
 * يلتقط: الهوية، التفضيلات، القرارات، المهام، المشاريع، العلاقات.
 * لا يحفظ الأسئلة ولا التحيات ولا أي نص يحمل سراً.
 * @returns {Array<{text:string, type:string, confidence:number, importance:number}>}
 */
function extractFacts(text) {
  const clean = String(text || "").trim();
  if (!clean || clean.length < 6 || clean.length > 400) return [];
  if (TRIVIAL.test(clean) || looksSecret(clean)) return [];
  // سؤال مباشر ليس معلومة عن المتحدّث
  if (/[?؟]\s*$/.test(clean) && !/(اسمي|my name|me llamo)/i.test(clean)) return [];

  const facts = [];
  const sentences = clean.split(/(?<=[.!؟?\n])\s+|،\s*(?=و?(?:انا|أنا|i |yo ))/u).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences.slice(0, 4)) {
    const type = classify(sentence);
    if (type === "fact") continue;           // لا نحفظ كل جملة عادية — فقط ما له نوع واضح
    facts.push({
      text: sentence.slice(0, LIMITS.factChars),
      type,
      confidence: type === "identity" ? 0.85 : 0.65,
      importance: TYPE_IMPORTANCE[type] || 0.5,
    });
  }
  return facts;
}

// ═══════════════════════════════════════════════
// الخيوط الموضوعية (§9 §11)
// ═══════════════════════════════════════════════

function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * يربط نصاً بخيط موضوعي قائم أو يفتح خيطاً جديداً.
 * الربط بالعنقود الدلالي أو بتداخل الكلمات، لا بالتطابق الحرفي.
 * @returns {Object|null} الخيط الذي لُمس
 */
function touchTopic(record, text, { create = false, factId = "" } = {}) {
  const s = stems(text);
  if (!s.size) return null;
  const clusters = clustersOf(s);
  let best = null;
  let bestScore = 0;
  for (const topic of record.topics) {
    const keywords = new Set(topic.keywords || []);
    let score = 0;
    for (const x of s) if (keywords.has(x)) score += 1;
    for (const c of clusters) if ((topic.clusters || []).includes(c)) score += 2;
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }

  if (best && bestScore >= 2) {
    best.lastAt = Date.now();
    best.mentions = (best.mentions || 0) + 1;
    best.keywords = [...new Set([...(best.keywords || []), ...s])].slice(-40);
    best.clusters = [...new Set([...(best.clusters || []), ...clusters])];
    if (factId && !best.factIds.includes(factId)) best.factIds.push(factId);
    return best;
  }

  if (!create || (!clusters.length && s.size < 2)) return null;
  const topic = {
    id: newId("t"),
    label: redact(String(text).trim()).slice(0, 80),
    keywords: [...s].slice(0, 30),
    clusters,
    factIds: factId ? [factId] : [],
    createdAt: Date.now(),
    lastAt: Date.now(),
    mentions: 1,
  };
  record.topics.push(topic);
  if (record.topics.length > LIMITS.topics) {
    record.topics.sort((a, b) => b.lastAt - a.lastAt);
    record.topics.length = LIMITS.topics;
  }
  return topic;
}

/** الخيط الموضوعي الأقرب لنص (بلا إنشاء) */
function activeTopic(descriptor, text) {
  const record = purge(getRecord(descriptor, { create: false }));
  if (!record || record.enabled === false || !record.topics.length) return null;
  const s = stems(text);
  const clusters = clustersOf(s);
  let best = null;
  let bestScore = 0;
  for (const topic of record.topics) {
    const keywords = new Set(topic.keywords || []);
    let score = 0;
    for (const x of s) if (keywords.has(x)) score += 1;
    for (const c of clusters) if ((topic.clusters || []).includes(c)) score += 2;
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? { id: best.id, label: best.label, clusters: best.clusters, lastAt: best.lastAt } : null;
}

// ═══════════════════════════════════════════════
// الكتابة
// ═══════════════════════════════════════════════

/** طيّ الأدوار الخارجة من النافذة القصيرة داخل الملخّص المتدحرج (§4) */
function foldIntoSummary(record, dropped) {
  if (!dropped.length) return;
  const lines = dropped
    .map((turn) => `${turn.role === "assistant" ? "بوت" : "مستخدم"}: ${turn.text}`)
    .join(" | ");
  const merged = record.summary.text ? `${record.summary.text} ${lines}` : lines;
  record.summary = {
    ...record.summary,
    text: merged.length > LIMITS.summaryChars ? `…${merged.slice(-LIMITS.summaryChars)}` : merged,
    at: Date.now(),
    folded: (record.summary.folded || 0) + dropped.length,
    kind: record.summary.kind === "ai" ? "ai+rolling" : "rolling",
  };
}

/**
 * تسجيل دور محادثة واحد في نطاق الرسالة الصحيح.
 * يربط الدور بخيطه الموضوعي ويستخرج الحقائق المهمّة من كلام المستخدم.
 * @param {Object} m رسالة مُسلسلة
 * @param {"user"|"assistant"} role
 * @param {string} text
 * @param {{extract?:boolean}} [options]
 */
function recordTurn(m, role, text, { extract = true } = {}) {
  const clean = redact(String(text || "").trim()).slice(0, LIMITS.turnChars);
  if (!clean) return null;

  const descriptor = conversationScope(m);
  const record = purge(getRecord(descriptor));
  if (!record || record.enabled === false) return null;

  const isUser = role !== "assistant";
  record.shortTerm.push({
    role: isUser ? "user" : "assistant",
    text: clean,
    at: Date.now(),
    id: m?.id || m?.key?.id || "",
  });

  if (record.shortTerm.length > LIMITS.shortTerm) {
    const dropped = record.shortTerm.splice(0, record.shortTerm.length - LIMITS.shortTerm);
    foldIntoSummary(record, dropped);
  }

  if (isUser) {
    touchTopic(record, clean);
    if (extract) {
      for (const fact of extractFacts(clean)) {
        remember(descriptor, { ...fact, source: "extract" });
      }
    }
  } else {
    record.answers.push({ text: clean, at: Date.now() });
    if (record.answers.length > LIMITS.answers) record.answers.shift();
  }

  record.updatedAt = Date.now();
  store.touch();
  return record;
}

/** بيانات وصفية صغيرة مرافقة للحقيقة — منقّحة ومحدودة */
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(meta).slice(0, 12)) {
    if (v === undefined || v === null) continue;
    out[String(k).slice(0, 30)] = typeof v === "number" || typeof v === "boolean" ? v : redact(String(v)).slice(0, 500);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * حفظ حقيقة طويلة المدى مع إزالة التكرار الدلالي (§9).
 * @param {Object} descriptor ناتج scopeOf/conversationScope
 * @param {{text:string, type?:string, confidence?:number, importance?:number,
 *          ttl?:number, source?:string, key?:string, label?:string, author?:string}} entry
 */
function remember(descriptor, entry) {
  const raw = String(entry?.text || "").trim();
  if (!raw) return null;
  if (looksSecret(raw)) return null;                       // لا نخزّن الأسرار أبداً

  const record = purge(getRecord(descriptor));
  if (!record || record.enabled === false) return null;

  const text = redact(raw).slice(0, LIMITS.factChars);
  const type = MEMORY_TYPES.includes(entry?.type) ? entry.type : classify(text);
  const confidence = Math.max(0, Math.min(1, Number(entry?.confidence ?? 0.6)));
  const importance = Math.max(0, Math.min(1, Number(entry?.importance ?? TYPE_IMPORTANCE[type] ?? 0.5)));
  const key = entry?.key ? String(entry.key).slice(0, 80) : "";

  // ① مفتاح صريح: تحديث في المكان
  let existing = key ? record.longTerm.find((item) => item.key === key) : null;

  // ② تطابق نصّي أو دلالي: نفس المعنى بصياغة قريبة لا يُكرَّر
  if (!existing) {
    const normalized = normalizeText(text);
    const s = stems(text);
    const nums = numbersOf(text);
    existing = record.longTerm.find((item) => {
      if (normalizeText(item.text) === normalized) return true;
      if (numbersOf(item.text) !== nums) return false;     // رقم مختلف = معلومة مختلفة
      return item.type === type && jaccard(stems(item.text), s) >= 0.8;
    });
  }

  const meta = sanitizeMeta(entry?.meta);

  if (existing) {
    existing.text = key ? text : existing.text;
    if (meta) existing.meta = meta;
    existing.confidence = Math.max(existing.confidence, confidence);
    existing.importance = Math.max(existing.importance || 0, importance);
    existing.at = Date.now();
    existing.seen = (existing.seen || 1) + 1;
    if (entry?.ttl) existing.ttl = Number(entry.ttl) || 0;
    if (entry?.label) existing.label = String(entry.label).slice(0, 80);
    record.updatedAt = Date.now();
    store.touch();
    return existing;
  }

  const item = {
    id: entry?.id ? String(entry.id).slice(0, 40) : newId("f"),
    text,
    type,
    confidence,
    importance,
    at: Date.now(),
    ttl: Number(entry?.ttl) || 0,
    source: String(entry?.source || "ai").slice(0, 24),
    seen: 1,
  };
  if (key) item.key = key;
  if (meta) item.meta = meta;
  if (entry?.label) item.label = String(entry.label).slice(0, 80);
  if (entry?.author) item.author = digitsOf(entry.author);

  // الحقيقة المهمّة تفتح أو تلمس خيطها الموضوعي
  const topic = touchTopic(record, text, {
    create: ["project", "task", "decision"].includes(type),
    factId: item.id,
  });
  if (topic) item.topicId = topic.id;

  record.longTerm.push(item);
  if (record.longTerm.length > LIMITS.longTerm) {
    // الإزاحة تحذف الأقل أهمية وثقة وحداثة أولاً
    record.longTerm.sort((a, b) =>
      ((b.importance || 0.5) + b.confidence) - ((a.importance || 0.5) + a.confidence) || (b.at - a.at));
    record.longTerm.length = LIMITS.longTerm;
  }

  // الهوية والتفضيلات تتبع صاحبها بين المحادثات (نطاق user) — لا غير
  if ((type === "identity" || type === "preference") && descriptor.user && descriptor.scope !== "user") {
    try {
      const userRecord = getRecord(scopeOf("user", { userJid: descriptor.user }));
      if (userRecord.enabled !== false && !userRecord.longTerm.some((f) => normalizeText(f.text) === normalizeText(text))) {
        userRecord.longTerm.push({ ...item, id: newId("u"), topicId: undefined, source: "promoted" });
        userRecord.updatedAt = Date.now();
      }
    } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:797",stage: "getRecord"}); }
  }

  record.updatedAt = Date.now();
  store.touch();
  return item;
}

/** حدث مهم (ترقية، طرد، قرار إداري…) */
function recordEvent(descriptor, text, kind = "event") {
  const clean = redact(String(text || "").trim()).slice(0, LIMITS.factChars);
  if (!clean) return null;
  const record = purge(getRecord(descriptor));
  if (!record || record.enabled === false) return null;
  record.events.push({ text: clean, kind: String(kind).slice(0, 24), at: Date.now(), ttl: 0 });
  if (record.events.length > LIMITS.events) record.events.splice(0, record.events.length - LIMITS.events);
  record.updatedAt = Date.now();
  store.touch();
  return record.events[record.events.length - 1];
}

/** تفضيل متعلّم (لغة الرد، الإيجاز، نوع الوسائط…) */
function learnPreference(descriptor, name, value, confidence = 0.6) {
  const key = String(name || "").trim().slice(0, 40);
  if (!key) return null;
  const record = purge(getRecord(descriptor));
  if (!record || record.enabled === false) return null;
  record.preferences[key] = {
    value: redact(String(value ?? "")).slice(0, 120),
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0.6)),
    at: Date.now(),
  };
  const keys = Object.keys(record.preferences);
  if (keys.length > LIMITS.preferences) delete record.preferences[keys[0]];
  record.updatedAt = Date.now();
  store.touch();
  return record.preferences[key];
}

/** سياق العلاقة بين المستخدم والبوت (نبرة، ألقاب، تاريخ التعامل) */
function updateRelationship(descriptor, patch = {}) {
  const record = purge(getRecord(descriptor));
  if (!record || record.enabled === false) return null;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    record.relationship[String(k).slice(0, 30)] = redact(String(v)).slice(0, 120);
  }
  record.relationship.interactions = String(Number(record.relationship.interactions || 0) + 1);
  record.updatedAt = Date.now();
  store.touch();
  return record.relationship;
}

// ── سياق الأوامر (§6 §11) ─────────────────────

/** آخر أمر نُفِّذ لهذا الشخص في هذه المحادثة */
function recordCommand(m, { command, args = "", result = "" } = {}) {
  const record = purge(getRecord(conversationScope(m)));
  if (!record || record.enabled === false) return null;
  if (record.lastCommand) {
    record.previousCommand = { ...record.lastCommand };
  }
  record.lastCommand = {
    command: String(command || "").slice(0, 60),
    args: redact(String(args || "")).slice(0, 200),
    result: redact(String(result || "")).slice(0, 200),
    at: Date.now(),
  };
  record.updatedAt = Date.now();
  store.touch();
  return record.lastCommand;
}

/** نتيجة آخر أمر أو أداة (نجح/فشل + ملخص) */
function recordResult(m, { command = "", ok = true, summary = "" } = {}) {
  const record = purge(getRecord(conversationScope(m)));
  if (!record || record.enabled === false) return null;
  record.lastResult = {
    command: String(command || "").slice(0, 60),
    ok: Boolean(ok),
    summary: redact(String(summary || "")).slice(0, 300),
    at: Date.now(),
  };
  if (record.lastCommand && (!command || record.lastCommand.command === command)) {
    record.lastCommand.result = record.lastResult.summary;
  }
  record.updatedAt = Date.now();
  store.touch();
  return record.lastResult;
}

/**
 * آخر عمل في هذه المحادثة (أداة/ملف) — لحل «حملها» و«هات الصوت بس» و«الملف اللي فوق» (v4 §18).
 * @param {Object} m
 * @param {{tool?:{id:string, url?:string, query?:string, prompt?:string, format?:string, links?:string[]}, file?:string}} patch
 */
function recordWork(m, patch = {}) {
  const record = purge(getRecord(conversationScope(m)));
  if (!record || record.enabled === false) return null;
  const next = { ...(record.lastWork || {}) };
  const text = (value, max) => redact(String(value || "")).slice(0, max);
  if (patch.tool?.id) {
    next.tool = {
      id: String(patch.tool.id).slice(0, 40),
      url: /^https?:\/\//i.test(String(patch.tool.url || "")) ? String(patch.tool.url).slice(0, 400) : "",
      query: text(patch.tool.query, 200),
      prompt: text(patch.tool.prompt, 300),
      format: String(patch.tool.format || "").slice(0, 8),
      links: (patch.tool.links || []).filter((link) => /^https?:\/\//i.test(String(link))).slice(0, 5).map((link) => String(link).slice(0, 400)),
      at: Date.now(),
    };
  }
  if (patch.file) next.file = { path: String(patch.file).slice(0, 200), at: Date.now() };
  record.lastWork = next;
  record.updatedAt = Date.now();
  store.touch();
  return record.lastWork;
}

/** آخر هدف (عضو) تعامل معه المستخدم — لحل «التاني» و«هو» */
function recordTarget(m, { jid, name = "" } = {}) {
  const number = digitsOf(jid);
  if (!number) return null;
  const record = purge(getRecord(conversationScope(m)));
  if (!record || record.enabled === false) return null;
  if (record.lastTarget && record.lastTarget.number !== number) {
    record.previousTarget = { ...record.lastTarget };
  }
  record.lastTarget = { number, name: String(name || "").slice(0, 60), at: Date.now() };
  record.updatedAt = Date.now();
  store.touch();
  return record.lastTarget;
}

/** إجراء مقترح لم يُنفَّذ بعد — «نفذه» تنفّذه لاحقاً */
function setPending(m, pending) {
  const record = purge(getRecord(conversationScope(m)));
  if (!record || record.enabled === false) return null;
  const cleanStep = (step) => ({
    command: String(step?.command || "").slice(0, 60),
    args: redact(String(step?.args || "")).slice(0, 200),
    ...(step?.tool ? { tool: String(step.tool).slice(0, 30), path: String(step.path || "").slice(0, 200), query: redact(String(step.query || "")).slice(0, 120) } : {}),
  });
  record.pending = pending
    ? {
      // command: أمر واحد · agent: خطة متعددة الخطوات · plan: تعديل ملف بانتظار موافقة المالك
      // · rollback/rename: عملية مالك حسّاسة · choice: خيارات عُرضت على المستخدم
      kind: ["command", "agent", "plan", "rollback", "rename", "choice"].includes(pending.kind) ? pending.kind : "command",
      command: String(pending.command || "").slice(0, 60),
      args: redact(String(pending.args || "")).slice(0, 200),
      steps: Array.isArray(pending.steps) ? pending.steps.slice(0, 6).map(cleanStep) : undefined,
      options: Array.isArray(pending.options) ? pending.options.slice(0, 6).map(cleanStep) : undefined,
      planId: pending.planId ? String(pending.planId).slice(0, 40) : undefined,
      from: pending.from ? String(pending.from).slice(0, 200) : undefined,
      to: pending.to ? String(pending.to).slice(0, 200) : undefined,
      reason: String(pending.reason || "").slice(0, 120),
      at: Date.now(),
    }
    : null;
  store.touch();
  return record.pending;
}

/** يأخذ الإجراء المعلّق ويمسحه (صالح 15 دقيقة) */
function takePending(m) {
  let record;
  try {
    record = purge(getRecord(conversationScope(m), { create: false }));
  } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:937",stage: "purge"}); return null; }
  if (!record?.pending) return null;
  const pending = record.pending;
  record.pending = null;
  store.touch();
  if (Date.now() - (pending.at || 0) > 15 * 60 * 1000) return null;
  return pending;
}

// ── المهام (§6) ───────────────────────────────

/** مهمة جديدة أو جارية في هذا النطاق */
function addTask(descriptor, { id = "", title, steps = [], source = "user", status = "open", meta = null } = {}) {
  const clean = redact(String(title || "").trim()).slice(0, 200);
  if (!clean) return null;
  const record = purge(getRecord(descriptor));
  if (!record || record.enabled === false) return null;
  const task = {
    id: id ? String(id).slice(0, 40) : newId("k"),
    title: clean,
    status,
    steps: steps.slice(0, 8).map((step, index) => ({
      id: index + 1,
      title: redact(String(step?.title || step || "")).slice(0, 180),
      status: step?.status || "pending",
    })),
    source: String(source).slice(0, 24),
    at: Date.now(),
    updatedAt: Date.now(),
  };
  const cleanMeta = sanitizeMeta(meta);
  if (cleanMeta) task.meta = cleanMeta;
  record.tasks.push(task);
  if (record.tasks.length > LIMITS.tasks) record.tasks.shift();
  touchTopic(record, clean, { create: true });
  record.updatedAt = Date.now();
  store.touch();
  return task;
}

function updateTask(descriptor, id, patch = {}) {
  const record = purge(getRecord(descriptor, { create: false }));
  const task = record?.tasks.find((item) => item.id === id);
  if (!task) return null;
  if (patch.status) task.status = String(patch.status).slice(0, 20);
  if (patch.stepId !== undefined) {
    const step = task.steps.find((s) => s.id === Number(patch.stepId));
    if (step) step.status = patch.stepStatus || "done";
  }
  if (task.steps.length && task.steps.every((s) => s.status === "done")) task.status = "done";
  task.updatedAt = Date.now();
  store.touch();
  return task;
}

function listTasks(descriptor, { status = "" } = {}) {
  const record = purge(getRecord(descriptor, { create: false }));
  if (!record) return [];
  return record.tasks.filter((task) => !status || task.status === status).map((task) => ({ ...task, steps: task.steps.map((s) => ({ ...s })) }));
}

/** آخر مهمة مفتوحة — تدخل حزمة السياق كـ Active Task */
function activeTask(descriptor) {
  const open = listTasks(descriptor).filter((task) => task.status !== "done");
  return open.length ? open[open.length - 1] : null;
}

// ── نسخ الإجابات (للرجوع: «ارجع»، «خليه زي الأول») ──

/** آخر إجابة أرسلها البوت في هذه المحادثة */
function lastAnswer(m) {
  let record;
  try {
    record = purge(getRecord(conversationScope(m), { create: false }));
  } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:1013",stage: "purge"}); return null; }
  return record?.answers?.length ? record.answers[record.answers.length - 1] : null;
}

/** يطّلع على الإجراء المعلّق دون أن يستهلكه */
function peekPending(m) {
  let record;
  try {
    record = purge(getRecord(conversationScope(m), { create: false }));
  } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:1024",stage: "purge"}); return null; }
  const pending = record?.pending;
  if (!pending || Date.now() - (pending.at || 0) > 15 * 60 * 1000) return null;
  return { ...pending };
}

function previousAnswer(m, stepsBack = 1) {
  let record;
  try {
    record = purge(getRecord(conversationScope(m), { create: false }));
  } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:1036",stage: "purge"}); return null; }
  if (!record?.answers?.length) return null;
  const index = record.answers.length - 1 - Math.max(1, Number(stepsBack) || 1);
  return index >= 0 ? record.answers[index] : null;
}

// ── سياق المجموعة العام (يحلّ محل ذاكرة Auto AI المؤقتة) ──

/**
 * رسالة عامة داخل مجموعة تدخل سياق المجموعة المشترك (§8).
 * هي رسائل مرئية لكل أعضاء المجموعة أصلاً؛ رسائل الخاص لا تدخل هنا أبداً.
 */
function recordGroupMessage(m) {
  if (!m?.isGroup || !m?.chat) return null;
  const text = redact(String(m.body || "").trim()).slice(0, 200);
  if (!text) return null;
  let record;
  try {
    record = purge(getRecord(scopeOf("group", { chatJid: m.chat, isGroup: true })));
  } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:1057",stage: "purge"}); return null; }
  if (!record || record.enabled === false) return null;
  record.context.push({ sender: digitsOf(m.sender) || "?", text, at: Date.now() });
  if (record.context.length > LIMITS.groupContext) record.context.splice(0, record.context.length - LIMITS.groupContext);
  store.touch();
  return record.context.length;
}

/** آخر السياق العام للمجموعة */
function groupContext(chatJid, limit = LIMITS.groupContext) {
  let record;
  try {
    record = purge(getRecord(scopeOf("group", { chatJid, isGroup: true }), { create: false }));
  } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:1072",stage: "purge"}); return []; }
  if (!record || record.enabled === false || !Array.isArray(record.context)) return [];
  return record.context.slice(-limit).map((entry) => ({ ...entry }));
}

// ═══════════════════════════════════════════════
// القراءة
// ═══════════════════════════════════════════════

/**
 * استرجاع الحقائق ذات الصلة فقط — لا تُرسل الذاكرة كاملة أبداً (§5 §9 §22).
 * الصلة = تداخل الكلمات المجذّرة + العنقود الدلالي + الخيط الموضوعي
 *        + الأهمية + الثقة + الحداثة.
 */
function recall(descriptor, query, limit = 6) {
  const record = purge(getRecord(descriptor, { create: false }));
  if (!record || record.enabled === false) return [];

  const queryStems = stems(query);
  const queryClusters = new Set(clustersOf(queryStems));
  const topic = queryStems.size ? activeTopic(descriptor, query) : null;
  const now = Date.now();

  const scored = record.longTerm.map((item) => {
    let score = item.confidence * 1.5 + (item.importance || 0.5) * 1.5;
    const itemStems = stems(item.text);
    for (const s of queryStems) {
      if (itemStems.has(s)) score += 3;
    }
    for (const c of clustersOf(itemStems)) {
      if (queryClusters.has(c)) score += 2.5;
    }
    if (topic && item.topicId === topic.id) score += 3;
    // الهوية والتفضيلات تبقى ذات صلة دائماً
    if (item.type === "identity" || item.type === "preference") score += 1.5;
    const ageDays = (now - item.at) / 86400000;
    score += Math.max(0, 1.5 - ageDays / 30);
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter(({ score }) => score > 2.5)
    .slice(0, limit)
    .map(({ item }) => item);
}

/** آخر أدوار المحادثة بصيغة history جاهزة للنموذج */
function history(descriptor, limit = LIMITS.shortTerm) {
  const record = purge(getRecord(descriptor, { create: false }));
  if (!record || record.enabled === false) return [];
  return record.shortTerm
    .slice(-limit)
    .map((turn) => ({ role: turn.role, content: turn.text }));
}

/** ملخّص دلالي حتمي: خيوط + حقائق مهمّة + آخر أمر + الملخّص المتدحرج */
function semanticSummary(descriptor) {
  const record = purge(getRecord(descriptor, { create: false }));
  if (!record || record.enabled === false) return "";
  const parts = [];
  const topics = [...record.topics].sort((a, b) => b.lastAt - a.lastAt).slice(0, 3);
  if (topics.length) parts.push(`Topics: ${topics.map((t) => t.label).join(" · ")}`);
  const key = [...record.longTerm].sort((a, b) => (b.importance || 0) - (a.importance || 0)).slice(0, 4);
  if (key.length) parts.push(`Key facts: ${key.map((f) => f.text).join(" · ")}`);
  if (record.lastCommand?.command) parts.push(`Last command: ${record.lastCommand.command} ${record.lastCommand.args || ""}`.trim());
  if (record.summary?.text) parts.push(`Earlier: ${record.summary.text}`);
  return parts.join("\n").slice(0, LIMITS.summaryChars + 400);
}

/**
 * ملخّص ذكي بمزوّد إن توفّر، وإلا يبقى الحتمي (§9).
 * @param {Object} descriptor
 * @param {(input:{turns:Array, summary:string})=>Promise<string>} summarizer
 */
async function refreshSummary(descriptor, summarizer) {
  const record = purge(getRecord(descriptor, { create: false }));
  if (!record || record.enabled === false || typeof summarizer !== "function") return null;
  if ((record.summary.folded || 0) - (record.summary.aiFolded || 0) < 6) return null;
  try {
    const text = await summarizer({
      turns: record.shortTerm.map((t) => ({ role: t.role, content: t.text })),
      summary: record.summary.text,
    });
    const clean = redact(String(text || "").trim()).slice(0, LIMITS.summaryChars);
    if (!clean) return null;
    record.summary = { ...record.summary, text: clean, kind: "ai", aiAt: Date.now(), aiFolded: record.summary.folded };
    store.touch();
    return clean;
  } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:1163",stage: "summarizer"}); return null; }
}

/** لقطة كاملة لسجل واحد (للعرض على صاحبه فقط) */
function snapshot(descriptor) {
  const record = purge(getRecord(descriptor, { create: false }));
  if (!record) return null;
  return {
    scope: record.scope,
    key: record.key,
    enabled: record.enabled !== false,
    ttlDays: record.ttlDays || 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    turns: record.shortTerm.length,
    summaryChars: record.summary?.text?.length || 0,
    summaryKind: record.summary?.kind || "rolling",
    facts: record.longTerm.map((item) => ({
      id: item.id, text: item.text, type: item.type, confidence: item.confidence,
      importance: item.importance, at: item.at, label: item.label, key: item.key,
    })),
    events: record.events.map((item) => ({ text: item.text, kind: item.kind, at: item.at })),
    preferences: { ...record.preferences },
    tasks: record.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
    topics: record.topics.map((topic) => ({ id: topic.id, label: topic.label, clusters: topic.clusters })),
    lastCommand: record.lastCommand,
    lastTarget: record.lastTarget,
    lastResult: record.lastResult,
    allowOwnerInspect: Boolean(record.allowOwnerInspect),
  };
}

/** سياق الإشارة: آخر أمر وآخر هدف وآخر نتيجة داخل هذه المحادثة فقط */
function conversationState(m) {
  let record;
  try {
    record = purge(getRecord(conversationScope(m), { create: false }));
  } catch {
    record = null;
  }
  if (!record || record.enabled === false) {
    return { lastCommand: null, previousCommand: null, lastTarget: null, previousTarget: null, lastResult: null, lastWork: null, pending: null, summary: "", answers: 0 };
  }
  return {
    lastWork: record.lastWork || null,
    lastCommand: record.lastCommand || null,
    previousCommand: record.previousCommand || null,
    lastTarget: record.lastTarget || null,
    previousTarget: record.previousTarget || null,
    lastResult: record.lastResult || null,
    pending: record.pending || null,
    summary: record.summary?.text || "",
    answers: record.answers?.length || 0,
    lastAnswerAt: record.answers?.length ? record.answers[record.answers.length - 1].at || 0 : 0,
  };
}

// ═══════════════════════════════════════════════
// الخصوصية والتحكّم (§22 §37)
// ═══════════════════════════════════════════════

/** حذف كل ذاكرة نطاق واحد */
function forget(descriptor) {
  const db = ensureReady().data;
  const { scope, group, user, name } = descriptor;

  if (scope === "global") {
    db.global = emptyRecord("global", "global");
    store.touch();
    return true;
  }
  if (scope === "system") {
    if (!db.system[name]) return false;
    delete db.system[name];
    store.touch();
    return true;
  }
  if (scope === "user") {
    if (!db.users[user]) return false;
    delete db.users[user];
    store.touch();
    return true;
  }
  if (scope === "private:user") {
    if (!db.private[user]) return false;
    delete db.private[user];
    store.touch();
    return true;
  }
  const bucket = db.groups[group];
  if (!bucket) return false;
  if (scope === "group") {
    bucket.group = emptyRecord("group", `group:${group}`);
    store.touch();
    return true;
  }
  if (!bucket.members?.[user]) return false;
  delete bucket.members[user];
  store.touch();
  return true;
}

/** نسيان آخر معلومة محفوظة في النطاق (§37) */
function forgetLast(descriptor) {
  const record = purge(getRecord(descriptor, { create: false }));
  if (!record || !record.longTerm.length) return null;
  let latest = 0;
  record.longTerm.forEach((item, index) => {
    if (item.at >= record.longTerm[latest].at) latest = index;
  });
  const [removed] = record.longTerm.splice(latest, 1);
  for (const topic of record.topics) topic.factIds = (topic.factIds || []).filter((id) => id !== removed.id);
  store.touch();
  return { text: removed.text, type: removed.type };
}

/** حذف حقائق تطابق معرّفاً أو نصاً داخل نطاق (لذاكرة المجموعة المسمّاة) */
function forgetMatching(descriptor, selector) {
  const record = purge(getRecord(descriptor, { create: false }));
  if (!record) return 0;
  const needle = String(selector || "").trim().toLowerCase();
  const before = record.longTerm.length;
  if (!needle || ["الكل", "كل", "all", "todo"].includes(needle)) {
    record.longTerm = [];
  } else {
    record.longTerm = record.longTerm.filter((item) =>
      !String(item.id).toLowerCase().includes(needle) && !String(item.text).toLowerCase().includes(needle));
  }
  const removed = before - record.longTerm.length;
  if (removed) store.touch();
  return removed;
}

/** حذف كل ذاكرة شخص واحد في كل النطاقات (حقّه في النسيان) */
function forgetUserEverywhere(userJid) {
  const user = digitsOf(userJid);
  if (!user) return 0;
  const db = ensureReady().data;
  let removed = 0;
  if (db.private[user]) {
    delete db.private[user];
    removed += 1;
  }
  if (db.users[user]) {
    delete db.users[user];
    removed += 1;
  }
  for (const bucket of Object.values(db.groups)) {
    if (bucket?.members?.[user]) {
      delete bucket.members[user];
      removed += 1;
    }
  }
  if (removed) store.touch();
  return removed;
}

/** تشغيل/إيقاف الذاكرة لنطاق */
function setEnabled(descriptor, enabled) {
  const record = getRecord(descriptor);
  if (!record) return false;
  record.enabled = Boolean(enabled);
  if (!record.enabled) {
    record.shortTerm = [];
    record.summary = { text: "", at: 0, folded: 0, kind: "rolling", aiAt: 0 };
    record.pending = null;
  }
  record.updatedAt = Date.now();
  store.touch();
  return true;
}

/** مدّة الاحتفاظ بالأيام (0 = دائم) */
function setTTLDays(descriptor, days) {
  const record = getRecord(descriptor);
  if (!record) return false;
  record.ttlDays = Math.max(0, Math.min(3650, Number(days) || 0));
  purge(record);
  record.updatedAt = Date.now();
  store.touch();
  return true;
}

/**
 * إذن صريح من صاحب الذاكرة للمالك بالاطلاع عليها (§37).
 * بلا هذا الإذن لا يرى المالك ذاكرة أي مستخدم.
 */
function setOwnerInspection(userJid, allowed) {
  const record = getRecord(scopeOf("user", { userJid }));
  record.allowOwnerInspect = Boolean(allowed);
  record.updatedAt = Date.now();
  store.touch();
  return record.allowOwnerInspect;
}

/**
 * اطلاع المالك على ذاكرة مستخدم — فقط بإذن صاحبها، وبسبب مكتوب، ومع سجل تدقيق.
 * @returns {{ok:boolean, reason?:string, snapshot?:Object}}
 */
function inspectForOwner(descriptor, { ownerJid = "", reason = "" } = {}) {
  const why = String(reason || "").trim();
  if (why.length < 3) return { ok: false, reason: "reason-required" };
  const targetUser = descriptor.user;
  if (!targetUser) return { ok: false, reason: "user-scope-only" };
  const consent = getRecord(scopeOf("user", { userJid: targetUser }), { create: false });
  if (!consent?.allowOwnerInspect) return { ok: false, reason: "no-consent" };
  recordEvent(scopeOf("system", { name: "audit" }), `owner ${digitsOf(ownerJid)} inspected ${descriptor.key}: ${why}`, "owner-inspect");
  return { ok: true, snapshot: snapshot(descriptor) };
}

/** إحصاءات عامة بلا أي محتوى شخصي */
function stats() {
  const db = ensureReady().data;
  let members = 0;
  for (const bucket of Object.values(db.groups)) {
    members += Object.keys(bucket?.members || {}).length;
  }
  return {
    privateRecords: Object.keys(db.private).length,
    groups: Object.keys(db.groups).length,
    groupMemberRecords: members,
    userRecords: Object.keys(db.users || {}).length,
    systemRecords: Object.keys(db.system || {}).length,
    globalFacts: db.global?.longTerm?.length || 0,
  };
}

// ═══════════════════════════════════════════════
// ترحيل الذاكرات القديمة إلى المحرّك الواحد (§6 §34)
// ═══════════════════════════════════════════════

/**
 * ينقل مرة واحدة ما كانت الأنظمة القديمة تحفظه بعيداً عن المحرّك:
 *  • Auto AI: جلسات autoai[chat].sessions[number].history  ← group:user / private:user
 *  • Auto AI: longTermMemory[number]                         ← user
 *  • مساحة العمل: aiGroupMemory[chat]                         ← group
 *  • الوكيل: preferences/facts/decisions/lessons              ← system:agent
 * لا يحذف البيانات القديمة من قاعدة البيانات (لا فقدان)، ويضع علامة حتى لا يتكرر.
 */
function migrateLegacyStores({ dbData = null, agentMemory = null } = {}) {
  const db = ensureReady().data;
  const done = db.migrations || (db.migrations = {});
  const report = { sessions: 0, longTerm: 0, groupMemory: 0, agent: 0 };

  if (dbData && !done.autoaiSessions) {
    for (const [chat, cfg] of Object.entries(dbData.autoai || {})) {
      for (const [number, session] of Object.entries(cfg?.sessions || {})) {
        const turns = Array.isArray(session?.history) ? session.history.slice(-LIMITS.shortTerm) : [];
        if (!turns.length) continue;
        const isGroup = String(chat).endsWith("@g.us");
        try {
          const descriptor = scopeOf(isGroup ? "group:user" : "private:user", { userJid: number, chatJid: chat, isGroup });
          const record = getRecord(descriptor);
          if (record.shortTerm.length) continue;
          record.shortTerm = turns.map((t) => ({
            role: t.role === "assistant" ? "assistant" : "user",
            text: redact(String(t.content || "")).slice(0, LIMITS.turnChars),
            at: t.timestamp || Date.now(),
            id: "",
          })).filter((t) => t.text);
          report.sessions += 1;
        } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:1424",stage: "scopeOf"}); }
      }
    }
    done.autoaiSessions = Date.now();
  }

  if (dbData && !done.longTermMemory) {
    for (const [number, entries] of Object.entries(dbData.longTermMemory || {})) {
      for (const entry of (Array.isArray(entries) ? entries : []).slice(-20)) {
        const facts = extractFacts(entry?.content);
        for (const fact of facts) {
          try {
            if (remember(scopeOf("user", { userJid: number }), { ...fact, source: "migrated" })) report.longTerm += 1;
          } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:1437",stage: "remember"}); }
        }
      }
    }
    done.longTermMemory = Date.now();
  }

  if (dbData && !done.aiGroupMemory) {
    for (const [chat, entries] of Object.entries(dbData.aiGroupMemory || {})) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        try {
          const item = remember(scopeOf("group", { chatJid: chat, isGroup: true }), {
            id: entry.id, text: entry.content, label: entry.label, author: entry.author,
            type: "important_context", confidence: 1, source: "group",
          });
          if (item) report.groupMemory += 1;
        } catch (error) { noteFailure("ai-memory", error, {where: "src/lib/terboo-ai-memory.js:1453"}); }
      }
    }
    done.aiGroupMemory = Date.now();
  }

  if (agentMemory && !done.agentMemory) {
    // نفس صيغة محوّل ذاكرة الوكيل (terboo-agent-memory.js): system:agent:<scope> ومفتاح bucket:key
    const agentScope = (name) => scopeOf("system", { name: `agent:${String(name || "global").replace(/[^\p{L}\p{N}_:.-]/gu, "_").slice(0, 70)}` });
    const typeOf = { preferences: "preference", facts: "fact", capabilities: "important_context" };
    for (const bucket of ["preferences", "facts", "capabilities"]) {
      for (const [scopeName, entries] of Object.entries(agentMemory[bucket] || {})) {
        for (const [key, item] of Object.entries(entries || {})) {
          const value = redact(String(item?.value ?? "")).slice(0, 500);
          const stored = remember(agentScope(scopeName), {
            key: `${bucket}:${key}`,
            text: `${key}: ${value}`,
            type: typeOf[bucket],
            confidence: item?.confidence ?? 1,
            source: "migrated",
            meta: { bucket, key, value, owner: String(item?.owner || "").slice(0, 80), source: "migrated" },
          });
          if (stored) report.agent += 1;
        }
      }
    }
    for (const decision of agentMemory.decisions || []) {
      const value = redact(String(decision?.value ?? "")).slice(0, 500);
      const stored = remember(agentScope(decision?.scope), {
        key: `decisions:${decision?.key}:${decision?.createdAt || ""}`,
        text: `${decision?.key}: ${value}`,
        type: "decision",
        confidence: decision?.confidence ?? 1,
        source: "migrated",
        meta: { bucket: "decisions", key: String(decision?.key || ""), value, owner: String(decision?.owner || "").slice(0, 80), source: "migrated" },
      });
      if (stored) report.agent += 1;
    }
    for (const lesson of agentMemory.lessons || []) {
      recordEvent(scopeOf("system", { name: "agent-lessons" }), `${lesson.operation}: ${redact(String(lesson.summary || ""))}`, lesson.success ? "lesson-ok" : "lesson-fail");
    }
    done.agentMemory = Date.now();
  }

  store.touch();
  return report;
}

/** أسماء نطاقات system التي تبدأ ببادئة (بلا محتوى) */
function listSystemScopes(prefix = "") {
  const db = ensureReady().data;
  return Object.keys(db.system || {}).filter((name) => name.startsWith(prefix));
}

/** كل حقائق سجل (للمحوّلات الداخلية فقط — لا تُرسل لنموذج) */
function factsOf(descriptor) {
  const record = purge(getRecord(descriptor, { create: false }));
  return record ? record.longTerm.map((item) => ({ ...item })) : [];
}

/** حذف حقيقة بمفتاحها داخل نطاق */
function forgetKey(descriptor, key) {
  const record = purge(getRecord(descriptor, { create: false }));
  if (!record) return false;
  const before = record.longTerm.length;
  record.longTerm = record.longTerm.filter((item) => item.key !== key);
  const removed = before !== record.longTerm.length;
  if (removed) store.touch();
  return removed;
}

/** أحداث سجل (للمحوّلات الداخلية) */
function eventsOf(descriptor) {
  const record = purge(getRecord(descriptor, { create: false }));
  return record ? record.events.map((item) => ({ ...item })) : [];
}

/** حفظ فوري (يُستدعى عند الإغلاق) */
function flush() {
  return store.flush();
}

/** تصفير كامل — للاختبارات وللنشر بذاكرة صفرية */
function resetAll() {
  store.data = emptyStore();
  store.dirty = true;
  return store.flush();
}

/** تهيئة المخزن بمسار محدّد (يُستدعى من الإقلاع أو الاختبارات) */
function initMemory(baseDir) {
  store.ready = false;
  return store.init(baseDir);
}

export {
  peekPending,
  lastAnswer,
  LIMITS,
  MEMORY_TYPES,
  REDACTED,
  TOPIC_CLUSTERS,
  activeTask,
  activeTopic,
  addTask,
  classify,
  clustersOf,
  conversationScope,
  conversationState,
  digitsOf,
  eventsOf,
  extractFacts,
  factsOf,
  flush,
  forget,
  forgetKey,
  forgetLast,
  forgetMatching,
  forgetUserEverywhere,
  groupContext,
  history,
  initMemory,
  inspectForOwner,
  learnPreference,
  listSystemScopes,
  listTasks,
  looksSecret,
  migrateLegacyStores,
  normalizeText,
  previousAnswer,
  recall,
  recordCommand,
  recordEvent,
  recordGroupMessage,
  recordResult,
  recordTarget,
  recordTurn,
  recordWork,
  redact,
  refreshSummary,
  remember,
  resetAll,
  scopeOf,
  semanticSummary,
  setEnabled,
  setOwnerInspection,
  setPending,
  setTTLDays,
  snapshot,
  stats,
  stem,
  stems,
  takePending,
  updateRelationship,
  updateTask,
};

export default {
  peekPending,
  lastAnswer,
  conversationScope,
  conversationState,
  history,
  recall,
  recordTurn,
  remember,
  scopeOf,
  snapshot,
};
