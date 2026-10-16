// ═══════════════════════════════════════════════
// 🤖 Terboo Web — نواة تنصيب البوت الفرعي (lifecycle واحد، تسليم آمن)
// ───────────────────────────────────────────────
// يستعمل terboo-jadibot-manager.js الحقيقي (startJadibot) ولا ينشئ مديراً ثانياً
// ولا اتصال واتساب منافساً. مسار الويب ومسار واتساب يستدعيان نفس النواة: الفرق
// وحده هو مُهيّئ التسليم (delivery adapter) — واتساب يرسل البطاقة في المحادثة،
// والويب يتسلّم الرمز عبر القيمة المعادة ويعرضه لتدفقٍ محمي للطالب الموثَّق وحده.
//
// العقد الأمني الذي يفرضه هذا الملف:
//   • كود الاقتران الحقيقي يصدر من childSock.requestPairingCode() لكل محاولة،
//     قصير العمر ومختلف — لا يملك المستخدم اختياره. «TARBOOV6» وسم تدفق فقط،
//     ليس رمزاً ثابتاً ولا سرّاً ولا تجاوزاً لأي تحقق.
//   • الرمز لا يُسجَّل ولا يُحفظ في قاعدة بيانات دائمة ولا telemetry: ذاكرة فقط،
//     بنافذة عرض قصيرة، ويُمحى فور الاتصال أو الانتهاء أو الإلغاء.
//   • كل طلب تنصيب مربوط بـcanonical الطالب ومعرّف جلسته، ويُعاد التحقق من الملكية
//     في كل poll. معرفة requestId وحدها لا تمنح وصولاً: عدم المطابقة ⇒ 404.
//   • التنصيب من الموقع لرقم الطالب الموثَّق فقط (الذي أثبت ملكيته بالدخول)،
//     لا لرقم ثالث.
//   • حدود لكل principal ولكل هاتف هدف ولكل IP، وتزامن واحد لكل حساب،
//     وidempotency ضد النقر المزدوج، وتهدئة، وانتهاء، وإلغاء، وتنظيف.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { noteFailure } from "../../lib/terboo-failure-log.js";
import { apiError } from "../errors.js";
import { consume } from "./rate-limit-service.js";
import { identityFromCanonical, maskPhone } from "./identity-service.js";
import { hmac } from "./secret-store.js";

/** وسم تدفق التنصيب (badge فقط — ليس رمز اقتران ولا سرّ) */
const INSTALL_LABEL = "TARBOOV6";

/** نافذة عرض الرمز: قصيرة؛ بعدها يلزم طلب جديد */
let CODE_TTL_MS = 150_000;
/** عمر سجل الطلب بعد الوصول إلى حالة نهائية قبل التنظيف */
const TERMINAL_TTL_MS = 60_000;
/** تهدئة لكل حساب بين طلبين */
let COOLDOWN_MS = 60_000;

const STATES = Object.freeze({
  VALIDATING: "validating",
  CREATING: "creating",
  WAITING_FOR_CODE: "waiting-for-pairing-code",
  CODE_READY: "code-ready",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  FOLLOWING_CHANNEL: "following-channel",
  READY: "ready",
  FAILED: "failed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

const TERMINAL = new Set([STATES.READY, STATES.FAILED, STATES.EXPIRED, STATES.CANCELLED]);

/** سجلّ الطلبات في الذاكرة فقط: requestId ⇒ record. لا يُكتب على القرص. */
const requests = new Map();
/** أحدث طلب نشط لكل حساب (idempotency + تزامن) */
const activeByCanonical = new Map();
/** آخر وقت بدء لكل حساب (تهدئة) */
const lastStartByCanonical = new Map();

let sweeper = null;
function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, rec] of requests) {
      const terminalExpired = TERMINAL.has(rec.state) && now - rec.updatedAt > TERMINAL_TTL_MS;
      const codeExpired = !TERMINAL.has(rec.state) && now > rec.codeExpiresAt && !rec.hasLiveSession;
      if (terminalExpired) {
        requests.delete(id);
        if (activeByCanonical.get(rec.canonical) === id) activeByCanonical.delete(rec.canonical);
      } else if (codeExpired) {
        wipeCode(rec);
        rec.state = STATES.EXPIRED;
        rec.updatedAt = now;
      }
    }
  }, 30_000);
  if (sweeper.unref) sweeper.unref();
}

/** مزوّد المقبس الرئيسي الحقيقي (نفس نمط otp-service)؛ الاختبارات تحقن مزيّفاً */
let socketProvider = null;
function setSocketProvider(provider) {
  socketProvider = typeof provider === "function" ? provider : null;
}
async function currentSocket() {
  if (socketProvider) return socketProvider();
  const mod = await import("../../connection.js");
  return mod.isConnected() ? mod.getSocket() : null;
}

/**
 * نواة البوتات الفرعية الحقيقية (terboo-jadibot-manager). قابلة للحقن في
 * الاختبارات وحدها كي لا يلمس اختبار الوحدة Baileys ولا ينشئ اتصالاً حقيقياً.
 */
let managerProvider = null;
function setManagerProvider(provider) {
  managerProvider = typeof provider === "function" ? provider : null;
}
async function getManager() {
  if (managerProvider) return managerProvider();
  return import("../../lib/terboo-jadibot-manager.js");
}

/** محو الرمز من الذاكرة فور عدم الحاجة إليه */
function wipeCode(rec) {
  rec.code = null;
  rec.copyCode = null;
}

function newRequestId() {
  return crypto.randomBytes(18).toString("base64url");
}

/** هاش الهاتف الهدف للحدود (لا رقم صريح في أي مفتاح حد) */
const phoneKey = (digits) => hmac(String(digits || ""), "subbot-target").slice(0, 32);

/**
 * يقرأ حالة الجلسة الحيّة من المدير ويطابقها بحالة التدفق المعروضة.
 * لا يخلط بين «جاهزية الرمز» و«فتح الاتصال»: ready فقط بعد اتصال socket حقيقي.
 */
async function reconcile(rec) {
  // expired تعني «انتهت نافذة عرض الرمز»، لا «أُوقف الاقتران»: المقبس الفرعي
  // يبقى حيّاً ولم يُوقفه أحد، فقد يُكمل المستخدم الربط بعد اختفاء الرمز.
  // قفلُ الحالة هنا كان يُظهر «منتهٍ» لبوت فرعي يعمل فعلاً. أمّا cancelled
  // وfailed فقد أُوقف فيهما الاقتران صراحةً، وready مستقرّة.
  const reopenable = rec.state === STATES.EXPIRED;
  if (TERMINAL.has(rec.state) && rec.state !== STATES.READY && !reopenable) return rec;
  const manager = await getManager();
  const live = manager.getJadibotStatus(`${rec.targetId}@s.whatsapp.net`);
  const now = Date.now();
  if (live && live.connectionReady) {
    rec.hasLiveSession = true;
    wipeCode(rec); // الرمز لم يعد لازماً بعد الاتصال
    // جاهز فقط بعد أن تستقرّ مرحلة متابعة القناة (نجحت أو فشلت أو تُخطّيت).
    // فشل المتابعة لا يمنع الجاهزية، لكنه لا يُقدَّم نجاحاً أيضاً.
    const follow = String(live.channelFollow || "pending");
    rec.channelFollow = follow;
    rec.state = follow === "pending" ? STATES.FOLLOWING_CHANNEL : STATES.READY;
    rec.updatedAt = now;
    return rec;
  }
  // لا جلسة حيّة بعد: الرمز ما زال صالحاً؟
  if (!TERMINAL.has(rec.state) || reopenable) {
    if (now > rec.codeExpiresAt) {
      wipeCode(rec);
      rec.state = STATES.EXPIRED;
    } else {
      rec.state = STATES.CODE_READY;
    }
    rec.updatedAt = now;
  }
  return rec;
}

/** العرض الآمن لسجل الطلب (الرمز يظهر فقط حين code-ready وطازج) */
function view(rec) {
  const now = Date.now();
  const fresh = rec.state === STATES.CODE_READY && now <= rec.codeExpiresAt && rec.code;
  return {
    requestId: rec.requestId,
    state: rec.state,
    label: INSTALL_LABEL,
    maskedTarget: rec.maskedTarget,
    expiresInSeconds: fresh ? Math.max(0, Math.ceil((rec.codeExpiresAt - now) / 1000)) : 0,
    // حالة متابعة القناة الحقيقية (pending/followed/failed/skipped) أو "" قبل الاتصال
    channelFollow: rec.channelFollow || "",
    // الرمز للطالب الموثَّق وحده، وفقط ضمن نافذة العرض
    code: fresh ? rec.code : undefined,
    copyCode: fresh ? rec.copyCode : undefined,
  };
}

/**
 * ① بدء تنصيب من الموقع. الرقم الهدف هو رقم الطالب الموثَّق وحده.
 * @param {{principal:Object, sessionId:string, ip:string}} input
 */
async function startProvision({ principal, sessionId, ip }) {
  startSweeper();
  if (!principal?.canonical) throw apiError("UNAUTHENTICATED");

  // idempotency: طلب نشط بالفعل لنفس الحساب ⇒ أعِد حالته بدل إنشاء مقبس ثانٍ
  const existingId = activeByCanonical.get(principal.canonical);
  if (existingId && requests.has(existingId)) {
    const existing = await reconcile(requests.get(existingId));
    if (!TERMINAL.has(existing.state) || existing.state === STATES.READY) {
      return view(existing);
    }
  }

  // الرقم الهدف: الهوية الموثَّقة فقط (لا رقم من جسم الطلب)
  const identity = identityFromCanonical(principal.canonical);
  if (!identity?.dbKey) {
    throw apiError("INVALID_INPUT", {
      message: "Your account has no confirmed phone number to install as a sub-bot.",
      details: { reason: "no-confirmed-phone" },
    });
  }
  const targetId = String(identity.dbKey).replace(/\D/g, "");

  // تهدئة لكل حساب
  const lastStart = lastStartByCanonical.get(principal.canonical) || 0;
  if (Date.now() - lastStart < COOLDOWN_MS) {
    const retryAfter = Math.ceil((COOLDOWN_MS - (Date.now() - lastStart)) / 1000);
    throw apiError("RATE_LIMITED", { details: { retryAfterSeconds: retryAfter } });
  }

  // حدود متعددة المستويات: لكل حساب · لكل هاتف هدف · لكل IP
  await consume("subbot-principal", principal.canonical, { points: 5, durationSeconds: 3600, blockSeconds: 600 });
  await consume("subbot-target", phoneKey(targetId), { points: 5, durationSeconds: 3600, blockSeconds: 600 });
  if (ip) await consume("subbot-ip", ip, { points: 10, durationSeconds: 3600, blockSeconds: 600 });

  const sock = await currentSocket();
  if (!sock) throw apiError("BOT_OFFLINE");

  const manager = await getManager();
  const userJid = `${targetId}@s.whatsapp.net`;

  // جلسة حيّة بالفعل لهذا الرقم ⇒ أعلِمه بوضوح بدل إنشاء ثانية
  if (manager.isJadibotActive(userJid)) {
    throw apiError("NEEDS_CONFIRMATION", {
      message: "A sub-bot is already active for your number. Stop it from WhatsApp before installing again.",
      details: { reason: "already-active" },
    });
  }

  lastStartByCanonical.set(principal.canonical, Date.now());

  const requestId = newRequestId();
  const rec = {
    requestId,
    canonical: principal.canonical,
    sessionId: sessionId || "",
    targetId,
    maskedTarget: maskPhone(targetId),
    state: STATES.CREATING,
    code: null,
    copyCode: null,
    codeExpiresAt: 0,
    hasLiveSession: false,
    channelFollow: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  requests.set(requestId, rec);
  activeByCanonical.set(principal.canonical, requestId);

  try {
    rec.state = STATES.WAITING_FOR_CODE;
    // مُهيّئ تسليم الويب: لا محادثة واتساب (m.chat فارغ) ⇒ لا بطاقة ولا سجل للرمز،
    // ويُعاد الرمز عبر القيمة المعادة فقط. نفس نواة lifecycle للمسارين.
    const syntheticM = { chat: null, sender: identity.sendable || userJid };
    const result = await manager.startJadibot(sock, syntheticM, userJid, true, false);
    const pairingCode = result?.pairingCode;
    if (!pairingCode) {
      rec.state = STATES.FAILED;
      rec.updatedAt = Date.now();
      throw apiError("SERVICE_UNAVAILABLE", { message: "Could not obtain a pairing code. Try again shortly." });
    }
    rec.code = pairingCode;
    rec.copyCode = String(pairingCode).replace(/-/g, "");
    rec.codeExpiresAt = Date.now() + CODE_TTL_MS;
    rec.state = STATES.CODE_READY;
    rec.updatedAt = Date.now();
    return view(rec);
  } catch (error) {
    rec.state = STATES.FAILED;
    rec.updatedAt = Date.now();
    wipeCode(rec);
    if (activeByCanonical.get(principal.canonical) === requestId) activeByCanonical.delete(principal.canonical);
    if (error?.name === "ApiError") throw error;
    // رسالة المدير (مثل الحد الأقصى/نشط بالفعل) آمنة للعرض كسبب مقتضب
    throw apiError("SERVICE_UNAVAILABLE", {
      message: "Sub-bot installation could not start. Try again shortly.",
      details: { reason: String(error?.message || "start-failed").slice(0, 120) },
    });
  }
}

/**
 * ② استعلام حالة طلب — يُعاد التحقق من الملكية في كل مرة.
 * عدم المطابقة ⇒ 404 (لا يُكشف وجود طلب لمستخدم آخر).
 */
async function getProvision({ principal, sessionId, requestId }) {
  const rec = requests.get(String(requestId || ""));
  if (!rec || rec.canonical !== principal?.canonical) throw apiError("NOT_FOUND");
  // ربط إضافي بالجلسة حين توفُّره (دون كسر جلسة جديدة لنفس الحساب)
  if (rec.sessionId && sessionId && rec.sessionId !== sessionId) throw apiError("NOT_FOUND");
  await reconcile(rec);
  return view(rec);
}

/** ③ إلغاء طلب — يوقف الاقتران إن لم يُكمل الاتصال بعد */
async function cancelProvision({ principal, sessionId, requestId }) {
  const rec = requests.get(String(requestId || ""));
  if (!rec || rec.canonical !== principal?.canonical) throw apiError("NOT_FOUND");
  if (rec.sessionId && sessionId && rec.sessionId !== sessionId) throw apiError("NOT_FOUND");
  wipeCode(rec);
  if (!rec.hasLiveSession) {
    try {
      const manager = await getManager();
      if (!manager.isJadibotActive(`${rec.targetId}@s.whatsapp.net`)) {
        await manager.stopJadibot(`${rec.targetId}@s.whatsapp.net`, true);
      }
    } catch (error) {
      // الإلغاء لا يفشل بسبب تعذّر التنظيف: الطلب يُلغى على أي حال، لكن تعذّر
      // إيقاف جلسة اقتران معلّقة أمر يستحق التسجيل (قد يترك جلسة شاردة).
      noteFailure("web-subbot", error, {
        where: "src/web/services/subbot-provision.js:cancelProvision",
        stage: "stopJadibot",
        fallback: "request-cancelled-anyway",
      });
    }
  }
  rec.state = STATES.CANCELLED;
  rec.updatedAt = Date.now();
  if (activeByCanonical.get(rec.canonical) === rec.requestId) activeByCanonical.delete(rec.canonical);
  return view(rec);
}

/** للاختبارات فقط: تصفير السجل الداخلي */
function _reset() {
  requests.clear();
  activeByCanonical.clear();
  lastStartByCanonical.clear();
}

/** للاختبارات فقط: ضبط التوقيتات لتغطية الانتهاء/التهدئة حتميّاً */
function _setTimings({ codeTtlMs, cooldownMs } = {}) {
  if (Number.isFinite(codeTtlMs)) CODE_TTL_MS = codeTtlMs;
  if (Number.isFinite(cooldownMs)) COOLDOWN_MS = cooldownMs;
}

export {
  INSTALL_LABEL,
  STATES,
  cancelProvision,
  getProvision,
  setManagerProvider,
  setSocketProvider,
  startProvision,
  _reset,
  _setTimings,
};
