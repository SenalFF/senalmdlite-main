require('dotenv').config(); // ✅ MUST be first line

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  proto,
  generateWAMessageContent,
  generateWAMessage,
  AnyMessageContent,
  prepareWAMessageMedia,
  areJidsSameUser,
  downloadContentFromMessage,
  MessageRetryMap,
  generateForwardMessageContent,
  generateWAMessageFromContent,
  generateMessageID, makeInMemoryStore,
  jidDecode,
  fetchLatestBaileysVersion,
  Browsers
} = require('fast-baileys');

const fs = require('fs');
const P = require('pino');
const express = require('express');
const axios = require('axios');
const path = require('path');

const config = require('./config');
const { sms, downloadMediaMessage } = require('./lib/msg');
const {
  getBuffer, getGroupAdmins, getRandom, h2k, isUrl, Json, runtime, sleep, fetchJson
} = require('./lib/functions');
const { File } = require('megajs');
const { commands, replyHandlers: _replyHandlers } = require('./command');
const replyHandlers = Array.isArray(_replyHandlers) ? _replyHandlers : [];

const app = express();
const port = process.env.PORT || 8000;

const prefix = config.PREFIX || '.';
const ownerNumber = [config.OWNER_NUMBER || '94769872326'];
const authDir = path.join(__dirname, '/auth_info_baileys/');
const credsPath = path.join(authDir, 'creds.json');

// ✅ Connection lock — prevents multiple simultaneous connections
let isConnecting = false;

const antiDeletePlugin = require('./plugins/antidelete.js');
global.pluginHooks = global.pluginHooks || [];
global.pluginHooks.push(antiDeletePlugin);

// ================= Session Download =================
async function ensureSessionFile() {
  if (!fs.existsSync(credsPath)) {
    if (!config.SESSION_ID) {
      console.error('❌ SESSION_ID env variable is missing.');
      process.exit(1);
    }

    console.log("🔄 creds.json not found. Downloading session from MEGA...");
    fs.mkdirSync(authDir, { recursive: true });

    const filer = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`);
    filer.download((err, data) => {
      if (err) {
        console.error("❌ Failed to download session from MEGA:", err);
        process.exit(1);
      }
      fs.writeFileSync(credsPath, data);
      console.log("✅ Session downloaded. Starting bot...");
      connectToWA(); // ✅ Called only once
    });

  } else {
    connectToWA(); // ✅ Called only once
  }
}

// ================= Connect to WhatsApp =================
async function connectToWA() {
  // ✅ Prevent duplicate connections
  if (isConnecting) {
    console.log("⚠️ Already connecting, skipping duplicate call...");
    return;
  }
  isConnecting = true;

  console.log("Connecting senal-MD 🧬...");

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const test = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Firefox", "20.0.04"],
    auth: state,
    version,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
  });

  // ================= Connection Updates =================
  test.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'connecting') {
      console.log("📡 Attempting to connect...");

    } else if (connection === 'close') {
      isConnecting = false; // ✅ Reset lock

      const statusCode = lastDisconnect?.error?.output?.statusCode;

      // ✅ Exit on conflict instead of reconnecting (fixes Railway duplicate issue)
      if (statusCode === 440) {
        console.log("⚠️ Conflict — session used elsewhere. Exiting cleanly...");
        process.exit(0);
      }

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log(`⚠️ Connection closed (${statusCode}). Reconnecting in 5s...`);
        setTimeout(() => connectToWA(), 5000);
      } else {
        console.log("❌ Logged out from WhatsApp. Exiting...");
        process.exit(0);
      }

    } else if (connection === 'open') {
      isConnecting = false; // ✅ Reset lock on success
      console.log('✅ Senal-MD connected to WhatsApp');

      // Load plugins
      try {
        const plugins = fs.readdirSync("./plugins/");
        let loaded = 0;
        plugins.forEach((plugin) => {
          if (path.extname(plugin).toLowerCase() === ".js") {
            try {
              require(`./plugins/${plugin}`);
              loaded++;
            } catch (e) {
              console.error(`❌ Plugin load error [${plugin}]:`, e.message);
            }
          }
        });
        console.log(`✅ Plugins loaded (${loaded}/${plugins.length})`);
      } catch (e) {
        console.error("❌ Error reading plugins dir:", e.message);
      }

      // Send alive message
      try {
        const up = `Senal-MD connected ✅\n\nPREFIX: ${prefix}`;
        await test.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
          image: { url: `https://raw.githubusercontent.com/SenalFF/senalmd/refs/heads/main/system/IMG-20251229-WA0001.jpg?raw=true` },
          caption: up
        });
      } catch (e) {
        console.error("⚠️ Failed to send alive message:", e.message);
      }
    }
  });

  test.ev.on('creds.update', saveCreds);

  // ================= Handle Incoming Messages =================
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

    // ================= Status Handler =================
    if (mek.key?.remoteJid === 'status@broadcast') {
      const senderJid = mek.key.participant || mek.key.remoteJid || "unknown@s.whatsapp.net";
      const mentionJid = senderJid.includes("@s.whatsapp.net") ? senderJid : senderJid + "@s.whatsapp.net";

      if (config.AUTO_STATUS_SEEN === "true") {
        try { await test.readMessages([mek.key]); } catch (e) {}
      }

      if (config.AUTO_STATUS_REACT === "true" && mek.key.participant) {
        try {
          const emojis = ['❤️','💸','😇','🍂','💥','💯','🔥','💫','💎','💗','🤍','🖤','👀','🙌','🙆','🚩','🥰','💐','😎','🤎','✅','🫀','🧡','😁','😄','🌸','🕊️','🌷','⛅','🌟','🗿','💜','💙','🌝','🖤','💚'];
          const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
          await test.sendMessage(mek.key.participant, {
            react: { text: randomEmoji, key: mek.key }
          });
        } catch (e) {}
      }

      if (mek.message?.extendedTextMessage && !mek.message.imageMessage && !mek.message.videoMessage) {
        const text = mek.message.extendedTextMessage.text || "";
        if (text.trim().length > 0) {
          try {
            await test.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
              text: `📝 *Text Status*\n👤 From: @${mentionJid.split("@")[0]}\n\n${text}`,
              mentions: [mentionJid]
            });
          } catch (e) {}
        }
      }

      if (mek.message?.imageMessage || mek.message?.videoMessage) {
        try {
          const msgType = mek.message.imageMessage ? "imageMessage" : "videoMessage";
          const mediaMsg = mek.message[msgType];
          const stream = await downloadContentFromMessage(mediaMsg, msgType === "imageMessage" ? "image" : "video");
          let buffer = Buffer.from([]);
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
          const mimetype = mediaMsg.mimetype || (msgType === "imageMessage" ? "image/jpeg" : "video/mp4");
          const captionText = mediaMsg.caption || "";
          await test.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
            [msgType === "imageMessage" ? "image" : "video"]: buffer,
            mimetype,
            caption: `📥 *Forwarded Status*\n👤 From: @${mentionJid.split("@")[0]}\n\n${captionText}`,
            mentions: [mentionJid]
          });
        } catch (err) {}
      }

      return; // ✅ Don't process status as commands
    }

    // ================= Message Parsing =================
    const m = sms(test, mek);
    const type = getContentType(mek.message);
    const from = mek.key.remoteJid;

    let body = '';
    if (type === 'conversation') body = mek.message.conversation;
    else if (type === 'extendedTextMessage') body = mek.message.extendedTextMessage?.text || '';
    else if (type === 'imageMessage') body = mek.message.imageMessage?.caption || '';
    else if (type === 'videoMessage') body = mek.message.videoMessage?.caption || '';
    else if (type === 'buttonsResponseMessage') body = mek.message.buttonsResponseMessage?.selectedButtonId || '';
    else if (type === 'listResponseMessage') body = mek.message.listResponseMessage?.singleSelectReply?.selectedRowId || '';

    const isCmd = body.startsWith(prefix);
    const commandName = isCmd ? body.slice(prefix.length).trim().split(" ")[0].toLowerCase() : '';
    const args = body.trim().split(/ +/).slice(1);
    const q = args.join(' ');

    const sender = mek.key.fromMe
      ? test.user.id.split(':')[0] + '@s.whatsapp.net'
      : (mek.key.participant || mek.key.remoteJid);
    const senderNumber = sender.split('@')[0];
    const isGroup = from.endsWith('@g.us');
    const botNumber = test.user.id.split(':')[0];
    const pushname = mek.pushName || 'No Name';
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

    // ✅ Debug log
    if (body) console.log(`📩 From: ${senderNumber} | Body: "${body}" | isCmd: ${isCmd} | Cmd: "${commandName}"`);

    // ================= Command Execution =================
    if (isCmd) {
      const cmd = commands.find((c) =>
        c.pattern === commandName || (c.alias && c.alias.includes(commandName))
      );

      if (cmd) {
        console.log(`⚡ Executing: "${commandName}"`);
        if (cmd.react) test.sendMessage(from, { react: { text: cmd.react, key: mek.key } });
        try {
          await cmd.function(test, mek, m, {
            from, quoted: mek, body, isCmd, command: commandName, args, q,
            isGroup, sender, senderNumber, botNumber2, botNumber, pushname,
            isMe, isOwner, groupMetadata, groupName, participants, groupAdmins,
            isBotAdmins, isAdmins, reply,
          });
        } catch (e) {
          console.error("[PLUGIN ERROR]", e);
          reply("⚠️ An error occurred while executing the command.");
        }
      } else {
        console.log(`❓ Unknown command: "${commandName}"`);
      }
    }

    // ================= Reply Handlers =================
    for (const handler of replyHandlers) {
      if (typeof handler.filter === 'function' && handler.filter(body, { sender, message: mek })) {
        try {
          await handler.function(test, mek, m, { from, quoted: mek, body, sender, reply });
          break;
        } catch (e) {
          console.log("Reply handler error:", e);
        }
      }
    }
  });

  // ================= Message Delete Handler =================
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

// ================= Express Server =================
app.get("/", (req, res) => res.send("Hey, Senal-MD started ✅"));
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));

// ================= Start =================
ensureSessionFile();
