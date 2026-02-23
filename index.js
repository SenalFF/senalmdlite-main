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

// ================= Bot Info =================
const botName = "Senal MD";

// Helper: build a vcard string using botName
function getBotVCard() {
  return `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`;
}

// chama — proper Baileys contacts payload (use this with sendMessage directly)
const chama = {
  contacts: {
    displayName: botName,
    contacts: [{ vcard: getBotVCard() }],
  },
};

async function ensureSessionFile() {
  if (!fs.existsSync(credsPath)) {
    if (!config.SESSION_ID) {
      console.error('❌ SESSION_ID env variable is missing. Cannot restore session.');
      process.exit(1);
    }

    console.log("📄 creds.json not found. Downloading session from MEGA...");

    const sessdata = config.SESSION_ID;
    const filer = File.fromURL(`https://mega.nz/file/${sessdata}`);

    filer.download((err, data) => {
      if (err) {
        console.error("❌ Failed to download session file from MEGA:", err);
        process.exit(1);
      }

      fs.mkdirSync(path.join(__dirname, '/auth_info_baileys/'), { recursive: true });
      fs.writeFileSync(credsPath, data);
      console.log("✅ Session downloaded and saved. Restarting bot...");
      setTimeout(() => {
        connectToWA();
      }, 2000);
    });
  } else {
    setTimeout(() => {
      connectToWA();
    }, 1000);
  }
}

const antiDeletePlugin = require('./plugins/antidelete.js');
global.pluginHooks = global.pluginHooks || [];
global.pluginHooks.push(antiDeletePlugin);

async function connectToWA() {
  console.log(`Connecting ${botName} 🧬...`);
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '/auth_info_baileys/'));
  const { version } = await fetchLatestBaileysVersion();

  const senal = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    browser: [botName, 'Safari', '1.0.0'],
    auth: state,
    version,
    syncFullHistory: true,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
  });

  senal.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        connectToWA();
      }
    } else if (connection === 'open') {
      console.log(`✅ ${botName} connected to WhatsApp`);

      const up = `${botName} connected ✅\n\nPREFIX: ${prefix}`;

      // 1️⃣ Send chama (bot identity contact card) on connect
      await senal.sendMessage(ownerNumber[0] + "@s.whatsapp.net", chama);

      // 2️⃣ Send connected notification image
      await senal.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
        image: { url: `https://raw.githubusercontent.com/SenalFF/senalmd/main/lib/senal-md.png?raw=true` },
        caption: up
      });

      fs.readdirSync("./plugins/").forEach((plugin) => {
        if (path.extname(plugin).toLowerCase() === ".js") {
          require(`./plugins/${plugin}`);
        }
      });
    }
  });

  senal.ev.on('creds.update', saveCreds);

  senal.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.messageStubType === 68) {
        await senal.sendMessageAck(msg.key);
      }
    }

    const mek = messages[0];
    if (!mek || !mek.message) return;
    mek.message = getContentType(mek.message) === 'ephemeralMessage' ? mek.message.ephemeralMessage.message : mek.message;

    if (global.pluginHooks) {
      for (const plugin of global.pluginHooks) {
        if (plugin.onMessage) {
          try {
            await plugin.onMessage(senal, mek);
          } catch (e) {
            console.log("onMessage error:", e);
          }
        }
      }
    }

    // Status broadcast handler
    if (mek.key?.remoteJid === 'status@broadcast') {
      const senderJid = mek.key.participant || mek.key.remoteJid || "unknown@s.whatsapp.net";
      const mentionJid = senderJid.includes("@s.whatsapp.net") ? senderJid : senderJid + "@s.whatsapp.net";

      // Auto seen status
      if (config.AUTO_STATUS_SEEN === "true") {
        try {
          await senal.readMessages([mek.key]);
          console.log(`[✓] Status seen: ${mek.key.id}`);
        } catch (e) {
          console.error("❌ Failed to mark status as seen:", e);
        }
      }

      // Auto react to status
      if (config.AUTO_STATUS_REACT === "true" && mek.key.participant) {
        try {
          const emojis = ['❤️', '💸', '😇', '🂡', '💥', '💯', '🔥', '💫', '💎', '💗', '🤍', '🖤', '💀', '🙌', '🙆', '🚩', '🥰', '👍', '😎', '🤎', '✅', '🫀', '🧡', '😍', '😄', '🌸', '🕊️', '🌷', '⛅', '🌟', '🗿', '💜', '💙', '🌍', '🖤', '💚'];
          const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

          await senal.sendMessage(mek.key.participant, {
            react: {
              text: randomEmoji,
              key: mek.key,
            }
          });

          console.log(`[✓] Reacted to status of ${mek.key.participant} with ${randomEmoji}`);
        } catch (e) {
          console.error("❌ Failed to react to status:", e);
        }
      }

      // 3️⃣ Forward text status — use chama + botName branding
      if (mek.message?.extendedTextMessage && !mek.message.imageMessage && !mek.message.videoMessage) {
        const text = mek.message.extendedTextMessage.text || "";
        if (text.trim().length > 0) {
          try {
            // Send chama bot identity card
            await senal.sendMessage(ownerNumber[0] + "@s.whatsapp.net", chama);

            // Send forwarded text status
            await senal.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
              text: `📝 *Text Status*\n🤖 Via: *${botName}*\n👤 From: @${mentionJid.split("@")[0]}\n\n${text}`,
              mentions: [mentionJid]
            });

            console.log(`✅ Text-only status from ${mentionJid} forwarded as ${botName}.`);
          } catch (e) {
            console.error("❌ Failed to forward text status:", e);
          }
        }
      }

      // 4️⃣ Forward media status — use chama + botName branding
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

          // Send chama bot identity card
          await senal.sendMessage(ownerNumber[0] + "@s.whatsapp.net", chama);

          // Send forwarded media status
          await senal.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
            [msgType === "imageMessage" ? "image" : "video"]: buffer,
            mimetype,
            caption: `🔥 *Forwarded Status*\n🤖 Via: *${botName}*\n👤 From: @${mentionJid.split("@")[0]}\n\n${captionText}`,
            mentions: [mentionJid]
          });

          console.log(`✅ Media status from ${mentionJid} forwarded as ${botName}.`);
        } catch (err) {
          console.error("❌ Failed to download or forward media status:", err);
        }
      }
    }

    const m = sms(senal, mek);
    const type = getContentType(mek.message);
    const from = mek.key.remoteJid;
    const body = type === 'conversation' ? mek.message.conversation : mek.message[type]?.text || mek.message[type]?.caption || '';
    const isCmd = body.startsWith(prefix);
    const commandName = isCmd ? body.slice(prefix.length).trim().split(" ")[0].toLowerCase() : '';
    const args = body.trim().split(/ +/).slice(1);
    const q = args.join(' ');

    const sender = mek.key.fromMe ? senal.user.id : (mek.key.participant || mek.key.remoteJid);
    const senderNumber = sender.split('@')[0];
    const isGroup = from.endsWith('@g.us');
    const botNumber = senal.user.id.split(':')[0];
    const pushname = mek.pushName || 'Sin Nombre';
    const isMe = botNumber.includes(senderNumber);
    const isOwner = ownerNumber.includes(senderNumber) || isMe;
    const botNumber2 = await jidNormalizedUser(senal.user.id);

    const groupMetadata = isGroup ? await senal.groupMetadata(from).catch(() => {}) : '';
    const groupName = isGroup ? groupMetadata.subject : '';
    const participants = isGroup ? groupMetadata.participants : '';
    const groupAdmins = isGroup ? await getGroupAdmins(participants) : '';
    const isBotAdmins = isGroup ? groupAdmins.includes(botNumber2) : false;
    const isAdmins = isGroup ? groupAdmins.includes(sender) : false;

    const reply = (text) => senal.sendMessage(from, { text }, { quoted: mek });

    if (isCmd) {
      const cmd = commands.find((c) => c.pattern === commandName || (c.alias && c.alias.includes(commandName)));
      if (cmd) {
        if (cmd.react) senal.sendMessage(from, { react: { text: cmd.react, key: mek.key } });
        try {
          // 5️⃣ Pass botName and chama into every command handler context
          cmd.function(senal, mek, m, {
            from, quoted: mek, body, isCmd, command: commandName, args, q,
            isGroup, sender, senderNumber, botNumber2, botNumber, pushname,
            isMe, isOwner, groupMetadata, groupName, participants, groupAdmins,
            isBotAdmins, isAdmins, reply,
            botName, chama, getBotVCard,
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
          // 6️⃣ Pass botName and chama into reply handlers too
          await handler.function(senal, mek, m, {
            from, quoted: mek, body: replyText, sender, reply,
            botName, chama, getBotVCard,
          });
          break;
        } catch (e) {
          console.log("Reply handler error:", e);
        }
      }
    }
  });

  senal.ev.on('messages.update', async (updates) => {
    if (global.pluginHooks) {
      for (const plugin of global.pluginHooks) {
        if (plugin.onDelete) {
          try {
            await plugin.onDelete(senal, updates);
          } catch (e) {
            console.log("onDelete error:", e);
          }
        }
      }
    }
  });
}

ensureSessionFile();

app.get("/", (req, res) => {
  res.send(`Hey, ${botName} started✅`);
});

app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
