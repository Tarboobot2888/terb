// ═══════════════════════════════════════════════
// 🎲 TERBOO ARCADE — العشوائية من الخادم فقط
// ───────────────────────────────────────────────
// • serverRng: crypto (نرد · خلط · توزيع أدوار) — العميل لا يرسل أي قيمة عشوائية.
// • seeded(seed): مولّد حتمي (mulberry32) لخصم الذكاء (MCTS) والاختبارات:
//   نفس الحالة + نفس البذرة ⇒ نفس الحركة (قابل لإعادة الإنتاج).
// ═══════════════════════════════════════════════

import crypto from "node:crypto";

/** واجهة موحّدة: int(n) ∈ [0,n) · pick(arr) · shuffle(arr) نسخة جديدة · float() ∈ [0,1) */
function wrap(nextFloat, intFn) {
  const int = intFn || ((n) => Math.floor(nextFloat() * n));
  return {
    float: nextFloat,
    int: (n) => (n > 0 ? int(n) : 0),
    pick: (arr) => (arr.length ? arr[int(arr.length)] : undefined),
    shuffle(arr) {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

const serverRng = wrap(
  () => crypto.randomInt(0, 2 ** 32) / 2 ** 32,
  (n) => crypto.randomInt(0, n),
);

/** بذرة رقمية من نص (sessionId مثلاً) */
function seedOf(text) {
  const hash = crypto.createHash("sha256").update(String(text)).digest();
  return hash.readUInt32LE(0);
}

function seeded(seed) {
  let a = (typeof seed === "number" ? seed : seedOf(seed)) >>> 0;
  return wrap(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

/** رمز قصير غير قابل للتخمين (nonce · معرّفات) */
function token(bytes = 6) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export { seedOf, seeded, serverRng, token };
export default serverRng;
