// ═══════════════════════════════════════════════
// 👁️ Terboo AI Media Strategy — النواة ترى وتسمع وتشاهد وتقرأ (§26–§33 §49 §90)
// ───────────────────────────────────────────────
// يُستدعى من النواة حين تقرّر البوابة VISION · AUDIO · VIDEO · DOCUMENT، أو يطلب المستخدم ردّاً صوتياً.
//   صورة   : OCR محلي دائماً + مزوّد رؤية يستلم الصورة فعلاً (Claude/ChatGPT) إن توفّر،
//            وإلا يكمل المسار الحالي (أداة img2prompt) — لا تظاهر بالرؤية.
//   صوت    : تفريغ حقيقي ⇒ النص يصبح رسالة المستخدم (الملاحظة الصوتية) أو يُعرض (اقرأ التسجيل)؛
//            تعذّر التفريغ ⇒ رد صريح بذلك.
//   فيديو  : Quick مباشرة، Deep في الخلفية (Task Control Plane) ⇒ ملخّص زمني عبر النموذج.
//   مستند  : استخراج ⇒ أقسام ⇒ أنسب القطع للسؤال ⇒ النموذج؛ الكبير في الخلفية.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import { t } from "./terboo-localization.js";
import * as UI from "./terboo-ui-theme.js";
import { markRaw } from "./terboo-i18n/runtime.js";
import { stepOf, markFirstResponse } from "./terboo-latency.js";
import { describeImage, extractDocument, mediaOf, ocrImage, representationForModel, safeDownload, textToVoice, transcribeAudio, understandVideo } from "./terboo-multimodal.js";
import { PRIORITY, enqueueTask } from "./terboo-task-queue.js";
import { taskOwner } from "./terboo-task-control.js";
import { recordTurn, recordWork } from "./terboo-ai-memory.js";

const MEDIA_INTENTS = new Set(["VISION", "AUDIO", "VIDEO", "DOCUMENT"]);
const BIG_DOCUMENT_CHARS = 120_000;
const DEEP_VIDEO_SECONDS = 45;

/** مزوّد رؤية حقيقي متاح؟ (محقون للاختبار أو محمّل بقدرة vision) */
async function visionAvailable(deps) {
  if (typeof deps.vision === "function") return true;
  try {
    const { loadProviders, supportsVision } = await import("./terboo-ai-providers.js");
    const loaded = await loadProviders();
    return Object.keys(loaded).some((name) => supportsVision(name));
  } catch (error) {
    noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:visionAvailable", stage: "loadProviders" });
    return false;
  }
}

function card(lang, blocks, icon = "🧠") {
  return UI.card({ title: t(lang, "assistant.title"), icon, blocks: blocks.filter(Boolean), lang });
}

async function say(m, text) {
  m.__terbooTicket?.markResponding?.();
  await m.reply(text).catch((error) => noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:say", stage: "m.reply" }));
  markFirstResponse(m);
}

/** إجابة النموذج على سؤال المستخدم بتمثيل الوسيط (بيانات غير موثوقة) */
async function answerWithModel({ m, db, text, lang, representation, deps, recordUser = true }) {
  const { composeReply } = await import("./terboo-ai-core.js");
  const composed = await composeReply({
    m, db, text: text || "", lang, ask: deps.ask, recordUser,
    extraInstruction: `${representation}\n\nAnswer the user's request using only the data above. If the data does not contain the answer, say so plainly.`,
  });
  return composed?.text || "";
}

/**
 * @returns {Promise<string|null>} "answered" أو null (لا وسيط/المسار العادي يكمل)
 */
async function runMediaStrategy({ m, sock, db, text, lang, gate, deps = {}, recordUser = true }) {
  if (!MEDIA_INTENTS.has(gate.intent)) return null;
  const info = mediaOf(m);
  if (!info) return null;
  stepOf(m, "capability", `multimodal:${info.kind}`);

  // ── صورة ──
  if (info.kind === "image" || info.kind === "sticker") {
    const ocrOnly = gate.op === "ocr";
    const canSee = !ocrOnly && (await visionAvailable(deps));
    if (!ocrOnly && !canSee) return null; // يكمل المسار الحالي (أداة img2prompt) بلا تظاهر
    const media = await safeDownload(info);
    if (!media.ok) { await say(m, card(lang, [t(lang, ["media", media.error].join(".")) || t(lang, "media.failed")], "⚠️")); return "answered"; }
    stepOf(m, "tool", ocrOnly ? "image.ocr" : "image.ocr+describe");
    const ocr = await (deps.ocr || ocrImage)(media.buffer, { languages: "ara+eng+spa" }).catch((error) => { noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:image", stage: "ocr" }); return { ok: false, text: "" }; });
    if (ocrOnly) {
      stepOf(m, "verify", ocr.ok ? `ocr:${ocr.confidence}` : "ocr:empty");
      await say(m, ocr.ok ? card(lang, [t(lang, "media.ocrResult", { confidence: ocr.confidence }), markRaw(ocr.text.slice(0, 3500))], "📝") : card(lang, [t(lang, "media.ocrEmpty")], "📝"));
      try { recordTurn(m, "assistant", ocr.text.slice(0, 500)); } catch (error) { noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:image", stage: "recordTurn" }); }
      return "answered";
    }
    const vision = typeof deps.vision === "function"
      ? await deps.vision(media.buffer, { question: text, lang })
      : await describeImage(media.buffer, { question: text, lang }).catch((error) => { noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:image", stage: "vision" }); return { ok: false, text: "" }; });
    stepOf(m, "verify", vision.ok ? "vision" : ocr.ok ? "ocr-only" : "failed");
    if (!vision.ok && !ocr.ok) return null;
    const representation = representationForModel("image", { ocr, description: vision.text });
    const answer = await answerWithModel({ m, db, text: text || t(lang, "media.describeDefault"), lang, representation, deps, recordUser });
    await say(m, markRaw(answer || vision.text || ocr.text));
    try { recordWork(m, { media: { kind: "image", ocr: Boolean(ocr.ok), vision: Boolean(vision.ok) } }); } catch (error) { noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:image", stage: "recordWork" }); }
    return "answered";
  }

  // ── صوت / ملاحظة صوتية ──
  if (info.kind === "audio" || info.kind === "voice") {
    const media = await safeDownload(info);
    if (!media.ok) { await say(m, card(lang, [t(lang, ["media", media.error].join(".")) || t(lang, "media.failed")], "⚠️")); return "answered"; }
    stepOf(m, "tool", "audio.transcribe");
    // لغة المستخدم المفضلة: موجّه مفردات + إعادة تفريغ مقطع قصير التُقط بلغة أخرى (بلاغ: رد إنجليزي على فويس عربي)
    const transcript = await transcribeAudio(media.buffer, { providers: deps.stt || undefined, hint: lang });
    stepOf(m, "verify", transcript.ok ? `transcript:${transcript.provider}` : `stt:${transcript.error}`);
    if (!transcript.ok) {
      const key = transcript.error === "no-speech" ? "media.noSpeech" : transcript.error === "unclear" ? "media.unclear" : transcript.error === "too-long" ? "media.too-long" : "media.sttUnavailable";
      await say(m, card(lang, [t(lang, key)], "🎙️"));
      return "answered";
    }
    try { recordWork(m, { media: { kind: info.kind, transcript: transcript.text.slice(0, 1000) } }); } catch (error) { noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:audio", stage: "recordWork" }); }
    // «اقرأ التسجيل» ⇒ التفريغ نفسه
    if (gate.op === "transcribe") {
      await say(m, card(lang, [t(lang, "media.transcript", { seconds: Math.round(transcript.seconds) }), markRaw(transcript.text.slice(0, 3500))], "🎙️"));
      return "answered";
    }
    // سؤال عن تسجيل («ايه رأيك في الكلام ده؟»): الإجابة من التفريغ الحقيقي كبيانات غير موثوقة
    if (gate.op === "ask" && String(text || "").trim()) {
      const representation = representationForModel("audio", { transcript: { ...transcript, ok: true } });
      const answer = await answerWithModel({ m, db, text, lang, representation, deps, recordUser });
      await say(m, markRaw(answer || transcript.text));
      return "answered";
    }
    // ملاحظة صوتية بلا نص ⇒ التفريغ هو طلب المستخدم: يكمل مسار النواة كأنه كتبه
    return { reroute: transcript.text, language: transcript.language };
  }

  // ── فيديو ──
  if (info.kind === "video") {
    const media = await safeDownload(info);
    if (!media.ok) { await say(m, card(lang, [t(lang, ["media", media.error].join(".")) || t(lang, "media.failed")], "⚠️")); return "answered"; }
    const deep = gate.op === "transcribe" || /(?:بالتفصيل|كامل|deep|detailed|completo)/i.test(text) || (info.seconds && info.seconds > DEEP_VIDEO_SECONDS);
    const run = async (ctx = null) => {
      const result = await understandVideo(media.buffer, { mode: deep ? "deep" : "quick", question: text, lang, ask: deps.visionAsk || undefined, stt: deps.stt || undefined, onProgress: (pct, note) => ctx?.progress(pct, note) });
      if (!result.ok) return { ok: false, summary: result.error || "video-failed" };
      const representation = representationForModel("video", result);
      const answer = gate.op === "transcribe" && result.transcript.ok
        ? result.transcript.text
        : await answerWithModel({ m, db, text: text || t(lang, "media.videoDefault"), lang, representation, deps, recordUser });
      return { ok: true, text: answer, summary: String(answer || "").slice(0, 300) };
    };
    stepOf(m, "tool", `video.${deep ? "deep" : "quick"}`);
    if (!deep) {
      const out = await run();
      stepOf(m, "verify", out.ok ? "video" : "failed");
      await say(m, out.ok ? markRaw(out.text) : card(lang, [t(lang, "media.failed")], "⚠️"));
      return "answered";
    }
    // Deep في الخلفية: إشعار فوري ثم النتيجة (§31 §49)
    const who = taskOwner(m);
    const task = enqueueTask({ type: "video.understand", title: t(lang, "media.videoTask"), owner: who.owner, scope: who.scope, priority: PRIORITY.P3, persist: true, run: (ctx) => run(ctx) });
    await say(m, card(lang, [t(lang, "tasks.started", { title: t(lang, "media.videoTask") }), t(lang, "tasks.startedHint", { id: task.id })], "✦"));
    task.done.then((out) => m.reply(out.ok ? markRaw(out.text) : card(lang, [t(lang, "media.failed")], "⚠️")), (error) => noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:video", stage: "background" }))
      .catch((error) => noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:video", stage: "reply" }));
    return "answered";
  }

  // ── مستند ──
  if (info.kind === "document") {
    const media = await safeDownload(info);
    if (!media.ok) { await say(m, card(lang, [t(lang, ["media", media.error].join(".")) || t(lang, "media.failed")], "⚠️")); return "answered"; }
    stepOf(m, "tool", "document.extract");
    const doc = await extractDocument(media.buffer, { fileName: info.fileName, mimetype: info.mimetype });
    // PDF ممسوح (صور بلا نص): OCR حقيقي للصفحات في الخلفية — إشعار فوري ثم النتيجة (لا تجميد ولا «لا نص» خاطئ)
    if (!doc.ok && doc.structure?.scanned) {
      stepOf(m, "tool", "document.ocr");
      const who = taskOwner(m);
      const title = doc.fileName;
      const task = enqueueTask({
        type: "document.analyze", title, owner: who.owner, scope: who.scope, priority: PRIORITY.P3, persist: true,
        run: async (ctx) => {
          ctx.progress(5, "ocr");
          const read = await extractDocument(media.buffer, { fileName: info.fileName, mimetype: info.mimetype, ocr: true });
          ctx.throwIfCancelled();
          if (!read.ok) return { ok: false, summary: `ocr:${read.error || "no-text"}` };
          try { recordWork(m, { file: { path: read.fileName, kind: read.kind, chars: read.text.length, ocr: true } }); } catch (error) { noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:document-ocr", stage: "recordWork" }); }
          ctx.progress(70, "answer");
          const question = text || t(lang, "media.docDefault");
          const answer = await answerWithModel({ m, db, text: question, lang, representation: representationForModel("document", read, question), deps, recordUser });
          return { ok: Boolean(answer), text: answer, summary: `ocr ${read.structure?.ocrPages || 0}p ${read.fileName}` };
        },
      });
      await say(m, card(lang, [t(lang, "media.docScanned", { name: title }), t(lang, "tasks.startedHint", { id: task.id })], "📄"));
      task.done.then((out) => m.reply(out.ok ? markRaw(out.text) : card(lang, [t(lang, "media.docEmpty", { name: title })], "📄")), (error) => { if (error?.code !== "TASK_CANCELLED") noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:document-ocr", stage: "background" }); })
        .catch((error) => noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:document-ocr", stage: "reply" }));
      return "answered";
    }
    if (!doc.ok) {
      stepOf(m, "verify", `document:${doc.error}`);
      await say(m, card(lang, [t(lang, doc.error === "unsupported-binary" ? "media.docUnsupported" : "media.docEmpty", { name: doc.fileName })], "📄"));
      return "answered";
    }
    try { recordWork(m, { file: { path: doc.fileName, kind: doc.kind, chars: doc.text.length } }); } catch (error) { noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:document", stage: "recordWork" }); }
    const question = text || t(lang, "media.docDefault");
    const respond = async () => answerWithModel({ m, db, text: question, lang, representation: representationForModel("document", doc, question), deps, recordUser });
    if (doc.text.length <= BIG_DOCUMENT_CHARS) {
      const answer = await respond();
      stepOf(m, "verify", answer ? `document:${doc.kind}` : "empty");
      await say(m, markRaw(answer || t(lang, "media.failed")));
      return "answered";
    }
    const who = taskOwner(m);
    const task = enqueueTask({ type: "document.analyze", title: doc.fileName, owner: who.owner, scope: who.scope, priority: PRIORITY.P3, persist: true, run: async () => ({ text: await respond(), summary: `${doc.kind} ${doc.fileName}` }) });
    await say(m, card(lang, [t(lang, "tasks.started", { title: doc.fileName }), t(lang, "tasks.startedHint", { id: task.id })], "✦"));
    task.done.then((out) => m.reply(markRaw(out.text || t(lang, "media.failed"))), (error) => noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:document", stage: "background" }))
      .catch((error) => noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:document", stage: "reply" }));
    return "answered";
  }
  return null;
}

/** الرد الصوتي (§29): «رد بصوت» · «اقرأهولي» — بعد النص أو لنص مقتبس */
async function sendVoiceReply({ m, sock, text, lang, synthesize = null }) {
  const voice = await textToVoice(text, { lang, synthesize });
  if (!voice.ok) return false;
  await sock.sendMessage(m.chat, { audio: voice.buffer, mimetype: voice.mimetype, ptt: true }, { quoted: m }).catch((error) => noteFailure("ai-media", error, { where: "src/lib/terboo-ai-media.js:sendVoiceReply", stage: "send" }));
  return true;
}

export { MEDIA_INTENTS, runMediaStrategy, sendVoiceReply, visionAvailable };
export default { runMediaStrategy, sendVoiceReply };
