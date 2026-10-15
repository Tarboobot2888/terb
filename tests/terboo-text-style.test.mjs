import assert from "node:assert/strict";
import { commandGuide, statusPanel } from "../src/lib/terboo-text-style.js";
import { designViolations } from "../src/lib/terboo-design.js";

// اللوحات النصية مبنية على محرّك التصميم: عنوان المحرّك، صفوف «> ◈»، تذييل، بلا backticks ولا زخارف قديمة
const guide = commandGuide({ title: "تحويل النص إلى صوت", command: ".صوت <نص>", example: ".صوت مرحباً" });
assert.match(guide, /^📌 \*تحويل النص إلى صوت\*/);
assert.match(guide, /^> ◈ \*الاستخدام:\* ⁦?\.صوت <نص>⁩?$/m);
assert.match(guide, /^> ◈ \*مثال:\* /m);
assert.match(guide, /_Bot Terboo_/);
assert.deepEqual(designViolations(guide), [], "دليل الأمر بلا backticks ولا زخارف قديمة");
const status = statusPanel({ title: "تم التفعيل", details: ["*النوع:* 🎙️ صوت"] });
assert.match(status, /^> ◈ \*النوع:\* 🎙️ صوت$/m);
assert.deepEqual(designViolations(status), []);
console.log("text style tests: passed");
