require("dotenv").config();

const { cmd } = require("../command");
const axios = require("axios");

// ================= ENV =================
const BASE_URL = process.env.SENAL_SONG_API;

if (!BASE_URL) {
  throw new Error("❌ Missing SENAL_SONG_API in .env");
}

// ================= SONG SEARCH COMMAND =================
cmd({
  pattern: "song",
  alias: ["music", "mp3"],
  desc: "🎵 Search and download songs",
  category: "download",
  react: "🎵",
  filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply("❗ Use: *.song <song name>*");

    await reply("🔍 *Searching song… Please wait!*");

    const { data } = await axios.get(
      `${BASE_URL}/api/search?q=${encodeURIComponent(q)}`,
      { timeout: 15000 }
    );

    if (!data || !data.results || data.results.length === 0) {
      return reply("❌ No songs found. Try a different search.");
    }

    const song   = data.results[0];
    const songId = song.id;

    const { data: details } = await axios.get(
      `${BASE_URL}/api/song/${songId}`,
      { timeout: 15000 }
    );

    const title  = details.title  || song.title  || "Unknown Title";
    const artist = details.artist || song.artist || "Unknown Artist";
    const album  = details.album  || "N/A";
    const year   = details.year   || "";
    const size   = details.size   || "";
    const thumb  = details.cover  || `${BASE_URL}/api/cover/${songId}`;

    const caption = [
      `🎵 *${title}*`,
      `🎤 Artist: ${artist}`,
      `💿 Album: ${album}`,
      year ? `📅 Year: ${year}` : null,
      size ? `📦 Size: ${size}` : null,
      `━━━━━━━━━━━━━━━━━━`,
      `👤 Developer: Mr Senal`
    ].filter(Boolean).join("\n");

    const buttons = [
      {
        buttonId: `sdl_${songId}`,
        buttonText: { displayText: "⬇️ Download MP3" },
        type: 1
      },
      {
        buttonId: `scover_${songId}`,
        buttonText: { displayText: "🖼 Download Cover" },
        type: 1
      }
    ];

    await conn.sendMessage(from, {
      image:      { url: thumb },
      caption,
      footer:     "🎶 Senal Song DL v1.0",
      buttons,
      headerType: 4
    }, { quoted: mek });

  } catch (err) {
    console.error("song search error:", err);
    reply("❌ Failed to search. Please try again.");
  }
});

// ================= BUTTON HANDLER =================
cmd({
  on: "message"
}, async (conn, mek, m, {}) => {
  try {
    const btnId =
      mek?.message?.buttonsResponseMessage?.selectedButtonId ||
      mek?.message?.templateButtonReplyMessage?.selectedId;

    if (!btnId) return;

    const jid = mek.key.remoteJid;

    // ---- DOWNLOAD MP3 ----
    if (btnId.startsWith("sdl_")) {
      const songId = btnId.split("_")[1];

      await conn.sendMessage(jid, {
        text: "⏳ *Preparing your song… Please wait!*\n\n🎵 Fetching MP3 file…\n👤 Developer: Mr Senal"
      }, { quoted: mek });

      const downloadUrl = `${BASE_URL}/api/download/${songId}`;

      // Build clean filename from song details
      let fileName = `song_${songId}.mp3`;
      try {
        const { data: details } = await axios.get(
          `${BASE_URL}/api/song/${songId}`,
          { timeout: 10000 }
        );
        const t = (details.title  || "song").replace(/[^a-zA-Z0-9 _-]/g, "").trim();
        const a = (details.artist || "").replace(/[^a-zA-Z0-9 _-]/g, "").trim();
        fileName = a ? `${a} - ${t}.mp3` : `${t}.mp3`;
      } catch (_) {}

      await conn.sendMessage(jid, {
        document: { url: downloadUrl },
        mimetype: "audio/mpeg",
        fileName,
        caption: `✅ *Song Downloaded!*\n🎵 ${fileName}\n👤 Mr Senal`
      }, { quoted: mek });
    }

    // ---- DOWNLOAD COVER ----
    if (btnId.startsWith("scover_")) {
      const songId   = btnId.split("_")[1];
      const coverUrl = `${BASE_URL}/api/cover/${songId}`;

      await conn.sendMessage(jid, {
        image:   { url: coverUrl },
        caption: "🖼 *Song Cover Art*\n👤 Mr Senal"
      }, { quoted: mek });
    }

  } catch (err) {
    console.error("song button error:", err);
    const jid = mek?.key?.remoteJid;
    if (jid) {
      const msg = err.code === "ECONNABORTED"
        ? "⏱ Request timed out. Please try again."
        : "❌ Failed to process. Please try again.";
      await conn.sendMessage(jid, { text: msg }, { quoted: mek });
    }
  }
});
