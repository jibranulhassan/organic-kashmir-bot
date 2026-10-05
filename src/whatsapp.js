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
  const { url, headers } = endpoint();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`WhatsApp send failed (${res.status}):`, err);

    // If an image header can't be loaded, retry the Buy Now message without the image.
    if (message.interactive && message.interactive.header && message.interactive.header.type === 'image') {
      const copy = JSON.parse(JSON.stringify(message));
      delete copy.interactive.header;
      return send(to, copy);
    }
  }
  return res.ok;
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
