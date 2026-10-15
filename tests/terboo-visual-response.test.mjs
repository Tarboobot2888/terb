// ═══════════════════════════════════════════════
// 🧪 Visual Command Eligibility Engine + VisualResponse
// ───────────────────────────────────────────────
// • لا HTML لمجرد الشكل: HTML مؤهل فقط للوحات الألعاب، ويُسلَّم hybrid حتى يُثبت الجسر
// • ألعاب الأسئلة القديمة = buttons · المستذئب/الدنجن/النينجا/ماينكرافت = hybrid · أوامر النص = text
// • validateVisualResponse يرفض الأزرار الميتة وHTML غير المُدقَّق والنص الفارغ
// • deliverVisual: بطاقة موحّدة، والـHTML لا يُرسل إلا بإذن المالك
// • المصفوفة المولّدة حديثة (--check)
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-visual-"));
const { initDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const V = await import("../src/lib/terboo-visual-response.js");

const meta = (c) => V.visualMetadata(c);
assert.equal(meta("اكس_او").mode, "html");
assert.equal(meta("اكس_او").delivered, "hybrid", "HTML يُسلَّم hybrid بلا جسر مُثبت");
assert.ok(meta("اكس_او").htmlEligible);
// ثعبان وسلم صار عقد أركيد ⇒ عرضه html مثل بقية الألعاب الموحّدة
assert.equal(meta("ثعبان_وسلم").mode, "html");
assert.equal(meta("حجرة_ورقة_مقص").mode, "html", "عقد أركيد ⇒ html");
assert.equal(meta("ساحة_المعلومات").mode, "html", "أسئلة الأركيد عرضها html (الأزرار تبقى قناة التحكم)");
// رُحّلت إلى عقد أركيد q_tebakbendera ⇒ Mini App تفاعلية لا بطاقة تلميح/استسلام
assert.equal(meta("خمن_العلم").mode, "html", "لعبة الأسئلة المُرحَّلة صارت Mini App");
for (const legacy of ["مستذئب", "دنجن", "نينجا"]) assert.equal(meta(legacy).mode, "hybrid", legacy);
// نظام Mini Apps أُزيل كلياً (مع إلغاء الموقع) ⇒ لا وضع mini-app ولا بادئة miniapp: بعد اليوم.
assert.ok(!V.VISUAL_MODES.includes("mini-app"), "لا وضع mini-app في الأوضاع المتاحة");
// اسم لعبة غير مسجّل لا يمنح الوضع: المرجع هو السجل لا نص البلوقن
assert.equal(V.visualMetadata("__لا_يوجد__").mode, "text");
const rows = V.visualMatrix();
assert.ok(rows.length > 500, `كل الأوامر الحية: ${rows.length}`);
const htmlRows = rows.filter((r) => r.htmlEligible);
assert.ok(htmlRows.every((r) => r.category === "game"), "HTML مؤهل للألعاب فقط");
assert.ok(rows.filter((r) => r.mode === "text").length > 0, "أوامر نصية تبقى نصاً");

// التحقق
assert.equal(V.validateVisualResponse({ mode: "buttons", cardId: "x", text: "hi", actions: [{ id: "", text: "dead" }] }).ok, false, "زر ميت مرفوض");
assert.equal(V.validateVisualResponse({ mode: "html", cardId: "x", text: "hi", html: "<script>x</script>" }).ok, false, "HTML غير مُدقَّق مرفوض");
assert.equal(V.validateVisualResponse({ mode: "text", cardId: "x", text: "  " }).ok, false, "نص فارغ مرفوض");
assert.equal(V.validateVisualResponse({ mode: "flash", cardId: "x", text: "a" }).ok, false);
assert.equal(V.validateVisualResponse({ mode: "buttons", cardId: "x", text: "ok", actions: [{ id: ".اركيد", text: "🎮" }] }).ok, true);

// التسليم: بطاقة موحّدة + HTML لا يُرسل افتراضياً
const relays = [];
const sock = { user: { id: "201111111111:1@s.whatsapp.net" }, relayMessage: async (chat, msg, opts) => { relays.push(msg); return opts?.messageId || "R"; }, sendMessage: async () => ({ key: { id: "S" } }) };
const m = { chat: "201000000301@s.whatsapp.net", sender: "201000000301@s.whatsapp.net", isGroup: false, key: { id: "K" }, reply: async () => ({}) };
const res = await V.deliverVisual(sock, m, { mode: "html", cardId: "t", text: "board", html: "<div>ok</div>", actions: [{ id: ".اركيد", text: "🎮" }] });
assert.equal(res.html.relayed, false);
assert.equal(res.html.reason, "client-rendering-unproven");
assert.ok(relays.length >= 1 && relays.every((x) => !x.richResponseMessage), "بطاقة تفاعلية فقط، بلا نقل HTML");

// المصفوفة المولّدة حديثة
execFileSync(process.execPath, ["tools/terboo-visual-matrix.mjs", "--check"], { stdio: "pipe" });

console.log(`✅ terboo-visual-response: ${rows.length} أمر · HTML مؤهل ${htmlRows.length} (ألعاب فقط، يُسلَّم hybrid) · تحقق يرفض الميت/غير المُدقَّق · تسليم موحّد · المصفوفة حديثة`);
process.exit(0);
