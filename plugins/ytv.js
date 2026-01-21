require("dotenv").config();

const { cmd } = require("../command");
const yts = require("yt-search");
const axios = require("axios");

// 🔐 ENV
const API_KEY = process.env.SENAL_YT_API_KEY;
const BASE_URL = process.env.SENAL_YT_BASE;

if (!API_KEY || !BASE_URL) {
  throw new Error("❌ Missing API config in .env");
}

// ================= VIDEO COMMAND =================
cmd({
  pattern: "ytv",
  alias: ["video", "ytvideo"],
  desc: "🎬 Download YouTube Video (360p / 720p / 1080p)",
  category: "download",
  react: "🎬",
  filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply("❗Please provide a YouTube link or video name.");

    await reply("⏳ *Searching video... Please wait sir!*");

    const search = await yts(q);
    const video = search.videos[0];
    if (!video?.videoId) return reply("❌ Video not found.");

    const caption = `
🎬 *${video.title}*
⏱ Duration: ${video.timestamp}
👤 Developer: Mr Senal
📦 Format: MP4
📤 Sent as: Document
    `.trim();

    const buttons = [
      { buttonId: `v360_${video.videoId}`, buttonText: { displayText: "📹 360p" }, type: 1 },
      { buttonId: `v720_${video.videoId}`, buttonText: { displayText: "📹 720p HD" }, type: 1 },
      { buttonId: `v1080_${video.videoId}`, buttonText: { displayText: "📹 1080p FHD" }, type: 1 }
    ];

    await conn.sendMessage(from, {
      image: { url: video.thumbnail },
      caption,
      footer: "🚀 Senal YT DL v4",
      buttons,
      headerType: 4
    }, { quoted: mek });

  } catch (err) {
    console.error("ytv error:", err);
    reply("❌ Error while processing video.");
  }
});

// ================= BUTTON HANDLER =================
cmd({
  buttonHandler: async (conn, mek, btnId) => {
    const jid = mek.key.remoteJid;

    try {
      if (!btnId.startsWith("v")) return;

      const [qTag, videoId] = btnId.split("_");
      const quality = qTag.replace("v", ""); // 360 / 720 / 1080

      await conn.sendMessage(jid, {
        text: "⏳ *Preparing video… Please wait, large files may take time!*"
      }, { quoted: mek });

      const apiUrl =
        `${BASE_URL}/download?id=${videoId}&format=${quality}&key=${API_KEY}`;

      const { data } = await axios.get(apiUrl, { timeout: 20000 });
      if (!data?.url || !data?.size) {
        throw new Error("Invalid API response");
      }

      // 📏 SIZE CHECK (2GB)
      const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
      if (data.size > maxSize) {
        return await conn.sendMessage(jid, {
          text: "❌ *File too large!* \nMaximum allowed size is 2GB."
        }, { quoted: mek });
      }

      // 📤 ALWAYS SEND AS DOCUMENT
      await conn.sendMessage(jid, {
        document: { url: data.url },
        mimetype: "video/mp4",
        fileName: `${videoId}_${quality}p.mp4`,
        caption: `✅ *Video sent*\n🎬 Quality: ${quality}p\n👤 Mr Senal`
      }, { quoted: mek });

    } catch (err) {
      console.error("video button error:", err);
      await conn.sendMessage(jid, {
        text: "❌ Failed to download video. Try lower quality."
      }, { quoted: mek });
    }
  }
});
    
