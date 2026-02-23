const { cmd } = require("../command");
const axios = require("axios");

cmd(
  {
    pattern: "cinedetails",
    alias: ["cdets", "movieinfo", "cid"],
    react: "🎬",
    desc: "Get full movie/series details from Cinesubz",
    category: "search",
    filename: __filename,
  },
  async (test, mek, m, { q, reply, from }) => {
    try {
      if (!q) {
        return reply(
          "❌ *Please provide a Cinesubz movie URL!*\n\n" +
          "📌 *Example:*\n`.cinedetails https://cinesubz.lk/movies/rrr-2022-sinhala-sub/`"
        );
      }

      if (!q.startsWith("http")) {
        return reply("⚠️ *Please provide a valid Cinesubz URL!*\n🔗 Example: `https://cinesubz.lk/movies/rrr-2022-sinhala-sub/`");
      }

      await test.sendMessage(from, { react: { text: "⏳", key: mek.key } });

      const res = await axios.get(
        `https://cinesubz-v3.vercel.app/api/details?url=${encodeURIComponent(q)}`
      );
      const d = res.data;

      if (!d || !d.title) {
        await test.sendMessage(from, { react: { text: "❌", key: mek.key } });
        return reply("⚠️ *No details found for this URL.*");
      }

      const castList = d.cast && d.cast.length > 0
        ? d.cast.slice(0, 5).map(c => `• ${c.name} _(${c.role})_`).join("\n")
        : "N/A";

      const genres = d.genres && d.genres.length > 0
        ? d.genres.join(", ")
        : "N/A";

      const caption =
`┏━━━━━━━━━━━━━━━━━━━━━┓
┃   🎬 *Seanal MD | Cinesubz*   ┃
┗━━━━━━━━━━━━━━━━━━━━━┛

🎞️ *${d.title}*
━━━━━━━━━━━━━━━━━━━━━━━

📝 *Type:*       ${d.type === "movie" ? "🎬 Movie" : "📺 Series"}
🌐 *Language:*   ${genres.includes("Telugu") ? "Telugu" : genres.includes("Tamil") ? "Tamil" : genres.includes("Hindi") ? "Hindi" : "N/A"}
⏱️ *Duration:*   ${d.runtime || "N/A"}
🎞️ *Quality:*    ${d.quality || "N/A"}
📅 *Year:*       ${d.year || "N/A"}
⭐ *IMDb:*       ${d.imdb || "N/A"} / 10
🎭 *Genres:*     ${genres}
🎥 *Director:*   ${d.director || "N/A"}

🌟 *Cast:*
${castList}

━━━━━━━━━━━━━━━━━━━━━━━
🎞️ *Trailer:* ${d.trailer || "N/A"}
🔗 *Watch Online:* ${d.url}

━━━━━━━━━━━━━━━━━━━━━━━
📥 *To get download links:*
➡️ Use: *.cdl ${d.post_id}*
━━━━━━━━━━━━━━━━━━━━━━━
✨ *Powered by Seanal MD Bot*`;

      await test.sendMessage(
        from,
        {
          image: { url: d.poster },
          caption: caption,
        },
        { quoted: mek }
      );

      await test.sendMessage(from, { react: { text: "✅", key: mek.key } });

    } catch (err) {
      console.error("❌ Cinesubz Details Error:", err.message);
      await test.sendMessage(from, { react: { text: "❌", key: mek.key } });
      reply("❌ *An error occurred while fetching movie details.*");
    }
  }
);
