const fs = require('fs');
if (fs.existsSync('config.env')) require('dotenv').config({ path: './config.env' });

function convertToBool(text, fault = 'true') {
    return text === fault ? true : false;
}

module.exports = {
SESSION_ID: process.env.SESSION_ID || "5FICATKC#CjGa3dwcRGNX0Mt0dsjznRMvGnASM-t2JYIFR-Ijwmg",

ALIVE_IMG: process.env.ALIVE_IMG || "https://raw.githubusercontent.com/SenalFF/senalmd/main/lib/senal-md.png?raw=true",

ALIVE_MSG: process.env.ALIVE_MSG || `═══〔 🤖 SENAL MD 〕═══

👋 Hello User!
🧑‍💻 Developed By : *Mr Senal*
⚙️ System Status  : ONLINE
🔋 Performance     : Optimal
🌐 Network          : Stable
🚀 Ready for Commands!

═══════════════════════`,

MODE: process.env.MODE || "private",
BOT_OWNER: '94769872326',
AUTO_STATUS_SEEN: convertToBool(process.env.AUTO_STATUS_SEEN || 'true'),
AUTO_STATUS_REACT: convertToBool(process.env.AUTO_STATUS_REACT || 'true'),
};
