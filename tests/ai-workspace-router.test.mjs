import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initDatabase } from "../src/lib/terboo-database.js";
import {
  addGroupMemory,
  buildGroupMemoryContext,
  createWorkPlan,
  getGroupMemories,
  listDecisions,
  recordDecision,
  removeGroupMemory,
  updateWorkPlan,
} from "../src/lib/terboo-ai-workspace.js";
import { chooseProviderRoute, runRoutedChat } from "../src/lib/terboo-ai-router.js";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const dbRoot = await fs.mkdtemp(path.join(os.tmpdir(), "terboo-ai-workspace-"));
const db = await initDatabase(path.join(dbRoot, "main"));
const chat = "workspace-test@g.us";
const owner = "201142324733@s.whatsapp.net";

const memory = addGroupMemory(db, chat, { content: "نستخدم العربية الفصحى في الشروحات التقنية.", author: owner, label: "أسلوب الرد" });
assert.equal(getGroupMemories(db, chat).length, 1);
assert.match(buildGroupMemoryContext(db, chat), /العربية الفصحى/);
assert.equal(removeGroupMemory(db, chat, memory.id).removed, 1);
assert.equal(getGroupMemories(db, chat).length, 0);

const plan = createWorkPlan(db, chat, { owner, goal: "حلل الخطأ ثم اقترح الإصلاح ثم افحص النتيجة" });
assert.equal(plan.steps.length, 3);
const updated = updateWorkPlan(db, chat, plan.id, 2);
assert.equal(updated.steps[1].status, "done");

recordDecision(db, { type: "اختبار", status: "planned", chat, owner, summary: "خطة تجريبية" });
assert.equal(listDecisions(db, { chat, owner }).length, 1);

const codeRoute = chooseProviderRoute({ text: "حلل خطأ JavaScript في البلوقن" });
assert.equal(codeRoute.task, "code");
// مسار البرمجة: Claude أولاً ثم DeepSeek ثم GeminiAPI ثم GPT
assert.equal(codeRoute.primary, "Claude");
assert.deepEqual(codeRoute.fallbacks, ["DeepSeek", "GeminiAPI", "GPT"]);
const calls = [];
const routed = await runRoutedChat({
  route: codeRoute,
  payload: { message: "test", instruction: "test" },
  providers: {
    Claude: async () => { calls.push("Claude"); throw new Error("غير متاح"); },
    DeepSeek: async () => { calls.push("DeepSeek"); throw new Error("غير متاح"); },
    GeminiAPI: async () => { calls.push("GeminiAPI"); return { text: "حل بديل" }; },
  },
});
assert.equal(routed.provider, "GeminiAPI");
assert.deepEqual(calls, ["Claude", "DeepSeek", "GeminiAPI"], "يجب تجربة المزودين بالترتيب حتى أول نجاح");

// مزود غير مُعرَّف يُتخطّى دون خطأ، والفشل الكامل يرمي رسالة تذكر كل مزود
const skipped = await runRoutedChat({
  route: codeRoute,
  payload: { message: "test" },
  providers: { DeepSeek: async () => ({ text: "رد" }) },
});
assert.equal(skipped.provider, "DeepSeek");
await assert.rejects(
  runRoutedChat({ route: codeRoute, payload: {}, providers: { GPT: async () => ({ text: "" }) } }),
  /GPT: المزود لم يعد نصاً صالحاً/,
);
assert.equal(chooseProviderRoute({ text: "مرحبا كيف حالك" }).primary, "GeminiAPI");
assert.equal(chooseProviderRoute({ hasImage: true }).task, "vision");

await fs.rm(dbRoot, { recursive: true, force: true });
console.log("ai workspace and router tests: passed");
process.exit(0);
