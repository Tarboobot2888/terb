import assert from "node:assert/strict";
import { bratImage, splitLines } from "../src/lib/terboo-brat.js";

// نص أقصر من عرض السطر يبقى سطراً واحداً
assert.deepEqual(splitLines("Terboo sticker", 17), ["Terboo sticker"]);

// نص أطول من عرض السطر يُلفّ على أسطر بلا قطع كلمة
const wrapped = splitLines("Bot Terboo sticker pack", 17);
assert.ok(wrapped.length > 1, "النص الطويل يُلفّ على أكثر من سطر");
assert.ok(wrapped.every((line) => line.length <= 17), "لا يتجاوز أي سطر العرض المحدّد");
assert.equal(wrapped.join(" "), "Bot Terboo sticker pack", "اللفّ لا يفقد أي كلمة");

const svg = bratImage('<script>alert("x")</script>', "green").toString("utf8");
assert.match(svg, /&lt;script&gt;/);
assert.doesNotMatch(svg, /<script>/);
assert.match(svg, /#b7ff00/);
console.log("local brat image tests: passed");
