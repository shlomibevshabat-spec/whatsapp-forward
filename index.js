const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const mime = require('mime-types');

// ================== ENVIRONMENT VARIABLES ==================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // ID of the Telegram channel (or group) to forward from
const WHATSAPP_GROUP_IDS = (process.env.WHATSAPP_GROUP_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean); // Comma-separated list of WhatsApp group IDs

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID || WHATSAPP_GROUP_IDS.length === 0) {
  console.error('❌ Missing required environment variables: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, WHATSAPP_GROUP_IDS');
  process.exit(1);
}

console.log('✅ Loaded ENV:');
console.log('  TELEGRAM_CHANNEL_ID =', TELEGRAM_CHANNEL_ID);
console.log('  WHATSAPP_GROUP_IDS  =', WHATSAPP_GROUP_IDS.join(', '));

// ================== EXPRESS (HEALTH CHECK) ==================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('OK - Telegram → WhatsApp forwarder is running.');
});

app.listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

// ================== WHATSAPP WEB CLIENT ==================
let waReady = false;

const waClient = new Client({
  authStrategy: new LocalAuth(), // Stores session data on disk
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

waClient.on('qr', (qr) => {
  console.log('📱 Scan this QR code with your WhatsApp (WhatsApp Web):');
  qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
  waReady = true;
  console.log('✅ WhatsApp Web client is ready!');
});

waClient.on('auth_failure', (msg) => {
  console.error('❌ WhatsApp auth failure:', msg);
});

waClient.on('disconnected', (reason) => {
  waReady = false;
  console.error('⚠️ WhatsApp client disconnected:', reason);
});

waClient.initialize();

// ================== TELEGRAM BOT ==================
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log('🤖 Telegram bot started, polling enabled.');

/**
 * Download a file from Telegram and return { base64, mimeType }
 */
async function downloadTelegramFile(fileId) {
  const file = await bot.getFile(fileId);
  const filePath = file.file_path;
  const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

  console.log('⬇️ Downloading Telegram file from:', url);

  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const mimeType = mime.lookup(filePath) || 'application/octet-stream';
  const base64 = Buffer.from(response.data).toString('base64');

  return { base64, mimeType };
}

/**
 * Forward a text message to all configured WhatsApp groups
 */
async function forwardTextToWhatsApp(text) {
  if (!text) return;
  for (const groupId of WHATSAPP_GROUP_IDS) {
    try {
      await waClient.sendMessage(groupId, text);
      console.log(`➡️ Sent text to WhatsApp group: ${groupId}`);
    } catch (err) {
      console.error(`❌ Failed to send text to ${groupId}:`, err.message);
    }
  }
}

/**
 * Forward media (image/video/document) with optional caption to all WhatsApp groups
 */
async function forwardMediaToWhatsApp(mimeType, base64, caption) {
  const media = new MessageMedia(mimeType, base64);
  for (const groupId of WHATSAPP_GROUP_IDS) {
    try {
      await waClient.sendMessage(groupId, media, { caption });
      console.log(`➡️ Sent media to WhatsApp group: ${groupId}`);
    } catch (err) {
      console.error(`❌ Failed to send media to ${groupId}:`, err.message);
    }
  }
}

/**
 * Handle incoming Telegram messages (from private chat / groups / channels)
 * isChannelPost = true when handling channel_post updates.
 */
async function handleTelegramUpdate(msg, isChannelPost = false) {
  try {
    const chatId = msg.chat.id.toString();
    const isSourceChannel = (chatId === TELEGRAM_CHANNEL_ID);
    const text = msg.text || '';

    // ----- Commands (only from private chats, not the source channel) -----
    if (text && text.startsWith('/')) {
      // /listgroups - show WhatsApp group IDs
      if (text === '/listgroups') {
        if (!waReady) {
          await bot.sendMessage(chatId, 'WhatsApp is not ready yet. Please wait a few seconds and try again.');
          return;
        }
        const chats = await waClient.getChats();
        const groups = chats.filter(c => c.isGroup);

        if (!groups.length) {
          await bot.sendMessage(chatId, 'No WhatsApp groups found on this account.');
          return;
        }

        let reply = 'WhatsApp groups on this account:\n\n';
        reply += groups
          .map(g => `${g.name} -> ${g.id._serialized}`)
          .join('\n');

        await bot.sendMessage(chatId, reply);
        return;
      }

      // /debug - show chat id (useful to get TELEGRAM_CHANNEL_ID)
      if (text === '/debug') {
        await bot.sendMessage(chatId, `This chat ID is: ${chatId}`);
        return;
      }

      // /help - simple help
      if (text === '/help') {
        await bot.sendMessage(
          chatId,
          'Commands:\n' +
          '/listgroups - list all WhatsApp groups and their IDs\n' +
          '/debug - show this chat ID\n' +
          'Normal messages from the configured Telegram channel will be forwarded to WhatsApp groups.'
        );
        return;
      }
    }

    // ----- Only forward messages from the configured channel/group -----
    if (!isSourceChannel) {
      return;
    }

    if (!waReady) {
      console.log('⚠️ Received a message from source channel but WhatsApp is not ready yet.');
      return;
    }

    // Caption or text for media
    const caption = msg.caption || msg.text || '';

    // 1) Text-only messages
    if (msg.text && !msg.photo && !msg.video && !msg.document) {
      console.log('📨 Forwarding text from Telegram channel:', caption);
      await forwardTextToWhatsApp(caption);
      return;
    }

    // 2) Photos
    if (msg.photo && msg.photo.length > 0) {
      console.log('📸 Forwarding photo from Telegram channel.');
      // Use the highest resolution photo (last element)
      const photo = msg.photo[msg.photo.length - 1];
      const fileId = photo.file_id;
      const { base64, mimeType } = await downloadTelegramFile(fileId);
      await forwardMediaToWhatsApp(mimeType, base64, caption);
      return;
    }

    // 3) Videos
    if (msg.video) {
      console.log('🎥 Forwarding video from Telegram channel.');
      const fileId = msg.video.file_id;
      const { base64, mimeType } = await downloadTelegramFile(fileId);
      await forwardMediaToWhatsApp(mimeType, base64, caption);
      return;
    }

    // 4) Documents (optional media)
    if (msg.document) {
      console.log('📎 Forwarding document from Telegram channel.');
      const fileId = msg.document.file_id;
      const { base64, mimeType } = await downloadTelegramFile(fileId);
      await forwardMediaToWhatsApp(mimeType, base64, caption);
      return;
    }

    console.log('ℹ️ Message type not handled, ignoring.');
  } catch (err) {
    console.error('❌ Error while handling Telegram update:', err);
  }
}

// Listen for normal messages (private chats / groups)
bot.on('message', async (msg) => {
  await handleTelegramUpdate(msg, false);
});

// Listen for channel posts
bot.on('channel_post', async (msg) => {
  await handleTelegramUpdate(msg, true);
});
