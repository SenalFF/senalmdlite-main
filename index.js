'use strict';

const {
  default: makeWASocket,
  DisconnectReason,
  getContentType,
  fetchLatestBaileysVersion,
  useSingleFileAuthState
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const P = require('pino');
const express = require('express');
const path = require('path');
const { File } = require('megajs');

const config = require('./config');
const { sms } = require('./lib/msg');
const { commands, replyHandlers } = require('./command');

// ================= CONFIG =================
const prefix = config.PREFIX || '.';
const ownerNumber = ['94769872326'];
const MASTER_SUDO = ['94769872326'];

const app = express();
const port = process.env.PORT || 8000;

const sessionFolder = path.join(__dirname, 'session');
const credsPath = path.join(sessionFolder, 'creds.json');

let sock = null;
let reconnecting = false;

// ================= EXPRESS SERVER =================
app.get('/', (req, res) => {
  res.send('🤖 DANUWA-MD BOT RUNNING ✅');
});

app.listen(port, () => {
  console.log(`🌍 Server running on http://localhost:${port}`);
});

// ================= SESSION RESTORE =================
async function restoreSession() {
  if (fs.existsSync(credsPath)) {
    console.log("✅ Session file found.");
    return startBot();
  }

  if (!config.SESSION_ID) {
    console.log("❌ SESSION_ID missing.");
    process.exit(1);
  }

  console.log("🔄 Downloading session from MEGA...");

  const file = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`);

  file.download((err, data) => {
    if (err) {
      console.log("❌ MEGA Download Failed:", err);
      process.exit(1);
    }

    fs.mkdirSync(sessionFolder, { recursive: true });
    fs.writeFileSync(credsPath, data);
    console.log("✅ Session restored successfully.");
    startBot();
  });
}

// ================= START BOT =================
async function startBot() {
  if (sock) {
    try { sock.end(); } catch {}
  }

  const { state, saveState } = useSingleFileAuthState(credsPath);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    printQRInTerminal: true,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '20.0.04']
  });

  sock.ev.on('creds.update', saveState);

  // ========== CONNECTION HANDLER ==========
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log("✅ WhatsApp Connected Successfully!");
      reconnecting = false;
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      console.log("❌ Connection closed. Code:", statusCode);

      if (statusCode === DisconnectReason.loggedOut) {
        console.log("🚫 Session logged out. Delete session and rescan QR.");
        process.exit(0);
      }

      if (!reconnecting) {
        reconnecting = true;
        console.log("🔄 Reconnecting in 5 seconds...");
        setTimeout(() => {
          startBot();
        }, 5000);
      }
    }
  });

  // ========== MESSAGE HANDLER ==========
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const mek = messages[0];
    if (!mek?.message) return;

    mek.message =
      getContentType(mek.message) === 'ephemeralMessage'
        ? mek.message.ephemeralMessage.message
        : mek.message;

    const from = mek.key.remoteJid;
    const sender = mek.key.participant || mek.key.remoteJid;
    const senderNumber = sender.split('@')[0];

    const isOwner =
      ownerNumber.includes(senderNumber) ||
      MASTER_SUDO.includes(senderNumber);

    const m = sms(sock, mek);
    const type = getContentType(mek.message);

    const body =
      type === 'conversation'
        ? mek.message.conversation
        : mek.message[type]?.text ||
          mek.message[type]?.caption ||
          '';

    if (!body.startsWith(prefix)) return;

    const commandName = body.slice(prefix.length).trim().split(" ")[0].toLowerCase();
    const args = body.trim().split(/ +/).slice(1);

    const reply = (text) =>
      sock.sendMessage(from, { text }, { quoted: mek });

    const cmd = commands.find(
      (c) =>
        c.pattern === commandName ||
        (c.alias && c.alias.includes(commandName))
    );

    if (cmd) {
      try {
        cmd.function(sock, mek, m, {
          from,
          sender,
          args,
          isOwner,
          reply
        });
      } catch (e) {
        console.log("❌ Command Error:", e);
      }
    }

    for (const handler of replyHandlers) {
      if (handler.filter(body, { sender })) {
        try {
          await handler.function(sock, mek, m, { from, sender, reply });
        } catch {}
      }
    }
  });
}

// ================= START =================
restoreSession();
