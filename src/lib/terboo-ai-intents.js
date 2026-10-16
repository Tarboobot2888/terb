// ═══════════════════════════════════════════════
// 🗣️ قاموس النوايا الدلالي - Bot Terboo
// ───────────────────────────────────────────────
// هذا الملف لا يحتوي أي قائمة أوامر ثابتة.
// وظيفته الوحيدة: توسيع كلمات المستخدم بمرادفات (عربي فصيح، لهجة مصرية،
// English، Español) حتى يجد محرك البحث الأمر الحقيقي داخل سجل البلوقنات.
//
// مثال: "ممكن تشيل الشخص ده" → يضيف: طرد kick remove expulsar
// ثم يبحث المحرك في أسماء وأوصاف الأوامر الفعلية ويختار الموجود منها.
// ═══════════════════════════════════════════════

/**
 * كل مجموعة = نية واحدة.
 * `triggers` كلمات قد يكتبها المستخدم، `expand` كلمات تُضاف للبحث
 * لأنها تظهر عادةً في أسماء/أوصاف الأوامر داخل البوت.
 */
const INTENT_GROUPS = [
  {
    intent: "kick",
    triggers: ["اطرد", "طرد", "تطرد", "يطرد", "شيل", "تشيل", "شيله", "احذف", "امسح العضو", "اخرج", "طلع", "طلعه", "طيره", "برا", "remove", "kick", "kik", "expulsar", "expulsa", "expulsalo", "echar", "echa", "echalo", "sacar", "saca", "sacalo", "banear"],
    expand: ["طرد", "kick", "remove", "expulsar", "عضو", "member"],
  },
  {
    intent: "add",
    triggers: ["ضيف", "اضف", "أضف", "ادخل", "ضمه", "invite", "add", "añadir", "anadir", "agregar", "invitar"],
    expand: ["اضف", "add", "agregar", "invite", "عضو", "رقم"],
  },
  {
    intent: "promote",
    triggers: ["مشرف", "ادمن", "أدمن", "رقي", "رقيه", "ترقية", "خليه مشرف", "خليه ادمن", "promote", "admin", "promover", "hacer admin", "hazlo admin", "hazlo administrador", "administrador", "ascender", "asciende"],
    expand: ["ترقية", "promote", "مشرف", "admin", "ادمن"],
  },
  {
    intent: "demote",
    triggers: ["نزل", "انزل", "نزله", "تنزيل", "شيل الادمن", "شيل الاشراف", "من الاشراف", "الغي الاشراف", "demote", "quitar admin", "quitale admin", "quita admin", "quitar el admin", "quitale el admin", "quita el admin", "remove admin", "remove his admin", "degradar", "degrada"],
    expand: ["خفض", "تنزيل", "demote", "مشرف", "admin"],
  },
  {
    intent: "groupClose",
    triggers: ["اقفل", "اغلق", "قفل", "قفل الجروب", "اقفل الجروب", "اسكت الجروب", "close", "close the group", "mute group", "cerrar", "cierra", "cierra el grupo", "silenciar"],
    expand: ["شات", "قفل", "اغلاق", "close", "group", "جروب", "مجموعة", "cerrar"],
  },
  {
    intent: "groupOpen",
    triggers: ["افتح", "فتح الجروب", "افتح الجروب", "شغل الجروب", "open", "open the group", "unmute", "abrir", "abre", "abre el grupo"],
    expand: ["شات", "فتح", "open", "group", "جروب", "مجموعة", "abrir"],
  },
  {
    intent: "antilink",
    triggers: ["منع الروابط", "امنع اللينكات", "antilink", "block links", "bloquear enlaces"],
    expand: ["antilink", "روابط", "لينك", "link", "حماية", "enlaces"],
  },
  {
    intent: "groupName",
    triggers: ["غير اسم الجروب", "غير الاسم", "بدل اسم المجموعة", "rename group", "cambiar nombre"],
    expand: ["اسم", "name", "group", "جروب", "subject", "nombre"],
  },
  {
    intent: "menu",
    triggers: ["القائمة", "قائمة", "القايمه", "قايمه", "منيو", "المنيو", "الاوامر", "اوامر", "menu", "mnu", "help", "comandos", "ayuda", "lista"],
    expand: ["menu", "قائمة", "اوامر", "help", "comandos"],
  },
  {
    intent: "profile",
    triggers: ["بروفايل", "بروفايلي", "حسابي", "ملفي", "ملفي الشخصي", "معلوماتي", "profile", "my profile", "my account", "perfil", "mi perfil", "mi cuenta"],
    expand: ["بروفايل", "profile", "حساب", "perfil"],
  },
  {
    intent: "sticker",
    triggers: ["ملصق", "استيكر", "ستيكر", "ستكر", "اعمل ملصق", "اعمل ستيكر", "حولها ملصق", "sticker", "pegatina", "stiker"],
    expand: ["ملصق", "sticker", "stiker", "pegatina"],
  },
  {
    intent: "download",
    triggers: ["حمل", "نزل", "تحميل", "هات الفيديو", "download", "descargar", "bajar"],
    expand: ["تحميل", "download", "descargar", "فيديو", "video"],
  },
  {
    intent: "tiktok",
    triggers: ["تيك توك", "تيكتوك", "tiktok", "tik tok"],
    expand: ["tiktok", "تيك", "تحميل", "download"],
  },
  {
    intent: "youtube",
    triggers: ["يوتيوب", "youtube", "yt", "يوتوب"],
    expand: ["youtube", "yt", "يوتيوب", "تحميل", "download"],
  },
  {
    intent: "instagram",
    triggers: ["انستا", "انستجرام", "instagram", "ig", "reels", "ريلز"],
    expand: ["instagram", "انستا", "ريل", "تحميل", "download"],
  },
  {
    intent: "games",
    triggers: ["لعبة", "العاب", "ألعاب", "game", "games", "juego", "juegos"],
    expand: ["game", "لعبة", "العاب", "juego"],
  },
  {
    intent: "rules",
    triggers: ["القوانين", "قوانين", "rules", "normas", "reglas"],
    expand: ["rules", "قوانين", "normas"],
  },
  {
    intent: "owner",
    triggers: ["المطور", "مطور", "صاحب البوت", "owner", "developer", "desarrollador", "creador"],
    expand: ["owner", "مطور", "developer", "desarrollador"],
  },
  {
    intent: "language",
    triggers: ["اللغة", "لغة", "لغتي", "غير اللغة", "غير لغتي", "language", "my language", "change language", "idioma", "mi idioma", "cambiar idioma", "cambia mi idioma"],
    expand: ["لغة", "language", "idioma", "lang"],
  },
  {
    intent: "register",
    triggers: ["تسجيل", "سجلني", "اسجل", "register", "register me", "sign up", "registrar", "registrarme", "registrame", "registro", "inscribirme"],
    expand: ["daftar", "register", "تسجيل", "registro"],
  },
  {
    intent: "image",
    triggers: ["صورة", "صور", "ارسم", "اعمل صورة", "image", "picture", "imagen", "dibujar"],
    expand: ["صورة", "image", "imagen", "توليد"],
  },
  {
    intent: "song",
    triggers: ["اغنية", "أغنية", "موسيقى", "song", "music", "canción", "cancion", "musica"],
    expand: ["اغنية", "song", "music", "musica", "تحميل"],
  },
  {
    intent: "mute",
    triggers: ["اكتم", "كتم", "اسكت", "mute", "silenciar"],
    expand: ["كتم", "mute", "silenciar"],
  },
  {
    intent: "ban",
    triggers: ["احظر", "حظر", "بان", "ban", "bloquear"],
    expand: ["حظر", "ban", "bloquear"],
  },
  {
    intent: "welcome",
    triggers: ["ترحيب", "رسالة الترحيب", "welcome", "bienvenida"],
    expand: ["ترحيب", "welcome", "bienvenida"],
  },
  {
    intent: "ping",
    triggers: ["بنج", "بينج", "بينغ", "بنغ", "ping", "latency", "سرعة البوت", "velocidad"],
    expand: ["بينغ", "ping", "speed"],
  },
  {
    intent: "memory",
    triggers: ["ذاكرتي", "ذاكرة", "memory", "my memory", "memoria", "mi memoria"],
    expand: ["ذاكرة", "memory", "memoria"],
  },
  {
    intent: "translate",
    triggers: ["ترجم", "ترجمة", "translate", "traducir"],
    expand: ["ترجم", "translate", "traducir"],
  },
];

/** تطبيع موحّد مع ملف المساعد */
function normalizeIntentText(value) {
  return String(value || "")
    .toLowerCase()
    // طيّ علامات الحروف اللاتينية: menú ⇒ menu، muéstrame ⇒ muestrame (العربية لا تتأثر)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئء]/g, "ء")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * صيغ بديلة لكلمة عربية (للاستعلام فقط، لا تُضاف للفهرس):
 *   أداة التعريف «ال» · حرف العطف «و/ف» · سابقة المضارع/الأمر «ت/ي/ن/ا»
 *   · ضمائر متصلة «ه/ها/هم/ني/لي/كم/وه/يه»
 * «ممكن تطرد» ⇒ طرد · «شيله» ⇒ شيل · «وطلعه» ⇒ طلع
 */
function wordVariants(word) {
  const out = [word];
  const add = (value) => { if (value && value.length >= 2 && !out.includes(value)) out.push(value); };
  if (!/[\u0600-\u06FF]/.test(word)) return out;
  let base = word;
  if (/^[وف]/.test(base) && base.length >= 4) { base = base.slice(1); add(base); }
  if (base.startsWith("ال") && base.length > 4) { base = base.slice(2); add(base); }
  for (const suffix of ["وها", "وهم", "وه", "يه", "ها", "هم", "ني", "لي", "كم", "ه"]) {
    if (base.endsWith(suffix) && base.length - suffix.length >= 3) { add(base.slice(0, -suffix.length)); break; }
  }
  const stems = [...out];
  for (const form of stems) {
    if (/^[تينا]/.test(form) && form.length >= 4) add(form.slice(1));
  }
  // الأمر ⇄ المصدر بالهمزة: «انشيء/انشئ» ⇒ «انشاء» · «ابدء» ⇒ «ابداء» (اسم الأمر غالباً بالمصدر)
  for (const form of [...out]) {
    if (/يء$/.test(form) && form.length >= 4) add(`${form.slice(0, -2)}اء`);
    else if (/[ئء]$/.test(form) && form.length >= 3 && !/اء$/.test(form)) add(`${form.slice(0, -1)}اء`);
  }
  return out;
}

const PREPARED = INTENT_GROUPS.map((group) => ({
  intent: group.intent,
  triggers: group.triggers.map(normalizeIntentText).filter(Boolean),
  expand: group.expand.map(normalizeIntentText).filter(Boolean),
}));

/**
 * يكتشف النوايا الموجودة في نص المستخدم ويعيد كلمات بحث إضافية.
 * @param {string} text نص المستخدم
 * @returns {{intents: string[], tokens: string[]}}
 */
function expandQuery(text) {
  const normalized = normalizeIntentText(text);
  if (!normalized) return { intents: [], tokens: [] };

  // نسخة بجذوع الكلمات: «البروفايل» ⇒ بروفايل، «تطرد» ⇒ طرد، «شيله» ⇒ شيل
  const stripped = normalized
    .split(" ")
    .map((word) => wordVariants(word).at(-1) || word)
    .join(" ");
  const variantWords = new Set(normalized.split(" ").flatMap((word) => wordVariants(word)));

  const padded = ` ${normalized} `;
  const paddedStripped = ` ${stripped} `;
  const intents = [];
  const tokens = new Set();

  for (const group of PREPARED) {
    const hit = group.triggers.some((trigger) => {
      if (trigger.includes(" ")) {
        return normalized.includes(trigger) || stripped.includes(trigger);
      }
      return padded.includes(` ${trigger} `) || paddedStripped.includes(` ${trigger} `) || variantWords.has(trigger);
    });
    if (!hit) continue;
    intents.push(group.intent);
    for (const token of group.expand) {
      for (const part of token.split(" ")) {
        if (part.length > 1) tokens.add(part);
      }
    }
  }

  // فكّ التعارض: عبارات التنزيل تحوي «admin/مشرف» فتستدعي الترقية أيضاً — التنزيل أدق
  if (intents.includes("demote") && intents.includes("promote")) {
    intents.splice(intents.indexOf("promote"), 1);
    tokens.delete("ترقيه");
    tokens.delete("promote");
  }

  // فكّ التعارض: «نزّله من الإشراف» تنزيل رتبة لا تحميل ملف
  if (intents.includes("demote") && intents.includes("download") && /(?:اشراف|ادمن|مشرف|admin)/.test(normalized)) {
    intents.splice(intents.indexOf("download"), 1);
    const drop = new Set(PREPARED.find((group) => group.intent === "download").expand);
    const keep = new Set(PREPARED.filter((group) => intents.includes(group.intent)).flatMap((group) => group.expand));
    for (const token of drop) if (!keep.has(token)) tokens.delete(token);
  }

  return { intents, tokens: [...tokens] };
}

export { INTENT_GROUPS, expandQuery, normalizeIntentText, wordVariants };
export default { expandQuery, normalizeIntentText, wordVariants };
