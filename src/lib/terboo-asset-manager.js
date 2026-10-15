import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Memory cache for all local assets
const assetCache = {};

/**
 * Preload all assets into memory at startup.
 * @param {Object} configAssets - botConfig.assets or config.assets object
 */
export function preloadAssets(configAssets) {
  if (!configAssets) return;
  for (const [key, filepath] of Object.entries(configAssets)) {
    try {
      if (typeof filepath === 'string' && !filepath.startsWith('http')) {
        const fullPath = path.resolve(process.cwd(), filepath);
        if (fs.existsSync(fullPath)) {
          assetCache[key] = fs.readFileSync(fullPath);
          console.log(`[AssetManager] 📂 Successfully cached: ${key}`);
        } else {
          console.error(`[AssetManager] ❌ File not found: ${fullPath}`);
        }
      }
    } catch (e) {
      console.error(`[AssetManager] ❌ Failed to load ${key}:`, e.message);
    }
  }
}

/**
 * ترحيل تشغيلي لمرة واحدة من أسماء الأصول القديمة (§33 §34).
 *
 * يغطي حالتين عند الترقية من نسخة قديمة:
 *  1. config.assets ما زال يحمل مفاتيح "maro*" أو "tarboo*" ← تُنسخ إلى مفاتيح "terboo*"
 *     المقابلة في الذاكرة إن لم تكن موجودة (لا يُكتب config.js ولا تُمس أي قيمة API).
 *  2. ملف الأصل الجديد غير موجود على القرص بينما القديم موجود
 *     ← يُعاد تسمية الملف القديم مرة واحدة، فلا تضيع صورة رفعها المالك.
 *
 * @returns {{keys: string[], files: string[]}} ما تم ترحيله فعلاً
 */
export function migrateLegacyAssets(configAssets) {
  const migrated = { keys: [], files: [] };
  if (!configAssets || typeof configAssets !== 'object') return migrated;

  // بادئات الإصدارات السابقة: maro (v1) ثم tarboo (v2)
  const PREVIOUS = /^(maro|tarboo)/i;
  for (const [key, value] of Object.entries({ ...configAssets })) {
    const found = key.match(PREVIOUS);
    if (!found) continue;
    const newKey = `terboo${key.slice(found[0].length)}`;
    if (!(newKey in configAssets)) {
      configAssets[newKey] = typeof value === 'string'
        ? value.replace(/(^|\/)(?:maro|tarboo)(?=[-.\d])/g, '$1terboo')
        : value;
      migrated.keys.push(`${key} → ${newKey}`);
    }
  }

  for (const value of Object.values(configAssets)) {
    if (typeof value !== 'string' || value.startsWith('http')) continue;
    const target = path.resolve(process.cwd(), value);
    if (fs.existsSync(target)) continue;
    const base = path.basename(target);
    if (!/^terboo/.test(base)) continue;
    const legacy = ['tarboo', 'maro']
      .map((prefix) => path.join(path.dirname(target), `${prefix}${base.slice(6)}`))
      .find((candidate) => fs.existsSync(candidate));
    if (!legacy) continue;
    try {
      if (legacy) {
        fs.renameSync(legacy, target);
        migrated.files.push(`${path.relative(process.cwd(), legacy)} → ${path.relative(process.cwd(), target)}`);
      }
    } catch (e) {
      console.error(`[AssetManager] تعذّر ترحيل ${legacy}:`, e.message);
    }
  }

  if (migrated.keys.length || migrated.files.length) {
    console.log(`[AssetManager] ترحيل أصول قديمة: ${migrated.keys.length} مفتاح · ${migrated.files.length} ملف`);
  }
  return migrated;
}

import config from '../../config.js';

/**
 * Get the cached asset buffer by key (e.g. 'terboo', 'terboo2').
 * If not in cache but available in config, loads it synchronously.
 * 
 * @param {string} key - The asset key defined in config.assets
 * @param {Object} [configAssets] - Optional config.assets reference for fallback
 * @returns {Buffer | null} The asset as a Buffer, or null if missing.
 */
export function getAssetBuffer(key, configAssets = null) {
  if (assetCache[key]) {
    return assetCache[key];
  }
  
  const assets = configAssets || config?.assets;
  if (assets && assets[key] && !assets[key].startsWith('http')) {
    try {
      const fullPath = path.resolve(process.cwd(), assets[key]);
      if (fs.existsSync(fullPath)) {
        const buf = fs.readFileSync(fullPath);
        assetCache[key] = buf; 
        return buf;
      }
    } catch (e) {
      console.error(`[AssetManager] Failed to read ${key} from disk:`, e.message);
    }
  }
  
  return null;
}

/**
 * Update an asset buffer in memory and save it to disk (useful for owner commands that change assets).
 * 
 * @param {string} key - Asset key
 * @param {Buffer} buffer - New asset buffer
 * @param {string} filepath - The path where it should be saved
 */
export function updateAssetAndSave(key, buffer, filepath) {
  assetCache[key] = buffer;
  if (filepath && !filepath.startsWith('http')) {
    try {
      const fullPath = path.resolve(process.cwd(), filepath);
      fs.writeFileSync(fullPath, buffer);
    } catch (e) {
      console.error(`[AssetManager] Failed to write updated asset ${key} to disk:`, e.message);
    }
  }
}

/** مجلد صور الأقسام (حزمة الهوية: tools/terboo-brand-assets.mjs) */
const SECTIONS_DIR = path.join('assets', 'image', 'sections');
const sectionCache = new Map();

/** مقاس الصور الأفقية المرسلة كاملة (لافتة القائمة · الأقسام · البطاقات): 720p خفيف وواضح */
export const WIDE_IMAGE = Object.freeze({ width: 1280, height: 720 });

/** حدود صور البوت المصمَّمة: الضلع الأطول ≤ 1280 · الأقصر ≤ 1080 (وما أمكن ≥ 720) */
export const DISPLAY_LIMITS = Object.freeze({ maxLong: 1280, maxShort: 1080, minShort: 720 });

/**
 * يضع صورة مصمَّمة (بطاقة على خلفية خارجية مجهولة المقاس) داخل حدود العرض بوضوح:
 * أكبر من الحد ⇒ تصغير lanczos + توضيح خفيف · أصغر ⇒ تكبير نحو 720 بلا تجاوز الحد · الشفافية تبقى PNG.
 * (للبطاقات التي نرسمها نحن الأفضل الرسم بالمقاس مباشرة؛ هذا للمصادر التي لا نتحكم في مقاسها.)
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
export async function fitDisplayImage(buffer) {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buffer).metadata();
  const long = Math.max(meta.width || 0, meta.height || 0);
  const short = Math.min(meta.width || 0, meta.height || 0);
  if (!long || !short) return buffer;
  const { maxLong, maxShort, minShort } = DISPLAY_LIMITS;
  const cap = Math.min(maxLong / long, maxShort / short);
  const scale = cap < 1 ? cap : Math.max(1, Math.min(minShort / short, cap));
  if (scale === 1) return buffer;
  const img = sharp(buffer).resize(Math.round(meta.width * scale), Math.round(meta.height * scale), { kernel: "lanczos3" }).sharpen({ sigma: 0.5 });
  return meta.hasAlpha ? img.png({ compressionLevel: 9 }).toBuffer() : img.jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

/**
 * صورة قسم القائمة: sections/<القسم>.jpg ⇒ sections/default.jpg ⇒ لافتة القائمة ⇒ صورة البوت.
 * تُقرأ مرة وتُعاد ما لم يتغير الملف على القرص.
 * @param {string} category
 * @returns {{buffer: Buffer, name: string} | null}
 */
export function sectionImage(category) {
  const safe = String(category || '').replace(/[\\/]|\.\./g, '');
  for (const name of [safe, 'default'].filter(Boolean)) {
    const file = path.resolve(process.cwd(), SECTIONS_DIR, `${name}.jpg`);
    // ملف القسم غير موجود ⇒ الاحتياطي التالي
    if (!fs.existsSync(file)) continue;
    try {
      const stat = fs.statSync(file);
      const cached = sectionCache.get(file);
      if (cached && cached.mtimeMs === stat.mtimeMs) return { buffer: cached.buffer, name };
      const buffer = fs.readFileSync(file);
      sectionCache.set(file, { buffer, mtimeMs: stat.mtimeMs });
      return { buffer, name };
    } catch (e) {
      console.error(`[AssetManager] Failed to read section image ${name}:`, e.message);
    }
  }
  const fallback = getAssetBuffer('terboo-banner') || getAssetBuffer('terboo');
  return fallback ? { buffer: fallback, name: 'banner' } : null;
}

// ── صور «الخلط» للردود (assets/image/shuffle) ─────
const SHUFFLE_DIR = path.join('assets', 'image', 'shuffle');
/**
 * بصمات SHA-256 لصور الخلط القديمة: صور أشخاص حقيقيين منقولة من الإنترنت (إحداها بعلامة مائية)
 * استُبدلت بصور الهوية. إن بقيت في نسخة قديمة بعد فك التحديث فوقها، لا تُختار أبداً (ولا تُحذف).
 */
const RETIRED_SHUFFLE = new Set([
  '7c0392f8fff33dd64f76be995ab4f2f014c34db082a9533375c38286f95ddf36',
  '4c2d6a23e5067b3ed6dcdff5bd0e6c2a4d1d3a8291d2067bc186da8bb7405348',
  '74d87607f132902cfe594c04be76f208349ccfff0e5ed134b4214f60360a2426',
  '59b6ef37f0e6bded37ffc32380a6eee90765ef633737deacd3b3958e8ad306f6',
]);
const shuffleCache = new Map();

/** كل صور الخلط الصالحة (صور المالك المضافة بـ .خلط_الصور + صور الهوية) — الملفات المتقاعدة مستبعدة */
export function shuffleImages() {
  const dir = path.resolve(process.cwd(), SHUFFLE_DIR);
  if (!fs.existsSync(dir)) return [];
  const usable = [];
  for (const name of fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f))) {
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      let entry = shuffleCache.get(file);
      if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
        const buffer = fs.readFileSync(file);
        entry = { mtimeMs: stat.mtimeMs, size: stat.size, retired: RETIRED_SHUFFLE.has(crypto.createHash('sha256').update(buffer).digest('hex')) };
        shuffleCache.set(file, entry);
      }
      if (!entry.retired) usable.push(file);
    } catch (e) {
      console.error(`[AssetManager] Failed to read shuffle image ${name}:`, e.message);
    }
  }
  return usable;
}

export { RETIRED_SHUFFLE };

/** صورة خلط عشوائية (Buffer) أو null */
export function randomShuffleImage() {
  const files = shuffleImages();
  return files.length ? fs.readFileSync(files[Math.floor(Math.random() * files.length)]) : null;
}
