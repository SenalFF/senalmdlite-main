// ================= Required Modules =================
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  fetchLatestBaileysVersion,
  Browsers,
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

// ================= Express Server =================
const app = express();
const port = process.env.PORT || 8000;

app.get('/', (req, res) => res.send('Hey, Senal-MD started ✅'));
app.listen(port, () => console.log(`🌐 Server listening on http://localhost:${port}`));

// ================= Config =================
const prefix = config.PREFIX || '.';
const ownerNumber = [config.BOT_OWNER || '94769872326'];
const botName = config.BOT_NAME || 'Senal MD';
const authDir = path.join(__dirname, '/auth_info_baileys/');
const credsPath = path.join(authDir, 'creds.json');

// ================= Reconnection State =================
let retryCount = 0;
let isReconnecting = false;
const maxRetries = 10;
const baseDelay = 3000;

// ================= Fake Quoted Message (Meta AI style) =================
const chama = {
  key: {
    remoteJid: 'status@broadcast',
    participant: '0@s.whatsapp.net',
    fromMe: false,
    id: 'META_AI_FAKE_ID_TS',
  },
  message: {
    contactMessage: {
      displayName: botName,
      vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`,
    },
  },
};

// ================= Ensure Session File =================
async function ensureSessionFile() {
  if (!fs.existsSync(credsPath)) {
    if (!config.SESSION_ID) {
      console.error('❌ SESSION_ID is missing in config/env. Cannot restore session.');
      process.exit(1);
    }

    console.log('🔄 creds.json not found. Downloading session from MEGA...');
    fs.mkdirSync(authDir, { recursive: true });

    try {
      const filer = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`);

      await new Promise((resolve, reject) => {
        filer.download((err, data) => {
          if (err) return reject(err);
          fs.writeFileSync(credsPath, data);
          resolve();
        });
      });

      console.log('✅ Session downloaded. Starting bot...');
      setTimeout(connectToWA, 2000);
    } catch (err) {
      console.error('❌ Failed to download session from MEGA:', err.message);
      process.exit(1);
    }
  } else {
    console.log('✅ Session file found. Starting bot...');
    setTimeout(connectToWA, 1000);
  }
}

// ================= Connect to WhatsApp =================
async function connectToWA() {
  if (retryCount >= maxRetries) {
    console.error(`❌ Max reconnection attempts (${maxRetries}) reached. Check your SESSION_ID.`);
    process.exit(1);
  }

  try {
    console.log(`🧬 Connecting ${botName}...`);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // ✅ KEY FIX: fetchLatestBaileysVersion hits a dead URL in this fork
    // Always use fallback so it never crashes here
    let version = [2, 3000, 1023089470];
    try {
      const fetched = await fetchLatestBaileysVersion();
      if (fetched?.version) version = fetched.version;
    } catch {
      console.log('⚠️  Version fetch failed — using fallback version (safe to ignore).');
    }

    console.log(`📦 WA version: ${version.join('.')}`);
    console.log(`🔑 Session loaded: ${!!state?.creds?.me}`);

    // ⚠️ If session not loaded, it means creds.json is corrupt or expired
    if (!state?.creds?.me) {
      console.log('⚠️  Session creds are empty. Your SESSION_ID may be expired.');
      console.log('💡 Generate a new SESSION_ID and update config.');
    }

    const conn = makeWASocket({
      logger: P({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers('Chrome'),         // ✅ Dew-Baileys: single string arg
      auth: state,
      version,
      syncFullHistory: false,              // ✅ true causes memory crash on free hosts
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      getMessage: async () => ({ conversation: '' }), // ✅ Prevents crash on stale message keys
    });

    // ================= Connection Updates =================
    conn.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('📱 QR code received — your session is expired. Generate a new SESSION_ID.');
      }

      if (connection === 'connecting') {
        console.log('📡 Connecting to WhatsApp...');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(`⚠️  Connection closed. Status code: ${statusCode}`);

        if (loggedOut) {
          console.log('❌ Logged out from WhatsApp. Generate a new SESSION_ID.');
          process.exit(0);
        }

        // ✅ FIX: isReconnecting lock prevents stacked parallel reconnects
        if (!isReconnecting) {
          isReconnecting = true;
          retryCount++;
          const delay = baseDelay * Math.pow(2, Math.min(retryCount - 1, 5));
          console.log(`🔄 Reconnecting in ${delay / 1000}s (attempt ${retryCount}/${maxRetries})...`);
          setTimeout(() => {
            isReconnecting = false;
            connectToWA();
          }, delay);
        }
      }

      if (connection === 'open') {
        retryCount = 0;
        isReconnecting = false;
        console.log(`✅ ${botName} connected to WhatsApp!`);

        // Load plugins
        try {
          const pluginFiles = fs.readdirSync('./plugins/');
          let loaded = 0;
          pluginFiles.forEach((plugin) => {
            if (path.extname(plugin).toLowerCase() === '.js') {
              try {
                require(`./plugins/${plugin}`);
                loaded++;
              } catch (e) {
                console.error(`❌ Plugin load error [${plugin}]:`, e.message);
              }
            }
          });
          console.log(`✅ Loaded ${loaded}/${pluginFiles.length} plugins`);
        } catch (e) {
          console.error('❌ Could not read plugins directory:', e.message);
        }

        // Send startup message to owner
        try {
          const upMsg = config.ALIVE_MSG || `${botName} connected ✅\n\nPREFIX: ${prefix}`;
          const aliveImg = config.ALIVE_IMG || null;

          if (aliveImg) {
            await conn.sendMessage(ownerNumber[0] + '@s.whatsapp.net', {
              image: { url: aliveImg },
              caption: upMsg,
            });
          } else {
            await conn.sendMessage(ownerNumber[0] + '@s.whatsapp.net', { text: upMsg });
          }
        } catch (e) {
          console.error('⚠️  Could not send startup message:', e.message);
        }
      }
    });

    conn.ev.on('creds.update', saveCreds);

    // ================= Handle Incoming Messages =================
    conn.ev.on('messages.upsert', async ({ messages }) => {
      try {
        // Handle message acks
        for (const msg of messages) {
          if (msg.messageStubType === 68) {
            try { await conn.sendMessageAck(msg.key); } catch {}
          }
        }

        const mek = messages[0];
        if (!mek?.message) return;

        // Unwrap ephemeral messages
        mek.message =
          getContentType(mek.message) === 'ephemeralMessage'
            ? mek.message.ephemeralMessage.message
            : mek.message;

        // Handle status@broadcast
        if (mek.key.remoteJid === 'status@broadcast') {
          if (config.AUTO_READ_STATUS === true || config.AUTO_READ_STATUS === 'true') {
            try { await conn.readMessages([mek.key]); } catch {}
          }
          return;
        }

        const m = sms(conn, mek);
        const type = getContentType(mek.message);
        const from = mek.key.remoteJid;

        // ================= Parse Body =================
        let body = '';
        if (type === 'conversation')
          body = mek.message.conversation;
        else if (type === 'extendedTextMessage')
          body = mek.message.extendedTextMessage.text;
        else if (type === 'imageMessage')
          body = mek.message.imageMessage?.caption || '';
        else if (type === 'videoMessage')
          body = mek.message.videoMessage?.caption || '';
        else if (type === 'buttonsResponseMessage')
          body = mek.message.buttonsResponseMessage.selectedButtonId;
        else if (type === 'listResponseMessage')
          body = mek.message.listResponseMessage.singleSelectReply.selectedRowId;
        else if (type === 'templateButtonReplyMessage')
          body = mek.message.templateButtonReplyMessage.selectedId;
        else
          body = mek.message[type]?.text || mek.message[type]?.caption || '';

        const isCmd = body.startsWith(prefix);
        const commandName = isCmd
          ? body.slice(prefix.length).trim().split(' ')[0].toLowerCase()
          : '';
        const args = body.trim().split(/ +/).slice(1);
        const q = args.join(' ');

        const sender = mek.key.fromMe
          ? conn.user.id
          : (mek.key.participant || mek.key.remoteJid);
        const senderNumber = sender.split('@')[0];
        const isGroup = from.endsWith('@g.us');
        const botNumber = conn.user.id.split(':')[0];
        const pushname = mek.pushName || 'User';
        const isMe = botNumber.includes(senderNumber);
        const isOwner = ownerNumber.includes(senderNumber) || isMe;
        const botNumber2 = jidNormalizedUser(conn.user.id);

        // Fetch group metadata only when in a group
        let groupMetadata = null, groupName = '', participants = [];
        let groupAdmins = [], isBotAdmins = false, isAdmins = false;
        if (isGroup) {
          try {
            groupMetadata = await conn.groupMetadata(from);
            groupName = groupMetadata.subject;
            participants = groupMetadata.participants;
            groupAdmins = await getGroupAdmins(participants);
            isBotAdmins = groupAdmins.includes(botNumber2);
            isAdmins = groupAdmins.includes(sender);
          } catch {}
        }

        const reply = (text, extra = {}) =>
          conn.sendMessage(from, { text, ...extra }, { quoted: chama });

        // ================= Button Handler =================
        if (type === 'buttonsResponseMessage') {
          const btnId = mek.message.buttonsResponseMessage.selectedButtonId;
          for (const plugin of commands) {
            if (plugin.buttonHandler) {
              try { await plugin.buttonHandler(conn, mek, btnId); } catch (e) {
                console.error('Button handler error:', e.message);
              }
            }
          }
        }

        // ================= Command Handler =================
        if (isCmd) {
          const cmd = commands.find(
            (c) => c.pattern === commandName ||
              (c.alias && c.alias.includes(commandName))
          );

          if (cmd) {
            // ✅ React guard — won't crash on bad JIDs
            if (cmd.react) {
              try {
                await conn.sendMessage(from, {
                  react: { text: cmd.react, key: mek.key },
                });
              } catch {}
            }

            try {
              await cmd.function(conn, mek, m, {
                from,
                quoted: mek,
                body,
                isCmd,
                command: commandName,
                args,
                q,
                isGroup,
                sender,
                senderNumber,
                botNumber2,
                botNumber,
                pushname,
                isMe,
                isOwner,
                groupMetadata,
                groupName,
                participants,
                groupAdmins,
                isBotAdmins,
                isAdmins,
                reply,
                prefix,
                conn,
              });
            } catch (e) {
              console.error('[PLUGIN ERROR]', e);
              reply('⚠️ An error occurred while executing that command.');
            }
          }
        }

        // ================= Reply Handlers =================
        for (const handler of replyHandlers) {
          if (handler.filter(body, { sender, message: mek })) {
            try {
              await handler.function(conn, mek, m, {
                from, quoted: mek, body, sender, reply,
              });
              break;
            } catch (e) {
              console.error('Reply handler error:', e.message);
            }
          }
        }

      } catch (err) {
        // ✅ Catch-all: one bad message never kills the whole listener
        console.error('❌ Message handler error:', err.message);
      }
    });

    // ================= Group Participant Updates =================
    conn.ev.on('group-participants.update', async (update) => {
      try {
        for (const plugin of commands) {
          if (plugin.on === 'group-participants.update') {
            await plugin.function(conn, update);
          }
        }
      } catch (e) {
        console.error('❌ Group update error:', e.message);
      }
    });

    // ================= Call Events =================
    conn.ev.on('call', async (callList) => {
      for (const call of callList) {
        for (const plugin of commands) {
          if (plugin.on === 'call') {
            try { await plugin.function(conn, call); } catch {}
          }
        }
      }
    });

  } catch (err) {
    console.error('❌ connectToWA() crashed:', err.message);
    if (!isReconnecting) {
      isReconnecting = true;
      retryCount++;
      const delay = baseDelay * Math.pow(2, Math.min(retryCount - 1, 5));
      setTimeout(() => {
        isReconnecting = false;
        connectToWA();
      }, delay);
    }
  }
}

// ================= Start =================
ensureSessionFile();
