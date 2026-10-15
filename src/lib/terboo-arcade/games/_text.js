// تطبيع نصوص الكلمات (عربي/لاتيني) للمقارنة العادلة في ألعاب الكلمات
function normWord(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

const AR_LETTERS = [..."ابتثجحخدذرزسشصضطظعغفقكلمنهويءئؤ"];
const LATIN_LETTERS = [..."abcdefghijklmnopqrstuvwxyz"];
const alphabetOf = (lang) => (lang === "ar" ? AR_LETTERS : LATIN_LETTERS);
const isArabicWord = (w) => /^[ء-ي]+$/.test(w);

export { AR_LETTERS, LATIN_LETTERS, alphabetOf, isArabicWord, normWord };
