// ═══════════════════════════════════════════════
// 🌐 Terboo Localized Arguments — كلمات الأوامر الفرعية بكل اللغات
// ───────────────────────────────────────────────
// كثير من البلوقنات تنتظر كلمة فرعية عربية مثل «تشغيل» أو «حذف» أو «قائمة».
// حين يكتب مستخدم إنجليزي أو إسباني المكافئ (on / delete / lista) تُترجم
// الكلمة إلى العربية قبل وصولها للبلوقن — بشرطين يمنعان أي تغيير خاطئ:
//
//   1. أن يقارن كود البلوقن نفسه بالكلمة العربية (=== أو case أو مصفوفة
//      أو مفتاح كائن أو بديل داخل تعبير نمطي).
//   2. ألّا يقبل البلوقن الكلمة الإنجليزية/الإسبانية أصلاً.
//
// تُفحص أول كلمتين فقط من الوسائط، فالنص الحر (أسماء، رسائل) لا يُمسّ.
// ═══════════════════════════════════════════════

import { noteFailure } from "../terboo-failure-log.js";
import fs from "node:fs";
import path from "node:path";

/** الكلمة العربية المعتمدة (أو بدائلها بالترتيب) ← مرادفاتها بالإنجليزية والإسبانية */
const VOCAB = [
  [["تشغيل", "تفعيل"], ["on", "enable", "activate", "activar", "encender"]],
  [["ايقاف", "إيقاف", "تعطيل"], ["off", "disable", "desactivar", "apagar"]],
  [["طرد"], ["kick", "expulsar"]],
  [["حذف", "مسح"], ["delete", "remove", "del", "borrar", "eliminar"]],
  [["مسح"], ["clear", "limpiar"]],
  [["تحذير"], ["warn", "warning", "advertir", "advertencia"]],
  [["تحذيرات"], ["warnings", "advertencias"]],
  [["طريقة", "وضع"], ["mode", "method", "modo"]],
  [["قائمة"], ["list", "lista"]],
  [["اضافة", "إضافة", "اضف", "أضف"], ["add", "agregar", "anadir"]],
  [["فحص"], ["check", "inspect", "revisar"]],
  [["فئة"], ["category", "categoria"]],
  [["إحصائيات", "احصائيات"], ["stats", "statistics", "estadisticas"]],
  [["مساعدة"], ["help", "ayuda"]],
  [["كامل"], ["full", "completo"]],
  [["قالب"], ["template", "plantilla"]],
  [["تفاصيل"], ["details", "detail", "detalles"]],
  [["نعم"], ["yes", "si"]],
  [["لا"], ["no"]],
  [["يومي", "مكرر"], ["daily", "diario", "repeat", "repetir"]],
  [["تصفير", "اعادة_تعيين"], ["reset", "reiniciar"]],
  [["الكل", "كل", "الجميع"], ["all", "todos", "todo", "everyone"]],
  [["مجموعات", "المجموعات"], ["groups", "grupos"]],
  [["خاص", "الخاص"], ["private", "privado"]],
  [["منشن"], ["mention", "mencion"]],
  [["إنهاء", "انهاء"], ["finish", "end", "done", "terminar"]],
  [["قبول"], ["accept", "approve", "aceptar", "aprobar"]],
  [["رفض"], ["reject", "decline", "rechazar"]],
  [["فتح"], ["open", "unlock", "abrir"]],
  [["قفل", "اغلاق", "إغلاق"], ["close", "lock", "cerrar"]],
  [["انشاء", "إنشاء"], ["create", "crear"]],
  [["انضمام"], ["join", "unirse"]],
  [["بدء"], ["start", "iniciar"]],
  [["خروج", "مغادرة"], ["leave", "exit", "salir"]],
  [["تأكيد", "تاكيد"], ["confirm", "confirmar"]],
  [["الغاء", "إلغاء"], ["cancel", "cancelar"]],
  [["معلومات"], ["info", "informacion"]],
  [["حالة"], ["status", "estado"]],
  [["ضبط", "تعيين"], ["set", "establecer"]],
  [["حد"], ["limit", "limite"]],
  [["اعضاء", "الاعضاء", "أعضاء"], ["members", "miembros"]],
  [["تبرع"], ["donate", "donar"]],
  [["التقاط"], ["take", "pick", "tomar"]],
  [["مشرفين", "المشرفين"], ["admins", "administradores"]],
  [["صورة"], ["image", "imagen"]],
  [["تجربة"], ["test", "prueba"]],
  [["اقرأ", "قراءة"], ["read", "leer"]],
  [["فصول"], ["chapters", "capitulos"]],
  [["تحميل"], ["download", "descargar"]],
  [["بحث"], ["search", "buscar"]],
  [["تصويت"], ["vote", "votar"]],
  [["لاعبين"], ["players", "jugadores"]],
  [["عرض"], ["show", "view", "ver", "mostrar"]],
  [["تعديل"], ["edit", "editar"]],
  [["شراء"], ["buy", "comprar"]],
  [["بيع"], ["sell", "vender"]],
  // "عرض" بمعنى عرض سلعة للبيع (السوق) — يُستعمل فقط إن لم يقارن البلوقن بكلمة "بيع"
  [["رسائل"], ["messages", "inbox", "mensajes", "bandeja"]],
  [["عرض"], ["sell", "vender"]],
];


/**
 * أسماء عناصر RPG بالإنجليزية والإسبانية ← مفتاح العنصر العربي في بيانات اللعبة.
 * تُطبَّق بالشروط نفسها: البلوقن يعرّف المفتاح العربي فعلاً ولا يقبل الاسم الأجنبي.
 */
const ITEM_VOCAB = [
  [["سمكة"], ["fish", "pez"]],
  [["سيف"], ["sword", "espada"]],
  [["درع"], ["shield", "armor", "escudo", "armadura"]],
  [["معول"], ["pickaxe", "pico"]],
  [["جرعة_مانا"], ["mana_potion", "manapotion", "pocion_mana"]],
  [["عشبة"], ["herb", "hierba"]],
  [["جرعة"], ["potion", "pocion"]],
  [["خبز"], ["bread", "pan"]],
  [["درع_جسم"], ["body_armor", "armadura_cuerpo"]],
  [["خوذة"], ["helmet", "casco"]],
  [["قوس"], ["bow", "arco"]],
  [["سيف_ذهبي"], ["golden_sword", "espada_dorada"]],
  [["درع_ماسي"], ["diamond_armor", "armadura_diamante"]],
  [["جرعة_طاقة"], ["energy_potion", "pocion_energia"]],
  [["ترياق"], ["antidote", "antidoto"]],
  [["جزر"], ["carrot", "zanahoria"]],
  [["بطاطس"], ["potato", "papa", "patata"]],
  [["فراولة"], ["strawberry", "fresa"]],
  [["بطيخ"], ["watermelon", "sandia"]],
  [["شريحة_لحم"], ["steak", "filete"]],
  [["قط"], ["cat", "gato"]],
  [["كلب"], ["dog", "perro"]],
  [["طائر"], ["bird", "pajaro"]],
  [["أرنب"], ["rabbit", "conejo"]],
  [["صنارة"], ["fishing_rod", "rod", "cana"]],
  [["حديد"], ["iron", "hierro"]],
  [["جلد"], ["leather", "cuero"]],
  [["ذهب"], ["gold", "oro"]],
  [["ماس"], ["diamond", "diamante"]],
  [["لحم"], ["meat", "carne"]],
  [["صندوق_غامض"], ["mystery_box", "caja_misteriosa"]],
  [["فأس"], ["axe", "hacha"]],
  [["سهم"], ["arrow", "flecha"]],
  [["جرعة_صحة"], ["health_potion", "pocion_vida"]],
  [["جرعة_قوة"], ["strength_potion", "pocion_fuerza"]],
  [["جرعة_دفاع"], ["defense_potion", "pocion_defensa"]],
  [["جرعة_حظ"], ["luck_potion", "pocion_suerte"]],
  [["جرعة_خبرة"], ["xp_potion", "pocion_xp"]],
  [["إكسير"], ["elixir"]],
  [["طماطم"], ["tomato", "tomate"]],
  [["ذرة"], ["corn", "maiz"]],
  [["قرع"], ["pumpkin", "calabaza"]],
  [["شوربة_سمك"], ["fish_soup", "sopa_pescado"]],
  [["لحم_مشوي"], ["grilled_meat", "carne_asada"]],
  [["فطيرة_تفاح"], ["apple_pie", "pastel_manzana"]],
  [["غابة"], ["forest", "bosque"]],
  [["كهف"], ["cave", "cueva"]],
  [["بركان"], ["volcano", "volcan"]],
  [["محيط"], ["ocean", "oceano"]],
  [["أطلال"], ["ruins", "ruinas"]],
  [["مشروب_طاقة"], ["energy_drink", "bebida_energetica"]],
  [["خشب"], ["wood", "madera"]],
  [["وتر"], ["string", "cuerda"]],
  [["أسد"], ["lion", "leon"]],
  [["ذئب"], ["wolf", "lobo"]],
  [["فينيكس"], ["phoenix", "fenix"]],
  [["تنين"], ["dragon"]],
  [["أرنب_رعدي"], ["thunder_rabbit", "conejo_trueno"]],
  [["فاكهة"], ["fruit", "fruta"]],
  [["طعام_مميز"], ["special_food", "comida_especial"]],
  [["صندوق_عادي"], ["common_box", "caja_comun"]],
  [["صندوق_نادر"], ["rare_box", "caja_rara"]],
  [["صندوق_أسطوري"], ["legendary_box", "caja_legendaria"]],
  [["صندوق_خرافي"], ["mythic_box", "caja_mitica"]],
  [["قمح"], ["wheat", "trigo"]],
  [["أرز"], ["rice", "arroz"]],
  [["بيض"], ["egg", "eggs", "huevo", "huevos"]],
  [["تفاح"], ["apple", "manzana"]],
  [["حجر"], ["stone", "piedra"]],
  [["فحم"], ["coal", "carbon"]],
  [["زمرد"], ["emerald", "esmeralda"]],
  [["نفايات"], ["trash", "basura"]],
  [["جمبري"], ["shrimp", "camaron"]],
  [["أخطبوط"], ["octopus", "pulpo"]],
  [["قرش"], ["shark", "tiburon"]],
  [["حوت"], ["whale", "ballena"]],
  [["كوناي"], ["kunai"]],
  [["شوريكين"], ["shuriken"]],
  [["تشاكرا"], ["chakra"]],
  [["مخطوطة"], ["scroll", "pergamino"]],
  [["رامن"], ["ramen"]],
  [["صندوق_خشبي"], ["wooden_box", "caja_madera"]],
  [["صندوق_حديدي"], ["iron_box", "caja_hierro"]],
  [["صندوق_ذهبي"], ["golden_box", "caja_dorada"]],
  [["صندوق_ماسي"], ["diamond_box", "caja_diamante"]],
  [["أرز_مقلي"], ["fried_rice", "arroz_frito"]],
  [["شوربة"], ["soup", "sopa"]],
  [["سوشي"], ["sushi"]],
  [["كعكة"], ["cake", "pastel"]],
  [["بيتزا"], ["pizza"]],
  [["عصير"], ["juice", "jugo", "zumo"]],
  [["طعام_سحري"], ["magic_food", "comida_magica"]],
  [["حمم"], ["lava"]],
  [["حراشف_تنين"], ["dragon_scales", "escamas_dragon"]],
  [["قلب_عملاق"], ["giant_heart", "corazon_gigante"]],
  [["لؤلؤة"], ["pearl", "perla"]],
  [["جوهرة_بحرية"], ["sea_gem", "gema_marina"]],
  [["عملة_قديمة"], ["old_coin", "moneda_antigua"]],
  [["تحفة"], ["artifact", "artefacto"]],
  [["جوهرة"], ["gem", "gema"]],
  [["فطر"], ["mushroom", "hongo", "seta"]],
  [["مال"], ["money", "dinero"]],
  [["هجوم"], ["attack", "ataque"]],
  [["دفاع"], ["defense", "defence", "defensa"]],
  [["صحة"], ["health", "hp", "salud"]],
  [["سرعة"], ["speed", "velocidad"]],
  [["حظ"], ["luck", "suerte"]],
  [["استلام"], ["claim", "collect", "reclamar"]],
  [["إيداع", "ايداع"], ["deposit", "depositar"]],
  [["سحب"], ["withdraw", "retirar"]],
  [["زرع"], ["plant", "plantar"]],
  [["حصاد"], ["harvest", "cosechar"]],
  [["إطعام", "اطعام"], ["feed", "alimentar"]],
  [["تدريب"], ["train", "entrenar"]],
  [["تسمية"], ["rename", "renombrar"]],
  [["تطور"], ["evolve", "evolucionar"]],
  [["تعبئة"], ["refill", "recargar"]],
  [["رأس"], ["head", "heads", "cara"]],
  [["ذيل"], ["tail", "tails", "cruz"]],
];

/** طيّ الحروف: حروف صغيرة وبلا علامات تشكيل لاتينية (información ← informacion) */
function fold(word) {
  return String(word || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const ALIAS_TO_CANONICAL = new Map();
for (const [canonicals, aliases] of [...VOCAB, ...ITEM_VOCAB]) {
  for (const alias of aliases) {
    const list = ALIAS_TO_CANONICAL.get(alias) || [];
    list.push(...canonicals);
    ALIAS_TO_CANONICAL.set(alias, list);
  }
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * هل يقارن الكود بهذه الكلمة فعلاً؟ (وليس مجرد ذكرها داخل رسالة)
 * === 'x' · 'x' === · case 'x' · ['x', ...] · x: (مفتاح كائن) · (x| أو |x) داخل تعبير نمطي
 */
function comparedInSource(source, word, { dataKeys = true } = {}) {
  const w = escapeRe(word);
  const q = `(['"\`])${w}\\1`;
  const patterns = [
    new RegExp(`[=!]==?\\s*${q}`, "i"),
    new RegExp(`${q}\\s*[=!]==?`, "i"),
    new RegExp(`case\\s*${q}`, "i"),
    // input.startsWith('رسائل')
    new RegExp(`\\.startsWith\\(\\s*${q}`, "i"),
    new RegExp(`[\\[,]\\s*${q}\\s*(?=[,\\]])`, "i"),
    // مفتاح في خريطة أوامر: { انشاء: async () => … } — ومع الكلمات العربية أيضاً { طرد: 'kick' }
    new RegExp(`(?:^|[{,\\s])(['"]?)${w}\\1\\s*:\\s*(?:async|\\(|function${dataKeys ? "|\\[|['\"\`{]" : ""})`, "im"),
    new RegExp(`(?:[(|]|\\(\\?:)${w}(?=[|)])`, "i"),
  ];
  return patterns.some((re) => re.test(source));
}

const sourceCache = new Map();
function readCached(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const cached = sourceCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.source;
    const source = fs.readFileSync(filePath, "utf8");
    sourceCache.set(filePath, { mtimeMs: stat.mtimeMs, source });
    return source;
  } catch (error) { noteFailure("args", error, {where: "src/lib/terboo-i18n/args.js:256",stage: "fs.statSync"}); return ""; }
}

/**
 * نص البلوقن مع مكتبات terboo المحلية التي يستوردها مباشرة (مستوى واحد):
 * بعض البلوقنات تفوّض المقارنة لمكتبة مشتركة مثل terboo-link-guard.
 */
function pluginSource(filePath) {
  if (!filePath) return "";
  const own = readCached(filePath);
  if (!own) return "";
  const dir = path.dirname(filePath);
  const imported = [...own.matchAll(/from\s+["'](\.{1,2}\/[^"']*terboo-[^"']+\.js)["']/g)]
    .map((match) => readCached(path.resolve(dir, match[1])))
    .filter(Boolean);
  return [own, ...imported].join("\n");
}

/**
 * يعيد الكلمة العربية المناسبة لهذا البلوقن، أو null إن لم يلزم أي تغيير.
 * @param {string} word كلمة المستخدم كما كتبها
 * @param {string} source نص ملف البلوقن
 */
function canonicalArg(word, source) {
  const key = fold(word);
  const candidates = ALIAS_TO_CANONICAL.get(key);
  if (!candidates || !source) return null;
  // الكلمة الأجنبية مقبولة أصلاً؟ (مفاتيح البيانات مثل { all: 'الجميع' } لا تُعدّ قبولاً)
  if (comparedInSource(source, key, { dataKeys: false }) || comparedInSource(source, String(word).toLowerCase(), { dataKeys: false })) return null;
  return candidates.find((canonical) => comparedInSource(source, canonical)) || null;
}

/** يستبدل أول `count` كلمات من نص مع الحفاظ على المسافات الأصلية */
function replaceLeadingWords(text, replacements) {
  if (!text || !replacements.size) return text;
  const parts = String(text).split(/(\s+)/);
  let wordIndex = 0;
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i] || /^\s+$/.test(parts[i])) continue;
    if (replacements.has(wordIndex)) parts[i] = replacements.get(wordIndex);
    wordIndex++;
    if (wordIndex > 2) break;
  }
  return parts.join("");
}

/**
 * يترجم الكلمات الفرعية في m.args / m.text / m.fullArgs / m.body لبلوقن معيّن.
 * @returns {Array<{index:number, from:string, to:string}>} التغييرات المطبّقة
 */
function localizeCommandArgs(m, plugin, { positions = 2 } = {}) {
  const args = Array.isArray(m?.args) ? m.args : [];
  if (!args.length) return [];
  const source = pluginSource(plugin?.filePath);
  if (!source) return [];

  const replacements = new Map();
  const changes = [];
  // وحدات الوقت: 5m / 2h / 1d ← 5د / 2س / 1ي حين يفهم البلوقن الوحدات العربية فقط
  const arabicUnits = /د\|س\|ي/.test(source) && !/\(m\|h\|d\)|\[mhd\]/i.test(source);
  for (let i = 0; i < Math.min(positions, args.length); i++) {
    const unit = arabicUnits && String(args[i]).match(/^(\d+)(m|min|h|d)$/i);
    if (unit) {
      const to = `${unit[1]}${{ m: "د", min: "د", h: "س", d: "ي" }[unit[2].toLowerCase()]}`;
      replacements.set(i, to);
      changes.push({ index: i, from: args[i], to });
      continue;
    }
    const to = canonicalArg(args[i], source);
    if (to) {
      replacements.set(i, to);
      changes.push({ index: i, from: args[i], to });
    }
  }
  if (!changes.length) return [];

  for (const { index, to } of changes) args[index] = to;
  m.args = args;
  if (typeof m.text === "string") m.text = replaceLeadingWords(m.text, replacements);
  if (typeof m.fullArgs === "string") m.fullArgs = replaceLeadingWords(m.fullArgs, replacements);
  if (typeof m.body === "string" && m.command) {
    const head = `${m.prefix || ""}${m.command}`;
    const index = m.body.toLowerCase().indexOf(head.toLowerCase());
    if (index === 0) m.body = head + replaceLeadingWords(m.body.slice(head.length), shiftForBody(m.body.slice(head.length), replacements));
  }
  return changes;
}

/** نص الجسم بعد الأمر يبدأ بمسافة؛ الفهارس نفسها لأن الفواصل تُتجاهل */
function shiftForBody(_text, replacements) {
  return replacements;
}

export { canonicalArg, comparedInSource, fold, ITEM_VOCAB, localizeCommandArgs, VOCAB };
export default { localizeCommandArgs };
