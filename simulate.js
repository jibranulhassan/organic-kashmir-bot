// Try the bot in your terminal without WhatsApp:  npm run simulate
// It uses your LIVE website catalog. Type a number to tap a button/row, or type any text.
require('./src/server-env');
const readline = require('readline');
const { respond } = require('./src/bot');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let options = [];

function show(m) {
  console.log('\n────────── BOT ──────────');
  if (m.type === 'text') return console.log(m.text.body);
  const i = m.interactive;
  if (i.header && i.header.type === 'text') console.log(`[${i.header.text}]`);
  if (i.header && i.header.type === 'image') console.log(`[image: ${i.header.image.link}]`);
  console.log(i.body.text);
  if (i.type === 'button') {
    i.action.buttons.forEach((b) => options.push(b.reply));
  } else if (i.type === 'list') {
    console.log(`  (list button: "${i.action.button}")`);
    i.action.sections.forEach((s) => s.rows.forEach((r) => options.push(r)));
  } else if (i.type === 'cta_url') {
    console.log(`  🔗 [${i.action.parameters.display_text}] → ${i.action.parameters.url}`);
  }
}

async function turn(input) {
  options = [];
  const replies = await respond(input);
  replies.forEach(show);
  options.forEach((o, n) => console.log(`  ${n + 1}. ${o.title}${o.description ? '  — ' + o.description : ''}`));
  rl.question('\nYou (number or text, "q" to quit): ', async (ans) => {
    if (ans.trim() === 'q') return rl.close();
    const n = Number(ans);
    if (n >= 1 && n <= options.length) return turn({ replyId: options[n - 1].id });
    return turn({ text: ans });
  });
}

turn({ text: 'hi' });
