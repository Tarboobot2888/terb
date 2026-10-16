// أدوات مشتركة للألعاب الشبكية: إحداثيات (a1 · b5) · أرقام عربية/فارسية · تسميات أعمدة
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const COLS = "abcdefghijklmnopqrstuvwxyz";
const KEYCAPS = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

/** يحوّل الأرقام العربية/الفارسية إلى لاتينية ويقص المسافات */
function digits(text) {
  return String(text ?? "")
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .trim();
}

/** «c4» ⇒ {r, c} (الصف 1 أعلى اللوحة) أو null */
function parseCoord(text, rows, cols) {
  const m = digits(text).toLowerCase().match(/^([a-z])\s*-?\s*(\d{1,2})$/) || digits(text).toLowerCase().match(/^(\d{1,2})\s*-?\s*([a-z])$/);
  if (!m) return null;
  const [letter, num] = /\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
  const c = COLS.indexOf(letter);
  const r = Number(num) - 1;
  return r >= 0 && r < rows && c >= 0 && c < cols ? { r, c } : null;
}

const coord = (r, c) => `${COLS[c].toUpperCase()}${r + 1}`;
const colLabels = (n) => [...COLS.slice(0, n).toUpperCase()].map((ch) => ` ${ch}`);
const rowLabels = (n) => Array.from({ length: n }, (_, i) => String(i + 1).padStart(2, " "));
const keycap = (n) => KEYCAPS[n] || String(n);

export { colLabels, coord, digits, keycap, parseCoord, rowLabels };
