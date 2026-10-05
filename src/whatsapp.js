// Sends messages through the WhatsApp Cloud API.
// Ways to connect, chosen by your settings:
//   • Dualhook:       DUALHOOK_API_KEY + PHONE_NUMBER_ID  (Coexistence on your existing number)
//   • Meta directly:  WHATSAPP_TOKEN + PHONE_NUMBER_ID    (test number / dedicated number)
//   • 360dialog:      D360_API_KEY
// The message format is identical; only the address and the key differ.

function endpoint() {
  // Dualhook (Coexistence): same request format as Meta, sent via Dualhook with a dh_live_ key
  if (process.env.DUALHOOK_API_KEY) {
    return {
      url: `${process.env.DUALHOOK_BASE_URL || 'https://api.dualhook.com/v25.0'}/${process.env.PHONE_NUMBER_ID}/messages`,
      headers: { Authorization: `Bearer ${process.env.DUALHOOK_API_KEY}`, 'Content-Type': 'application/json' },
    };
  }
  if (process.env.D360_API_KEY) {
    return {
      url: (process.env.D360_BASE_URL || 'https://waba-v2.360dialog.io') + '/messages',
      headers: { 'D360-API-KEY': process.env.D360_API_KEY, 'Content-Type': 'application/json' },
    };
  }
  return {
    url: `https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v24.0'}/${process.env.PHONE_NUMBER_ID}/messages`,
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
  };
}

async function send(to, message) {
  const { _fallbacks, ...payload } = message; // _fallbacks = simpler versions to try if this one is rejected
  const { url, headers } = endpoint();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }),
  });
  if (res.ok) return true;

  const err = await res.text();
  console.error(`WhatsApp send failed (${res.status}) for ${payload.interactive ? payload.interactive.type : payload.type}:`, err);

  // Try the next simpler version (e.g. carousel -> list)
  if (_fallbacks && _fallbacks.length) {
    const [next, ...rest] = _fallbacks;
    console.log(`   retrying as ${next.interactive ? next.interactive.type : next.type}`);
    return send(to, rest.length ? { ...next, _fallbacks: rest } : next);
  }

  // If an image header can't be loaded, retry without the image.
  if (payload.interactive && payload.interactive.header && payload.interactive.header.type === 'image') {
    const copy = JSON.parse(JSON.stringify(payload));
    delete copy.interactive.header;
    return send(to, copy);
  }
  return false;
}

async function markRead(messageId) {
  try {
    const { url, headers } = endpoint();
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    });
  } catch (_) {}
}

module.exports = { send, markRead };
