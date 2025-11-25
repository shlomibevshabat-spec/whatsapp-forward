const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const mime = require('mime-types');

// ================== CONFIG ==================
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
  res.send('OK — Telegram → WhatsApp forwarder is running (Stable Mode).');
});

app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

// ================== WHATSAPP (ULTRA STABLE MODE) ==================
let waReady = false;

const waClient = new Client({
  authStrategy: new LocalAuth({
    dataPath: './.wadata'
  }),
  restartOnAuthFail: true,
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-infobars',
      '--single-process',
      '--no-zygote',
      '--window-size=1280,720'
    ]
  }
});

let lastQR = null;
let qrShowing = false;

waClient.on('qr', (qr) => {
  if (qr === lastQR) return;
  lastQR = qr;

  if (qrShowing) return;
  qrShowing = true;

  console.log('\n📱 Scan this QR code with WhatsApp (Stable Mode):\n');
  qrcode.generate(qr, { small: true });

  setTimeout(() => (qrShowing = false), 5000);
});

waClient.on('ready', () => {
  waReady = true;
  console.log('✅ WhatsApp is READY! Fully connected.');
});

waClient.on('authenticated', () => {
  console.log('🔐 WhatsApp authenticated.');
});

waClient.on('auth_failure', () => {
  waReady = false;
  console.log('❌ Auth failure — restarting...');
  setTimeout(() => waClient.initialize(), 5000);
});

waClient.on('disconnected', (reason) => {
  waReady = false;
  console.log('⚠️ WhatsApp disconnected:', reason);
  console.log('🔄 Reconnecting in 5 seconds...');
  setTimeout(() => waClient.initialize(), 5000);
});

// Start client
waClient.initialize();

// ================== TELEGRAM BOT ==================
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log('🤖 Telegram bot started.');

// ================== HELPERS ==================
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
  if (!waReady) return console.log("❌ WA not ready, skip.");
  for (const groupId of WHATSAPP_GROUP_IDS) {
    try {
      await waClient.sendMessage(groupId, text);
      console.log(`➡️ Message sent to: ${groupId}`);
    } catch (err) {
      console.error(`❌ Failed to send to ${groupId}:`, err.message);
    }
  }
}

async function sendMediaToWhatsApp(mimeType, base64, caption) {
  if (!waReady) return console.log("❌ WA not ready, skip.");
  const media = new MessageMedia(mimeType, base64);
  for (const groupId of WHATSAPP_GROUP_IDS) {
    try {
      await waClient.sendMessage(groupId, media, { caption });
      console.log(`➡️ Media sent to: ${groupId}`);
    } catch (err) {
      console.error(`❌ Failed to send to ${groupId}:`, err.message);
    }
  }
}

// ================== TELEGRAM HANDLER ==================
async function handleTelegram(msg) {
  const chatId = msg.chat.id.toString();
  const caption = msg.caption || msg.text || '';

  if (chatId !== TELEGRAM_CHANNEL_ID) return;
  if (!waReady) return console.log("ℹ️ WA not ready yet.");

  if (msg.text && !msg.photo && !msg.video && !msg.document) {
    return sendTextToWhatsApp(caption);
  }

  if (msg.photo) {
    const file = await downloadTelegramFile(msg.photo.at(-1).file_id);
    return sendMediaToWhatsApp(file.mimeType, file.base64, caption);
  }

  if (msg.video) {
    const file = await downloadTelegramFile(msg.video.file_id);
    return sendMediaToWhatsApp(file.mimeType, file.base64, caption);
  }

  if (msg.document) {
    const file = await downloadTelegramFile(msg.document.file_id);
    return sendMediaToWhatsApp(file.mimeType, file.base64, caption);
  }
}

bot.on('message', handleTelegram);
bot.on('channel_post', handleTelegram);
