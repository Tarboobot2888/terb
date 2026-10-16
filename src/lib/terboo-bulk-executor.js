// ═══════════════════════════════════════════════
// 📦 Terboo Bulk Executor — تنفيذ جماعي آمن وقابل للإلغاء (§32)
// ───────────────────────────────────────────────
//   runBulk({ items, keyOf, batchSize, gapMs, execute, verify, signal, onProgress, onCheckpoint, done })
// · دفعات صغيرة بحد معدّل (لا إغراق لواتساب/المزوّد) مع تراجع تلقائي عند rate-limit
// · تحقق حقيقي بعد كل دفعة (قراءة حديثة) — النجاح = ما تحقق فعلاً، لا ما قاله المزوّد فقط
// · لا إعادة عمياء: الدفعة الفاشلة تُعاد مرة واحدة فقط لما ثبت أنه لم يُطبَّق وكان فشله عابراً
// · إلغاء بين الدفعات عبر AbortSignal (المهمة) ⇒ تقرير جزئي صادق
// · نقطة استئناف: مفاتيح ما تم ⇒ لا يُعاد تنفيذ عنصر نُفّذ (idempotent)
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";

const DEFAULTS = Object.freeze({ batchSize: 5, gapMs: 800, backoffMs: 2000, maxGapMs: 30_000, maxItems: 1024 });
/** رموز فشل عابرة تستحق محاولة ثانية واحدة (بعد التحقق أنها لم تُطبَّق) */
const TRANSIENT = new Set(["rate-limit", "timeout", "network", "unknown"]);

const wait = (ms, signal) => new Promise((resolve) => {
  if (!ms || signal?.aborted) return resolve();
  // بلا unref: عملية جماعية جارية يجب أن تُكمل (أو تُلغى صراحة) لا أن تُقطع بخروج العملية
  const timer = setTimeout(done, ms);
  function done() {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", done);
    resolve();
  }
  signal?.addEventListener?.("abort", done, { once: true });
});

/** خطأ مزوّد ⇒ رمز موحّد */
function codeOfError(error) {
  const text = `${error?.message || ""} ${error?.data || ""} ${error?.output?.statusCode || ""}`.toLowerCase();
  if (/rate-?overlimit|429|too many/.test(text)) return "rate-limit";
  if (/timed? ?out|408/.test(text)) return "timeout";
  if (/not-authorized|forbidden|403|401/.test(text)) return "not-authorized";
  if (/not-acceptable|406/.test(text)) return "not-acceptable";
  if (/connection closed|econnreset|socket|network/.test(text)) return "network";
  return "unknown";
}

/**
 * @param {{items:Array, keyOf?:(item:any)=>string, batchSize?:number, gapMs?:number, backoffMs?:number, maxGapMs?:number,
 *          execute:(batch:Array, ctx:{signal?:AbortSignal, attempt:number})=>Promise<Array<{key:string, ok:boolean, code?:string}>>,
 *          verify?:(batch:Array)=>Promise<Map<string,boolean>|null>, signal?:AbortSignal,
 *          onProgress?:(state:{done:number,total:number,failed:number})=>void, onCheckpoint?:(keys:string[])=>void,
 *          done?:Iterable<string>}} options
 * @returns {Promise<{total:number, succeeded:string[], failed:Array<{key:string, code:string}>, skipped:string[],
 *          cancelled:boolean, batches:number, verified:boolean, rateLimited:number, durationMs:number}>}
 */
async function runBulk(options) {
  const started = Date.now();
  const keyOf = options.keyOf || ((item) => String(item));
  const batchSize = Math.max(1, Math.min(50, Number(options.batchSize) || DEFAULTS.batchSize));
  const baseGap = Math.max(0, Number(options.gapMs ?? DEFAULTS.gapMs));
  const maxGap = Math.max(baseGap, Number(options.maxGapMs) || DEFAULTS.maxGapMs);
  const backoff = Math.max(0, Number(options.backoffMs ?? DEFAULTS.backoffMs));
  const already = new Set([...(options.done || [])].map(String));
  const items = (options.items || []).slice(0, DEFAULTS.maxItems);
  const pending = items.filter((item) => !already.has(keyOf(item)));
  const report = { total: items.length, succeeded: [...already].filter((k) => items.some((i) => keyOf(i) === k)), failed: [], skipped: [], cancelled: false, batches: 0, verified: true, rateLimited: 0, durationMs: 0 };
  let gap = baseGap;

  for (let start = 0; start < pending.length; start += batchSize) {
    if (options.signal?.aborted) {
      report.cancelled = true;
      report.skipped.push(...pending.slice(start).map(keyOf));
      break;
    }
    if (start > 0) await wait(gap, options.signal);
    if (options.signal?.aborted) {
      report.cancelled = true;
      report.skipped.push(...pending.slice(start).map(keyOf));
      break;
    }
    let batch = pending.slice(start, start + batchSize);
    report.batches += 1;
    const outcome = new Map();
    for (let attempt = 1; attempt <= 2 && batch.length; attempt += 1) {
      let results;
      try {
        results = await options.execute(batch, { signal: options.signal, attempt });
      } catch (error) {
        const code = codeOfError(error);
        if (code === "rate-limit") report.rateLimited += 1;
        noteFailure("bulk-executor", error, { where: "terboo-bulk-executor:execute", stage: code, fallback: attempt === 1 ? "verify-then-retry" : "report" });
        results = batch.map((item) => ({ key: keyOf(item), ok: false, code }));
      }
      const byKey = new Map((results || []).map((r) => [String(r.key), r]));
      // التحقق الحقيقي بعد الدفعة (قراءة حديثة) — يحسم ما حدث فعلاً حتى لو انقطع الرد
      let truth = null;
      if (options.verify) {
        try {
          truth = await options.verify(batch);
        } catch (error) {
          noteFailure("bulk-executor", error, { where: "terboo-bulk-executor:verify", fallback: "provider-codes" });
        }
      }
      if (!truth) report.verified = false;
      const retry = [];
      for (const item of batch) {
        const key = keyOf(item);
        const r = byKey.get(key) || { ok: false, code: "no-result" };
        const applied = truth ? truth.get(key) === true : r.ok;
        if (applied) { outcome.set(key, { ok: true }); continue; }
        const code = truth && r.ok ? "not-verified" : r.code || "failed";
        outcome.set(key, { ok: false, code });
        if (attempt === 1 && TRANSIENT.has(code)) retry.push(item);
      }
      if (retry.length) {
        // تراجع عند rate-limit (لا إغراق) ثم محاولة ثانية واحدة لما لم يُطبَّق فقط
        if (retry.some((item) => outcome.get(keyOf(item))?.code === "rate-limit")) gap = Math.min(maxGap, Math.max(gap * 2, backoff));
        await wait(gap, options.signal);
        if (options.signal?.aborted) break;
      } else if (gap > baseGap) {
        gap = Math.max(baseGap, Math.floor(gap / 2));
      }
      batch = retry;
    }
    for (const [key, r] of outcome) {
      if (r.ok) report.succeeded.push(key);
      else report.failed.push({ key, code: r.code });
    }
    options.onCheckpoint?.(report.succeeded.slice());
    options.onProgress?.({ done: report.succeeded.length + report.failed.length, total: report.total, failed: report.failed.length });
  }
  report.durationMs = Date.now() - started;
  return report;
}

export { DEFAULTS, TRANSIENT, codeOfError, runBulk };
export default { runBulk, codeOfError };
