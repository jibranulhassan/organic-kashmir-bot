require('./server-env');

const http = require('http');
const crypto = require('crypto');
const { respond } = require('./bot');
const wa = require('./whatsapp');

const seen = new Map(); // Meta sometimes delivers the same message twice

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

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
          for (const msg of (change.value && change.value.messages) || []) {
            if (seen.has(msg.id)) continue;
            seen.set(msg.id, Date.now());
            handle(msg).catch((e) => console.error('Handle error:', e));
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

  console.log(`← ${from}: ${input.replyId || input.text || '[' + msg.type + ']'}`);
  wa.markRead(msg.id);
  const replies = await respond(input);
  for (const r of replies) await wa.send(from, r);
}

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Bot listening on port ${port}`));
