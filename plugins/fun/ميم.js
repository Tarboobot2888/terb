import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';
import config from '../../config.js';
import te from '../../src/lib/terboo-error.js';
import { getCanvasFamily, getFontFile, registerFonts } from '../../src/lib/terboo-fonts.js';

const ASSETS_DIR = join(process.cwd(), 'assets', 'meme');
const FONTS_DIR = join(ASSETS_DIR, 'fonts');
const MEME_FONT = getCanvasFamily('en');
const BG_URL = "https://imgflip.com/s/meme/Drake-Hotline-Bling.jpg";

async function download(url) {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    return Buffer.from(res.data);
}

async function prepareAssets() {
    await mkdir(FONTS_DIR, { recursive: true });

    // خط المشروع المشحون (Plus Jakarta Sans) بدل تنزيل خط نظام خارجي
    await registerFonts();
    const shipped = getFontFile('en', 700) || getFontFile('en', 400);
    if (shipped) GlobalFonts.registerFromPath(shipped, MEME_FONT);

    const bgLocal = join(ASSETS_DIR, 'Drake-Hotline-Bling.jpg');
    if (!existsSync(bgLocal)) await writeFile(bgLocal, await download(BG_URL));
    return bgLocal;
}

function drawText(ctx, text, zone, fontSize, fontFamily) {
    ctx.font = `400 ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width > zone.w && cur) { lines.push(cur); cur = w; }
        else cur = t;
    }
    if (cur) lines.push(cur);

    const lh = fontSize * 1.2;
    const startY = zone.y + zone.h / 2 - (lines.length * lh) / 2 + lh / 2;
    lines.forEach((l, i) => ctx.fillText(l, zone.x + zone.w / 2, startY + i * lh));
}

const pluginConfig = {
    name: 'ميم_دريك',
    alias: ['drake'],
    category: 'fun',
    description: 'إنشاء ميم Drake Hotline Bling',
    usage: '.ميم_دريك <نص1> | <نص2>',
    example: '.ميم_دريك Femboy | Tomboy',
    isOwner: false, isPremium: false, isGroup: false, isPrivate: false,
    cooldown: 10, energi: 1, isEnabled: true
};

async function handler(m, { sock }) {
    const input = m.args.join(' ')?.trim();
    if (!input) return m.reply(`🎭 *ميم Drake*\n\n📌 مثال: ${m.prefix}ميم Femboy | Tomboy`);

    const parts = input.split('|');
    const teks1 = (parts[0] || 'Yes').trim();
    const teks2 = (parts[1] || 'No').trim();

    m.react('🎭');

    try {
        const bgLocal = await prepareAssets();
        // القالب مرسوم بإحداثيات 1200؛ المخرج 1080 (نطاق 720–1080) بتحجيم موحّد فلا تتحرك أماكن النص
        const SIZE = 1080;
        const canvas = createCanvas(SIZE, SIZE);
        const ctx = canvas.getContext('2d');
        ctx.scale(SIZE / 1200, SIZE / 1200);

        const bgImg = await loadImage(bgLocal);
        ctx.drawImage(bgImg, 0, 0, 1200, 1200);

        // نص عربي بخط عربي (خط اللاتينية لا يحوي حروفه ⇒ مربعات)
        const fontFor = (text) => (/[\u0600-\u06FF]/.test(text) ? getCanvasFamily('ar') : MEME_FONT);
        drawText(ctx, teks1, { x: 615, y: 22, w: 571, h: 564 }, 110, fontFor(teks1));
        drawText(ctx, teks2, { x: 615, y: 623, w: 571, h: 561 }, 110, fontFor(teks2));

        const buffer = await canvas.encode('jpeg', 90);
        await sock.sendMessage(m.chat, { image: buffer, caption: `🎭 ${teks1} | ${teks2}` }, { quoted: m });
        m.react('✅');
    } catch (error) {
        console.error('Meme Error:', error);
        m.react('❌');
        m.reply(te(m.prefix, m.command, m.pushName));
    }
}

export { pluginConfig as config, handler };