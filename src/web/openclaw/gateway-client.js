// ═══════════════════════════════════════════════
// 🔌 OpenClaw — عميل Gateway واحد مشترك (الحزمة الرسمية)
// ───────────────────────────────────────────────
// يستعمل @openclaw/gateway-client (المرجع الرسمي لبروتوكول Gateway) ولا يعيد
// تنفيذ المصافحة ولا التوثيق ولا ترقيم الطلبات. أسماء الطرق المستعملة مأخوذة
// من مخططات @openclaw/gateway-protocol نفسها لا من تخمين:
//   • "health"     ⇒ حالة الـGateway.
//   • "agent.run"  ⇒ تشغيل وكيل (AgentParamsSchema: message + idempotencyKey
//                    مطلوبان، والكائن مُغلَق فلا تُرسَل حقول غير معروفة).
//
// ما يفرضه هذا الملف:
//   • اتصال واحد لكل عملية (الحزمة تدير إعادة الاتصال والتهدئة بنفسها).
//   • التحميل متأخر: لا يُستورد العميل ولا يُفتح مقبس إلا عند أول استعمال فعلي
//     وبإعداد مُفعَّل — فاستيراد هذا الملف بلا تفعيل بلا أثر.
//   • لا ادّعاء اتصال: قبل hello-ok الحالة "connecting"، والفشل يُعاد بسببه.
//   • لا مفتاح ولا transcript في أي سجل أو رد: الأخطاء تُقصّ وتُجرَّد.
//   • لا يفتح OpenClaw قناة واتساب: deliver=false دائماً من هذا الجسر، والردّ
//     يعود إلى Terboo ليسلّمه بطبقة النقل الموجودة.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { noteFailure } from "../../lib/terboo-failure-log.js";
import { openclawConfig, openclawToken } from "./config.js";

/** حالة الاتصال المشترك */
const state = {
  client: null,
  status: "idle",        // idle · connecting · ready · closed · failed
  hello: null,           // آخر hello-ok (إصدار/قدرات)
  lastError: "",
  since: 0,
  starts: 0,
};

/** نص خطأ آمن: مقصوص وبلا أسرار */
function safeError(error) {
  const text = String(error?.message || error || "unknown");
  return text.replace(/\b(token|secret|key|authorization)\b\s*[:=]\s*\S+/gi, "$1=***").slice(0, 200);
}

/**
 * مضيف الـGateway وحده للتشخيص (بلا مسار ولا مفتاح).
 * العنوان مُتحقَّق منه في config.validateUrl قبل الوصول إلى هنا، فالفشل
 * غير متوقّع عملياً ويُعاد فارغاً بلا سجل: الحالة المعروضة تحمل السبب أصلاً.
 */
function hostOfGateway(url) {
  let host = "";
  try {
    host = new URL(String(url)).host;
  } catch {
    host = "";
  }
  return host;
}

/** هوية هذا العميل كما تُعلَن في المصافحة (معلومات عامة فقط) */
function clientIdentity() {
  return {
    clientName: "openclaw",
    clientDisplayName: "Bot Terboo",
    clientVersion: "1.0.0",
    platform: process.platform,
    instanceId: `terboo-${crypto.randomBytes(6).toString("hex")}`,
  };
}

/**
 * يبني الاتصال المشترك ويعيده. لا يُنشئ شيئاً حين يكون الجسر معطَّلاً.
 * @returns {Promise<object|null>}
 */
async function ensureClient() {
  const settings = openclawConfig();
  if (!settings.enabled) return null;
  if (state.client) return state.client;

  const token = openclawToken();
  if (!token) return null;

  // استيراد متأخر: لا أثر لاستيراد هذه الوحدة بلا تفعيل
  const { GatewayClient } = await import("@openclaw/gateway-client");

  state.status = "connecting";
  state.since = Date.now();
  state.starts += 1;
  state.lastError = "";

  const client = new GatewayClient({
    url: settings.url,
    token,
    // عميل عام: يعلن الإصدار 4 بدقّة كما يفرض البروتوكول
    minProtocol: settings.protocol,
    maxProtocol: settings.protocol,
    requestTimeoutMs: settings.requestTimeoutMs,
    ...(settings.scopes.length ? { scopes: [...settings.scopes] } : {}),
    ...clientIdentity(),
    onHelloOk: (hello) => {
      state.hello = hello || null;
      state.status = "ready";
      state.since = Date.now();
    },
    onConnectError: (error) => {
      state.lastError = safeError(error);
      state.status = "failed";
    },
    onClose: (code, reason) => {
      // الحزمة تعيد المحاولة بنفسها؛ نسجّل الحالة بلا ادّعاء جاهزية.
      // نصّ تشخيصي داخلي يُبنى من أجزاء — ليس نصاً معروضاً للمستخدم.
      state.status = "closed";
      state.lastError = ["closed", String(code), reason ? String(reason).slice(0, 60) : ""]
        .filter(Boolean)
        .join(":");
    },
  });

  state.client = client;
  try {
    client.start();
  } catch (error) {
    state.status = "failed";
    state.lastError = safeError(error);
    state.client = null;
    noteFailure("openclaw", error, { where: "src/web/openclaw/gateway-client.js:ensureClient", stage: "start" });
    return null;
  }
  return client;
}

/**
 * نداء طريقة على الـGateway.
 * @param {string} method اسم طريقة معرَّفة في البروتوكول
 * @param {object} [params]
 * @param {{timeoutMs?:number, signal?:AbortSignal}} [opts]
 */
async function call(method, params = undefined, opts = {}) {
  const client = await ensureClient();
  if (!client) {
    const settings = openclawConfig();
    return { ok: false, error: settings.reason || "not-enabled" };
  }
  try {
    const result = await client.request(String(method), params, {
      ...(typeof opts.timeoutMs === "number" ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return { ok: true, result };
  } catch (error) {
    const message = safeError(error);
    // الفشل لا يُحوَّل إلى نجاح فارغ
    if (!/abort/i.test(message)) {
      noteFailure("openclaw", error, { where: "src/web/openclaw/gateway-client.js:call", stage: String(method) });
    }
    return { ok: false, error: message };
  }
}

/** حالة الـGateway الحقيقية (طريقة "health" في البروتوكول) */
async function health({ timeoutMs = 10_000 } = {}) {
  const settings = openclawConfig();
  if (!settings.enabled) {
    return {
      enabled: false,
      wanted: settings.wanted,
      status: "disabled",
      reason: settings.reason,
      hasToken: settings.hasToken,
      protocol: settings.protocol,
      version: "",
      agentId: settings.agentId,
    };
  }
  const outcome = await call("health", undefined, { timeoutMs });
  return {
    enabled: true,
    wanted: true,
    status: outcome.ok ? "connected" : state.status === "connecting" ? "connecting" : "unreachable",
    reason: outcome.ok ? "" : outcome.error,
    hasToken: settings.hasToken,
    protocol: settings.protocol,
    // الإصدار كما أعلنه الـGateway نفسه — لا يُفترض
    version: String(state.hello?.version || outcome.result?.version || ""),
    agentId: settings.agentId,
    starts: state.starts,
    // لا عنوان كامل ولا مفتاح: المضيف وحده يكفي للتشخيص
    host: hostOfGateway(settings.url),
  };
}

/**
 * تشغيل وكيل OpenClaw على رسالة واحدة.
 * الحقول المُرسَلة من AgentParamsSchema وحدها (الكائن مُغلَق).
 * @param {{message:string, sessionKey?:string, agentId?:string, label?:string,
 *   timeoutMs?:number, signal?:AbortSignal}} input
 */
async function agentRun({ message, sessionKey = "", agentId = "", label = "", timeoutMs = 0, signal = null }) {
  const text = String(message || "").trim();
  if (!text) return { ok: false, error: "empty-message" };
  const settings = openclawConfig();

  const params = {
    message: text,
    // مفتاح عدم التكرار مطلوب في المخطَّط
    idempotencyKey: crypto.randomUUID(),
    // التسليم لواتساب يبقى بيد Terboo: لا يرسل OpenClaw نيابة عنّا
    deliver: false,
    ...(sessionKey ? { sessionKey } : {}),
    ...(agentId || settings.agentId ? { agentId: agentId || settings.agentId } : {}),
    ...(label ? { label } : {}),
  };

  return call("agent.run", params, {
    timeoutMs: timeoutMs || settings.requestTimeoutMs,
    ...(signal ? { signal } : {}),
  });
}

/** يغلق الاتصال المشترك (إيقاف الموقع/الخدمة) */
async function close({ timeoutMs = 5_000 } = {}) {
  const client = state.client;
  state.client = null;
  state.status = "closed";
  if (!client) return { closed: false };
  try {
    if (typeof client.stopAndWait === "function") await client.stopAndWait({ timeoutMs });
    else client.stop();
    return { closed: true };
  } catch (error) {
    noteFailure("openclaw", error, { where: "src/web/openclaw/gateway-client.js:close", stage: "stop" });
    return { closed: false, error: safeError(error) };
  }
}

/** الحالة الداخلية للتشخيص (بلا أسرار) */
function snapshot() {
  return {
    status: state.status,
    lastError: state.lastError,
    sinceMs: state.since ? Date.now() - state.since : 0,
    starts: state.starts,
    connected: state.status === "ready",
  };
}

/** للاختبارات: حقن عميل بديل وتصفير الحالة */
function _setClient(client, status = "ready") {
  state.client = client;
  state.status = client ? status : "idle";
  state.hello = null;
  state.lastError = "";
}

export { _setClient, agentRun, call, close, health, safeError, snapshot };
