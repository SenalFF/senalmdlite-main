const { cmd } = require("../command");
const axios = require("axios");

const CINEDL_API = "https://cinedl.vercel.app";

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
    // Fetch movie title from cinesubz API using post ID
    let movieTitle = null;
    try {
      const infoRes = await axios.get(
        `https://cinesubz-v3.vercel.app/api/player?post=${postId}`
      );
      // Try to get title from details API
      if (infoRes.data && infoRes.data.iframe_url) {
        // Extract URL from iframe and get details
        const detailRes = await axios.get(
          `https://cinesubz-v3.vercel.app/api/details?post_id=${postId}`
        ).catch(() => null);

        if (detailRes?.data?.title) {
          movieTitle = detailRes.data.title;
        }
      }
    } catch (e) {
      // Title fetch failed, continue without title
    }

    // Clean title for filename
    const cleanTitle = movieTitle
      ? movieTitle.replace(/[^\w\s.-]/gi, "").trim()
      : `Movie_${postId}`;

    const fileName = `${cleanTitle}.mp4`;

    reply(`*📥 Sending:* ${movieTitle || `Post ID: ${postId}`}\n_Please wait..._`);

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

🎞️ *${movieTitle || `Post ID: ${postId}`}*

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
