// ═══════════════════════════════════════════════
// ⚡ Terboo Fast Intent Gate (§15 §16 §89 §90 §91)
// ───────────────────────────────────────────────
// «ما الذي يريد المستخدم فعله؟» قبل «ما هو الأمر؟» — بلا أي نداء نموذج.
// إشارات: رابط · نوع الوسائط · وسائط مقتبسة · شكل أمر · إشارة/رد · مجموعة · لغة المالك
//   · لغة الإدارة · متابعة · مهمة نشطة · هدف/أداة سابقة · اللغة واللهجة.
// النتيجة: النية + الثقة + هل هي حتمية (تُنفَّذ بلا نموذج) + المسار fast/deep + الإشارات.
//
// النوايا: CHAT · QUESTION · COMMAND · TOOL · SEARCH · SCRAPER · VISION · AUDIO · VIDEO
//   · DOCUMENT · IMAGE · CREATIVE · MEMORY · AGENT · OWNER · PROJECT · AUTOMATION
//   · TASK_CONTROL · CLARIFICATION · REFUSAL
// ═══════════════════════════════════════════════

import { requestedLanguage } from "./terboo-languages.js";

const INTENTS = ["CHAT", "QUESTION", "COMMAND", "TOOL", "SEARCH", "SCRAPER", "VISION", "AUDIO", "VIDEO", "DOCUMENT", "IMAGE", "CREATIVE", "MEMORY", "AGENT", "OWNER", "PROJECT", "AUTOMATION", "TASK_CONTROL", "CLARIFICATION", "REFUSAL"];

/** تطبيع عربي خفيف للمطابقة */
function norm(text) {
  return String(text || "").toLowerCase()
    .replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/\s+/g, " ").trim();
}

// ── اللغة واللهجة ────────────────────────────────
const ARABIC = /[؀-ۿ]/;
const EGYPTIAN = /(?:^|\s)(?:ازيك|ازاي|عايز|عاوز|عايزه|ده|دي|دول|كده|كدا|ايه|ليه|مش|هات|بتاع|بتاعي|اوي|خالص|يعني|بقي|بقى|زي|حاجه|دلوقتي|امبارح|بكره|كمان|برضه|ياعم|يا عم|نزله|حمله|اقراهولي|ابعتلي|فين|منين|امتي)(?=$|\s|[؟?!.،])/;

function detectLanguage(text) {
  const value = String(text || "");
  if (ARABIC.test(value)) return { language: "ar", dialect: EGYPTIAN.test(norm(value)) ? "egyptian" : "msa" };
  if (/[a-z]/i.test(value)) return { language: "en", dialect: "" };
  return { language: "", dialect: "" };
}

// ── أنماط النوايا (على النص المطبَّع) ──────────────
const P = {
  forbidden: /\b(?:eval|exec|execsync|spawnsync|child_process|rm\s+-rf|shutdown|reboot)\b|(?:اعطني|اطبع|اعرض|هات|ابعت)[^\n]{0,30}(?:مفتاح|مفاتيح|api\s*key|token|باسورد|كلمه المرور|session|creds)|\b(?:show|print|send|dump|leak)\b[^\n]{0,30}\b(?:api[_ ]?key|secret|token|password|credentials|session)\b/i,
  taskStatus: /(?:(?:ايه|ما|شو|وش)\s+)?(?:حاله|وضع)\s+(?:ال)?مهم[هت]?|(?:ال)?مهم[هت]?\s+(?:وصلت|خلصت|وصلت لفين|عملت ايه)|task status|status of (?:the |my )?task|(?:estado|progreso) de (?:la|mi) tarea/i,
  taskCancel: /^(?:(?:وقف|اوقف|الغي|الغ|بطل|ستوب)\s+(?:ال)?(?:مهم[هت]?|تحميل|بحث|شغل|تنصيب|تثبيت|طرد|[اإ]ذاع[هة]|برودكاست|نشر|رفع|بناء|[اإ]رسال|مؤقت|جدول[هة])(?:\s+(?:ال)?(?:جماعي|مجدول|الجماعي|المجدول))?(?:\s+دي|\s+ده)?|stop (?:the |my )?(?:task|download|search|install(?:ation)?|kick(?:ing)?|broadcast|upload|build|deploy(?:ment)?|timer|schedule)|cancel (?:the |my )?(?:task|download|search|install(?:ation)?|kick(?:ing)?|broadcast|upload|build|deploy(?:ment)?|timer|schedule)|(?:det[eé]n|cancela) (?:la |el )?(?:tarea|descarga|b[uú]squeda|instalaci[oó]n|expulsi[oó]n|difusi[oó]n|subida|compilaci[oó]n|programaci[oó]n|temporizador))[\s!.،,؟?]*$/i,
  taskResume: /^(?:كمل|كملي|كملها|كمّلها|استانف|استأنف|استانفها|كمل من حيث وقفت|كمل المهم[هت]|(?:كمل|كملي|استانف|استأنف)\s+(?:ال)?(?:[اإ]ذاع[هة]|برودكاست|نشر|طرد|تنصيب|تثبيت|تحميل|رفع)|resume(?: it| the broadcast| the task)?|continue(?: it| the task| the broadcast)?|contin[uú]a(?:la| la tarea| la difusi[oó]n)?)[\s!.،,؟?]*$/i,
  taskRetry: /^(?:(?:اعد|عيد)\s+المحاول[هت]|اعدها|عيدها|جرب تاني|حاول تاني|retry(?: it)?|try again|reintenta(?:la)?|int[eé]ntalo de nuevo)[\s!.،,؟?]*$/i,
  taskResult: /(?:هات|ارجع\s*ل|وريني|فين)\s+(?:ال)?نتيج[هت]|(?:اخر|آخر)\s+نتيج[هت]|نتيج[هت]\s+(?:ال)?مهم[هت]|(?:show|get|give me) (?:the |my )?(?:last )?result|(?:muestra|dame) (?:el )?(?:[uú]ltimo )?resultado/i,
  taskList: /^(?:مهامي|المهام|ايه المهام|my tasks|list (?:my )?tasks|mis tareas)[\s!.،,؟?]*$/i,
  taskId: /\bTASK-[A-Z0-9]+-[A-Z0-9]{4}\b/i,
  voiceReply: /(?:رد|ردي|جاوب)\s+(?:علي\s+)?(?:ب)?(?:صوت|الصوت|فويس|ريكورد)|اقراهولي|اقرأهولي|اقراه لي|ابعتلي\s+(?:ال)?رد\s+(?:تسجيل|صوت|فويس)|(?:reply|answer|respond) (?:with|in|by) (?:a )?(?:voice|audio)|read it (?:out )?to me|(?:responde|contesta) (?:con|en) (?:voz|audio)|l[eé]emelo/i,
  automation: /^(?:(?:من فضلك|لو سمحت|please)\s+)?(?:فكرني|ذكرني|نبهني|remind me|recu[eé]rdame)(?=[\s،,.!؟?:]|$)|(?:فكرني|ذكرني|نبهني)\s+(?:ب|بعد|بكره|بكرة|كل|الساعه|يوم)|كل\s+(?:يوم|اسبوع|ساعه|شهر)\s+(?:ابعت|لخص|ذكرني)|remind me|every (?:day|week|hour|month)|recu[eé]rdame|cada (?:d[ií]a|semana)/i,
  reminderList: /^(?:تذكيراتي|منبهاتي|(?:وريني|اعرض|هات|ايه)\s+(?:ال)?(?:تذكيرات|منبهات)(?:ي)?|(?:show |list )?my reminders|mis recordatorios)[\s!.،,؟?]*$/i,
  reminderCancel: /^(?:(?:الغي|الغ|امسح|شيل|احذف|بطل|cancel|delete|remove|cancela|borra|elimina)\s+(?:كل\s+|all\s+(?:my\s+)?|todos\s+(?:los\s+|mis\s+)?)?(?:ال)?(?:تذكير(?:ات)?(?:ي)?|منبه(?:ات)?|(?:the\s+|my\s+)?reminders?|(?:el\s+|mi\s+)?recordatorios?))[\s!.،,؟?]*$/i,
  greeting: /^(?:ازيك|ازيك يا [^\s]+|عامل ايه|عاملين ايه|اخبارك|السلام عليكم|سلام|مرحبا|اهلا|هاي|هلا|صباح الخير|مساء الخير|hi|hello|hey|yo|good (?:morning|evening)|hola|buenos d[ií]as|buenas(?: tardes| noches)?)[\s!.،,؟?😊👋❤️]*$/i,
  identity: /(?:انت|إنت)\s+مين|مين\s+(?:انت|إنت)|من\s+انت|عرف(?:ني)?\s+بنفسك|who are you|what are you|qui[eé]n eres|qu[eé] eres/i,
  imageGen: /(?:اعمل|اعملي|ارسم|ارسملي|ولد|ولدلي|صمم|صمملي|انش(?:ئ|يء|ي|ا|اء)(?:لي)?|اصنع|اصنعلي|سوي|سويلي)\s+(?:لي\s+)?(?:صوره|صور|رسمه|لوجو|شعار|بوستر|تصميم|خلفيه)|(?:generate|create|draw|make) (?:me )?(?:an? )?(?:image|picture|drawing|logo)|(?:genera|crea|dibuja) (?:una )?(?:imagen|foto|ilustraci[oó]n)/i,
  imageAsk: /(?:(?:اي|ايه|ايش|شو|وش|ماذا|ما|مين|منو)\s+(?:هو\s+|هي\s+)?(?:الموجود|اللي|الي|يوجد|موجود|المكتوب|ده|دي|دا|هذا|هذه|هاد|هذي|هدا)|(?:اوصف|وصف|صف|اشرح|حلل)(?:لي|ي)?\s*(?:ال)?(?:صوره|صور)|في\s+(?:ال)?صوره|حلل|اوصف|وصف|ايه ده|ايه دي|ايه اللي في|اشرح)\s*(?:ال)?(?:صوره|صورة)?|(?:اقرا|استخرج|طلع)\s+(?:ال)?(?:نص|الكلام|المكتوب)|ocr|(?:describe|analy[sz]e|what(?:'s| is) (?:in|this)|explain) (?:this|the)? ?(?:image|picture|photo|screenshot)?|read the text|(?:describe|analiza|qu[eé] hay en) (?:la|esta)? ?(?:imagen|foto)?/i,
  // سؤال/فحص عن صورة بصياغات التشغيل الحقيقي («افحص الصوره دي تحتوي علي اي» · «فيها ايه» · «ترجم الصوره»)
  imageInspect: /(?:^|\s)(?:افحص|افحصلي|فحص|شوف|شوفلي|بص|بصلي|ركز|دقق|راجع|قيم|قيملي)(?:\s|$)|(?:تحتوي|بتحتوي|يحتوي|بيحتوي|محتوي|فيها|فيه|عليها|مكتوب|المكتوب)\s+(?:علي\s+|على\s+)?(?:اي|ايه|ايش|شو|وش|ماذا|ما)(?=[\s،,.!؟?]|$)|(?:ترجم|ترجملي)\s+(?:ال)?(?:صوره|صور|كلام|نص|مكتوب)|(?:رايك|رأيك)\s+(?:في|ف)\s+(?:ال)?(?:صوره|صور)|\b(?:check|look at|scan|inspect|what does (?:it|this|the (?:image|photo|picture)) (?:contain|say|show))\b|(?:revisa|mira|qu[eé] contiene)/i,
  /** طلب أداة على الصورة (لا سؤال عنها) — يقرّره النموذج */
  imageTool: /ستيكر|استيكر|ملصق|sticker|برومبت|prompt|خلفيه|background|fondo|كرتون|انمي|anime|cartoon|(?:^|\s)hd(?:\s|$)|جوده|وضح|upscale|كبر|صغر|قص|اقلب|لون|فلتر|filter|اعمل(?:ها|لي)?\s|حول(?:ها)?\s|خلي(?:ها)?\s|ابعت(?:ها)?\s|ارسل(?:ها)?\s|نزل(?:ها)?\s|احفظ/i,
  ocr: /(?:اقرا|استخرج|طلع|انسخ)\s+(?:ال)?(?:نص|الكلام|المكتوب)|ocr|read the text|extract (?:the )?text|extrae el texto|lee el texto/i,
  imageEdit: /(?:عدل(?:ها|ه)?(?=[\s،,.!؟?]|$)|شيل|احذف الخلفيه|شيل الخلفيه|وضحها|خليها اوضح|حسن الجوده|كبرها|(?:خليها|حولها|اعملها)\s+(?:ل|الي|إلى)?\s*(?:كرتون|انمي|رسم|ابيض واسود)|upscale|remove (?:the )?background|enhance|make it clearer|edit (?:this |the )?(?:image|photo|picture)|(?:make it|turn it into) (?:a )?(?:cartoon|anime)|quita el fondo|mejora|edita (?:la |esta )?(?:imagen|foto))/i,
  transcribe: /(?:اقرا|فرغ|اكتب|حول)\s+(?:ال)?(?:تسجيل|الريكورد|الفويس|الصوت|الكلام)(?:\s+(?:ل|الي)\s*نص)?|transcri(?:be|pt)|what (?:does|did) (?:he|she|it) say|transcribe|qu[eé] dice/i,
  videoAsk: /(?:ايه اللي حصل|لخص|اوصف|اكتب الكلام|ايه اول حاجه|مين|ايه)\s*(?:في|ف)?\s*(?:ال)?(?:فيديو|مقطع)?|what happened|summari[sz]e (?:the )?video|what(?:'s| is) in (?:the|this) video|qu[eé] pas[oó]|resume el video/i,
  videoEdit: /(?:اقطع|قص)\s+(?:الجزء|من)|استخرج\s+(?:ال)?صوت|حوله\s+mp3|حسن\s+(?:ال)?جوده|extract (?:the )?audio|cut (?:from|the part)|convert (?:it )?to mp3|extrae el audio|corta/i,
  docAsk: /(?:لخص|حلل|اقرا|راجع|ايه في)\s*(?:ال)?(?:ملف|مستند|بي دي اف|pdf)?|summari[sz]e|analy[sz]e|review (?:the |this )?(?:file|document)|resume el (?:archivo|documento)|analiza/i,
  search: /^(?:ابحث|دور|دورلي|فتش|سيرش)\s+(?:عن|علي|على)?\s*\S|^(?:search|look up|find)\s+\S|^(?:busca|buscar)\s+\S/i,
  deepResearch: /(?:اعمل|اعملي)\s+بحث\s+(?:كامل|شامل|مفصل)|بحث\s+(?:كامل|شامل|عميق)\s+عن|deep research|research (?:everything|thoroughly)|investigaci[oó]n completa/i,
  // نهاية كلمة آمنة للعربية (\b في JS لا يعمل بجوار الحروف العربية)
  moderation: /^(?:اطرد|اطردي|طرد|شيل|ارفع|رقي|نزل|اكتم|كتم|انذر|حذر|افتح|اقفل|قفل|غير اسم|غير وصف|منشن|تاج|kick|remove|ban|promote|demote|mute|warn|open|close|expulsa|silencia|promueve)(?=[\s،,.!؟?@]|$)/i,
  code: /```|\b(?:function|const|let|var|def|class|import|return|public static|#include|SELECT|console\.log)\b[^\n]*[({;=]|(?:اكتب|اعمل|صلح|اشرح|ظبط|عدل)(?:لي|ي|ل)?\s+(?:لي\s+)?(?:ال)?(?:كود|سكربت|سكريبت|برنامج|داله|فنكشن)|كود\s+(?:برمجي|بايثون|جافا|جافاسكربت|js|javascript|python|java|php|html|css|sql|c\+\+|c#)|بلغ[هة]\s+(?:js|javascript|typescript|python|java|php|html|css|sql|c\+\+|c#|go|rust|kotlin|swift|بايثون|جافا|جافاسكربت)|\b(?:write|fix|debug|explain) (?:me )?(?:the |this |a |some )?(?:simple )?(?:\w+ )?(?:code|function|script|program)|(?:escribe|corrige|explica) (?:el )?c[oó]digo/i,
  project: /(?:افحص|راجع|دور على|صلح|اصلح)\s+(?:ال)?(?:مشروع|بوت|اخطاء|imports|القائمه|الازرار|scrapers|الذكاء)|ايه اللي بطيء|check the project|fix (?:the )?imports/i,
  followUp: /^(?:(?:لا|لأ)[\s،,]*)?(?:كمل|كملي|هات التاني|التاني|الاول|الثاني|التالت|الثالث|مش ده|مش دي|خليها صوت|خليه صوت|اعمله بنفس الطريقه|(?:اعملها|اعمله|اعيدها|عيدها|عيده)(?:\s+تاني)?|نزله|نزلها|حمله|حملها|حوله mp3|حوله صوت|صغره|كبره|اعكسه|ارجع|جرب تاني|تاني|(?:(?:هات|عايز|اريد)\s+)?(?:ال)?(?:صوت|فيديو|mp3|mp4)(?:\s+(?:بس|فقط|بقي|بقى))?|again|more|the other one|continue|next|(?:just |only )?(?:the )?(?:audio|video)(?: only)?|(?:as|in) (?:audio|mp3)|otra vez|el otro|(?:hazlo|en|solo)(?: en)? (?:audio|video)|hazlo en audio)[\s!.،,؟?]*$/i,
  question: /[؟?]\s*$|^(?:اي|ايش|شو|وش|ماذا|منو|ليه|ازاي|امتي|فين|مين|ايه|كم|هل|لماذا|كيف|متى|اين|ما|why|how|when|where|who|what|which|is|are|can|do|does|por qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|qu[eé]|cu[aá]l)(?=[\s،,.!؟?]|$)/i,
};

const URL = /https?:\/\/[^\s<>"']+/i;

/**
 * يصنّف الرسالة بلا نموذج.
 * @param {{text:string, m?:Object, state?:Object, isOwner?:boolean, hasActiveTask?:boolean}} input
 * @returns {{intent:string, confidence:number, deterministic:boolean, path:"fast"|"deep", needsModel:boolean, signals:Object, language:string, dialect:string, op?:string}}
 */
function classify({ text = "", m = null, state = {}, isOwner = false, hasActiveTask = false } = {}) {
  const raw = String(text || "");
  const value = norm(raw);
  const { language, dialect } = detectLanguage(raw);
  const own = m ? { image: Boolean(m.isImage || m.isSticker), audio: Boolean(m.isAudio), ptt: Boolean(m.ptt || m.message?.audioMessage?.ptt), video: Boolean(m.isVideo), document: Boolean(m.isDocument) } : {};
  const quoted = m?.quoted ? { image: Boolean(m.quoted.isImage || m.quoted.isSticker), audio: Boolean(m.quoted.isAudio), video: Boolean(m.quoted.isVideo), document: Boolean(m.quoted.isDocument), url: URL.test(String(m.quoted.body || m.quoted.text || "")) } : {};
  const signals = {
    url: URL.test(raw), media: Object.entries(own).filter(([, v]) => v).map(([k]) => k), quotedMedia: Object.entries(quoted).filter(([k, v]) => v && k !== "url").map(([k]) => k),
    quotedUrl: Boolean(quoted.url), commandLike: /^[.!#/]\S/.test(raw.trim()), group: Boolean(m?.isGroup), followUp: P.followUp.test(value),
    activeTask: Boolean(hasActiveTask), previousTool: Boolean(state?.lastWork?.tool), previousTarget: Boolean(state?.lastTarget || state?.lastCommand),
    voiceReply: P.voiceReply.test(value), code: P.code.test(raw) || Boolean(requestedLanguage(raw)), taskId: raw.match(P.taskId)?.[0]?.toUpperCase() || "",
  };
  const out = (intent, confidence, deterministic, extra = {}) => ({
    intent, confidence, deterministic,
    path: deterministic || ["CHAT", "QUESTION", "COMMAND", "CLARIFICATION"].includes(intent) ? "fast" : "deep",
    needsModel: !deterministic, signals, language, dialect, ...extra,
  });

  if (P.forbidden.test(raw)) return out("REFUSAL", 1, true);

  // ── التذكيرات: قائمة/إلغاء حتمي (قبل التحكم بالمهام) ──
  if (P.reminderList.test(value)) return out("AUTOMATION", 0.95, true, { op: "list" });
  if (P.reminderCancel.test(value)) return out("AUTOMATION", 0.95, true, { op: /(?:كل|all|todos)\s|تذكيرات|منبهات|reminders|recordatorios/i.test(value) ? "cancel-all" : "cancel" });

  // ── التحكم بالمهام: حتمي ──
  if (P.taskCancel.test(value) || (hasActiveTask && /^(?:وقف|اوقف|الغي|الغ|بطل|stop|cancel|para|cancela)(?:ها|it)?[\s!.،,؟?]*$/i.test(value.replace(/\s+it$/i, "it")))) return out("TASK_CONTROL", 0.97, true, { op: "cancel" });
  if (P.taskStatus.test(value) || (signals.taskId && /حال|status|estado/i.test(value))) return out("TASK_CONTROL", 0.95, true, { op: "status" });
  if (P.taskResult.test(value)) return out("TASK_CONTROL", 0.93, true, { op: "result" });
  if (P.taskRetry.test(value) && (hasActiveTask || state?.lastTask)) return out("TASK_CONTROL", 0.9, true, { op: "retry" });
  // «كمل» وحدها بعد إجابة أحدث من المهمة = إكمال الإجابة؛ «كملها» · «كمل المهمة» = المهمة دائماً
  const bareContinue = /^(?:كمل|كملي|continue|contin[uú]a)[\s!.،,؟?]*$/i.test(value);
  const taskAt = Number(state?.lastTask?.finishedAt || state?.lastTask?.createdAt || 0);
  const answerIsNewer = bareContinue && Number(state?.lastAnswerAt || 0) > taskAt;
  if (P.taskResume.test(value) && !answerIsNewer && (hasActiveTask || state?.lastTask?.resumable)) return out("TASK_CONTROL", 0.9, true, { op: "resume" });
  if (P.taskList.test(value)) return out("TASK_CONTROL", 0.95, true, { op: "list" });

  // ── وسائط الرسالة نفسها أو المقتبسة ──
  // وسيط مرفق بنفس الرسالة ⇒ الطلب عنه دائماً؛ وسيط مقتبس ⇒ فقط إن سأل عنه النص (لا «شكراً» على تسجيل قديم)
  const ownKind = own.video ? "video" : own.document ? "document" : (own.audio || own.ptt) ? "audio" : own.image ? "image" : "";
  const quotedKind = quoted.video ? "video" : quoted.document ? "document" : quoted.audio ? "audio" : quoted.image ? "image" : "";
  const aboutQuoted = Boolean(quotedKind) && (!value || P.question.test(raw.trim()) || P.transcribe.test(value) || P.docAsk.test(value) || P.videoAsk.test(value) || P.imageAsk.test(value) || P.imageInspect.test(value) || P.ocr.test(value) || P.imageEdit.test(value) || P.videoEdit.test(value) || /(?:^|\s)(?:ده|دي|دا|هذا|هذه|هاد|this|that|esto|eso)(?=[\s،,.!؟?]|$)/i.test(value));
  const mediaKind = ownKind || (aboutQuoted ? quotedKind : "");
  if ((own.audio || own.ptt) && !value) return out("AUDIO", 0.95, true, { op: "voice-note" });
  // الصوت لا يُفهم بلا تفريغ: أي طلب عنه يمر على التفريغ الحقيقي أولاً
  if (mediaKind === "audio") {
    const explicit = P.transcribe.test(value) || !value;
    return out("AUDIO", 0.9, explicit || P.question.test(raw.trim()), { op: explicit ? "transcribe" : "ask" });
  }
  if (mediaKind === "video") {
    if (P.videoEdit.test(value)) return out("TOOL", 0.85, false, { op: "video-edit" });
    // طلب صريح/سؤال/بلا نص ⇒ فهم الفيديو أولاً؛ غير ذلك («نفذ المطلوب») يقرّر النموذج (أداة؟) ثم الفهم الحقيقي احتياطاً
    const explicit = !value || P.videoAsk.test(value) || P.transcribe.test(value) || P.question.test(raw.trim());
    return out("VIDEO", 0.85, explicit, { op: P.transcribe.test(value) ? "transcribe" : "understand" });
  }
  // المستند يُقرأ فعلاً قبل أي إجابة عنه (لا إجابة عمياء عن ملف لم يُفتح)
  if (mediaKind === "document") {
    const explicit = P.docAsk.test(value) || !value;
    return out("DOCUMENT", 0.88, explicit || P.question.test(raw.trim()), { op: explicit ? "summarize" : "ask" });
  }
  if (mediaKind === "image") {
    if (P.imageEdit.test(value)) return out("IMAGE", 0.85, false, { op: "edit" });
    if (P.ocr.test(value)) return out("VISION", 0.9, true, { op: "ocr" });
    if (P.imageAsk.test(value) || P.imageInspect.test(value) || !value || P.question.test(raw.trim())) return out("VISION", 0.85, true, { op: "describe" });
    // كلام عن الصورة نفسها بلا طلب أداة ⇒ رؤية حقيقية (لا أداة «صورة لنص» إنجليزية)
    if (!P.imageTool.test(value) && /(?:^|\s)(?:ال)?(?:صوره|صور|الصوره دي|image|photo|picture|imagen|foto)(?=[\s،,.!؟?]|$)/i.test(value)) return out("VISION", 0.8, true, { op: "describe" });
    return out("VISION", 0.7, false, { op: "ask" });
  }

  // ── روابط وأدوات ──
  if (signals.url) return out("SCRAPER", 0.85, false, { op: "url" });
  if (signals.followUp && (signals.previousTool || signals.quotedUrl)) return out("TOOL", 0.85, true, { op: "follow-up" });
  if (P.imageGen.test(value)) return out("CREATIVE", 0.88, false, { op: "image-generate" });
  if (P.deepResearch.test(value)) return out("AGENT", 0.85, false, { op: "research" });
  if (P.search.test(raw.trim())) return out("SEARCH", 0.82, false, { op: "search" });
  if (P.automation.test(value)) return out("AUTOMATION", 0.9, true, { op: "schedule" });

  // ── المالك والمشروع ──
  if (isOwner && P.project.test(value)) return out("PROJECT", 0.85, false, { op: "project" });

  // ── إدارة/أوامر ──
  if (signals.commandLike) return out("COMMAND", 0.95, true);
  if (P.moderation.test(value)) return out("COMMAND", 0.8, false, { op: "moderation" });

  // ── محادثة ──
  if (signals.voiceReply) return out("CHAT", 0.85, false, { op: "voice-reply" });
  if (signals.code) return out("CHAT", 0.75, false, { op: "code" });
  if (P.identity.test(value)) return out("CHAT", 0.95, false, { op: "identity" });
  if (P.greeting.test(value)) return out("CHAT", 0.95, false, { op: "greeting" });
  if (signals.followUp) return out("CLARIFICATION", 0.6, false, { op: "follow-up" });
  if (P.question.test(raw.trim())) return out("QUESTION", 0.7, false);
  return out("CHAT", 0.55, false);
}

export { INTENTS, P as PATTERNS, classify, detectLanguage, norm };
export default { classify, detectLanguage, INTENTS };
