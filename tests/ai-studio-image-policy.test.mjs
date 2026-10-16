import assert from "node:assert/strict";
import fs from "node:fs/promises";

const studio = await fs.readFile(new URL("../src/lib/terboo-ai-studio.js", import.meta.url), "utf8");
assert.match(studio, /pendingImageGenerations/);
assert.match(studio, /وافق على الصورة/);
assert.match(studio, /حسن هذه الصورة/);
console.log("ai studio image policy tests: passed");
