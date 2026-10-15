// ═══════════════════════════════════════════════
// 🔤 وحدات النص — التطبيع المشترك بين المستخرج والمترجم وقت التشغيل
// ───────────────────────────────────────────────
// الوحدة = سطر واحد من نص يراه المستخدم، بعد فصل الزخرفة عن جوهره:
//   "> ❌ *فشل التحميل:* {0}"  →  prefix "> ❌ *" · core "فشل التحميل:* {0}" …
// الجوهر هو مفتاح الكتالوج، والزخرفة تُعاد كما هي حول الترجمة.
// المتغيرات داخل القوالب تصبح {0} {1} … بالترتيب داخل السطر.
// ═══════════════════════════════════════════════

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-zÀ-ÿ]{3,}/;

/** محارف زخرفة تُفصل عن بداية/نهاية السطر (لا تُترجم) */
const EDGE = /^[\s>*_~`•◦·▢□■▪▫◈◆◇❖❋✦✧✧❯›»«‹↳↪→⇒➜➔►▶⤷\-–—|│┃┆┊╭╮╰╯┌┐└┘├┤┬┴┼═─━┄┈╌⟡◉○●◯▰▱▬‍‎‏⁦-⁩️\p{Extended_Pictographic}\p{Emoji_Presentation}]+/u;
const EDGE_END = /[\s*_~`•◦·▢□■▪▫◈◆◇❖❋✦✧❯›»«‹\-–—|│┃╭╮╰╯═─━┄┈╌⟡◉○●◯▰▱▬‍‎‏⁦-⁩️\p{Extended_Pictographic}\p{Emoji_Presentation}]+$/u;

/** ترقيم قائمة في بداية السطر («1 - » · «2. » · «3) ») — زخرفة لا جزء من النص */
const LIST_NUMBER = /^\d{1,3}\s*[-.)]\s+/;

/** يفصل الزخرفة عن الجوهر: {prefix, core, suffix} */
function splitEdges(line) {
  const value = String(line ?? "");
  let head = value.match(EDGE)?.[0] || "";
  let rest = value.slice(head.length);
  const number = rest.match(LIST_NUMBER)?.[0];
  if (number) {
    const more = rest.slice(number.length).match(EDGE)?.[0] || "";
    head += number + more;
    rest = rest.slice(number.length + more.length);
  }
  const tail = rest.match(EDGE_END)?.[0] || "";
  const core = rest.slice(0, rest.length - tail.length);
  return { prefix: head, core, suffix: tail };
}

/** هل الجوهر نص طبيعي يستحق الترجمة؟ */
function isNatural(core) {
  const bare = String(core || "").replace(/\{\d+\}/g, " ");
  if (ARABIC.test(bare)) return (bare.match(/[؀-ۿ]/g) || []).length >= 2;
  const words = bare.match(/[A-Za-zÀ-ÿ]{3,}/g) || [];
  if (words.length < 2 && !(words.length === 1 && /^[A-Za-zÀ-ÿ]{4,}[.!?:]*$/.test(bare.trim()))) return false;
  // شكل كود/مسار/رابط/JSON لا جملة
  if (/=>|function\s*\(|\bconst\b|\blet\b|\breturn\b|\{\s*\}|\(\)\s*=>|;\s*$|^[\w./:-]+$|https?:\/\/|\bundefined\b|\bnull\b|\$\{/.test(bare)) return false;
  return true;
}

/** لغة المصدر: ar · id (إندونيسي) · en */
const INDONESIAN = /(?<![A-Za-z])(yang|dan|tidak|untuk|dengan|sudah|belum|kamu|anda|silakan|silahkan|berhasil|gagal|masukkan|contoh|ketik|sedang|harap|tunggu|bisa|dari|atau|ini|itu|akan|oleh|pada|adalah|karena|jika|kalau|tolong|mohon|gunakan|dikirim|ditemukan|tersedia|pengguna|grup|pesan|gambar|lagu|nama|waktu|hari|jam|menit|detik|koin|saldo|hadiah|selamat|terima|kasih|maaf|salah|benar|jawab|jawaban|soal|pilih|sekarang|kembali|keluar|masuk|buat|hapus|tambah|ganti|ubah|lihat|kirim|ambil|beli|jual)(?![A-Za-z])/gi;

function sourceLanguage(core) {
  if (ARABIC.test(core)) return "ar";
  const hits = String(core).match(INDONESIAN) || [];
  return hits.length >= 1 ? "id" : "en";
}

/** تطبيع المفتاح: مسافات موحّدة */
function normalizeCore(core) {
  return String(core || "").replace(/[⁦-⁩‎‏]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * يحوّل سطر قالب إلى وحدة. المتغيرات تُعاد ترقيمها داخل السطر.
 * @param {string} line سطر فيه {0} {1} …
 * @returns {{prefix:string, core:string, suffix:string, key:string, placeholders:number}|null}
 */
function unitOf(line) {
  const { prefix, core, suffix } = splitEdges(line);
  if (!isNatural(core)) return null;
  let n = 0;
  const map = new Map();
  const renumbered = core.replace(/\{(\d+)\}/g, (_, index) => {
    if (!map.has(index)) map.set(index, n++);
    return `{${map.get(index)}}`;
  });
  const key = normalizeCore(renumbered);
  return key ? { prefix, core: key, suffix, key, placeholders: n } : null;
}

export { ARABIC, EDGE, EDGE_END, isNatural, normalizeCore, sourceLanguage, splitEdges, unitOf };
