const { cmd } = require("../command");
const axios = require("axios");

const SUBZ_API = "https://subz-lk.vercel.app";

const pendingSearch = {};
const pendingDownload = {};

// ─────────────────────────────────────────
// HELPER: Check if download URL is valid & under 2GB
// ─────────────────────────────────────────
async function checkDownloadLink(url, sizeText) {
  // Skip Google Drive (can't direct download)
  if (url.includes("drive.google.com")) return false;

  // Parse size
  const sizeUpper = sizeText.toUpperCase();
  let sizeMB = 0;
  if (sizeUpper.includes("GB")) sizeMB = parseFloat(sizeUpper) * 1024;
  else if (sizeUpper.includes("MB")) sizeMB = parseFloat(sizeUpper);

  // Skip over 2GB
  if (sizeMB > 2048) return false;

  // Check if URL is reachable
  try {
    const res = await axios.head(url, { timeout: 8000, maxRedirects: 5 });
    return res.status < 400;
  } catch {
    try {
      // Try GET with range as fallback
      const res = await axios.get(url, {
        timeout: 8000,
        maxRedirects: 5,
        headers: { Range: "bytes=0-1" },
        responseType: "stream",
      });
      res.data.destroy();
      return res.status < 400;
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────
// COMMAND: .subz <movie name>
// ─────────────────────────────────────────
cmd(
  {
    pattern: "subz",
    alias: ["subzlk", "slk"],
    react: "🎬",
    desc: "Search movies on Subz.lk",
    category: "download",
    filename: __filename,
  },
  async (danuwa, mek, m, { from, q, sender, reply }) => {
    if (!q)
      return reply(
        `*🎬 Subz.lk Movie Search*\n` +
        `Usage: *.subz movie name*\n` +
        `Example: *.subz RRR*`
      );

    await danuwa.sendMessage(from, { react: { text: "⏳", key: mek.key } });

    try {
      const res = await axios.get(
        `${SUBZ_API}/search?q=${encodeURIComponent(q)}&type=movie`
      );
      const results = res.data?.data?.results;

      if (!results || results.length === 0) {
        await danuwa.sendMessage(from, { react: { text: "❌", key: mek.key } });
        return reply("⚠️ *No results found!*\nTry a different movie name.");
      }

      pendingSearch[sender] = { results, timestamp: Date.now() };

      let msg =
        `┏━━━━━━━━━━━━━━━━━━━━━┓\n` +
        `┃  🎬 *Senal MD | Subz.lk*  ┃\n` +
        `┗━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
        `🔍 *Results for:* ${q}\n` +
        `📊 *Found:* ${results.length} result(s)\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      results.forEach((movie, i) => {
        msg += `💠 *${i + 1}.* ${movie.title}\n`;
        msg += `🌐 *Language:* ${movie.language || "N/A"}\n`;
        msg += `📅 *Year:* ${movie.year || "N/A"}\n`;
        msg += `🎞️ *Quality:* ${movie.quality || "N/A"}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      });

      msg += `\n*Reply with number to view details*\n`;
      msg += `✨ *Powered by Senal MD Bot*`;

      await danuwa.sendMessage(from, { text: msg }, { quoted: mek });
      await danuwa.sendMessage(from, { react: { text: "✅", key: mek.key } });

    } catch (err) {
      console.error("Subz Search Error:", err.message);
      await danuwa.sendMessage(from, { react: { text: "❌", key: mek.key } });
      reply(`*❌ Search failed:* ${err.message}`);
    }
  }
);

// ─────────────────────────────────────────
// FILTER: Movie selection → Show details
// ─────────────────────────────────────────
cmd(
  {
    filter: (text, { sender }) =>
      pendingSearch[sender] &&
      !isNaN(text) &&
      parseInt(text) > 0 &&
      parseInt(text) <= pendingSearch[sender].results.length,
  },
  async (danuwa, mek, m, { body, sender, reply, from }) => {
    await danuwa.sendMessage(from, { react: { text: "⏳", key: mek.key } });

    const index = parseInt(body.trim()) - 1;
    const selected = pendingSearch[sender].results[index];
    delete pendingSearch[sender];

    try {
      const res = await axios.get(`${SUBZ_API}/details?id=${selected.id}`);
      const d = res.data?.data;

      if (!d) return reply("*❌ Failed to get movie details!*");

      const genres = d.genres?.join(", ") || "N/A";
      const subtitle = d.subtitle?.available
        ? `✅ Available (${d.subtitle.download_count?.toLocaleString() || 0} downloads)`
        : "❌ Not Available";

      // Store download options for next step
      pendingDownload[sender] = {
        id: d.id,
        title: d.title,
        downloads: d.downloads || [],
        timestamp: Date.now(),
      };

      let downloadList = "";
      (d.downloads || []).forEach((dl, i) => {
        const icon = dl.type === "Google Drive" ? "☁️" : "⚡";
        downloadList += `*${i + 1}.* ${icon} ${dl.quality} - ${dl.size} _(${dl.type})_\n`;
      });

      const caption =
        `┏━━━━━━━━━━━━━━━━━━━━━┓\n` +
        `┃  🎬 *Senal MD | Subz.lk*  ┃\n` +
        `┗━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
        `🎞️ *${d.title}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 *Language:* ${d.language || "N/A"}\n` +
        `⏱️ *Duration:* ${d.duration || "N/A"}\n` +
        `🎞️ *Quality:* ${d.quality || "N/A"}\n` +
        `📅 *Released:* ${d.release_date || "N/A"}\n` +
        `🎭 *Genres:* ${genres}\n` +
        `🔤 *Subtitle:* ${subtitle}\n\n` +
        `📝 *${d.description || ""}*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📥 *Download Options:*\n` +
        `${downloadList}\n` +
        `*Reply with number to download*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `✨ *Powered by Senal MD Bot*`;

      await danuwa.sendMessage(
        from,
        { image: { url: d.image }, caption },
        { quoted: mek }
      );

      await danuwa.sendMessage(from, { react: { text: "✅", key: mek.key } });

    } catch (err) {
      console.error("Subz Details Error:", err.message);
      await danuwa.sendMessage(from, { react: { text: "❌", key: mek.key } });
      reply(`*❌ Failed to get details:* ${err.message}`);
    }
  }
);

// ─────────────────────────────────────────
// FILTER: Quality selection → Smart Download
// ─────────────────────────────────────────
cmd(
  {
    filter: (text, { sender }) =>
      pendingDownload[sender] &&
      !isNaN(text) &&
      parseInt(text) > 0 &&
      parseInt(text) <= pendingDownload[sender].downloads.length,
  },
  async (danuwa, mek, m, { body, sender, reply, from }) => {
    await danuwa.sendMessage(from, { react: { text: "⏳", key: mek.key } });

    const index = parseInt(body.trim()) - 1;
    const { title, downloads, id } = pendingDownload[sender];
    delete pendingDownload[sender];

    reply(`*🔍 Checking download links...*\n_Finding best working link under 2GB_`);

    try {
      // Build list starting from selected, then check others
      const ordered = [
        downloads[index],
        ...downloads.filter((_, i) => i !== index),
      ];

      let workingLink = null;

      for (const dl of ordered) {
        reply(`*⚙️ Checking:* ${dl.quality} (${dl.size})...`);
        const isValid = await checkDownloadLink(dl.url, dl.size);
        if (isValid) {
          workingLink = dl;
          break;
        }
      }

      if (!workingLink) {
        await danuwa.sendMessage(from, { react: { text: "❌", key: mek.key } });
        return reply(
          `*❌ No working download links found under 2GB!*\n` +
          `All links are either unavailable or exceed 2GB.`
        );
      }

      const caption =
        `┏━━━━━━━━━━━━━━━━━━━━━┓\n` +
        `┃  🎬 *Senal MD | Subz.lk*  ┃\n` +
        `┗━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
        `🎞️ *${title}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Quality:* ${workingLink.quality}\n` +
        `💾 *Size:* ${workingLink.size}\n` +
        `🔗 *Type:* ${workingLink.type}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `✨ *Powered by Senal MD Bot*`;

      reply(`*⬇️ Sending:* ${title}\n*Quality:* ${workingLink.quality}\n_Please wait..._`);

      await danuwa.sendMessage(
        from,
        {
          document: { url: workingLink.url },
          mimetype: "video/mp4",
          fileName: `${title} - ${workingLink.quality}.mp4`.replace(/[^\w\s().-]/gi, ""),
          caption,
        },
        { quoted: mek }
      );

      await danuwa.sendMessage(from, { react: { text: "✅", key: mek.key } });

    } catch (err) {
      console.error("Subz Download Error:", err.message);
      await danuwa.sendMessage(from, { react: { text: "❌", key: mek.key } });
      reply(`*❌ Download failed:* ${err.message}`);
    }
  }
);

// ─────────────────────────────────────────
// Cleanup expired sessions (10 min)
// ─────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  const timeout = 10 * 60 * 1000;
  for (const s in pendingSearch)
    if (now - pendingSearch[s].timestamp > timeout) delete pendingSearch[s];
  for (const s in pendingDownload)
    if (now - pendingDownload[s].timestamp > timeout) delete pendingDownload[s];
}, 5 * 60 * 1000);

module.exports = { pendingSearch, pendingDownload };
