const fs = require('fs');
if (fs.existsSync('config.env')) require('dotenv').config({ path: './config.env' });

function convertToBool(text, fault = 'true') {
    return text === fault ? true : false;
}
module.exports = {
SESSION_ID: process.env.SESSION_ID || "",
ALIVE_IMG: process.env.ALIVE_IMG || "https://raw.githubusercontent.com/SenalFF/senalmd/refs/heads/main/system/IMG-20251229-WA0001.jpg?raw=true",
ALIVE_MSG: process.env.ALIVE_MSG || `═══〔 🤖 SENAL MD 〕═══

👋 Hello User!
🧑‍💻 Developed By : *Mr Senal*
⚙️ System Status  : ONLINE
🔋 Performance     : Optimal
🌐 Network          : Stable
🚀 Ready for Commands!

═══════════════════════`,
BOT_OWNER: '94769872326',  // Replace with the owner's phone number
AUTO_STATUS_SEEN: 'true',
AUTO_STATUS_REACT: 'true',



};
