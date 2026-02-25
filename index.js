// ================= Required Modules =================
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
  generateForwardMessageContent,
  generateWAMessageFromContent,
  generateMessageID,
  makeInMemoryStore,
  jidDecode,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

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
const { commands, replyHandlers } = require('./command');

const app = express();
const port = process.env.PORT || 8000;

const prefix = '.';
const ownerNumber = ['94769872326'];
const credsPath = path.join(__dirname, '/auth_info_baileys/creds.json');

// ================= Reconnect guard =================
let isConnecting = false;

// ================= Session Setup =================
async function ensureSessionFile() {
  if (!fs.existsSync(credsPath)) {
    if (!config.SESSION_ID) {
      console.error('❌ SESSION_ID env variable is missing. Cannot restore session.');
      process.exit(1);
    }

    console.log("🔄 creds.json not found. Downloading session from MEGA...");

    const sessdata = config.SESSION_ID;
    const filer = File.fromURL(`https://mega.nz/file/${sessdata}`);

    filer.download((err, data) => {
      if (err) {
        console.error("❌ Failed to download session file from MEGA:", err);
        process.exit(1);
      }

      fs.mkdirSync(path.join(__dirname, '/auth_info_baileys/'), { recursive: true });
      fs.writeFileSync(credsPath, data);
      console.log("✅ Session downloaded and saved. Starting bot...");
      setTimeout(() => connectToWA(), 2000);
    });
  } else {
    setTimeout(() => connectToWA(), 1000);
  }
}

// ================= Anti-Delete Plugin =================
const antiDeletePlugin = require('./plugins/antidelete.js');
global.pluginHooks = global.pluginHooks || [];
global.pluginHooks.push(antiDeletePlugin);

// ================= Body Extractor =================
// Handles all message types to reliably get the text body
function extractBody(message) {
  if (!message) return '';
  const type = getContentType(message);
  if (!type) return '';

  const msg = message[type];
  if (!msg) return '';

  switch (type) {
    case 'conversation':
      return message.conversation || '';
    case 'extendedTextMessage':
      return msg.text || '';
    case 'imageMessage':
    case 'videoMessage':
    case 'audioMessage':
    case 'documentMessage':
    case 'stickerMessage':
      return msg.caption || '';
    case 'buttonsResponseMessage':
      return msg.selectedButtonId || '';
    case 'listResponseMessage':
      return msg.singleSelectReply?.selectedRowId || '';
    case 'templateButtonReplyMessage':
      return msg.selectedId || '';
    case 'interactiveResponseMessage':
      try {
        const body = JSON.parse(msg.nativeFlowResponseMessage?.paramsJson || '{}');
        return body.id || '';
      } catch {
        return '';
      }
    default:
      return msg.text || msg.caption || '';
  }
}

// ================= Connect to WhatsApp =================
async function connectToWA() {
  if (isConnecting) return;
  isConnecting = true;

  console.log("Connecting Senal-MD 🧬...");

  try {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '/auth_info_baileys/'));
    const { version } = await fetchLatestBaileysVersion();

    const conn = makeWASocket({
      logger: P({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ["Ubuntu", "Firefox", "20.0.04"],
      auth: state,
      version,
      syncFullHistory: true,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
    });

    // ================= Connection Updates =================
    conn.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        isConnecting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.log("❌ Logged out from WhatsApp. Please re-link.");
        } else {
          console.log(`🔄 Reconnecting... (code: ${statusCode})`);
          setTimeout(() => connectToWA(), 5000);
        }

      } else if (connection === 'open') {
        console.log('✅ Senal-MD connected to WhatsApp');

        // Load plugins
        fs.readdirSync("./plugins/").forEach((plugin) => {
          if (path.extname(plugin).toLowerCase() === ".js") {
            try {
              require(`./plugins/${plugin}`);
            } catch (err) {
              console.error(`❌ Error loading plugin ${plugin}:`, err);
            }
          }
        });
        console.log("✅ Plugins loaded");

        // Send alive message via axios (avoids Baileys URL fetch timeout)
        (async () => {
          try {
            const aliveImgUrl = `https://raw.githubusercontent.com/SenalFF/senalmd/main/lib/senal-md.png`;
            const up = `Senal-MD connected ✅\n\nPREFIX: ${prefix}`;

            let imageBuffer = null;
            try {
              const response = await axios.get(aliveImgUrl, {
                responseType: "arraybuffer",
                timeout: 30000,
              });
              imageBuffer = Buffer.from(response.data);
              console.log("✅ Alive image fetched successfully");
            } catch (imgErr) {
              console.error("⚠️ Failed to fetch alive image:", imgErr.message);
            }

            if (imageBuffer) {
              await conn.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
                image: imageBuffer,
                caption: up,
              });
            } else {
              await conn.sendMessage(ownerNumber[0] + "@s.whatsapp.net", { text: up });
            }
          } catch (err) {
            console.error("❌ Error sending startup message:", err);
          }
        })();
      }
    });

    conn.ev.on('creds.update', saveCreds);

    // ================= Handle Incoming Messages =================
    conn.ev.on('messages.upsert', async ({ messages, type: upsertType }) => {
      // Only handle notify-type upserts (real incoming messages)
      if (upsertType !== 'notify') return;

      for (const msg of messages) {
        if (msg.messageStubType === 68) {
          try { await conn.sendMessageAck(msg.key); } catch {}
        }
      }

      const mek = messages[0];
      if (!mek || !mek.message) return;

      // Unwrap ephemeral
      if (getContentType(mek.message) === 'ephemeralMessage') {
        mek.message = mek.message.ephemeralMessage.message;
      }

      // Unwrap viewOnceMessage
      if (getContentType(mek.message) === 'viewOnceMessage') {
        mek.message = Object.values(mek.message.viewOnceMessage.message)[0];
      }

      // Plugin hooks
      if (global.pluginHooks) {
        for (const plugin of global.pluginHooks) {
          if (plugin.onMessage) {
            try { await plugin.onMessage(conn, mek); } catch (e) { console.log("onMessage error:", e); }
          }
        }
      }

      // ================= Status Handler =================
      if (mek.key?.remoteJid === 'status@broadcast') {
        const senderJid = mek.key.participant || mek.key.remoteJid || "unknown@s.whatsapp.net";
        const mentionJid = senderJid.includes("@s.whatsapp.net") ? senderJid : senderJid + "@s.whatsapp.net";

        if (config.AUTO_STATUS_SEEN === "true") {
          try {
            await conn.readMessages([mek.key]);
          } catch (e) {}
        }

        if (config.AUTO_STATUS_REACT === "true" && mek.key.participant) {
          try {
            const emojis = ['❤️','💸','😇','🍂','💥','💯','🔥','💫','💎','💗','🤍','🖤','👀','🙌','🙆','🚩','🥰','💐','😎','🤎','✅','🫀','🧡','😁','😄','🌸','🕊️','🌷','⛅','🌟','🗿','💜','💙','🌝','💚'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            await conn.sendMessage(mek.key.participant, { react: { text: randomEmoji, key: mek.key } });
          } catch (e) {}
        }

        if (mek.message?.extendedTextMessage && !mek.message.imageMessage && !mek.message.videoMessage) {
          const text = mek.message.extendedTextMessage.text || "";
          if (text.trim().length > 0) {
            try {
              await conn.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
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
            await conn.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
              [msgType === "imageMessage" ? "image" : "video"]: buffer,
              mimetype,
              caption: `📥 *Forwarded Status*\n👤 From: @${mentionJid.split("@")[0]}\n\n${captionText}`,
              mentions: [mentionJid]
            });
          } catch (err) {}
        }

        return; // Don't process status messages as commands
      }

      // ================= Message Parsing =================
      const m = sms(conn, mek);
      const from = mek.key.remoteJid;
      const isGroup = from.endsWith('@g.us');

      // ✅ Proper sender detection
      const sender = mek.key.fromMe
        ? (conn.user.id.split(':')[0] + '@s.whatsapp.net')
        : (mek.key.participant || mek.key.remoteJid);
      const senderNumber = sender.split('@')[0];

      const botNumber = conn.user.id.split(':')[0];
      const botNumber2 = jidNormalizedUser(conn.user.id);
      const pushname = mek.pushName || 'User';
      const isMe = botNumber.includes(senderNumber);
      const isOwner = ownerNumber.includes(senderNumber) || isMe;

      // ✅ Robust body extraction covering all message types
      const body = extractBody(mek.message);
      const isCmd = body.startsWith(prefix);
      const commandName = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : '';
      const args = body.trim().split(/\s+/).slice(isCmd ? 1 : 0);
      const q = args.join(' ');

      // Debug log — remove after confirming commands work
      if (isCmd) console.log(`[CMD] from=${senderNumber} cmd=${commandName} body="${body}"`);

      const groupMetadata = isGroup ? await conn.groupMetadata(from).catch(() => null) : null;
      const groupName = groupMetadata?.subject || '';
      const participants = groupMetadata?.participants || [];
      const groupAdmins = isGroup && participants.length ? await getGroupAdmins(participants) : [];
      const isBotAdmins = isGroup ? groupAdmins.includes(botNumber2) : false;
      const isAdmins = isGroup ? groupAdmins.includes(sender) : false;

      const reply = (text) => conn.sendMessage(from, { text }, { quoted: mek });

      // ================= Command Execution =================
      if (isCmd && commandName) {
        const cmd = commands.find((c) =>
          c.pattern === commandName ||
          (c.alias && Array.isArray(c.alias) && c.alias.includes(commandName))
        );

        if (cmd) {
          console.log(`[EXEC] Running command: ${commandName}`);
          if (cmd.react) {
            conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } }).catch(() => {});
          }
          try {
            await cmd.function(conn, mek, m, {
              from, quoted: mek, body, isCmd, command: commandName, args, q,
              isGroup, sender, senderNumber, botNumber2, botNumber, pushname,
              isMe, isOwner, groupMetadata, groupName, participants, groupAdmins,
              isBotAdmins, isAdmins, reply,
            });
          } catch (e) {
            console.error(`[PLUGIN ERROR] ${commandName}:`, e);
            reply(`⚠️ Error executing command: ${commandName}`).catch(() => {});
          }
        } else {
          console.log(`[CMD] Unknown command: ${commandName}`);
        }
      }

      // ================= Reply Handlers =================
      if (replyHandlers && replyHandlers.length) {
        for (const handler of replyHandlers) {
          try {
            if (handler.filter(body, { sender, message: mek })) {
              await handler.function(conn, mek, m, {
                from, quoted: mek, body, sender, reply,
              });
              break;
            }
          } catch (e) {
            console.log("Reply handler error:", e);
          }
        }
      }
    });

    // ================= Message Delete Handler =================
    conn.ev.on('messages.update', async (updates) => {
      if (global.pluginHooks) {
        for (const plugin of global.pluginHooks) {
          if (plugin.onDelete) {
            try { await plugin.onDelete(conn, updates); } catch (e) { console.log("onDelete error:", e); }
          }
        }
      }
    });

  } catch (err) {
    console.error("❌ Error in connectToWA:", err);
    isConnecting = false;
    setTimeout(() => connectToWA(), 5000);
  }
}

// ================= Start =================
ensureSessionFile();

app.get("/", (req, res) => res.send("Hey, Senal-MD started ✅"));
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
