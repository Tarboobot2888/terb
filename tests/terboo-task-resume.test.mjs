// ═══════════════════════════════════════════════
// 🧪 Terboo Task Resume — استئناف حقيقي بعد إعادة التشغيل
// ───────────────────────────────────────────────
// مهمة تحميل (رابط) كانت جارية ⇒ «إعادة تشغيل» (ملف المهام فقط يبقى) ⇒ waiting
// ⇒ «كملها» ⇒ runner نوعها يعيد تشغيلها من مدخلاتها المحفوظة ويسلّم في نفس الدردشة لصاحبها.
// مهمة فيديو (الوسيط لا يُحفظ) ⇒ رفض صادق «أرسله مجدداً» لا استئناف شكلي.
// مهمة شخص آخر ⇒ لا يراها ولا يستأنفها. إعادة مهمة حيّة ⇒ النتيجة تُسلَّم ولا تضيع.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-task-resume-"));
const store = path.join(tmp, "tasks.json");
process.env.TERBOO_TASKS_PATH = store;

const OWNER = "201222222222@s.whatsapp.net";
const OTHER = "201333333333@s.whatsapp.net";
const GROUP = "120363000000000888@g.us";
const now = Date.now();

// ما بقي على القرص من التشغيل السابق: مهمة تحميل جارية + مهمة فيديو جارية
fs.writeFileSync(store, JSON.stringify([
  { id: "TASK-OLD-DL", type: "tool:aio", title: "TikTok", owner: "pn:201222222222", scope: GROUP, priority: 2, status: "running", progress: 40, note: "", createdAt: now - 5000, startedAt: now - 4000, finishedAt: null, error: null, retryCount: 0, maxRetries: 0, parentTask: null, childTasks: [], provider: null, tool: "aio", cancellation: null, resumable: true, checkpoint: null, summary: null, artifacts: [], input: { id: "aio", url: "https://www.tiktok.com/@x/video/1", query: "", prompt: "", name: "", format: "", lang: "ar" } },
  { id: "TASK-OLD-VID", type: "video.understand", title: "تحليل فيديو", owner: "pn:201222222222", scope: GROUP, priority: 3, status: "running", progress: 10, note: "", createdAt: now - 3000, startedAt: now - 2000, finishedAt: null, error: null, retryCount: 0, maxRetries: 0, parentTask: null, childTasks: [], provider: null, tool: null, cancellation: null, resumable: false, checkpoint: null, summary: null, artifacts: [], input: null },
]));

const tasks = await import("../src/lib/terboo-task-queue.js");
const { installTaskRunners, jidOfOwner } = await import("../src/lib/terboo-task-runners.js");
const { controlTask } = await import("../src/lib/terboo-task-control.js");

const sent = [];
const sock = { sendMessage: async (chat, content, options) => { sent.push({ chat, content, options }); return { key: { id: `S${sent.length}` } }; } };
const toolCalls = [];
// منفّذ الأداة الحقيقي يحتاج الشبكة؛ هنا يُستبدل ويستخدم deliverResult الحقيقي للتسليم
const { deliverResult } = await import("../src/lib/terboo-scraper-registry.js");
const fakeRun = async ({ id, input, m, sock: s, lang }) => {
  toolCalls.push({ id, input, m });
  const deliveries = await deliverResult(s, m, { ok: true, media: [{ type: "video", url: "https://cdn.example.com/v.mp4" }], items: [], text: "" }, { lang });
  return { ok: true, via: "adapter", id, deliveries, attempts: [] };
};

const { tools } = installTaskRunners({ getSocket: () => sock, run: fakeRun });
assert.ok(tools >= 10, `runners لأدوات الروابط/البحث/الوصف (${tools})`);
assert.equal(tasks.restoreInterrupted(), 2, "ما كان جارياً قبل الإيقاف ⇒ waiting");
assert.equal(tasks.getTask("TASK-OLD-DL").status, "waiting");

const m = (sender) => ({ sender, chat: GROUP, isGroup: true, key: { id: "Q1", remoteJid: GROUP } });

// شخص آخر لا يستأنف مهمة غيره
const foreign = controlTask({ m: m(OTHER), lang: "ar", op: "resume", taskId: "TASK-OLD-DL" });
assert.equal(foreign.ok, false);
assert.equal(toolCalls.length, 0, "لا تنفيذ لمهمة شخص آخر");

// «كملها» ⇒ أحدث مهمة نشطة له (الفيديو) ⇒ رفض صادق: الوسيط لم يُحفظ
const video = controlTask({ m: m(OWNER), lang: "ar", op: "resume" });
assert.equal(video.ok, false);
assert.match(video.blocks.join("\n"), /أرسله مجدداً/, "فيديو بعد إعادة التشغيل ⇒ أرسله مجدداً (لا استئناف شكلي)");
const videoRetry = controlTask({ m: m(OWNER), lang: "ar", op: "retry", taskId: "TASK-OLD-VID" });
assert.equal(videoRetry.ok, false);
assert.match(videoRetry.blocks.join("\n"), /أرسله مجدداً/);

// استئناف التحميل برقمه ⇒ runner نوعها ⇒ تسليم حقيقي في دردشة المهمة
const resumed = controlTask({ m: m(OWNER), lang: "ar", op: "resume", taskId: "TASK-OLD-DL" });
assert.equal(resumed.ok, true, "مهمة رابط تُستأنف بعد إعادة التشغيل");
assert.ok(resumed.done, "النتيجة تُعاد للمستدعي ليسلّمها");
const out = await resumed.done;
assert.equal(out.ok, true);
assert.equal(toolCalls.length, 1);
assert.equal(toolCalls[0].input.url, "https://www.tiktok.com/@x/video/1", "نفس الرابط المحفوظ");
assert.equal(toolCalls[0].input.lang, undefined, "اللغة ليست مدخلاً للأداة");
assert.equal(toolCalls[0].m.chat, GROUP, "تُسلَّم في نفس الدردشة");
assert.equal(toolCalls[0].m.sender, OWNER, "لصاحب المهمة");
assert.equal(sent.length, 1);
assert.equal(sent[0].chat, GROUP);
assert.equal(sent[0].options.quoted, undefined, "لا اقتباس لرسالة غير موجودة بعد إعادة التشغيل");
assert.equal(tasks.getTask(resumed.taskId).status, "completed");
assert.equal(tasks.getTask(resumed.taskId).parentTask, "TASK-OLD-DL");

// هوية LID محفوظة ⇒ معرّف صالح للتسليم
assert.equal(jidOfOwner("pn:201222222222"), OWNER);
assert.match(jidOfOwner("lid:123456789012345"), /@(?:lid|s\.whatsapp\.net)$/);

// فشل حقيقي ⇒ المهمة «failed» (لا نجاح شكلي)
installTaskRunners({ getSocket: () => sock, run: async () => ({ ok: false, reason: "failed", messageKey: "scraper.failed", attempts: [] }) });
const again = controlTask({ m: m(OWNER), lang: "ar", op: "retry", taskId: "TASK-OLD-DL" });
assert.equal(again.ok, true);
await assert.rejects(again.done, (error) => error.code === "TOOL_FAILED");
assert.equal(tasks.getTask(again.taskId).status, "failed");

// بلا اتصال واتساب ⇒ فشل صريح لا تسليم ضائع
installTaskRunners({ getSocket: () => null, run: fakeRun });
const offline = controlTask({ m: m(OWNER), lang: "ar", op: "retry", taskId: "TASK-OLD-DL" });
await assert.rejects(offline.done, (error) => error.code === "NOT_CONNECTED");

// إعادة مهمة حيّة (مستند) ⇒ دالتها الأصلية ونتيجتها النصية تصل للمستدعي
const live = tasks.enqueueTask({ type: "document.analyze", title: "تقرير.pdf", owner: "pn:201222222222", scope: GROUP, persist: true, run: async () => ({ text: "ملخص التقرير", summary: "pdf" }) });
await live.done;
const retried = controlTask({ m: m(OWNER), lang: "ar", op: "retry", taskId: live.id });
assert.equal(retried.ok, true);
assert.equal((await retried.done).text, "ملخص التقرير", "نتيجة الإعادة لا تضيع");

console.log("✅ terboo-task-resume: استئناف بعد إعادة التشغيل · رفض صادق للوسائط · ملكية · فشل صريح · تسليم نتيجة الإعادة");
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* مجلد مؤقت */ }
process.exit(0);
