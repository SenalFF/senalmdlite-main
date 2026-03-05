const { cmd } = require("../command");
const axios = require("axios");

cmd(
  {
    pattern: "cinesubz",
    alias: ["csearch", "moviesearch", "cs"],
    react: "🎬",
    desc: "Search movies/series on Cinesubz",
    category: "search",
    filename: __filename,
  },
  async (test, mek, m, { q, reply, from }) => {
    try {
      // 1. Validate input
      if (!q) return reply("❌ *Please provide a movie or series name!*\n\n📌 *Example:* `.cinesubz RRR`");

      // 2. Loading reaction
      await test.sendMessage(from, { react: { text: "⏳", key: mek.key } });

      // 3. Call Cinesubz API
      const res = await axios.get(
        `https://cinesubz-production.up.railway.app/api/search?q=${encodeURIComponent(q)}`
      );
      const data = res.data;

      // 4. Check results
      if (!data.results || data.results.length === 0) {
        await test.sendMessage(from, { react: { text: "❌", key: mek.key } });
        return reply("⚠️ *No results found!*\nTry a different movie or series name.");
      }

      // 5. Build stylish message
      let msg = "┏━━━━━━━━━━━━━━━━━━━━┓\n";
      msg += "┃  🎬 *Senal MD | Cinesubz*  ┃\n";
      msg += "┗━━━━━━━━━━━━━━━━━━━━┛\n\n";
      msg += `🔍 Results for: *${q}*\n`;
      msg += `📊 Found: *${data.results.length}* result(s)\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      // 6. Loop through results
      data.results.forEach((movie, index) => {
        msg += `💠 *${index + 1}.* ${movie.title}\n`;
        msg += `🆔 Post ID: \`${movie.post_id}\`\n`;
        msg += `🔗 ${movie.url}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      });

      msg += `\n✨ *Powered by Senal MD Bot*`;

      // 7. Send the message
      await test.sendMessage(
        from,
        { text: msg },
        { quoted: mek }
      );

      // 8. Success reaction
      await test.sendMessage(from, { react: { text: "✅", key: mek.key } });

    } catch (err) {
      console.error("❌ Cinesubz Search Error:", err.message);
      await test.sendMessage(from, { react: { text: "❌", key: mek.key } });
      reply("❌ *An error occurred while searching.*\nPlease try again later.");
    }
  }
);
