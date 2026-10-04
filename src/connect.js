// Private "Connect your WhatsApp Business app number" page (Meta Embedded Signup, Coexistence).
//
// Open:  https://YOUR-BOT.onrender.com/connect?key=ADMIN_KEY
// Needs these Render settings:
//   META_APP_ID      your Meta app ID
//   META_APP_SECRET  App settings → Basic → App secret
//   FB_CONFIG_ID     Facebook Login for Business → Configurations → your Embedded Signup configuration ID
//   ADMIN_KEY        any long secret word — protects this page
//
// What it does after you log in and scan the QR code with the WhatsApp Business app:
//   1. exchanges Meta's one-time code for an access token for your WhatsApp account
//   2. finds your phone number ID
//   3. subscribes this app to your WhatsApp account (so messages reach the bot)
//   4. starts contacts + chat-history sync (Meta requires this within 24 hours)
//   5. shows you the PHONE_NUMBER_ID and token to paste into Render

const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v24.0'}`;

function authorized(key) {
  return process.env.ADMIN_KEY && key === process.env.ADMIN_KEY;
}

function missingSettings() {
  return ['META_APP_ID', 'META_APP_SECRET', 'FB_CONFIG_ID', 'ADMIN_KEY'].filter((k) => !process.env[k]);
}

function page(key) {
  const missing = missingSettings();
  const ver = process.env.GRAPH_VERSION || 'v24.0';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect WhatsApp — Organic Kashmir</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f4ef;color:#1d2a24;margin:0;padding:24px}
  .card{max-width:620px;margin:32px auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
  h1{font-size:22px;margin:0 0 6px} p,li{line-height:1.55}
  button{background:#1877f2;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:16px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .warn{background:#fff4e5;border-radius:8px;padding:12px}
  .ok{background:#e8f6ee;border-radius:8px;padding:12px}
  .err{background:#fdecec;border-radius:8px;padding:12px}
  code,textarea{font-family:ui-monospace,Consolas,monospace;font-size:13px}
  textarea{width:100%;height:70px;box-sizing:border-box}
  #log{white-space:pre-wrap;font-size:14px}
</style></head><body><div class="card">
<h1>Connect your WhatsApp Business number</h1>
<p>This links your existing number to the Organic Kashmir bot. You keep using the WhatsApp Business app on your phone as before.</p>
${missing.length ? `<p class="warn">Missing Render settings: <b>${missing.join(', ')}</b>. Add them, redeploy, then reload this page.</p>` : ''}
<ol>
  <li>Keep the phone with your business number nearby, with the WhatsApp Business app updated.</li>
  <li>Click the button, log in with Facebook and choose the <b>Organic Kashmir</b> business portfolio.</li>
  <li>Choose to connect your <b>existing WhatsApp Business app</b>, enter the number and scan the QR code in the app.</li>
  <li>Allow sharing of chat history when asked.</li>
</ol>
<p><button id="go" ${missing.length ? 'disabled' : ''}>Connect WhatsApp Business app</button></p>
<div id="log"></div>
</div>
<script>
  const KEY = ${JSON.stringify(key)};
  let session = null, code = null;
  const log = (html, cls) => { const d = document.createElement('div'); if (cls) d.className = cls; d.innerHTML = html; d.style.marginTop = '12px'; document.getElementById('log').appendChild(d); };

  window.fbAsyncInit = function () {
    FB.init({ appId: ${JSON.stringify(process.env.META_APP_ID || '')}, autoLogAppEvents: true, xfbml: false, version: ${JSON.stringify(ver)} });
  };

  window.addEventListener('message', (event) => {
    if (!/facebook\\.com$/.test(new URL(event.origin).hostname)) return;
    let data; try { data = JSON.parse(event.data); } catch (_) { return; }
    if (data.type !== 'WA_EMBEDDED_SIGNUP') return;
    if (String(data.event).startsWith('FINISH')) { session = data.data || {}; maybeFinish(); }
    else if (data.event === 'CANCEL') log('Signup was closed before finishing' + (data.data && data.data.current_step ? ' (at step: ' + data.data.current_step + ')' : '') + '. You can try again.', 'warn');
    else if (data.event === 'ERROR') log('Meta reported an error: ' + JSON.stringify(data.data), 'err');
  });

  document.getElementById('go').onclick = () => {
    if (!window.FB) return log('Facebook SDK did not load. Disable ad-blockers for this page and reload.', 'err');
    FB.login((response) => {
      if (response.authResponse && response.authResponse.code) { code = response.authResponse.code; maybeFinish(); }
      else log('Facebook login was not completed.', 'warn');
    }, {
      config_id: ${JSON.stringify(process.env.FB_CONFIG_ID || '')},
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }
    });
  };

  let sent = false;
  async function maybeFinish() {
    if (!code || sent) return;
    // the session event normally arrives just before/after the code; wait briefly for it
    if (!session) { setTimeout(() => { if (!sent) finish(); }, 4000); return; }
    finish();
  }
  async function finish() {
    if (sent) return; sent = true;
    log('Connecting… please keep this page open.');
    try {
      const r = await fetch('/connect/complete?key=' + encodeURIComponent(KEY), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, waba_id: session && session.waba_id, phone_number_id: session && session.phone_number_id })
      });
      const out = await r.json();
      if (!r.ok) return log('❌ ' + (out.error || 'Something went wrong'), 'err');
      log('✅ <b>Connected!</b> Now copy these two values into Render → Environment:', 'ok');
      log('<b>PHONE_NUMBER_ID</b><br><textarea readonly>' + out.phone_number_id + '</textarea>');
      log('<b>WHATSAPP_TOKEN</b> (keep this private)<br><textarea readonly>' + out.token + '</textarea>');
      log('Also set <b>SHARED_NUMBER</b> = <code>true</code>, then save and redeploy.');
      log('<b>Steps done:</b><br>' + out.steps.map(s => (s.ok ? '✅ ' : '⚠️ ') + s.name + (s.detail ? ' — ' + s.detail : '')).join('<br>'));
    } catch (e) { log('❌ ' + e.message, 'err'); }
  }
</script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>
</body></html>`;
}

async function graph(method, path, token, body) {
  const res = await fetch(GRAPH + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function complete({ code, waba_id, phone_number_id }) {
  if (!code) throw new Error('No login code received from Meta.');
  const steps = [];

  // 1. Exchange the one-time code for an access token
  const q = new URLSearchParams({ client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, code });
  const tr = await fetch(`${GRAPH}/oauth/access_token?${q}`);
  const tj = await tr.json().catch(() => ({}));
  if (!tr.ok || !tj.access_token) throw new Error('Could not get access token: ' + JSON.stringify(tj.error || tj));
  const token = tj.access_token;
  steps.push({ name: 'Access token received', ok: true });

  // 2. Find the WhatsApp account and phone number if Meta didn't send them
  if (!waba_id) {
    const dbg = await graph('GET', `/debug_token?input_token=${encodeURIComponent(token)}`, `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`);
    const scopes = (dbg.data.data && dbg.data.data.granular_scopes) || [];
    const s = scopes.find((x) => x.scope === 'whatsapp_business_management');
    waba_id = s && s.target_ids && s.target_ids[0];
  }
  if (!waba_id) throw new Error('Could not find your WhatsApp Business Account ID.');
  steps.push({ name: 'WhatsApp account found', ok: true, detail: waba_id });

  if (!phone_number_id) {
    const pn = await graph('GET', `/${waba_id}/phone_numbers?fields=id,display_phone_number,verified_name`, token);
    const first = pn.data.data && pn.data.data[0];
    if (!first) throw new Error('No phone number found on the WhatsApp account: ' + JSON.stringify(pn.data.error || pn.data));
    phone_number_id = first.id;
    steps.push({ name: 'Phone number found', ok: true, detail: `${first.display_phone_number} (${first.verified_name})` });
  }

  // 3. Subscribe this app to the WhatsApp account so messages reach the bot
  const sub = await graph('POST', `/${waba_id}/subscribed_apps`, token);
  steps.push({ name: 'Bot subscribed to incoming messages', ok: sub.ok, detail: sub.ok ? '' : JSON.stringify(sub.data.error || sub.data) });

  // 4. Start contacts + history sync (required within 24 hours). No /register for Coexistence numbers.
  for (const sync_type of ['smb_app_state_sync', 'history']) {
    const r = await graph('POST', `/${phone_number_id}/smb_app_data`, token, { messaging_product: 'whatsapp', sync_type });
    steps.push({
      name: sync_type === 'history' ? 'Chat history sync started' : 'Contacts sync started',
      ok: r.ok,
      detail: r.ok ? '' : JSON.stringify(r.data.error || r.data),
    });
  }

  console.log(`🔗 Coexistence connected: WABA ${waba_id}, phone number ID ${phone_number_id}`);
  return { phone_number_id, waba_id, token, steps };
}

// Returns true if it handled the request
function handle(req, res, url) {
  if (url.pathname !== '/connect' && url.pathname !== '/connect/complete') return false;
  const key = url.searchParams.get('key') || '';
  if (!authorized(key)) {
    res.writeHead(404);
    res.end();
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/connect') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page(key));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/connect/complete') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch (_) {}
      try {
        const out = await complete(body);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(out));
      } catch (e) {
        console.error('Connect error:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  res.writeHead(405);
  res.end();
  return true;
}

module.exports = { handle };
