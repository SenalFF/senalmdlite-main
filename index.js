const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  proto,
  generateWAMessageContent,
  generateWAMessage,
  prepareWAMessageMedia,
  areJidsSameUser,
  downloadContentFromMessage,
  MessageRetryMap,
  generateForwardMessageContent,
  generateWAMessageFromContent,
  generateMessageID,
  makeInMemoryStore,
  jidDecode,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const P = require('pino');
const express = require('express');
const axios = require('axios');
const path = require('path');
const qrcode = require('qrcode-terminal');

const config = require('./config');
const { sms, downloadMediaMessage } = require('./lib/msg');
const {
  getBuffer, getGroupAdmins, getRandom, h2k, isUrl, Json, runtime, sleep, fetchJson
} = require('./lib/functions');
const { File } = require('megajs');
const { commands, replyHandlers } = require('./command');

const app = express();
const port = process.env.PORT || 8000;

const prefix = '.';
const ownerNumber = ['94769872326'];
const credsPath = path.join(__dirname, '/auth_info_baileys/creds.json');
const authDir = path.join(__dirname, '/auth_info_baileys/');

// ─── Reconnect State ──────────────────────────────────────────────────────────
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

// ─── Plugin Hooks ─────────────────────────────────────────────────────────────
const antiDeletePlugin = require('./plugins/antidelete.js');
global.pluginHooks = global.pluginHooks || [];
global.pluginHooks.push(antiDeletePlugin);

// ─── Session Setup ────────────────────────────────────────────────────────────
async function ensureSessionFile() {
  // If RESET_SESSION=true in Railway env, wipe old broken session
  if (process.env.RESET_SESSION === 'true') {
    console.log("🗑️ RESET_SESSION detected. Clearing old session...");
    fs.rmSync(authDir, { recursive: true, force: true });
  }

  fs.mkdirSync(authDir, { recursive: true });

  if (!fs.existsSync(credsPath)) {
    if (config.SESSION_ID && config.SESSION_ID.trim() !== '') {
      console.log("🔄 creds.json not found. Downloading session from MEGA...");
      const filer = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`);

      filer.download((err, data) => {
        if (err) {
          console.error("❌ MEGA download failed:", err.message);
          console.log("📲 No session. Will use pairing code...");
          setTimeout(() => connectToWA(), 1000);
          return;
        }

        // Validate it's real JSON before saving
        try {
          JSON.parse(data.toString());
          fs.writeFileSync(credsPath, data);
          console.log("✅ Session downloaded and saved. Connecting...");
        } catch (e) {
          console.error("❌ MEGA session file is corrupted (not valid JSON). Using pairing code...");
        }

        setTimeout(() => connectToWA(), 2000);
      });
    } else {
      console.log("⚠️ No SESSION_ID set. Will use pairing code...");
      setTimeout(() => connectToWA(), 1000);
    }
  } else {
    console.log("✅ Session file found. Connecting...");
    setTimeout(() => connectToWA(), 1000);
  }
}

// ─── Main Connection ──────────────────────────────────────────────────────────
async function connectToWA() {
  console.log("Connecting test-MD 🧬...");

  let state, saveCreds;
  try {
    ({ state, saveCreds } = await useMultiFileAuthState(authDir));
  } catch (e) {
    console.error("❌ Failed to load auth state:", e.message);
    process.exit(1);
  }

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
    console.log(`ℹ️ Using WA version: ${version.join('.')}`);
  } catch (e) {
    console.warn("⚠️ Could not fetch WA version, using fallback.");
    version = [2, 3000, 1015901307];
  }

  // ✅ Browsers.macOS IS valid in this Baileys version (confirmed from source)
  // Browsers.macOS(browser) => ['Mac OS', browser, '14.4.1']
  const test = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS("Firefox"),
    auth: state,
    version,
    syncFullHistory: true,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
    // DO NOT set mobile: true — it throws loggedOut error in this Baileys version
  });

  // ─── Pairing Code (for Railway / no QR access) ────────────────────────────
  const isRegistered = test.authState.creds.registered;
  console.log(`ℹ️ Session registered: ${isRegistered}`);

  if (!isRegistered) {
    const phoneNumber = ownerNumber[0].replace(/[^0-9]/g, '');
    console.log(`📲 Requesting pairing code for +${phoneNumber}...`);
    setTimeout(async () => {
      try {
        const code = await test.requestPairingCode(phoneNumber);
        console.log(`\n╔══════════════════════════════════╗`);
        console.log(`║   🔑 PAIRING CODE: ${code}   ║`);
        console.log(`╚══════════════════════════════════╝\n`);
        console.log(`👉 WhatsApp → Linked Devices → Link a Device → Link with Phone Number`);
        console.log(`👉 Enter the code above to connect`);
      } catch (e) {
        console.error("❌ Pairing code request failed:", e.message);
      }
    }, 3000);
  } else {
    console.log("ℹ️ Already registered. Skipping pairing code.");
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ─── Connection Events ────────────────────────────────────────────────────
  test.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Show QR as fallback in case pairing code fails
    if (qr) {
      console.log("📱 QR Code (fallback - scan if pairing code doesn't work):");
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      // ── DisconnectReason codes from actual Baileys source ──
      // 401 = loggedOut
      // 403 = forbidden
      // 408 = connectionLost / timedOut
      // 411 = multideviceMismatch
      // 428 = connectionClosed
      // 440 = connectionReplaced
      // 500 = badSession
      // 503 = unavailableService
      // 515 = restartRequired

      console.log(`❌ Connection closed. Code: ${statusCode}`);

      if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
        // Logged out or forbidden — clear session and restart fresh
        console.log("🔒 Logged out or forbidden. Clearing session...");
        fs.rmSync(authDir, { recursive: true, force: true });
        process.exit(1);

      } else if (statusCode === DisconnectReason.badSession || statusCode === 500) {
        // Bad/corrupted session — clear and restart
        console.log("💥 Bad session detected. Clearing session...");
        fs.rmSync(authDir, { recursive: true, force: true });
        process.exit(1);

      } else if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
        // Restart required — reconnect immediately without counting attempts
        console.log("🔄 Restart required by server. Reconnecting now...");
        setTimeout(connectToWA, 1000);

      } else {
        // connectionClosed / connectionLost / timedOut / etc — retry with limit
        if (reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT} in 5s...`);
          setTimeout(connectToWA, 5000);
        } else {
          console.error("🚫 Max reconnect attempts reached. Clearing session and restarting...");
          fs.rmSync(authDir, { recursive: true, force: true });
          process.exit(1);
        }
      }

    } else if (connection === 'open') {
      reconnectAttempts = 0; // reset counter on successful connect
      console.log('✅ test-MD connected to WhatsApp');

      const up = `test-MD connected ✅\n\nPREFIX: ${prefix}`;
      try {
        await test.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
          image: { url: `https://github.com/testwpbot/test12/blob/main/images/Danuwa%20-%20MD.png?raw=true` },
          caption: up
        });
      } catch (e) {
        console.warn("⚠️ Could not send startup message:", e.message);
      }

      fs.readdirSync("./plugins/").forEach((plugin) => {
        if (path.extname(plugin).toLowerCase() === ".js") {
          try {
            require(`./plugins/${plugin}`);
          } catch (e) {
            console.error(`❌ Failed to load plugin ${plugin}:`, e.message);
          }
        }
      });
    }
  });

  test.ev.on('creds.update', saveCreds);

  // ─── Message Handler ──────────────────────────────────────────────────────
  test.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.messageStubType === 68) {
        await test.sendMessageAck(msg.key);
      }
    }

    const mek = messages[0];
    if (!mek || !mek.message) return;

    mek.message = getContentType(mek.message) === 'ephemeralMessage'
      ? mek.message.ephemeralMessage.message
      : mek.message;

    // Plugin hooks
    if (global.pluginHooks) {
      for (const plugin of global.pluginHooks) {
        if (plugin.onMessage) {
          try {
            await plugin.onMessage(test, mek);
          } catch (e) {
            console.log("onMessage error:", e);
          }
        }
      }
    }

    // ─── Status Handler ────────────────────────────────────────────────────
    if (mek.key?.remoteJid === 'status@broadcast') {
      const senderJid = mek.key.participant || mek.key.remoteJid || "unknown@s.whatsapp.net";
      const mentionJid = senderJid.includes("@s.whatsapp.net") ? senderJid : senderJid + "@s.whatsapp.net";

      if (config.AUTO_STATUS_SEEN === "true") {
        try {
          await test.readMessages([mek.key]);
          console.log(`[✓] Status seen: ${mek.key.id}`);
        } catch (e) {
          console.error("❌ Failed to mark status as seen:", e);
        }
      }

      if (config.AUTO_STATUS_REACT === "true" && mek.key.participant) {
        try {
          const emojis = ['❤️','💸','😇','🍂','💥','💯','🔥','💫','💎','💗','🤍','🖤','👀','🙌','🙆','🚩','🥰','💐','😎','🤎','✅','🫀','🧡','😁','😄','🌸','🕊️','🌷','⛅','🌟','🗿','💜','💙','🌝','🖤','💚'];
          const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
          await test.sendMessage(mek.key.participant, {
            react: { text: randomEmoji, key: mek.key }
          });
          console.log(`[✓] Reacted to status of ${mek.key.participant} with ${randomEmoji}`);
        } catch (e) {
          console.error("❌ Failed to react to status:", e);
        }
      }

      if (mek.message?.extendedTextMessage && !mek.message.imageMessage && !mek.message.videoMessage) {
        const text = mek.message.extendedTextMessage.text || "";
        if (text.trim().length > 0) {
          try {
            await test.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
              text: `📝 *Text Status*\n👤 From: @${mentionJid.split("@")[0]}\n\n${text}`,
              mentions: [mentionJid]
            });
            console.log(`✅ Text status from ${mentionJid} forwarded.`);
          } catch (e) {
            console.error("❌ Failed to forward text status:", e);
          }
        }
      }

      if (mek.message?.imageMessage || mek.message?.videoMessage) {
        try {
          const msgType = mek.message.imageMessage ? "imageMessage" : "videoMessage";
          const mediaMsg = mek.message[msgType];
          const stream = await downloadContentFromMessage(
            mediaMsg,
            msgType === "imageMessage" ? "image" : "video"
          );
          let buffer = Buffer.from([]);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }
          const mimetype = mediaMsg.mimetype || (msgType === "imageMessage" ? "image/jpeg" : "video/mp4");
          const captionText = mediaMsg.caption || "";
          await test.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
            [msgType === "imageMessage" ? "image" : "video"]: buffer,
            mimetype,
            caption: `📥 *Forwarded Status*\n👤 From: @${mentionJid.split("@")[0]}\n\n${captionText}`,
            mentions: [mentionJid]
          });
          console.log(`✅ Media status from ${mentionJid} forwarded.`);
        } catch (err) {
          console.error("❌ Failed to forward media status:", err);
        }
      }

      return; // don't process status messages as commands
    }
    // ──────────────────────────────────────────────────────────────────────

    const m = sms(test, mek);
    const type = getContentType(mek.message);
    const from = mek.key.remoteJid;
    const body = type === 'conversation'
      ? mek.message.conversation
      : mek.message[type]?.text || mek.message[type]?.caption || '';
    const isCmd = body.startsWith(prefix);
    const commandName = isCmd ? body.slice(prefix.length).trim().split(" ")[0].toLowerCase() : '';
    const args = body.trim().split(/ +/).slice(1);
    const q = args.join(' ');

    const sender = mek.key.fromMe ? test.user.id : (mek.key.participant || mek.key.remoteJid);
    const senderNumber = sender.split('@')[0];
    const isGroup = from.endsWith('@g.us');
    const botNumber = test.user.id.split(':')[0];
    const pushname = mek.pushName || 'Sin Nombre';
    const isMe = botNumber.includes(senderNumber);
    const isOwner = ownerNumber.includes(senderNumber) || isMe;
    const botNumber2 = await jidNormalizedUser(test.user.id);

    const groupMetadata = isGroup ? await test.groupMetadata(from).catch(() => {}) : '';
    const groupName = isGroup ? groupMetadata?.subject : '';
    const participants = isGroup ? groupMetadata?.participants : '';
    const groupAdmins = isGroup ? await getGroupAdmins(participants) : '';
    const isBotAdmins = isGroup ? groupAdmins.includes(botNumber2) : false;
    const isAdmins = isGroup ? groupAdmins.includes(sender) : false;

    const reply = (text) => test.sendMessage(from, { text }, { quoted: mek });

    if (isCmd) {
      const cmd = commands.find((c) => c.pattern === commandName || (c.alias && c.alias.includes(commandName)));
      if (cmd) {
        if (cmd.react) test.sendMessage(from, { react: { text: cmd.react, key: mek.key } });
        try {
          cmd.function(test, mek, m, {
            from, quoted: mek, body, isCmd, command: commandName, args, q,
            isGroup, sender, senderNumber, botNumber2, botNumber, pushname,
            isMe, isOwner, groupMetadata, groupName, participants, groupAdmins,
            isBotAdmins, isAdmins, reply,
          });
        } catch (e) {
          console.error("[PLUGIN ERROR]", e);
        }
      }
    }

    const replyText = body;
    for (const handler of replyHandlers) {
      if (handler.filter(replyText, { sender, message: mek })) {
        try {
          await handler.function(test, mek, m, {
            from, quoted: mek, body: replyText, sender, reply,
          });
          break;
        } catch (e) {
          console.log("Reply handler error:", e);
        }
      }
    }
  });

  // ─── Delete Handler ───────────────────────────────────────────────────────
  test.ev.on('messages.update', async (updates) => {
    if (global.pluginHooks) {
      for (const plugin of global.pluginHooks) {
        if (plugin.onDelete) {
          try {
            await plugin.onDelete(test, updates);
          } catch (e) {
            console.log("onDelete error:", e);
          }
        }
      }
    }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
ensureSessionFile();

app.get("/", (req, res) => {
  res.send("Hey, test-MD started ✅");
});

app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
