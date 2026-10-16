// ═══════════════════════════════════════════════
// 📎 Terboo Web — الرفع والملفات الناتجة (Artifacts)
// ───────────────────────────────────────────────
// • التخزين خارج webroot تماماً: data/web-uploads/<ownerHash>/<id>.<ext>
//   لا يُقدَّم أي ملف منها كملف ثابت، والتنزيل يمرّ على فحص ملكية وصلاحية.
// • النوع الحقيقي يُستخرج من البايتات بـfile-type، لا من الامتداد ولا من
//   Content-Type الذي يرسله المتصفح. عدم تطابقهما يُرفض.
// • الحدود من terboo-multimodal.js/terboo-documents.js الحقيقية (لا أرقام مخترعة):
//   صورة 16MB/40Mpx · صوت 25MB/900s · فيديو 64MB/600s · مستند 100MB.
// • أسماء الملفات تُولَّد خادمياً ولا تُبنى من اسم المستخدم (منع الاجتياز والتخمين).
// • الملفات التنفيذية والأرشيفات المشبوهة مرفوضة؛ فكّ الأرشيف — حين يلزم —
//   يمرّ على safeUnzip في terboo-documents.js (zip-slip وقنابل الضغط).
// • الاحتفاظ محدود (artifactTtlHours) وتُحذف دورياً.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { noteFailure } from "../../lib/terboo-failure-log.js";
import { MEDIA_LIMITS } from "../../lib/terboo-multimodal.js";
import { websiteConfig } from "../config.js";
import { apiError } from "../errors.js";
import { artifactsOf, dropArtifact, expiredArtifacts, getArtifact, putArtifact } from "../store/web-store.js";
import { hmac } from "./secret-store.js";
import * as limits from "./rate-limit-service.js";

const ROOT = path.join(process.cwd(), "data", "web-uploads");

/** أنواع مقبولة ⇒ فئة الوسيط المنطقية */
const ACCEPTED = new Map([
  ["image/jpeg", "image"], ["image/png", "image"], ["image/webp", "image"], ["image/gif", "image"],
  ["image/bmp", "image"], ["image/tiff", "image"], ["image/avif", "image"], ["image/heic", "image"],
  ["audio/mpeg", "audio"], ["audio/ogg", "audio"], ["audio/wav", "audio"], ["audio/x-wav", "audio"],
  ["audio/mp4", "audio"], ["audio/aac", "audio"], ["audio/flac", "audio"], ["audio/opus", "audio"],
  ["video/mp4", "video"], ["video/webm", "video"], ["video/quicktime", "video"], ["video/x-matroska", "video"],
  ["application/pdf", "document"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "document"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "document"],
  ["application/msword", "document"], ["application/vnd.ms-excel", "document"],
  ["text/plain", "document"], ["text/csv", "document"], ["application/json", "document"],
  ["application/zip", "archive"],
]);

/** أنواع مرفوضة دائماً مهما كان الامتداد */
const FORBIDDEN_TYPES = new Set([
  "application/x-msdownload", "application/x-executable", "application/x-mach-binary",
  "application/x-sharedlib", "application/x-dosexec", "application/vnd.microsoft.portable-executable",
  "application/x-elf", "application/java-archive", "application/x-shockwave-flash",
]);

/** حد البايتات لكل فئة من الحدود الحقيقية في محرّك الوسائط */
function maxBytesFor(kind) {
  if (kind === "image") return MEDIA_LIMITS.image.maxBytes;
  if (kind === "audio") return MEDIA_LIMITS.audio.maxBytes;
  if (kind === "video") return MEDIA_LIMITS.video.maxBytes;
  return MEDIA_LIMITS.document.maxBytes;
}

const ownerDir = (owner) => path.join(ROOT, hmac(owner, "upload-owner").slice(0, 32));

/** اسم ملف خادمي بحت: لا جزء منه من مدخل المستخدم */
function storedName(id, ext) {
  const safeExt = /^[a-z0-9]{1,8}$/.test(String(ext || "")) ? String(ext) : "bin";
  return `${id}.${safeExt}`;
}

/** اسم العرض: يُنقَّى ولا يُستعمل أبداً كمسار */
function displayName(raw) {
  return String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120) || "file";
}

/**
 * يخزّن رفعاً بعد كل الفحوص.
 * @param {{principal:Object, buffer:Buffer, fileName?:string, declaredType?:string}} input
 */
async function storeUpload({ principal, buffer, fileName = "", declaredType = "" }) {
  const owner = principal.canonical;
  const site = websiteConfig();
  await limits.uploads(owner);

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw apiError("INVALID_INPUT", { message: "The uploaded file is empty." });
  }
  if (buffer.length > site.limits.uploadBytes) {
    throw apiError("PAYLOAD_TOO_LARGE", { details: { maxBytes: site.limits.uploadBytes } });
  }

  // النوع الحقيقي من البايتات — لا من الامتداد ولا من ترويسة العميل
  const sniffed = await fileTypeFromBuffer(buffer);
  let mime = sniffed?.mime || "";
  let ext = sniffed?.ext || "";

  // نص عادي لا بصمة له: يُقبل كمستند إن كان نصاً صالحاً فعلاً
  if (!mime) {
    const head = buffer.subarray(0, 4096).toString("utf8");
    const printable = !/[\u0000-\u0008\u000e-\u001f]/.test(head);
    if (!printable) throw apiError("INVALID_INPUT", { message: "The file type is not supported." });
    mime = /^\s*[[{]/.test(head) ? "application/json" : "text/plain";
    ext = mime === "application/json" ? "json" : "txt";
  }

  if (FORBIDDEN_TYPES.has(mime)) {
    throw apiError("INVALID_INPUT", { message: "Executable files are not accepted.", details: { reason: "executable" } });
  }
  const kind = ACCEPTED.get(mime);
  if (!kind) {
    throw apiError("INVALID_INPUT", { message: "The file type is not supported.", details: { detected: mime } });
  }

  // الامتداد الذي أعلنه المستخدم يخالف البايتات ⇒ رفض (منع تمرير منفّذ باسم صورة)
  const claimedExt = path.extname(displayName(fileName)).replace(".", "").toLowerCase();
  if (claimedExt && ext && claimedExt !== ext && !(kind === "document" && ["txt", "csv", "json", "md"].includes(claimedExt))) {
    throw apiError("INVALID_INPUT", {
      message: "The file extension does not match its real content.",
      details: { declared: claimedExt, detected: ext },
    });
  }
  // Content-Type الذي أعلنه المتصفح يُسجَّل للمقارنة فقط، ولا يُعتمد عليه
  const declaredMismatch = Boolean(declaredType && declaredType.split(";")[0].trim() !== mime);

  const maxBytes = maxBytesFor(kind);
  if (buffer.length > maxBytes) {
    throw apiError("PAYLOAD_TOO_LARGE", { details: { kind, maxBytes } });
  }

  const id = `u_${crypto.randomBytes(16).toString("base64url")}`;
  const dir = ownerDir(owner);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, storedName(id, ext));
  fs.writeFileSync(file, buffer, { mode: 0o600 });

  const now = Date.now();
  const record = {
    owner,
    kind,
    mime,
    ext,
    bytes: buffer.length,
    name: displayName(fileName),
    // المسار لا يُعاد في أي API؛ يُحفظ داخلياً فقط
    file,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    createdAt: now,
    expiresAt: now + site.limits.artifactTtlHours * 3_600_000,
    declaredMismatch,
    source: "upload",
  };
  putArtifact(id, record);

  return publicArtifact(id, record);
}

/** يسجّل ملفاً ناتجاً عن أداة (لا رفع) */
function storeOutput({ principal, buffer, mime, ext, name = "result", toolId = "" }) {
  const owner = principal.canonical;
  const id = `o_${crypto.randomBytes(16).toString("base64url")}`;
  const dir = ownerDir(owner);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, storedName(id, ext));
  fs.writeFileSync(file, buffer, { mode: 0o600 });
  const now = Date.now();
  const record = {
    owner,
    kind: ACCEPTED.get(mime) || "document",
    mime,
    ext,
    bytes: buffer.length,
    name: displayName(name),
    file,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    createdAt: now,
    expiresAt: now + websiteConfig().limits.artifactTtlHours * 3_600_000,
    source: toolId ? `tool:${toolId}` : "output",
  };
  putArtifact(id, record);
  return publicArtifact(id, record);
}

/** الشكل المعروض: بلا مسار ولا بايتات */
function publicArtifact(id, record) {
  return {
    id,
    kind: record.kind,
    mime: record.mime,
    bytes: record.bytes,
    name: record.name,
    sha256: record.sha256.slice(0, 16),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    source: record.source,
    // يُبنى من أجزاء: مسار API ثابت وليس نصاً معروضاً للمستخدم
    downloadPath: ["/api/v1/artifacts", id].join("/"),
  };
}

/**
 * يقرأ ملفاً بعد التحقق من الملكية والصلاحية (IDOR).
 * ملك غيرك أو منتهٍ أو مفقود ⇒ نفس الرد: 404 بلا تمييز.
 */
function openArtifact(principal, id) {
  const record = getArtifact(String(id || ""));
  if (!record || record.owner !== principal.canonical) throw apiError("NOT_FOUND");
  if (record.expiresAt && record.expiresAt <= Date.now()) {
    removeArtifact(id);
    throw apiError("NOT_FOUND");
  }
  if (!fs.existsSync(record.file)) {
    dropArtifact(id);
    throw apiError("NOT_FOUND");
  }
  return record;
}

/** بايتات ملف مملوك (للأدوات التي تستقبل buffer) */
function readArtifactBuffer(principal, id) {
  const record = openArtifact(principal, id);
  return { record, buffer: fs.readFileSync(record.file) };
}

function removeArtifact(id) {
  const record = getArtifact(String(id || ""));
  if (!record) return false;
  try {
    if (fs.existsSync(record.file)) fs.unlinkSync(record.file);
  } catch (error) {
    noteFailure("web-upload", error, { where: "src/web/services/upload-service.js:removeArtifact", stage: "unlink", fallback: "drop-record" });
  }
  return dropArtifact(String(id));
}

function listArtifacts(principal, { limit = 50 } = {}) {
  return artifactsOf(principal.canonical)
    .slice(0, Math.min(limit, 200))
    .map((record) => publicArtifact(record.id, record));
}

/** تنظيف المنتهي — يُستدعى دورياً من دورة حياة الموقع */
function pruneArtifacts() {
  let removed = 0;
  for (const record of expiredArtifacts()) if (removeArtifact(record.id)) removed++;
  return removed;
}

export {
  ACCEPTED,
  FORBIDDEN_TYPES,
  listArtifacts,
  maxBytesFor,
  openArtifact,
  pruneArtifacts,
  publicArtifact,
  readArtifactBuffer,
  removeArtifact,
  storeOutput,
  storeUpload,
};
