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
const axios = require('axios');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { File } = require('megajs');

const config = require('./config');
const { sms, downloadMediaMessage } = require('./lib/msg');
const {
  getBuffer, getGroupAdmins, getRandom, h2k, isUrl, Json, runtime, sleep, fetchJson
} = require('./lib/functions');
const { commands, replyHandlers } = require('./command');

// ===== CONFIG =====
const ownerNumber = ['94769872326'];
const MASTER_SUDO = ['94769872326'];
const app = express();
const port = process.env.PORT || 8000;
const prefix = config.PREFIX || '.';
const authDir = path.join(__dirname, '/auth_info_baileys/');
const credsPath = path.join(authDir, 'creds.json');

// ===== RECONNECT STATE =====
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

// ===== ANTI DELETE PLUGIN =====
const antiDeletePlugin = require('./plugins/antidelete.js');
global.pluginHooks = global.pluginHooks || [];
global.pluginHooks.push(antiDeletePlugin);

// ===== SESSION RESTORE (MEGA) =====
async function ensureSessionFile() {
  // Clear session if RESET_SESSION=true (useful for Railway)
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
          console.log("📲 No valid session. Will use pairing code...");
          setTimeout(() => connectToWA(), 1000);
          return;
        }

        // Validate JSON before saving
        try {
          JSON.parse(data.toString());
          fs.writeFileSync(credsPath, data);
          console.log("✅ Session downloaded and saved. Starting bot...");
        } catch (e) {
          console.error("❌ Session file from MEGA is corrupted. Using pairing code...");
        }

        setTimeout(() => connectToWA(), 2000);
      });
    } else {
      console.log("⚠️ No SESSION_ID. Will use pairing code...");
      setTimeout(() => connectToWA(), 1000);
    }
  } else {
    console.log("✅ Session file found. Connecting...");
    setTimeout(() => connectToWA(), 1000);
  }
}

// ===== MAIN CONNECT =====
async function connectToWA() {
  console.log("🔌 Connecting to WhatsApp...");

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
    console.log(`ℹ️ WA version: ${version.join('.')}`);
  } catch (e) {
    console.warn("⚠️ Could not fetch WA version, using fallback.");
    version = [2, 3000, 1015901307];
  }

  const ishan = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Mac OS', 'Firefox', '14.4.1'],
    auth: state,
    version,
    syncFullHistory: true,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
  });

  // ===== PAIRING CODE (for Railway/cloud) =====
  const isRegistered = ishan.authState.creds.registered;
  console.log(`ℹ️ Session registered: ${isRegistered}`);

  if (!isRegistered) {
    const phoneNumber = ownerNumber[0].replace(/[^0-9]/g, '');
    console.log(`📲 Requesting pairing code for +${phoneNumber}...`);
    setTimeout(async () => {
      try {
        const code = await ishan.requestPairingCode(phoneNumber);
        console.log(`\n╔══════════════════════════════════╗`);
        console.log(`║   🔑 PAIRING CODE: ${code}   ║`);
        console.log(`╚══════════════════════════════════╝\n`);
        console.log(`👉 WhatsApp → Linked Devices → Link a Device → Link with Phone Number`);
        console.log(`👉 Enter the code above`);
      } catch (e) {
        console.error("❌ Pairing code failed:", e.message);
      }
    }, 3000);
  } else {
    console.log("ℹ️ Already registered. Skipping pairing code.");
  }

  // ===== CONNECTION UPDATE =====
  ishan.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📱 QR Code (fallback):");
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`❌ Connection closed. Code: ${statusCode}`);

      if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
        console.log("🔒 Logged out. Clearing session...");
        fs.rmSync(authDir, { recursive: true, force: true });
        process.exit(1);

      } else if (statusCode === DisconnectReason.badSession) {
        console.log("💥 Bad session. Clearing and restarting...");
        fs.rmSync(authDir, { recursive: true, force: true });
        process.exit(1);

      } else if (statusCode === DisconnectReason.restartRequired) {
        console.log("🔄 Restart required. Reconnecting...");
        reconnectAttempts = 0;
        setTimeout(() => connectToWA(), 1000);

      } else {
        if (reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT} in 5s...`);
          setTimeout(() => connectToWA(), 5000);
        } else {
          console.error("🚫 Max reconnect attempts reached. Clearing session...");
          fs.rmSync(authDir, { recursive: true, force: true });
          process.exit(1);
        }
      }

    } else if (connection === 'open') {
      reconnectAttempts = 0;
      console.log('✅ Bot connected to WhatsApp');

      const up = `┎━━━━━━━━━━━━━━━━❖
┃❖ 🤖 𝗜𝗦𝗛𝗔𝗡 𝗦𝗣𝗔𝗥𝗞-𝕏 🚀
┃❖ 🟢 STATUS : ONLINE ✅
┃  ◄❖ ━━━━━━━━━━━━❖►
┃➤  ✒️ *PREFIX* : [${prefix}]
┃➤ ⚙️ *MODE* : Stable
┃➤ 🚀 *BUILD* : Production
┃➤ 🧬 *VERSION* : V3.0 ultra
┃➤ 💡 *TYPE* : .menu to command
┃➤ 🔐 *Secure & Private*
┃➤ *JOIN UPDATED =* https://whatsapp.com/channel/0029Vb7eEOGLY6dBNzl2IH0O
┃➤ *JOIN GROUP =* https://chat.whatsapp.com/C5jE3Tk7U0RBGcR6kwRSUi
┗━━━━━━━━━━━━━━━━❖

> ©𝙳𝚎𝚟𝚎𝚕𝚘𝚙𝚎𝚛 𝚋𝚢 𝙸𝚂𝙷𝙰𝙽-𝕏`;

      const botJid = ishan.user.id.split(":")[0] + "@s.whatsapp.net";

      try {
        await ishan.sendMessage(botJid, {
          image: { url: `https://files.catbox.moe/h1xuqv.jpg` },
          caption: up
        });
      } catch (e) {
        console.warn("⚠️ Could not send startup message:", e.message);
      }

      // ✅ newsletterFollow confirmed in Baileys v7 source (newsletter.ts:104)
      try {
        await ishan.newsletterFollow("120363424336206242@newsletter");
        console.log("✅ Auto joined official channel");
      } catch (e) {
        console.log("⚠️ Channel join failed:", e.message);
      }

      // Load plugins
      fs.readdirSync("./plugins/").forEach((plugin) => {
        if (path.extname(plugin).toLowerCase() === ".js") {
          try {
            require(`./plugins/${plugin}`);
          } catch (e) {
            console.error(`❌ Plugin load failed [${plugin}]:`, e.message);
          }
        }
      });

      console.log("✅ All plugins loaded.");
    }
  });

  ishan.ev.on('creds.update', saveCreds);

  // ===== MESSAGE UPSERT =====
  ishan.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.messageStubType === 68) {
        await ishan.sendMessageAck(msg.key);
      }
    }

    const mek = messages[0];
    if (!mek || !mek.message) return;

    mek.message = getContentType(mek.message) === 'ephemeralMessage'
      ? mek.message.ephemeralMessage.message
      : mek.message;

    const from = mek.key.remoteJid;
    const sender = mek.key.fromMe ? ishan.user.id : (mek.key.participant || mek.key.remoteJid);
    const senderNumber = sender.split('@')[0];
    const isGroup = from.endsWith('@g.us');
    const botNumber = ishan.user.id.split(':')[0];
    const pushname = mek.pushName || 'Sin Nombre';
    const isMe = botNumber.includes(senderNumber);
    const isOwner = ownerNumber.includes(senderNumber) || isMe;
    const isSudo = MASTER_SUDO.includes(senderNumber);

    // ===== MODE FIREWALL =====
    const mode = (config.MODE || "public").toLowerCase();
    if (mode === "group" && !isGroup) return;
    if (mode === "inbox" && isGroup) return;
    if (mode === "private" && !(isOwner || isSudo)) return;

    // ===== STATUS HANDLER =====
    if (mek.key?.remoteJid === 'status@broadcast') {
      if (config.AUTO_STATUS_SEEN === "true") {
        try { await ishan.readMessages([mek.key]); } catch {}
      }

      if (config.AUTO_STATUS_REACT === "true" && mek.key.participant) {
        const emojis = ['❤️','💸','😇','🍂','💥','💯','🔥','💫','💎','💗','🤍','🖤','👀','🙌','🙆','🚩','🥰','💐','😎','🤎','✅','🫀','🧡','😁','😄','🌸','🕊️','🌷','⛅','🌟','🗿','💜','💙','🌝','🖤','💚'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        try {
          await ishan.sendMessage(mek.key.participant, {
            react: { text: randomEmoji, key: mek.key }
          });
        } catch {}
      }

      if (config.AUTO_STATUS_FORWARD === "true") {
        if (mek.message?.imageMessage || mek.message?.videoMessage) {
          try {
            const msgType = mek.message.imageMessage ? "imageMessage" : "videoMessage";
            const mediaMsg = mek.message[msgType];
            const stream = await downloadContentFromMessage(
              mediaMsg,
              msgType === "imageMessage" ? "image" : "video"
            );
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await ishan.sendMessage(botNumber + "@s.whatsapp.net", {
              [msgType === "imageMessage" ? "image" : "video"]: buffer,
              caption: `📥 Forwarded Status from @${senderNumber}`,
              mentions: [senderNumber + "@s.whatsapp.net"]
            });
          } catch (e) {
            console.error("❌ Status forward failed:", e.message);
          }
        }
      }

      // Plugin hooks for status messages
      if (global.pluginHooks) {
        for (const plugin of global.pluginHooks) {
          if (plugin.onMessage) {
            try { await plugin.onMessage(ishan, mek); } catch {}
          }
        }
      }

      return; // stop — don't process status as commands
    }

    // Plugin hooks for regular messages
    if (global.pluginHooks) {
      for (const plugin of global.pluginHooks) {
        if (plugin.onMessage) {
          try { await plugin.onMessage(ishan, mek); } catch {}
        }
      }
    }

    const m = sms(ishan, mek);
    const type = getContentType(mek.message);
    const body = type === 'conversation'
      ? mek.message.conversation
      : mek.message[type]?.text || mek.message[type]?.caption || '';

    const isCmd = body.startsWith(prefix);
    const commandName = isCmd ? body.slice(prefix.length).trim().split(" ")[0].toLowerCase() : '';
    const args = body.trim().split(/ +/).slice(1);
    const q = args.join(' ');

    const groupMetadata = isGroup ? await ishan.groupMetadata(from).catch(() => {}) : '';
    const groupName = isGroup ? groupMetadata?.subject : '';
    const participants = isGroup ? groupMetadata?.participants : '';
    const groupAdmins = isGroup ? await getGroupAdmins(participants) : '';
    const botNumber2 = await jidNormalizedUser(ishan.user.id);
    const isBotAdmins = isGroup ? groupAdmins.includes(botNumber2) : false;
    const isAdmins = isGroup ? groupAdmins.includes(sender) : false;

    const reply = (text) => ishan.sendMessage(from, { text }, { quoted: mek });

    // ===== COMMAND HANDLER =====
    if (isCmd) {
      const cmd = commands.find((c) =>
        c.pattern === commandName || (c.alias && c.alias.includes(commandName))
      );
      if (cmd) {
        if (cmd.react) ishan.sendMessage(from, { react: { text: cmd.react, key: mek.key } });
        try {
          cmd.function(ishan, mek, m, {
            from, quoted: mek, body, isCmd,
            command: commandName, args, q,
            isGroup, sender, senderNumber,
            botNumber2, botNumber, pushname,
            isMe, isOwner, isSudo,
            groupMetadata, groupName,
            participants, groupAdmins,
            isBotAdmins, isAdmins,
            reply,
          });
        } catch (e) {
          console.error("[PLUGIN ERROR]", e);
        }
      }
    }

    // ===== REPLY HANDLERS =====
    for (const handler of replyHandlers) {
      if (handler.filter(body, { sender, message: mek })) {
        try {
          await handler.function(ishan, mek, m, {
            from, quoted: mek, body, sender, reply,
          });
          break;
        } catch (e) {
          console.log("Reply handler error:", e);
        }
      }
    }
  });

  // ===== DELETE EVENT =====
  ishan.ev.on('messages.update', async (updates) => {
    if (global.pluginHooks) {
      for (const plugin of global.pluginHooks) {
        if (plugin.onDelete) {
          try { await plugin.onDelete(ishan, updates); } catch {}
        }
      }
    }
  });
}

// ===== START =====
ensureSessionFile();

app.get("/", (req, res) => {
  res.send("Hey, 𝗜𝗦𝗛𝗔𝗡 𝗦𝗣𝗔𝗥𝗞-𝕏 🚀 started ✅");
});

app.listen(port, () =>
  console.log(`Server listening on http://localhost:${port}`)
);
