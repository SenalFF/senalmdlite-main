'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const P = require('pino');
const express = require('express');
const path = require('path');
const { File } = require('megajs');

const config = require('./config');
const { sms } = require('./lib/msg');
const { getGroupAdmins } = require('./lib/functions');
const { commands, replyHandlers } = require('./command');

// ================== CONFIG ==================
const ownerNumber = ['94769872326'];
const MASTER_SUDO = ['94769872326'];
const prefix = config.PREFIX || '.';

const app = express();
const port = process.env.PORT || 8000;
const credsPath = path.join(__dirname, '/auth_info_baileys/creds.json');

let isConnecting = false;
let ishan;

// ================== EXPRESS ==================
app.get("/", (req, res) => {
  res.send("Hey, 𝗜𝗦𝗛𝗔𝗡 𝗦𝗣𝗔𝗥𝗞-𝕏 🚀 started ✅");
});

app.listen(port, () =>
  console.log(`Server listening on http://localhost:${port}`)
);

// ================== SESSION RESTORE ==================
async function ensureSessionFile() {
  if (fs.existsSync(credsPath)) {
    return startBot();
  }

  if (!config.SESSION_ID) {
    console.error("❌ SESSION_ID missing in config/env");
    process.exit(1);
  }

  console.log("🔄 creds.json not found. Downloading session from MEGA...");

  const file = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`);

  file.download(async (err, data) => {
    if (err) {
      console.error("❌ Failed to download session:", err);
      process.exit(1);
    }

    fs.mkdirSync(path.dirname(credsPath), { recursive: true });
    fs.writeFileSync(credsPath, data);
    console.log("[✅] Session restored. Starting bot...");
    startBot();
  });
}

// ================== START BOT ==================
async function startBot() {
  if (isConnecting) return;
  isConnecting = true;

  console.log("[📥] Plugins installed ✅");

  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(__dirname, '/auth_info_baileys/')
  );

  const { version } = await fetchLatestBaileysVersion();

  ishan = makeWASocket({
    logger: P({ level: 'silent' }),
    auth: state,
    version,
    browser: ['Ubuntu', 'Chrome', '110'],
    syncFullHistory: false,
    markOnlineOnConnect: true,
  });

  // ================== CONNECTION ==================
  ishan.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log("❌ Connection closed");

      if (shouldReconnect) {
        console.log("🔄 Reconnecting in 5 seconds...");
        setTimeout(() => {
          isConnecting = false;
          startBot();
        }, 5000);
      }

    } else if (connection === 'open') {
      console.log("✅ WhatsApp Connected Successfully");
      isConnecting = false;
    }
  });

  ishan.ev.on('creds.update', saveCreds);

  // ================== MESSAGE SYSTEM ==================
  ishan.ev.on('messages.upsert', async ({ messages }) => {
    const mek = messages[0];
    if (!mek?.message) return;

    mek.message =
      getContentType(mek.message) === 'ephemeralMessage'
        ? mek.message.ephemeralMessage.message
        : mek.message;

    const from = mek.key.remoteJid;
    const sender = mek.key.fromMe
      ? ishan.user.id
      : mek.key.participant || mek.key.remoteJid;

    const senderNumber = sender.split('@')[0];
    const isGroup = from.endsWith('@g.us');
    const botNumber = ishan.user.id.split(':')[0];

    const isMe = botNumber.includes(senderNumber);
    const isOwner = ownerNumber.includes(senderNumber) || isMe;
    const isSudo = MASTER_SUDO.includes(senderNumber);

    const m = sms(ishan, mek);
    const type = getContentType(mek.message);

    const body =
      type === 'conversation'
        ? mek.message.conversation
        : mek.message[type]?.text ||
          mek.message[type]?.caption ||
          '';

    const isCmd = body.startsWith(prefix);
    const commandName = isCmd
      ? body.slice(prefix.length).trim().split(" ")[0].toLowerCase()
      : '';

    const args = body.trim().split(/ +/).slice(1);
    const q = args.join(' ');

    const reply = (text) =>
      ishan.sendMessage(from, { text }, { quoted: mek });

    // ================== COMMAND HANDLER ==================
    if (isCmd) {
      const cmd = commands.find(
        (c) =>
          c.pattern === commandName ||
          (c.alias && c.alias.includes(commandName))
      );

      if (cmd) {
        try {
          cmd.function(ishan, mek, m, {
            from,
            sender,
            isGroup,
            isOwner,
            isSudo,
            args,
            q,
            reply,
          });
        } catch (e) {
          console.error("❌ Command Error:", e);
        }
      }
    }

    // ================== REPLY HANDLERS ==================
    for (const handler of replyHandlers) {
      if (handler.filter(body, { sender })) {
        try {
          await handler.function(ishan, mek, m, { from, sender, reply });
          break;
        } catch (e) {
          console.log("Reply handler error:", e);
        }
      }
    }
  });
}

// ================== START ==================
ensureSessionFile();
