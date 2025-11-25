const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const mime = require('mime-types');

// ================== CONFIG (EDIT ONLY IF SOMETHING CHANGES) ==================
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

// ================== WHATSAPP CLIENT (STABLE FOR RENDER) ==================
let waReady = false;

const waClient = new Client({
  authStrategy: new LocalAuth({
    clientId: 'telegram-whatsapp-forwarder' // keep session in a fixed folder
  }),
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 0,
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      '--disable-extensions',
      '--disable-infobars',
      '--window-size=1280,720',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--no-zygote'
    ]
  }
});

waClient.on('qr', (qr) => {
  waReady = false;
  console.log('📱 Scan this QR code with WhatsApp:');
  qrcode.generate(qr, { small: true });
});

waClient.on('loading_screen', (percent, message) => {
  console.log(`⏳ WhatsApp loading: ${percent}% - ${message}`);
});

waClient.on('authenticated', () => {
  console.log('🔐 WhatsApp authenticated.');
});

waClient.on('ready', () => {
  waReady = true;
  console.log('✅ WhatsApp Web client connected and ready!');
});

waClient.on('auth_failure', (msg) => {
  waReady = false;
  console.error('❌ WhatsApp auth failure:', msg);
});

waClient.on('disconnected', (reason) => {
  waReady = false;
  console.error('⚠️ WhatsApp disconnected:', reason);
  // Optional: reinitialize on disconnect after some delay
  setTimeout(() => {
    console.log('♻️ Re-initializing WhatsApp client after disconnect...');
    waClient.initialize();
  }, 5000);
});

process.on('unhandledRejection', (reason) => {
  console.error('🚨 Unhandled Promise Rejection:', reason);
});

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
  if (!text || !text.trim()) return;
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

// ================== TELEGRAM HANDLER ==================
async function handleTelegram(msg) {
  const chatId = msg.chat.id.toString();
  const caption = msg.caption || msg.text || '';

  // Only forward from the specific channel
  if (chatId !== TELEGRAM_CHANNEL_ID) {
    return;
  }

  if (!waReady) {
    console.log('ℹ️ WhatsApp not ready yet, skipping message.');
    return;
  }

  try {
    // Pure text message
    if (msg.text && !msg.photo && !msg.video && !msg.document) {
      await sendTextToWhatsApp(caption);
      return;
    }

    // Photo
    if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      const file = await downloadTelegramFile(photo.file_id);
      await sendMediaToWhatsApp(file.mimeType, file.base64, caption);
      return;
    }

    // Video
    if (msg.video) {
      const file = await downloadTelegramFile(msg.video.file_id);
      await sendMediaToWhatsApp(file.mimeType, file.base64, caption);
      return;
    }

    // Document (could be image, video, etc.)
    if (msg.document) {
      const file = await downloadTelegramFile(msg.document.file_id);
      await sendMediaToWhatsApp(file.mimeType, file.base64, caption);
      return;
    }

    console.log('ℹ️ Unsupported Telegram message type, nothing sent.');
  } catch (err) {
    console.error('💥 Error handling Telegram message:', err);
  }
}

bot.on('message', handleTelegram);
bot.on('channel_post', handleTelegram);
