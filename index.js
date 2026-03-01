'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  getContentType,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const P = require('pino');
const express = require('express');
const path = require('path');
const { File } = require('megajs');
const AdmZip = require('adm-zip');

const config = require('./config');
const { sms } = require('./lib/msg');
const { commands, replyHandlers } = require('./command');

// ================= CONFIG =================
const prefix = config.PREFIX || '.';
const ownerNumber = ['94769872326'];
const MASTER_SUDO = ['94769872326'];

const app = express();
const port = process.env.PORT || 8000;

const sessionFolder = path.join(__dirname, 'auth_info_baileys');

let sock = null;
let reconnecting = false;

// ================= EXPRESS =================
app.get('/', (req, res) => {
  res.send('🤖 DANUWA-MD BOT RUNNING ✅');
});

app.listen(port, () => {
  console.log(`🌍 Server running on http://localhost:${port}`);
});

// ================= SESSION RESTORE (ZIP METHOD) =================
async function restoreSession() {

  if (fs.existsSync(path.join(sessionFolder, 'creds.json'))) {
    console.log("✅ Session folder found.");
    return startBot();
  }

  if (!config.SESSION_ID) {
    console.log("❌ SESSION_ID missing.");
    process.exit(1);
  }

  console.log("🔄 Downloading session ZIP from MEGA...");

  const file = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`);

  file.download((err, data) => {
    if (err) {
      console.log("❌ MEGA Download Failed:", err);
      process.exit(1);
    }

    const zipPath = path.join(__dirname, 'session.zip');
    fs.writeFileSync(zipPath, data);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(sessionFolder, true);

    fs.unlinkSync(zipPath);

    console.log("✅ Full session restored.");
    startBot();
  });
}

// ================= START BOT =================
async function startBot() {

  if (sock) {
    try { sock.end(); } catch {}
  }

  fs.mkdirSync(sessionFolder, { recursive: true });

  const { state, saveCreds } =
    await useMultiFileAuthState(sessionFolder);

  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    printQRInTerminal: true,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  // ================= CONNECTION HANDLER =================
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
        console.log("🚫 Session logged out. Delete old ZIP and rescan QR.");
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

  // ================= MESSAGE HANDLER =================
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

    const commandName =
      body.slice(prefix.length).trim().split(" ")[0].toLowerCase();

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
