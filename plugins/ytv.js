require("dotenv").config();

const { cmd } = require("../command");
const yts = require("yt-search");
const axios = require("axios");

// ENV
const API_KEY = process.env.SENAL_YT_API_KEY;
const BASE_URL = process.env.SENAL_YT_BASE;

if (!API_KEY || !BASE_URL) {
  throw new Error("Missing API config in .env");
}

// ================= MAIN COMMAND =================
cmd({
  pattern: "ytv",
  alias: ["ytvideo", "video"],
  desc: "🎬 Download YouTube video",
  category: "download",
  react: "🎬",
  filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply("❗Use: *.ytv <video name or link>*");

    await reply("⏳ *Searching video… Please wait!*");

    const search = await yts(q);
    const video = search.videos[0];
    if (!video?.videoId) return reply("❌ Video not found.");

    const caption = `
🎬 *${video.title}*
⏱ Duration: ${video.timestamp}
👁 Views: ${video.views.toLocaleString()}
📦 Upload limit: 2GB (WhatsApp)
👤 Developer: Mr Senal
    `.trim();

    const buttons = [
      { buttonId: `vd_${video.videoId}`, buttonText: { displayText: "⬇️ Download Video" }, type: 1 },
      { buttonId: `vt_${video.videoId}`, buttonText: { displayText: "🖼 Download Thumbnail" }, type: 1 },
      { buttonId: "api_usage", buttonText: { displayText: "ℹ️ API Usage" }, type: 1 }
    ];

    await conn.sendMessage(from, {
      image: { url: video.thumbnail },
      caption,
      footer: "🚀 Senal YT DL v4.5",
      buttons,
      headerType: 4
    }, { quoted: mek });

  } catch (err) {
    console.error("ytvideo error:", err);
    reply("❌ Error occurred.");
  }
});

// ================= BUTTON HANDLER =================
cmd({
  buttonHandler: async (conn, mek, btnId) => {
    const jid = mek.key.remoteJid;

    try {
      // DOWNLOAD VIDEO
      if (btnId.startsWith("vd_")) {
        const id = btnId.split("_")[1];

        const qButtons = [
          { buttonId: `vq_360_${id}`, buttonText: { displayText: "📹 360p" }, type: 1 },
          { buttonId: `vq_480_${id}`, buttonText: { displayText: "📹 480p" }, type: 1 },
          { buttonId: `vq_720_${id}`, buttonText: { displayText: "📹 720p HD" }, type: 1 },
          { buttonId: `vq_1080_${id}`, buttonText: { displayText: "📹 1080p FHD" }, type: 1 }
        ];

        return await conn.sendMessage(jid, {
          text: "🎞 *Select video quality*\n📦 WhatsApp max upload size: *2GB*",
          buttons: qButtons,
          footer: "Senal YT DL v4.5"
        }, { quoted: mek });
      }

      // QUALITY SELECT
      if (btnId.startsWith("vq_")) {
        const [, quality, videoId] = btnId.split("_");

        await conn.sendMessage(jid, {
          text: `
⏳ *Preparing video… Please wait!*

📦 *Important Notice*
WhatsApp allows a *maximum upload size of 2GB*.
If the selected quality exceeds this limit,
the download will be stopped automatically.

🎬 Selected quality: ${quality}p
👤 Developer: Mr Senal
          `.trim()
        }, { quoted: mek });

        const apiUrl =
          `${BASE_URL}/download?id=${videoId}&format=${quality}&key=${API_KEY}`;

        const { data } = await axios.get(apiUrl, { timeout: 20000 });
        if (!data?.url || !data?.size) throw new Error("Invalid API response");

        const maxSize = 2 * 1024 * 1024 * 1024;
        if (data.size > maxSize) {
          return await conn.sendMessage(jid, {
            text: "❌ File too large for WhatsApp (2GB limit). Try lower quality."
          }, { quoted: mek });
        }

        await conn.sendMessage(jid, {
          document: { url: data.url },
          mimetype: "video/mp4",
          fileName: `${videoId}_${quality}p.mp4`,
          caption: `✅ Video sent\n🎬 Quality: ${quality}p\n👤 Mr Senal`
        }, { quoted: mek });
      }

      // THUMBNAIL
      if (btnId.startsWith("vt_")) {
        const id = btnId.split("_")[1];
        const thumb = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

        return await conn.sendMessage(jid, {
          image: { url: thumb },
          caption: "🖼 Video Thumbnail\n👤 Mr Senal"
        }, { quoted: mek });
      }

      // API USAGE
      if (btnId === "api_usage") {
        return await conn.sendMessage(jid, {
          text: `
🧠 *Senal YT DL API*
👨‍💻 Developer: Mr Senal
📦 Version: 4.5

🔗 Base URL:
https://v4-yt.vercel.app

⬇️ Video:
GET /download?id=VIDEO_ID&format=720&key=******

🎵 Audio:
GET /download?id=VIDEO_ID&format=mp3&key=******

🔒 API key hidden for security
          `.trim()
        }, { quoted: mek });
      }

    } catch (err) {
      console.error("ytvideo button error:", err);
      await conn.sendMessage(jid, {
        text: "❌ Failed to process request."
      }, { quoted: mek });
    }
  }
});
          
