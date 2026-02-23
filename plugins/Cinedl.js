const { cmd } = require("../command");

const CINEDL_API = "https://cinedl.vercel.app";

const pendingDownload = {};

cmd({
  pattern: "download",
  alias: ["dl", "cdl"],
  react: "⬇️",
  desc: "Download movie from Cinesubz by Post ID",
  category: "download",
  filename: __filename
}, async (danuwa, mek, m, { from, q, sender, reply }) => {
  if (!q) return reply(`*⬇️ Movie Download*\nUsage: .download POST_ID\nExample: .download 34619`);

  const postId = q.trim();

  reply(`*⏳ Preparing download...*\nPost ID: ${postId}`);

  try {
    await danuwa.sendMessage(from, {
      document: {
        url: `${CINEDL_API}/download?post=${postId}&filename=movie.mp4`
      },
      mimetype: "video/mp4",
      fileName: `movie_${postId}.mp4`,
      caption: `*🎬 Movie Download*\n*📌 Post ID:* ${postId}\n\n*🍿 Enjoy!*`
    }, { quoted: mek });

    await danuwa.sendMessage(from, { react: { text: "✅", key: m.key } });

  } catch (error) {
    await danuwa.sendMessage(from, { react: { text: "❌", key: m.key } });
    reply(`*❌ Download failed:* ${error.message}`);
  }
});
