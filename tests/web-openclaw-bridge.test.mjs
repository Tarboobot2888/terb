// جسر OpenClaw: معطَّل افتراضياً وصادق في حالته · Gateway على شبكة خاصة فقط ·
// أسماء الطرق ومعاملاتها من مخططات البروتوكول الرسمية لا من تخمين ·
// منع افتراضي لأدوات Terboo · مفاتيح الجلسة مشتقّة على الخادم ولا تكشف الهوية ·
// لا مفتاح ولا نصّ محادثة في أي رد أو سجل · انقطاع المحرّك ⇒ لا ردّ مُختلق.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const ROOT = process.cwd();
const cfg = await import("../src/web/openclaw/config.js");
const gateway = await import("../src/web/openclaw/gateway-client.js");
const sessions = await import("../src/web/openclaw/session-map.js");
const policy = await import("../src/web/openclaw/tool-policy.js");
const ai = await import("../src/web/services/openclaw-ai-service.js");

const principal = { canonical: "pn:201000000001", isOwner: false, isPremium: false, isBanned: false };

// ── 1. معطَّل افتراضياً، وحالته صادقة بلا ادّعاء اتصال ──────
const base = cfg.openclawConfig();
assert.equal(base.enabled, false, "الجسر معطَّل افتراضياً");
assert.equal(base.protocol, 4, "إصدار البروتوكول الذي تعلنه الحزمة الرسمية");
assert.equal(base.hasToken, false);
const idle = await ai.status();
assert.equal(idle.enabled, false);
assert.equal(idle.status, "disabled");
assert.equal(idle.reason, "disabled");
assert.ok(!("token" in idle) && !("url" in idle), "لا مفتاح ولا عنوان كامل في الحالة المعروضة");

// سؤال المحرّك وهو معطَّل ⇒ فشل صريح لا ردّ مُختلق
const offline = await ai.ask({ principal, text: "مرحبا" });
assert.equal(offline.ok, false);
assert.equal(offline.text, "", "لا نصّ من محرّك معطَّل");
assert.equal(offline.reason, "disabled");

// ── 2. عنوان Gateway: ws/wss على شبكة خاصة فقط ──────────────
for (const good of [
  "ws://127.0.0.1:7777",
  "ws://localhost:7777",
  "wss://10.0.0.5:8443",
  "ws://192.168.1.20:7777",
  "ws://172.16.3.4:7777",
  "ws://openclaw:7777",
  "wss://[::1]:7777",
]) {
  assert.equal(cfg.validateUrl(good).ok, true, `عنوان داخلي صالح رُفض: ${good}`);
}
for (const [bad, reason] of [
  ["", "no-url"],
  ["not a url", "invalid-url"],
  ["http://127.0.0.1:7777", "scheme-must-be-ws-or-wss"],
  ["https://127.0.0.1:7777", "scheme-must-be-ws-or-wss"],
  ["ws://user:pass@127.0.0.1:7777", "credentials-in-url"],
  ["wss://gateway.example.com:443", "gateway-must-stay-on-private-network"],
  ["ws://8.8.8.8:7777", "gateway-must-stay-on-private-network"],
]) {
  const outcome = cfg.validateUrl(bad);
  assert.equal(outcome.ok, false, `عنوان خطر قُبل: ${bad}`);
  assert.equal(outcome.reason, reason, `سبب خاطئ لـ${bad}`);
}
assert.equal(cfg.isInternalHost("169.254.169.254"), false, "عنوان الميتاداتا ليس شبكة خاصة مقبولة");

// ── 3. أسماء الطرق والمعاملات من المخططات الرسمية ───────────
const clientSource = fs.readFileSync(path.join(ROOT, "src/web/openclaw/gateway-client.js"), "utf8");
for (const method of ['"health"', '"agent.run"']) {
  assert.ok(clientSource.includes(method), `طريقة البروتوكول غير مستعملة: ${method}`);
}
// حقول agent.run المطلوبة في AgentParamsSchema
assert.ok(/idempotencyKey/.test(clientSource), "agent.run يرسل idempotencyKey المطلوب");
assert.ok(/deliver: false/.test(clientSource), "التسليم لواتساب يبقى بيد Terboo");
// الكائن مُغلَق ⇒ لا حقول مُختلقة
const sent = clientSource.slice(clientSource.indexOf("const params = {"), clientSource.indexOf("return call(\"agent.run\""));
const KNOWN = new Set(["message", "idempotencyKey", "deliver", "sessionKey", "agentId", "label"]);
for (const field of [...sent.matchAll(/^\s*(?:\.\.\.\([^)]*\?\s*\{\s*)?([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1])) {
  assert.ok(KNOWN.has(field), `حقل غير معروف في agent.run (الكائن مُغلَق): ${field}`);
}

// ── 4. منع افتراضي لأدوات Terboo ────────────────────────────
const open = policy.toolPolicy();
assert.deepEqual(open.allowed, [], "لا أداة معروضة لـOpenClaw افتراضياً");
assert.deepEqual(open.rejected, []);
const denied = policy.mayCallTool(principal, "google");
assert.equal(denied.allowed, false);
assert.equal(denied.reason, "not-exposed", "أداة غير مُدرَجة لا تُنادى");
assert.ok(policy.NEVER_EXPOSE.has("group.members"), "أدوات سياق واتساب لا تُعرَض أبداً");
for (const kind of ["exec", "shell", "file", "ssh"]) {
  assert.ok(policy.BLOCKED_KINDS.has(kind), `نوع تنفيذي غير محجوب: ${kind}`);
}

// ── 5. مفاتيح الجلسة: حتميّة · لا تكشف الهوية · تفصل القنوات ──
const webKey = sessions.sessionKeyFor(principal, { channel: "web", conversationId: "c1" });
const sameKey = sessions.sessionKeyFor(principal, { channel: "web", conversationId: "c1" });
const waKey = sessions.sessionKeyFor(principal, { channel: "whatsapp", conversationId: "c1" });
const otherConversation = sessions.sessionKeyFor(principal, { channel: "web", conversationId: "c2" });
const otherPerson = sessions.sessionKeyFor({ canonical: "pn:201000000002" }, { channel: "web", conversationId: "c1" });
assert.equal(webKey, sameKey, "نفس المدخلات ⇒ نفس المفتاح");
assert.notEqual(webKey, waKey, "القنوات لا تتشارك جلسة");
assert.notEqual(webKey, otherConversation, "المحادثات لا تتشارك جلسة");
assert.notEqual(webKey, otherPerson, "المستخدمون لا يتشاركون جلسة");
assert.ok(webKey.startsWith("terboo:web:"), "بادئة واضحة للجلسة");
assert.ok(!webKey.includes("201000000001"), "المفتاح لا يحمل رقماً");
assert.ok(!webKey.includes("pn:201000000001"), "المفتاح لا يحمل الهوية القانونية");
assert.equal(sessions.sessionKeyFor({}, {}), "", "بلا هوية ⇒ بلا مفتاح");
assert.ok(!sessions.sessionLabelFor({ channel: "web", conversationId: "c1" }).includes("201"), "الوسم بلا رقم");

// ── 6. تعتيم الأخطاء: لا مفتاح في أي نصّ خطأ ────────────────
const masked = gateway.safeError(new Error("connect failed token=abc123secret"));
assert.ok(!masked.includes("abc123secret"), "المفتاح يُعتَّم في نصّ الخطأ");
assert.ok(masked.includes("***"), "التعتيم ظاهر");
assert.ok(gateway.safeError(new Error("x".repeat(500))).length <= 200, "نصّ الخطأ مقصوص");

// ── 7. الحالة الداخلية بلا أسرار ─────────────────────────────
const snap = gateway.snapshot();
assert.deepEqual(Object.keys(snap).sort(), ["connected", "lastError", "sinceMs", "starts", "status"]);
assert.equal(snap.connected, false, "لا ادّعاء اتصال");

// ── 8. استخلاص الردّ: حقول معروفة فقط، ولا نجاح بنصّ فارغ ───
assert.equal(ai.extractText({ text: " مرحبا " }), "مرحبا");
assert.equal(ai.extractText({ message: "hi" }), "hi");
assert.equal(ai.extractText({ messages: [{ text: "a" }, { content: "b" }] }), "b", "آخر رسالة مساعد");
assert.equal(ai.extractText({}), "");
assert.equal(ai.extractText(null), "");
assert.equal(ai.extractText({ unknownField: "x" }), "", "لا يُخترع نصّ من حقل مجهول");

// ── 9. العميل الرسمي مثبّت بنسخة مطابقة لمصدر الـGateway ────
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
assert.equal(pkg.dependencies["@openclaw/gateway-client"], "2026.10.1", "العميل مثبّت بنسخة دقيقة");
assert.equal(pkg.dependencies["@openclaw/gateway-protocol"], "2026.10.1", "البروتوكول مثبّت بنسخة دقيقة");
const official = await import("@openclaw/gateway-client");
assert.equal(typeof official.GatewayClient, "function", "الحزمة الرسمية تُحمَّل على Node الحالي");

// ── 10. لا مفتاح في أي مصدر من الجسر ────────────────────────
for (const rel of [
  "src/web/openclaw/config.js",
  "src/web/openclaw/gateway-client.js",
  "src/web/openclaw/session-map.js",
  "src/web/openclaw/tool-policy.js",
  "src/web/services/openclaw-ai-service.js",
]) {
  const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
  assert.ok(!/logger\.[a-z]+\([^)]*token/i.test(source), `سجل يطبع المفتاح في ${rel}`);
  assert.ok(!/console\.(log|info|warn|error)/.test(source), `طباعة مباشرة في ${rel}`);
}

console.log("✅ web-openclaw-bridge: معطَّل افتراضياً وصادق · Gateway على شبكة خاصة فقط · طرق/معاملات من المخططات الرسمية · منع افتراضي للأدوات · جلسات مشتقّة بلا كشف هوية · تعتيم الأسرار · لا ردّ مُختلق عند الانقطاع");
