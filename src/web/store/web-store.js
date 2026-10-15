// ═══════════════════════════════════════════════
// 🗄️ Terboo Web Store — مخزن الويب المستقل (كاتب واحد)
// ───────────────────────────────────────────────
// لماذا مخزن جديد ولا نكتب في database/main/users.json؟
//   • قاعدة البوت ملفات JSON بذاكرة داخل العملية وكتابات مؤجلة كل 5s (terboo-database.js).
//     أي كاتب ثانٍ يفقد تحديثات. لذلك: نقرأ بيانات المستخدم عبر getDatabase() المركزي فقط،
//     وكل ما يملكه الموقع (جلسات · محادثات · ملفات ناتجة · حالة الدومين · تدقيق) هنا.
//   • بيانات الموقع لها schema وملكية وanretention خاصة بها، ولا تخلط بمفاتيح غير معروفة
//     في سجلّات المستخدمين.
//
// العقد:
//   • كاتب واحد: هذه الوحدة داخل عملية البوت وحدها. لا عملية ثانية تكتب هذه الملفات.
//   • كتابة ذرّية: ملف مؤقت ثم rename، وكتابة مؤجَّلة مع flush عند الإغلاق.
//   • schemaVersion في كل ملف + ترحيل idempotent قبل أي قراءة.
//   • الملفات خارج webroot تماماً ولا تُقدَّم كملفات ثابتة أبداً.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { noteFailure } from "../../lib/terboo-failure-log.js";

const SCHEMA_VERSION = 1;
const FLUSH_MS = 2000;

/** الملفات التي يملكها الموقع، وقيمها الافتراضية */
const FILES = Object.freeze({
  sessions: { file: "sessions.json", defaults: { schemaVersion: SCHEMA_VERSION, sessions: {} } },
  conversations: { file: "conversations.json", defaults: { schemaVersion: SCHEMA_VERSION, conversations: {} } },
  artifacts: { file: "artifacts.json", defaults: { schemaVersion: SCHEMA_VERSION, artifacts: {} } },
  domain: { file: "domain.json", defaults: { schemaVersion: SCHEMA_VERSION, domain: "", verified: false, token: "", method: "", checkedAt: 0, lastError: "" } },
  audit: { file: "audit.json", defaults: { schemaVersion: SCHEMA_VERSION, entries: [] } },
  settings: { file: "settings.json", defaults: { schemaVersion: SCHEMA_VERSION, values: {} } },
});

const AUDIT_MAX = 2000;

let baseDir = "";
let data = null;
const dirty = new Set();
let flushTimer = null;
let hooksInstalled = false;

/** ترحيل idempotent: يُشغَّل على كل قراءة أولى ولا يفقد بيانات */
function migrate(key, loaded) {
  const defaults = FILES[key].defaults;
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return { ...defaults };
  const version = Number(loaded.schemaVersion) || 0;
  const merged = { ...defaults, ...loaded, schemaVersion: SCHEMA_VERSION };
  if (version === SCHEMA_VERSION) return merged;
  // v0 ⇒ v1: لا شكل قديم منشور بعد؛ يُكتفى بضمان الحقول ووسم الإصدار.
  return merged;
}

function readFile(key) {
  const target = path.join(baseDir, FILES[key].file);
  if (!fs.existsSync(target)) return { ...FILES[key].defaults };
  try {
    const raw = fs.readFileSync(target, "utf8").trim();
    if (!raw) return { ...FILES[key].defaults };
    return migrate(key, JSON.parse(raw));
  } catch (error) {
    // ملف تالف: نسخة احتياطية ثم بداية نظيفة (لا إسقاط للموقع ولا فقد صامت)
    try {
      fs.copyFileSync(target, `${target}.corrupted.${Date.now()}.bak`);
    } catch (copyError) {
      noteFailure("web-store", copyError, { where: "src/web/store/web-store.js:readFile", stage: "backup" });
    }
    noteFailure("web-store", error, { where: "src/web/store/web-store.js:readFile", stage: key, fallback: "defaults" });
    return { ...FILES[key].defaults };
  }
}

function writeFileAtomic(key) {
  const target = path.join(baseDir, FILES[key].file);
  const temp = `${target}.tmp`;
  const json = JSON.stringify(data[key], null, 2);
  fs.writeFileSync(temp, json, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, target);
}

function flushNow() {
  if (!data || !baseDir) return;
  for (const key of [...dirty]) {
    try {
      writeFileAtomic(key);
      dirty.delete(key);
    } catch (error) {
      noteFailure("web-store", error, { where: "src/web/store/web-store.js:flushNow", stage: key });
    }
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, FLUSH_MS);
  if (flushTimer.unref) flushTimer.unref();
}

function markDirty(key) {
  dirty.add(key);
  scheduleFlush();
}

/** تهيئة المخزن. تُستدعى مرة واحدة عند تشغيل الموقع. */
function initWebStore(dir) {
  baseDir = dir;
  fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  data = {};
  for (const key of Object.keys(FILES)) data[key] = readFile(key);
  if (!hooksInstalled) {
    hooksInstalled = true;
    process.on("exit", flushNow);
    process.on("beforeExit", flushNow);
  }
  return { dir: baseDir, schemaVersion: SCHEMA_VERSION, files: Object.keys(FILES) };
}

const ready = () => {
  if (!data) throw new Error("web store not initialised — call initWebStore(dir) first");
  return data;
};
const isReady = () => Boolean(data);

// ── الجلسات ──────────────────────────────────────
const allSessions = () => ready().sessions.sessions;
function putSession(id, record) {
  allSessions()[id] = record;
  markDirty("sessions");
  return record;
}
function getSession(id) {
  return allSessions()[id] || null;
}
function dropSession(id) {
  if (!allSessions()[id]) return false;
  delete allSessions()[id];
  markDirty("sessions");
  return true;
}
function sessionsOf(canonical) {
  return Object.entries(allSessions())
    .filter(([, s]) => s.canonical === canonical)
    .map(([id, s]) => ({ id, ...s }));
}
function pruneSessions(now = Date.now()) {
  let removed = 0;
  for (const [id, s] of Object.entries(allSessions())) {
    if (s.expiresAt <= now || s.absoluteExpiresAt <= now) {
      delete allSessions()[id];
      removed++;
    }
  }
  if (removed) markDirty("sessions");
  return removed;
}

// ── المحادثات (قناة الويب وحدها) ─────────────────
const allConversations = () => ready().conversations.conversations;
function putConversation(id, record) {
  allConversations()[id] = record;
  markDirty("conversations");
  return record;
}
function getConversation(id) {
  return allConversations()[id] || null;
}
function dropConversation(id) {
  if (!allConversations()[id]) return false;
  delete allConversations()[id];
  markDirty("conversations");
  return true;
}
function conversationsOf(canonical) {
  return Object.entries(allConversations())
    .filter(([, c]) => c.owner === canonical)
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
function touchConversation(id) {
  const c = allConversations()[id];
  if (!c) return null;
  c.updatedAt = Date.now();
  markDirty("conversations");
  return c;
}

// ── الملفات الناتجة ──────────────────────────────
const allArtifacts = () => ready().artifacts.artifacts;
function putArtifact(id, record) {
  allArtifacts()[id] = record;
  markDirty("artifacts");
  return record;
}
function getArtifact(id) {
  return allArtifacts()[id] || null;
}
function dropArtifact(id) {
  if (!allArtifacts()[id]) return false;
  delete allArtifacts()[id];
  markDirty("artifacts");
  return true;
}
function artifactsOf(canonical) {
  return Object.entries(allArtifacts())
    .filter(([, a]) => a.owner === canonical)
    .map(([id, a]) => ({ id, ...a }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function expiredArtifacts(now = Date.now()) {
  return Object.entries(allArtifacts())
    .filter(([, a]) => a.expiresAt && a.expiresAt <= now)
    .map(([id, a]) => ({ id, ...a }));
}

// ── حالة الدومين ─────────────────────────────────
function readDomainState() {
  // يُقرأ أيضاً قبل التهيئة (باني الروابط يعمل داخل البوت بلا موقع مشغَّل)
  if (!isReady()) return { ...FILES.domain.defaults };
  const { schemaVersion, ...state } = ready().domain;
  return state;
}
function writeDomainState(patch) {
  const current = ready().domain;
  Object.assign(current, patch, { schemaVersion: SCHEMA_VERSION });
  markDirty("domain");
  return readDomainState();
}

// ── إعدادات الموقع القابلة للتغيير وقت التشغيل ──
function readWebSetting(key, fallback = null) {
  if (!isReady()) return fallback;
  const value = ready().settings.values[key];
  return value === undefined ? fallback : value;
}
function writeWebSetting(key, value) {
  ready().settings.values[key] = value;
  markDirty("settings");
  return value;
}

// ── سجل التدقيق ──────────────────────────────────
function appendAudit(entry) {
  const entries = ready().audit.entries;
  entries.push(entry);
  if (entries.length > AUDIT_MAX) entries.splice(0, entries.length - AUDIT_MAX);
  markDirty("audit");
  return entry;
}
function readAudit({ limit = 100, actor = "", action = "" } = {}) {
  return ready().audit.entries
    .filter((e) => (!actor || e.actor === actor) && (!action || e.action === action))
    .slice(-Math.max(1, Math.min(limit, AUDIT_MAX)))
    .reverse();
}

function webStoreStats() {
  if (!isReady()) return { ready: false };
  return {
    ready: true,
    dir: baseDir,
    schemaVersion: SCHEMA_VERSION,
    sessions: Object.keys(allSessions()).length,
    conversations: Object.keys(allConversations()).length,
    artifacts: Object.keys(allArtifacts()).length,
    auditEntries: ready().audit.entries.length,
    pendingWrites: dirty.size,
  };
}

/** يُستدعى من إغلاق الموقع/البوت: كل ما لم يُكتب يُكتب الآن */
function flushWebStore() {
  flushNow();
}

/** للاختبارات فقط: يعيد المخزن إلى حالة غير مهيّأة */
function _resetWebStore() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  data = null;
  baseDir = "";
  dirty.clear();
}

export {
  SCHEMA_VERSION,
  _resetWebStore,
  allArtifacts,
  allConversations,
  allSessions,
  appendAudit,
  artifactsOf,
  conversationsOf,
  dropArtifact,
  dropConversation,
  dropSession,
  expiredArtifacts,
  flushWebStore,
  getArtifact,
  getConversation,
  getSession,
  initWebStore,
  isReady,
  pruneSessions,
  putArtifact,
  putConversation,
  putSession,
  readAudit,
  readDomainState,
  readWebSetting,
  sessionsOf,
  touchConversation,
  webStoreStats,
  writeDomainState,
  writeWebSetting,
};
