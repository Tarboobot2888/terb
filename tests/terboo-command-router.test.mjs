// اختبار موجّه الأوامر بكل اللغات (§12 §40)
//
// يثبت أن الطلب الطبيعي يصل إلى الأمر الحقيقي في السجل الحيّ:
//   عربي فصيح · مصري · English · Español · أخطاء إملائية · مرادفات · صيغ أفعال
// ويثبت أن الصلاحيات تُحترم قبل الترشيح (عضو عادي لا يُرشَّح له أمر مشرفين/مالك).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-router-"));
const { initDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const index = await import("../src/lib/terboo-command-index.js");
const { expandQuery, wordVariants } = await import("../src/lib/terboo-ai-intents.js");

const admin = { sender: "201000000001@s.whatsapp.net", chat: "120363000000000001@g.us", isGroup: true, isAdmin: true, isOwner: false, isPremium: false };
const member = { ...admin, isAdmin: false };
const priv = { sender: "201000000001@s.whatsapp.net", chat: "201000000001@s.whatsapp.net", isGroup: false, isAdmin: false, isOwner: false };

/** الاسم الأساسي للأمر الحقيقي (يوحّد المرادفات) */
const canonical = (name) => {
  const plugin = getPlugin(name);
  assert.ok(plugin, `الأمر المتوقّع غير موجود في السجل: ${name}`);
  return Array.isArray(plugin.config.name) ? plugin.config.name[0] : plugin.config.name;
};

const CASES = [
  // [النص، السياق، الأمر المتوقّع، الوصف]
  ["ممكن تطرد الشخص ده؟", admin, "kick", "مصري بصيغة المضارع"],
  ["اطرد العضو", admin, "kick", "فصيح أمر"],
  ["شيله من الجروب", admin, "kick", "مصري بضمير متصل"],
  ["ممكن تشيل الشخص ده من الجروب", admin, "kick", "مصري طويل"],
  ["kick this guy", admin, "kick", "English"],
  ["remove him from the group", admin, "kick", "English وصفي"],
  ["kik him", admin, "kick", "خطأ إملائي"],
  ["expulsa a este usuario", admin, "kick", "Español"],
  ["saca a este del grupo", admin, "kick", "Español عامّي"],
  ["رقي العضو ده مشرف", admin, "promote", "ترقية مصري"],
  ["خليه مشرف", admin, "promote", "ترقية مصري"],
  ["promote him to admin", admin, "promote", "English"],
  ["hazlo administrador", admin, "promote", "Español"],
  ["نزله من الاشراف", admin, "demote", "تنزيل مصري (لا تحميل)"],
  ["demote him", admin, "demote", "English"],
  ["quítale el admin", admin, "demote", "Español بعلامات"],
  ["اقفل الجروب", admin, "شات", "قفل المجموعة"],
  ["close the group", admin, "شات", "English"],
  ["cierra el grupo", admin, "شات", "Español"],
  ["افتح الجروب", admin, "شات", "فتح المجموعة"],
  ["abre el grupo", admin, "شات", "Español"],
  ["اعرض القائمة", priv, "menu", "فصيح"],
  ["ورينى القايمة", priv, "menu", "مصري بإملاء عامّي"],
  ["منيو", priv, "menu", "تعريب"],
  ["mnu", priv, "menu", "خطأ إملائي"],
  ["اوامر", priv, "menu", "مرادف"],
  ["show me the menu", priv, "menu", "English"],
  ["muéstrame el menú", priv, "menu", "Español بعلامات"],
  ["غير لغتي", priv, "لغة", "مصري"],
  ["change my language", priv, "لغة", "English"],
  ["cambia mi idioma", priv, "لغة", "Español"],
  ["بروفايلي", priv, "بروفايل", "ضمير متصل"],
  ["my profile", priv, "بروفايل", "English"],
  ["mi perfil", priv, "بروفايل", "Español"],
  ["سجلني", priv, "daftar", "تسجيل"],
  ["register me", priv, "daftar", "English"],
  ["registrarme", priv, "daftar", "Español"],
  ["بنج", priv, "ping", "تعريب"],
  ["ping", priv, "ping", "اسم مباشر"],
  ["ذاكرتي", priv, "ذاكرة", "ذاكرة"],
  ["اعمل ستيكر", priv, "لملصق", "مصري"],
  ["make a sticker", priv, "لملصق", "English"],
];

const failures = [];
for (const [text, m, expected, label] of CASES) {
  const ranked = index.rank(text, m);
  const top = ranked[0]?.entry?.name || "(لا شيء)";
  if (top !== canonical(expected)) failures.push(`${label}: «${text}» ⇒ ${top} (المتوقع ${canonical(expected)})`);
}
assert.equal(failures.length, 0, `أخطاء توجيه:\n${failures.join("\n")}`);

// الصلاحيات قبل الترشيح: العضو العادي لا يُرشَّح له الطرد أصلاً
{
  const ranked = index.rank("ممكن تطرد الشخص ده؟", member);
  assert.ok(ranked.every(({ entry }) => entry.name !== canonical("kick")), "أمر المشرفين لا يُرشَّح لعضو عادي");
  const inPrivate = index.rank("اطرد العضو", priv);
  assert.ok(inPrivate.every(({ entry }) => entry.name !== canonical("kick")), "أمر المجموعات لا يُرشَّح في الخاص");
}

// الصيغ البديلة للكلمات العربية
{
  assert.ok(wordVariants("تطرد").includes("طرد"));
  assert.ok(wordVariants("شيله").includes("شيل"));
  assert.ok(wordVariants("وطلعه").includes("طلع"));
  assert.deepEqual(wordVariants("kick"), ["kick"], "الكلمات اللاتينية بلا تغيير");
}

// فكّ تعارض النوايا
{
  const demote = expandQuery("نزله من الاشراف");
  assert.ok(demote.intents.includes("demote") && !demote.intents.includes("download"), "تنزيل الرتبة لا يُفهم تحميلاً");
  const quit = expandQuery("quítale el admin");
  assert.ok(quit.intents.includes("demote") && !quit.intents.includes("promote"), "سحب الإشراف لا يُفهم ترقية");
  assert.ok(expandQuery("نزل فيديو يوتيوب").intents.includes("download"), "«نزل فيديو» ما زال تحميلاً");
}

// كل بلوقن جديد يدخل الفهرس تلقائياً (لا قائمة ثابتة)
assert.ok(index.indexStats().commands > 800, "الفهرس يغطّي كل السجل الحيّ");

console.log(`✅ terboo-command-router: ${CASES.length} طلباً بأربع لغات/لهجات · الصلاحيات قبل الترشيح`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
