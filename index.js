// ================= Required Modules =================
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  fetchLatestBaileysVersion,
  Browsers,
} = require("dew-baileys");

const fs = require("fs");
const P = require("pino");
const path = require("path");
const axios = require("axios");
const express = require("express");
const config = require("./config");
const { sms } = require("./lib/msg");

// ================= Owner =================
const ownerNumber = [config.OWNER_NUMBER || "94769872326"];

// ================= Bot Info =================
const botName = "Senal MD";
const chama = {
  key: {
    remoteJid: "status@broadcast",
    participant: "0@s.whatsapp.net",
    fromMe: false,
    id: "META_AI_FAKE_ID_TS",
  },
  message: {
    contactMessage: {
      displayName: botName,
      vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`,
    },
  },
};

//=================== SESSION AUTH ============================
const authPath = path.join(__dirname, "/auth_info_baileys");
const credsFile = path.join(authPath, "creds.json");

if (!fs.existsSync(authPath)) fs.mkdirSync(authPath);

if (!fs.existsSync(credsFile)) {
  if (!config.SESSION_ID) {
    console.log("❌ Please add your SESSION_ID in .env!");
    process.exit(1);
  }
  
  const { File } = require("megajs");
  const sessdata = config.SESSION_ID;
  
  try {
    const file = File.fromURL(`https://mega.nz/file/${sessdata}`);
    const writeStream = fs.createWriteStream(credsFile);
    
    file.download()
      .on("finish", () => {
        console.log("✅ Session downloaded successfully");
      })
      .on("error", (err) => {
        console.error("❌ Session download failed:", err.message);
        if (fs.existsSync(credsFile)) {
          fs.unlinkSync(credsFile); // Remove corrupted file
        }
        process.exit(1);
      })
      .pipe(writeStream)
      .on("error", (err) => {
        console.error("❌ Session file write failed:", err.message);
        if (fs.existsSync(credsFile)) {
          fs.unlinkSync(credsFile); // Remove corrupted file
        }
        process.exit(1);
      });
  } catch (err) {
    console.error("❌ Session loading error:", err.message);
    process.exit(1);
  }
}

// ================= Express Server =================
const app = express();
const port = process.env.PORT || 8000;

app.get("/", (req, res) => res.send("Hey, Senal MD started ✅"));

app.listen(port, () => console.log(`🌐 Server listening on http://localhost:${port}`));

// ================= Reconnection State =================
let retryCount = 0;
const maxRetries = 5;
const baseDelay = 3000; // 3 seconds

// ================= Connect to WhatsApp =================
async function connectToWA() {
  try {
    // Prevent too many reconnection attempts
    if (retryCount > maxRetries) {
      console.error(`❌ Max reconnection attempts (${maxRetries}) reached. Please check your configuration.`);
      process.exit(1);
    }

    if (retryCount > 0) {
      const delay = baseDelay * Math.pow(2, retryCount - 1); // Exponential backoff
      console.log(`⏳ Reconnecting in ${delay / 1000}s (attempt ${retryCount}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

  
    const envConfig = await readEnv();
    const prefix = envConfig.PREFIX || ".";

    console.log("⏳ Connecting Senal MD BOT...");

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const conn = makeWASocket({
      logger: P({ level: "silent" }),
      printQRInTerminal: false,
      browser: ["Ubuntu", "Firefox", "20.0.04"],
      syncFullHistory: true,
      auth: state,
      version,
      markOnlineOnConnect: true,
      syncFullHistory: false,
    });

    // ================= Connection Updates =================
    conn.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === "connecting") {
        console.log("📡 Attempting to connect...");
      } else if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect) {
          retryCount++;
          console.log(`⚠️ Connection closed. Error:`, lastDisconnect?.error);
          connectToWA();
        } else {
          console.log("❌ Logged out from WhatsApp");
          process.exit(0);
        }

      } else if (connection === "open") {
        retryCount = 0; // Reset retry counter on successful connection
        console.log("✅ Bot connected to WhatsApp");
        console.log("🔌 Connection is stable");

        // Load plugins
        try {
          const plugins = fs.readdirSync("./plugins/");
          let loadedCount = 0;
          
          plugins.forEach((plugin) => {
            if (path.extname(plugin).toLowerCase() === ".js") {
              try {
                require("./plugins/" + plugin);
                loadedCount++;
              } catch (err) {
                console.error(`❌ Error loading plugin ${plugin}:`, err.message);
              }
            }
          });
          
          console.log(`✅ Plugins loaded (${loadedCount}/${plugins.length})`);
        } catch (err) {
          console.error("❌ Error reading plugins directory:", err.message);
        }

        const upMsg = envConfig.ALIVE_MSG || `Senal MD connected ✅\nPrefix: ${prefix}`;
        const aliveImg = envConfig.ALIVE_IMG || null;

        const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`;

        // ✅ Async IIFE — needed because connection.update callback is not async
        (async () => {
          try {
            let imageBuffer = null;

            if (aliveImg) {
              if (aliveImg.startsWith("http")) {
                // Remote URL — use axios for reliable fetching
                try {
                  const response = await axios.get(aliveImg, {
                    responseType: "arraybuffer",
                    timeout: 30000,
                  });
                  imageBuffer = Buffer.from(response.data);
                  console.log("✅ Alive image fetched successfully");
                } catch (imgErr) {
                  console.error("⚠️ Failed to fetch alive image:", imgErr.message);
                }
              } else {
                // Local file path
                if (fs.existsSync(aliveImg)) {
                  imageBuffer = fs.readFileSync(aliveImg);
                  console.log("✅ Alive image loaded from local path");
                } else {
                  console.error("⚠️ Local alive image not found:", aliveImg);
                }
              }
            }

            // Send image or fallback to text
            if (imageBuffer) {
              await conn.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
                image: imageBuffer,
                caption: upMsg,
              });
            } else {
              await conn.sendMessage(ownerNumber[0] + "@s.whatsapp.net", { text: upMsg });
            }

            // Send Meta AI contact card
            await conn.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
              contacts: {
                displayName: botName,
                contacts: [{ vcard }],
              },
            });

          } catch (err) {
            console.error("❌ Error sending startup messages:", err);
          }
        })();
      }
    });

    conn.ev.on("creds.update", saveCreds);

    // ================= Handle Incoming Messages =================
    conn.ev.on("messages.upsert", async (mek) => {
      mek = mek.messages[0];
      if (!mek?.message) return;

      // Handle ephemeral messages
      mek.message =
        getContentType(mek.message) === "ephemeralMessage"
          ? mek.message.ephemeralMessage.message
          : mek.message;

      // Auto-read status updates
      if (
        mek.key &&
        mek.key.remoteJid === "status@broadcast" &&
        config.AUTO_READ_STATUS === "true"
      ) {
        await conn.readMessages([mek.key]);
      }

      const m = sms(conn, mek);
      const from = mek.key.remoteJid;
      const type = getContentType(mek.message);

      // ================= Parse Body =================
      let body = "";
      const contentType = getContentType(mek.message);

      if (contentType === "conversation") body = mek.message.conversation;
      else if (contentType === "extendedTextMessage") body = mek.message.extendedTextMessage.text;
      else if (contentType === "buttonsResponseMessage") body = mek.message.buttonsResponseMessage.selectedButtonId;
      else if (contentType === "listResponseMessage") body = mek.message.listResponseMessage.singleSelectReply.selectedRowId;

      const isCmd = body.startsWith(prefix);
      const commandText = isCmd
        ? body.slice(prefix.length).trim().split(/ +/)[0].toLowerCase()
        : body.toLowerCase();

      const args = body.trim().split(/ +/).slice(isCmd ? 1 : 0);
      const q = args.join(" ");
      const isGroup = from.endsWith("@g.us");
      const sender = mek.key.fromMe
        ? conn.user.id.split(":")[0] + "@s.whatsapp.net"
        : mek.key.participant || mek.key.remoteJid;
      const senderNumber = sender.split("@")[0];
      const botNumber = conn.user.id.split(":")[0];
      const pushname = mek.pushName || "No Name";
      const isMe = botNumber.includes(senderNumber);
      const isOwner = ownerNumber.includes(senderNumber) || isMe;

      const reply = (text, extra = {}) => {
        return conn.sendMessage(from, { text, ...extra }, { quoted: chama });
      };

      // ===== Load commands =====
      const events = require("./command");

      // ===== BUTTON HANDLER (GLOBAL SAFE) =====
      if (contentType === "buttonsResponseMessage") {
        const btnId = mek.message.buttonsResponseMessage.selectedButtonId;
        for (const plugin of events.commands) {
          if (plugin.buttonHandler) {
            try {
              await plugin.buttonHandler(conn, mek, btnId);
            } catch (err) {
              console.error("Button handler error:", err);
            }
          }
        }
      }

      // ===== COMMAND EXECUTION =====
      const cmd = events.commands.find((c) => {
        if (!c.pattern) return false;
        if (c.pattern.toLowerCase() === commandText) return true;
        if (c.alias && c.alias.map((a) => a.toLowerCase()).includes(commandText)) return true;
        return false;
      });

      if (cmd) {
        if (cmd.react) {
          await conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } });
        }
        try {
          await cmd.function(conn, mek, m, {
            from,
            body,
            isCmd,
            command: commandText,
            args,
            q,
            isGroup,
            sender,
            senderNumber,
            botNumber2: jidNormalizedUser(conn.user.id),
            botNumber,
            pushname,
            isMe,
            isOwner,
            reply,
          });
        } catch (e) {
          console.error("[PLUGIN ERROR]", e);
          reply("⚠️ An error occurred while executing the command.");
        }
      }
    });

  } catch (err) {
    console.error("❌ Error connecting to WhatsApp:", err.message);
    console.error("Stack:", err.stack);
    retryCount++;
    connectToWA();
  }
}

// Start bot after 4 seconds
setTimeout(() => {
  if (fs.existsSync(credsFile)) {
    connectToWA();
  } else {
    console.log("⏳ Waiting for session file to download...");
    const checkInterval = setInterval(() => {
      if (fs.existsSync(credsFile)) {
        clearInterval(checkInterval);
        console.log("✅ Session file ready, starting bot...");
        connectToWA();
      }
    }, 1000);
    
    // Timeout after 2 minutes
    setTimeout(() => {
      clearInterval(checkInterval);
      console.error("❌ Session file download timeout");
      process.exit(1);
    }, 120000);
  }
}, 4000);
