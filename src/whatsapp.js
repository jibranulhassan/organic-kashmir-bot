// Sends messages through the WhatsApp Cloud API (Meta Graph API).
const GRAPH = 'https://graph.facebook.com/v21.0';

async function send(to, message) {
  const res = await fetch(`${GRAPH}/${process.env.PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
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
    await fetch(`${GRAPH}/${process.env.PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    });
  } catch (_) {}
}

module.exports = { send, markRead };
