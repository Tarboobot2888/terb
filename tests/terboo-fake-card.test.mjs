import assert from "node:assert/strict";
import sharp from "sharp";
import { fakeCardImage } from "../src/lib/terboo-fake-card.js";

// النص يُهرَّب داخل SVG
const card = (await fakeCardImage({ title: "FREE FIRE", name: "<مالك>" })).toString("utf8");
assert.match(card, /FREE FIRE/);
assert.match(card, /&lt;مالك&gt;/);
assert.doesNotMatch(card, /<مالك>/);

// صورة رمزية صالحة تُدمج كـ PNG داخل البطاقة
// (كان الاختبار يستعمل PNG مضمّناً تالفاً — CRC خاطئ في IDAT — فنولّد صورة صالحة فعلاً)
const pixel = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#f59e0b" } }).png().toBuffer();
const withAvatar = (await fakeCardImage({ title: "DEVELOPER", name: "Bot Terboo", avatarBuffer: pixel })).toString("utf8");
assert.match(withAvatar, /data:image\/png;base64,/);

// صورة تالفة لا تُسقط البطاقة: تُرسم بلا صورة رمزية
const corrupt = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9BwAAAABJRU5ErkJggg==", "base64");
const withCorrupt = (await fakeCardImage({ title: "DEVELOPER", name: "Bot Terboo", avatarBuffer: corrupt })).toString("utf8");
assert.doesNotMatch(withCorrupt, /data:image\/png;base64,/);
assert.match(withCorrupt, /Bot Terboo/);

// الخط المطبّق هو خط الهوية لا خط نظام
assert.match(card, /Noto Sans Arabic/);
assert.doesNotMatch(card, /Arial/);
console.log("local fake card tests: passed");
