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
<details style="margin-top:24px"><summary>Number already connected, but setup didn't finish?</summary>
<p>Paste a <b>system-user access token</b> that has access to your WhatsApp account (Business Settings → System users → Generate token, with whatsapp_business_management and whatsapp_business_messaging), then click Finish setup.</p>
<textarea id="tok" placeholder="Paste token here"></textarea>
<p><button id="fin">Finish setup</button></p></details>
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
    if (String(data.event).startsWith('FINISH')) { session = data.data || {}; log('Meta reports: ' + data.event + (session.waba_id ? ' (account ' + session.waba_id + ')' : '')); maybeFinish(); }
    else if (data.event === 'CANCEL') log('Signup was closed before finishing' + (data.data && data.data.current_step ? ' (at step: ' + data.data.current_step + ')' : '') + '. You can try again.', 'warn');
    else if (data.event === 'ERROR') log('Meta reported an error: ' + JSON.stringify(data.data), 'err');
  });

  document.getElementById('go').onclick = () => {
    // Same-tab redirect flow (reliable code exchange). Meta sends you back here when done.
    location.href = '/connect/start?key=' + encodeURIComponent(KEY);
  };

  document.getElementById('fin').onclick = () => {
    const t = document.getElementById('tok').value.trim();
    if (!t) return log('Paste the token first.', 'warn');
    sent = false; code = null; session = session || {}; manualToken = t; finish();
  };
  let manualToken = null;
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
        body: JSON.stringify({ code, token: manualToken || undefined, page_url: location.origin + location.pathname, waba_id: session && session.waba_id, phone_number_id: session && session.phone_number_id })
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

const lastDiag = {};
async function findNumbers(token, onlyWaba) {
  for (const k of Object.keys(lastDiag)) delete lastDiag[k];
  const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
  const wabas = new Set(onlyWaba ? [onlyWaba] : []);

  if (!wabas.size) {
    // a) WhatsApp accounts this token was granted
    const r = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`);
    const d = await r.json().catch(() => ({}));
    lastDiag.scopes = ((d.data && d.data.granular_scopes) || []).map((g) => `${g.scope}${g.target_ids ? ' [' + g.target_ids.length + ' item(s)]' : ''}`);
    lastDiag.tokenType = d.data && d.data.type;
    lastDiag.debugError = d.error && d.error.message;
    for (const g of (d.data && d.data.granular_scopes) || []) {
      if (/^whatsapp_business_(management|messaging)$/.test(g.scope)) for (const id of g.target_ids || []) wabas.add(id);
    }
  }
  if (!wabas.size) {
    // b) WhatsApp accounts owned by / shared with the businesses this token can see
    const b = await graph('GET', '/me/businesses?fields=id,name', token);
    lastDiag.businesses = ((b.data && b.data.data) || []).map((x) => x.name);
    if (b.data && b.data.error) lastDiag.businessError = b.data.error.message;
    for (const biz of (b.data && b.data.data) || []) {
      for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
        const w = await graph('GET', `/${biz.id}/${edge}?fields=id,name`, token);
        for (const x of (w.data && w.data.data) || []) wabas.add(x.id);
      }
    }
  }

  const out = [];
  for (const id of wabas) {
    const pn = await graph('GET', `/${id}/phone_numbers?fields=id,display_phone_number,verified_name,is_on_biz_app,platform_type`, token);
    for (const n of (pn.data && pn.data.data) || []) out.push({ ...n, waba_id: id });
  }
  return out;
}

async function complete({ code, waba_id, phone_number_id, page_url, redirect_uri, token: givenToken }) {
  if (!code && !givenToken) throw new Error('No login code received from Meta.');
  const steps = [];

  // 1. Exchange the one-time code for an access token.
  // Codes from the JS SDK popup are picky about redirect_uri, so try the accepted variants in turn.
  const variants = redirect_uri
    ? [{ redirect_uri }]
    : [{ redirect_uri: '' }, {}, ...(page_url ? [{ redirect_uri: page_url }] : [])];
  let token = givenToken || null, lastErr = null;
  for (const extra of givenToken ? [] : variants) {
    const q = new URLSearchParams({ client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, code, ...extra });
    const tr = await fetch(`${GRAPH}/oauth/access_token?${q}`);
    const tj = await tr.json().catch(() => ({}));
    if (tr.ok && tj.access_token) { token = tj.access_token; break; }
    lastErr = tj.error || tj;
    if (!(lastErr && lastErr.error_subcode === 36008)) break; // only retry the redirect_uri mismatch
  }
  if (!token) throw new Error('Could not get access token: ' + JSON.stringify(lastErr));
  steps.push({ name: 'Access token received', ok: true });

  // 2. Find the WhatsApp account and phone number if Meta didn't send them
  if (!waba_id || !phone_number_id) {
    const candidates = await findNumbers(token, waba_id);
    if (!candidates.length) {
      const e = new Error(
        'Meta did not share any WhatsApp number with this app. Please run the connect steps again and make sure you finish them: enter the number, scan the QR code in the WhatsApp Business app and allow chat history.' +
          '\n\nDetails for support: ' + JSON.stringify(lastDiag)
      );
      throw e;
    }
    // Prefer the number that lives in the WhatsApp Business app (Coexistence), never Meta's test number
    const real = candidates.filter((c) => !/^\+?1\s?555/.test(c.display_phone_number || ''));
    const biz = real.filter((c) => c.is_on_biz_app);
    const pick = biz.length === 1 ? biz[0] : real.length === 1 ? real[0] : null;
    if (!pick) {
      const e = new Error('CHOOSE');
      e.choices = real.length ? real : candidates;
      e.token = token;
      throw e;
    }
    waba_id = pick.waba_id;
    phone_number_id = pick.id;
    steps.push({ name: 'Phone number found', ok: true, detail: `${pick.display_phone_number} (${pick.verified_name || ''})` });
  }
  steps.push({ name: 'WhatsApp account found', ok: true, detail: waba_id });

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
function callbackUrl(req) {
  const base = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `https://${req.headers.host}`;
  return base.replace(/\/$/, '') + '/connect/callback';
}

function resultPage(out, error, custom) {
  const rows = custom ? custom : out
    ? `<p class="ok">✅ <b>Connected!</b> Copy these two values into Render → Environment (replace the old ones):</p>
       <p><b>PHONE_NUMBER_ID</b><br><textarea readonly>${out.phone_number_id}</textarea></p>
       <p><b>WHATSAPP_TOKEN</b> (keep this private)<br><textarea readonly>${out.token}</textarea></p>
       <p>Make sure <b>SHARED_NUMBER</b> = <code>true</code>, then click <b>Save, rebuild and deploy</b>.</p>
       <p><b>Steps done:</b><br>${out.steps.map((s) => (s.ok ? '✅ ' : '⚠️ ') + s.name + (s.detail ? ' — ' + String(s.detail).replace(/</g, '&lt;') : '')).join('<br>')}</p>`
    : `<p class="err" style="white-space:pre-wrap">❌ ${String(error).replace(/</g, '&lt;')}</p><p><a href="javascript:history.go(-2)">Go back and try again</a></p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect WhatsApp — result</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f6f4ef;margin:0;padding:24px;color:#1d2a24}.card{max-width:640px;margin:32px auto;background:#fff;border-radius:14px;padding:28px}
.ok{background:#e8f6ee;border-radius:8px;padding:12px}.err{background:#fdecec;border-radius:8px;padding:12px}textarea{width:100%;height:70px;font-family:Consolas,monospace;font-size:13px}p{line-height:1.55}</style>
</head><body><div class="card"><h1 style="font-size:22px">Connect your WhatsApp Business number</h1>${rows}</div></body></html>`;
}

function choosePage(key, token, choices) {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const items = choices
    .map(
      (c) => `<form method="post" action="/connect/finish?key=${encodeURIComponent(key)}" style="margin:10px 0">
      <input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="waba_id" value="${esc(c.waba_id)}"><input type="hidden" name="phone_number_id" value="${esc(c.id)}">
      <button style="background:#1877f2;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:15px;cursor:pointer">Use ${esc(c.display_phone_number)} — ${esc(c.verified_name)}${c.is_on_biz_app ? ' (WhatsApp Business app)' : ''}</button></form>`
    )
    .join('');
  return resultPage(null, null, `<p>We found more than one WhatsApp number. Choose your <b>official Organic Kashmir number</b>:</p>${items}`);
}

function handle(req, res, url) {
  if (!url.pathname.startsWith('/connect')) return false;
  const key = url.searchParams.get('key') || url.searchParams.get('state') || '';
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

  // Start: send the browser to Meta's Embedded Signup (Coexistence) in the same tab
  if (req.method === 'GET' && url.pathname === '/connect/start') {
    const q = new URLSearchParams({
      client_id: process.env.META_APP_ID || '',
      redirect_uri: callbackUrl(req),
      config_id: process.env.FB_CONFIG_ID || '',
      response_type: 'code',
      override_default_response_type: 'true',
      state: key,
      extras: JSON.stringify({ setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }),
    });
    res.writeHead(302, { Location: `https://www.facebook.com/${process.env.GRAPH_VERSION || 'v24.0'}/dialog/oauth?${q}` });
    res.end();
    return true;
  }

  // Meta sends the browser back here with ?code=...&state=KEY
  if (req.method === 'GET' && url.pathname === '/connect/callback') {
    const code = url.searchParams.get('code');
    const send = (html) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    };
    if (!code) {
      const why = url.searchParams.get('error_description') || url.searchParams.get('error_reason') || 'Signup was cancelled or not completed.';
      send(resultPage(null, why));
      return true;
    }
    complete({ code, redirect_uri: callbackUrl(req) })
      .then((out) => send(resultPage(out)))
      .catch((e) => {
        if (e.message === 'CHOOSE') return send(choosePage(key, e.token, e.choices));
        console.error('Connect error:', e.message);
        send(resultPage(null, e.message));
      });
    return true;
  }

  // Number chosen on the "choose" page
  if (req.method === 'POST' && url.pathname === '/connect/finish') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const f = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const send = (html) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      };
      complete({ token: f.get('token'), waba_id: f.get('waba_id'), phone_number_id: f.get('phone_number_id') })
        .then((out) => send(resultPage(out)))
        .catch((e) => send(resultPage(null, e.message)));
    });
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
        const msg = e.message === 'CHOOSE'
          ? 'More than one number found: ' + e.choices.map((c) => c.display_phone_number).join(', ') + '. Use the blue button flow to choose.'
          : e.message;
        res.end(JSON.stringify({ error: msg }));
      }
    });
    return true;
  }

  res.writeHead(405);
  res.end();
  return true;
}

module.exports = { handle };
