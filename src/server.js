require('./server-env');

const http = require('http');
const crypto = require('crypto');
const { respond, isAgentRequest } = require('./bot');
const team = require('./team');
const connect = require('./connect');
const wa = require('./whatsapp');
const handover = require('./handover');

const seen = new Map(); // Meta sometimes delivers the same message twice

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Private page for connecting your WhatsApp Business app number (Coexistence)
  if (connect.handle(req, res, url)) return;

  // Health check: open your server URL in a browser to confirm it's running
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Organic Kashmir WhatsApp bot is running ✅');
  }

  // Step 1: Meta calls this once to verify your webhook URL
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const q = url.searchParams;
    if (q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === process.env.VERIFY_TOKEN) {
      console.log('Webhook verified by Meta ✅');
      res.writeHead(200);
      return res.end(q.get('hub.challenge'));
    }
    res.writeHead(403);
    return res.end();
  }

  // Step 2: every incoming WhatsApp message arrives here
  if (req.method === 'POST' && url.pathname === '/webhook') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);

      if (process.env.APP_SECRET) {
        const expected = 'sha256=' + crypto.createHmac('sha256', process.env.APP_SECRET).update(raw).digest('hex');
        const got = req.headers['x-hub-signature-256'] || '';
        if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
          res.writeHead(401);
          return res.end();
        }
      }
      res.writeHead(200);
      res.end(); // reply to Meta immediately, then process

      let body;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch (_) {
        return;
      }
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const contacts = (change.value && change.value.contacts) || [];
          for (const msg of (change.value && change.value.messages) || []) {
            if (seen.has(msg.id)) continue;
            seen.set(msg.id, Date.now());
            const c = contacts.find((x) => x.wa_id === msg.from);
            msg._name = c && c.profile ? c.profile.name : '';
            handle(msg).catch((e) => console.error('Handle error:', e));
          }
          // Coexistence: messages your team sends from the WhatsApp Business app
          for (const echo of (change.value && change.value.message_echoes) || []) {
            if (echo.to) {
              handover.noteStaffReply(echo.to);
              console.log(`👤 Team replied to ${echo.to} from the app — bot paused for this chat`);
            }
          }
        }
      }
      for (const [k, t] of seen) if (Date.now() - t > 3600e3) seen.delete(k);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

async function handle(msg) {
  const from = msg.from;
  const input = {};
  if (msg.type === 'text') input.text = msg.text.body;
  else if (msg.type === 'interactive') {
    const i = msg.interactive;
    input.replyId = (i.button_reply && i.button_reply.id) || (i.list_reply && i.list_reply.id);
  } else if (msg.type === 'button') input.text = msg.button.text;
  // images, voice notes etc. just get the welcome menu

  const label = input.replyId || input.text || '[' + msg.type + ']';
  input.agent = isAgentRequest(input);
  const decision = handover.decide(from, input);
  if (!decision.reply) {
    console.log(`← ${from}: ${label}  (left for the team)`);
    return;
  }
  console.log(`← ${from}: ${label}`);
  // On a shared number, don't mark as read — so your team still sees it as unread in the app
  if (!handover.SHARED) wa.markRead(msg.id);
  const replies = await respond({ ...input, note: decision.note, name: msg._name });
  for (const r of replies) await wa.send(from, r);

  // "Talk to Executive": alert the team and keep the bot out of this chat
  if (input.agent) {
    handover.noteStaffReply(from);
    await team.alertTeam(from, msg._name);
  }
}

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Bot listening on port ${port}`);
  console.log(handover.SHARED ? 'Mode: shared number (Coexistence)' : 'Mode: dedicated bot number');
  register360Webhook();
});

// With 360dialog, tell them where to send incoming messages (done automatically on Render).
async function register360Webhook() {
  const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (!process.env.D360_API_KEY || !publicUrl) return;
  try {
    const base = process.env.D360_BASE_URL || 'https://waba-v2.360dialog.io';
    const res = await fetch(`${base}/v1/configs/webhook`, {
      method: 'POST',
      headers: { 'D360-API-KEY': process.env.D360_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: publicUrl.replace(/\/$/, '') + '/webhook' }),
    });
    console.log(res.ok ? '360dialog webhook registered ✅' : `360dialog webhook failed (${res.status}): ${await res.text()}`);
  } catch (e) {
    console.error('360dialog webhook error:', e.message);
  }
}
