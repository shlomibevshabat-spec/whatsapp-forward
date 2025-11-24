const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const mime = require('mime-types');

// ================== FIXED VALUES ==================
const TELEGRAM_BOT_TOKEN = "8226331707:AAFb12NhOoHEDXIrYIvZhEtg63Um7Bg-CmQ";
const TELEGRAM_CHANNEL_ID = "-1001888973840";

const WHATSAPP_GROUP_IDS = [
  "120363042249649319@g.us",
  "120363031058682306@g.us",
  "120363046136542161@g.us",
  "120363042245554211@g.us",
  "120363046679835533@g.us",
  "120363042884732176@g.us",
  "120363024793780358@g.us",
  "120363391155320572@g.us",
  "120363041222191874@g.us",
  "120363024351000992@g.us",
  "120363024504810327@g.us",
  "120363042249649319@g.us"
];

// ================== EXPRESS SERVER ==================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('OK — Telegram → WhatsApp forwarder is running.');
});

app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

// ================== WHATSAPP CLIENT – VERSION THAT WORKED ==================
let waReady = false;

const waClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

waClient.on('qr', (qr) => {
  console.log('📱 Scan this QR code with WhatsApp:');
  qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
  waReady = true;
  console.log('✅ WhatsApp Web client connected!');
});

waClient.on('auth_failure', (msg) => {
  console.error('❌ WhatsApp auth failure:', msg);
});

waClient.on('disconnected', (reason) => {
  waReady = false;
  console.error('⚠️ WhatsApp disconnected:', reason);
});

waClient.initialize();

// ================== TELEGRAM BOT ==================
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log('🤖 Telegram bot started.');


// ================== FUNCTIONS ==================

async function downloadTelegramFile(fileId) {
  const file = await bot.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;

  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const mimeType = mime.lookup(file.file_path) || 'application/octet-stream';

  return {
    base64: Buffer.from(response.data).toString('base64'),
    mimeType
  };
}

async function sendTextToWhatsApp(text) {
  for (const groupId of WHATSAPP_GROUP_IDS) {
    try {
      await waClient.sendMessage(groupId, text);
      console.log(`➡️ Sent text to: ${groupId}`);
    } catch (err) {
      console.error(`❌ Failed to send text to ${groupId}:`, err.message);
    }
  }
}

async function sendMediaToWhatsApp(mimeType, base64, caption) {
  const media = new MessageMedia(mimeType, base64);

  for (const groupId of WHATSAPP_GROUP_IDS) {
    try {
      await waClient.sendMessage(groupId, media, { caption });
      console.log(`➡️ Sent media to: ${groupId}`);
    } catch (err) {
      console.error(`❌ Failed to send media to ${groupId}:`, err.message);
    }
  }
}

async function handleTelegram(msg) {
  const chatId = msg.chat.id.toString();
  const caption = msg.caption || msg.text || '';

  if (chatId !== TELEGRAM_CHANNEL_ID) return;
  if (!waReady) return;

  if (msg.text && !msg.photo && !msg.video && !msg.document) {
    await sendTextToWhatsApp(caption);
    return;
  }

  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    const file = await downloadTelegramFile(photo.file_id);
    await sendMediaToWhatsApp(file.mimeType, file.base64, caption);
    return;
  }

  if (msg.video) {
    const file = await downloadTelegramFile(msg.video.file_id);
    await sendMediaToWhatsApp(file.mimeType, file.base64, caption);
    return;
  }

  if (msg.document) {
    const file = await downloadTelegramFile(msg.document.file_id);
    await sendMediaToWhatsApp(file.mimeType, file.base64, caption);
    return;
  }
}

bot.on('message', handleTelegram);
bot.on('channel_post', handleTelegram);
