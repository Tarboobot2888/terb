/**
 * كلمات أوامر المتجر بالعربية/الإنجليزية/الإسبانية ← الكلمة العربية التي يخزّنها المتجر.
 * البيانات المحفوظة (نوع المنتج "رقمي"/"مادي"، المخزون -1 = غير محدود) لا تتغير.
 */

function fold(word) {
  return String(word || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const FIELD_ALIASES = {
  اسم: ["name", "nombre"],
  سعر: ["price", "precio"],
  سعر_أصلي: ["سعر_اصلي", "original_price", "originalprice", "precio_original"],
  خصم: ["discount", "descuento"],
  مخزون: ["stock", "inventario", "existencias"],
  نوع: ["type", "tipo"],
  وصف: ["description", "desc", "descripcion"],
  تفاصيل: ["details", "detail", "detalles"],
  صورة: ["image", "photo", "imagen", "foto"],
  فيديو: ["video"],
};

const FIELD_LOOKUP = new Map();
for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
  FIELD_LOOKUP.set(fold(canonical), canonical);
  for (const alias of aliases) FIELD_LOOKUP.set(fold(alias), canonical);
}

/** اسم الحقل بأي لغة ← الاسم العربي (أو الكلمة نفسها إن لم تُعرف) */
export function storeField(word) {
  return FIELD_LOOKUP.get(fold(word)) || String(word || "").toLowerCase();
}

const PHYSICAL = new Set(["مادي", "fisik", "physical", "fisico"]);
const DIGITAL = new Set(["رقمي", "digital"]);

/** "مادي" | "رقمي" | null */
export function storeType(word) {
  const key = fold(word);
  if (PHYSICAL.has(key)) return "مادي";
  if (DIGITAL.has(key)) return "رقمي";
  return null;
}

const UNLIMITED = new Set(["غير محدود", "unlimited", "ilimitado", "∞", "♾️"]);

export function isUnlimitedStock(word) {
  return UNLIMITED.has(fold(word));
}
