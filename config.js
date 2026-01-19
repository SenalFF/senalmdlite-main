const fs = require('fs');
if (fs.existsSync('config.env')) require('dotenv').config({ path: './config.env' });

function convertToBool(text, fault = 'true') {
    return text === fault ? true : false;
}
module.exports = {
SESSION_ID: process.env.SESSION_ID || "ysR3HRxb#i0qf3kxWLfejgeYHryMUWZg5mglhQcpzXJgIRYCg1e0",
ALIVE_IMG: process.env.ALIVE_IMG || "https://raw.githubusercontent.com/SenalFF/senalmd/main/lib/senal-md.png?raw=true",
ALIVE_MSG: process.env.ALIVE_MSG || "*Hello👋 Senal-MD Is Alive Now😍*",
BOT_OWNER: '94769872326',  // Replace with the owner's phone number
AUTO_STATUS_SEEN: 'true',
AUTO_STATUS_REACT: 'true',



};
