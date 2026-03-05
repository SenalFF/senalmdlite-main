const { cmd } = require("../command");
const axios = require("axios");

const CINEDL_API = "https://cinedl-production.up.railway.app";

cmd({
  pattern: "download",
  alias: ["dl", "cdl"],
  react: "⬇️",
  desc: "Download movie from Cinesubz by Post ID",
  category: "download",
  filename: __filename
}, async (danuwa, mek, m, { from, q, sender, reply }) => {
  if (!q) return reply(
    `*⬇️ Movie Download*\n` +
    `Usage: *.cdl POST_ID*\n` +
    `Example: *.cdl 34619*\n\n` +
    `💡 Get Post ID using *.cinesubz* or *.cinedetails*`
  );

  const postId = q.trim();

  await danuwa.sendMessage(from, { react: { text: "⏳", key: mek.key } });
  reply(`*⏳ Fetching movie info...*`);

  try {
    // Fetch info from your API
    const infoRes = await axios.get(`${CINEDL_API}/info?post=${postId}`);
    const { video_url } = infoRes.data;

    if (!video_url) throw new Error("No video URL found");

    // Extract filename from video_url
    // e.g. "https://player1.sonic-cloud.online/CineSubz.com - Faster.2010.BrRip-720P.mp4"
    // → "CineSubz.com - Faster.2010.BrRip-720P.mp4"
    const fileName = decodeURIComponent(video_url.split("/").pop());

    // Extract movie title from filename (remove extension)
    const movieTitle = fileName.replace(/\.[^/.]+$/, "");

    reply(`*📥 Sending:* ${movieTitle}\n_Please wait..._`);

    await danuwa.sendMessage(from, {
      document: {
        url: `${CINEDL_API}/download?post=${postId}&filename=${encodeURIComponent(fileName)}`
      },
      mimetype: "video/mp4",
      fileName: fileName,
      caption:
`┏━━━━━━━━━━━━━━━━━━━━━┓
┃   🎬 *Senal MD | Cinesubz*   ┃
┗━━━━━━━━━━━━━━━━━━━━━┛

🎞️ *${movieTitle}*

━━━━━━━━━━━━━━━━━━━━━━━
✨ *Powered by Senal MD Bot*`
    }, { quoted: mek });

    await danuwa.sendMessage(from, { react: { text: "✅", key: mek.key } });

  } catch (error) {
    console.error("Download error:", error.message);
    await danuwa.sendMessage(from, { react: { text: "❌", key: mek.key } });
    reply(`*❌ Download failed:* ${error.message}`);
  }
});
