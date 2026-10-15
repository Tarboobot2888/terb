import config from '../../config.js';
import te from '../../src/lib/terboo-error.js';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { getFontStack } from "../../src/lib/terboo-fonts.js";

const pluginConfig = {
  name: 'اقتباس',
  alias: ['quote'],
  category: 'tools',
  description: 'إنشاء صورة اقتباس',
  usage: '.اقتباس <نص>',
  example: '.اقتباس الحياة جميلة',
  isOwner: false, isPremium: false, isGroup: false, isPrivate: false,
  cooldown: 10, energi: 1, isEnabled: true
};

async function createQuote(text, time) {
  // التصميم بإحداثيات 800×400 ويُرسم 1280×640 (×1.6) ⇒ أوضح
  const canvas = createCanvas(1280, 640);
  const ctx = canvas.getContext('2d');
  ctx.scale(1.6, 1.6);
  
  // خلفية
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, 800, 400);
  
  // نص الاقتباس
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 28px ${getFontStack("ar")}`;
  ctx.textAlign = 'center';
  ctx.fillText(text, 400, 180);
  
  // الوقت
  ctx.fillStyle = '#aaaaaa';
  ctx.font = `20px ${getFontStack("ar")}`;
  ctx.fillText(time, 400, 250);
  
  return canvas.toBuffer('image/png');
}

async function handler(m, { sock }) {
  const text = m.args.join(' ')?.trim();

  if (!text) {
    return m.reply(`💬 *اقتباس*\n\n📌 مثال: ${m.prefix}اقتباس الحياة جميلة`);
  }

  m.react('🎨');

  try {
    const time = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const buffer = await createQuote(text, time);

    await sock.sendMessage(m.chat, {
      image: buffer,
      caption: `💬 *${text}*`
    }, { quoted: m });

    m.react('✅');
  } catch (error) {
    console.error('Quote Error:', error);
    m.react('❌');
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

export { pluginConfig as config, handler };