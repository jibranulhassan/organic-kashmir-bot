// Conversation logic. Stateless: every button carries an ID that says where
// the customer is (e.g. "col:kashmiri-saffron:0"), so no database is needed.
//
// Flow:  any message -> [Retail | Corporate]
//        Corporate   -> email address
//        Retail      -> Category -> Sub-category -> Product -> Size/variant -> "Buy Now" link
//
// All choices are shown as tappable buttons directly in the chat (no "View options" step).
// WhatsApp allows max 3 buttons per message, so longer menus are split over a few messages.

const { MENU, CORPORATE_EMAIL, BRAND, STORE_URL } = require('./config');
const shop = require('./shopify');

const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');
const rs = (n) => 'Rs. ' + Math.round(n).toLocaleString('en-IN');

const PER_PAGE = 7; // items per page before a "More" button (7 + More + Back = 3 messages max)

// ---------- message builders (WhatsApp Cloud API payloads) ----------
function buttons(body, btns, header) {
  const m = {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: btns.map((b) => ({ type: 'reply', reply: { id: b.id, title: cut(b.title, 20) } })),
      },
    },
  };
  if (header) m.interactive.header = { type: 'text', text: cut(header, 60) };
  return m;
}

function text(body) {
  return { type: 'text', text: { body, preview_url: true } };
}

function buyLink(body, url, image) {
  const m = {
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: body },
      footer: { text: 'Type "menu" to keep shopping' },
      action: { name: 'cta_url', parameters: { display_text: 'Buy Now', url } },
    },
  };
  if (image) m.interactive.header = { type: 'image', image: { link: image } };
  return m;
}

// Shows options as direct buttons, split into as few messages as possible (3 buttons each,
// balanced so no message is left with a lonely button).
// items: [{ id, title, line? }] — "line" = full text shown above the buttons, numbered.
function choices(intro, items, { header, moreText = 'More options 👇', startNum = 0 } = {}) {
  const n = Math.max(1, Math.ceil(items.length / 3));
  const chunks = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const size = Math.ceil((items.length - i) / (n - k));
    chunks.push(items.slice(i, i + size));
    i += size;
  }
  let num = startNum;
  return chunks.map((chunk, k) => {
    const lines = [];
    const btns = chunk.map((it) => {
      if (!it.line) return it;
      num++;
      lines.push(`*${num}.* ${it.line}`);
      return { id: it.id, title: `${num}. ${it.title}` };
    });
    const parts = [];
    if (k === 0 && intro) parts.push(intro);
    if (lines.length) parts.push(lines.join('\n'));
    const body = parts.join('\n\n') || moreText;
    return buttons(body, btns, k === 0 ? header : null);
  });
}

// Limit a long list to one page, adding "More" and "Back" buttons.
function paged(items, pageNo, moreId, back) {
  const start = pageNo * PER_PAGE;
  const rest = items.slice(start);
  const out = rest.length > PER_PAGE + 1 ? rest.slice(0, PER_PAGE) : rest;
  if (rest.length > out.length) out.push({ id: moreId, title: '➡️ More' });
  if (back) out.push(back);
  return out;
}

// ---------- helpers ----------
function findCategory(key) {
  return MENU.find((c) => c.key === key);
}
function parentOfCollection(handle) {
  for (const c of MENU) {
    if (c.collection === handle) return { cat: c, sub: null };
    const sub = (c.children || []).find((s) => s.collection === handle);
    if (sub) return { cat: c, sub };
  }
  return { cat: null, sub: null };
}
async function findProduct(col, handle) {
  if (col) {
    try {
      const p = (await shop.getCollectionProducts(col)).find((x) => x.handle === handle);
      if (p) return p;
    } catch (_) {}
  }
  return shop.getProduct(handle);
}

// ---------- screens (each returns an array of messages) ----------
function welcome() {
  return [
    buttons(
      `Welcome to *${BRAND}* 🌸\nPure saffron, honey & more — straight from Kashmir.\n\nAre you shopping as a retail customer or contacting us for corporate / bulk orders?`,
      [
        { id: 'retail', title: '🛍️ Retail Customer' },
        { id: 'corporate', title: '🏢 Corporate' },
      ]
    ),
  ];
}

function corporate() {
  return [
    text(
      `Thank you for your interest in partnering with *${BRAND}* 🤝\n\nFor corporate gifting, bulk and wholesale enquiries, please email us at:\n📧 *${CORPORATE_EMAIL}*\n\nOur team will get back to you shortly.`
    ),
    buttons('Anything else?', [{ id: 'start', title: '🏠 Main menu' }]),
  ];
}

function categories() {
  return choices(
    'Choose a category to browse 👇',
    MENU.map((c) => ({ id: `cat:${c.key}`, title: c.title })),
    { header: 'Shop by category', moreText: 'More categories 👇' }
  );
}

async function category(key) {
  const c = findCategory(key);
  if (!c) return categories();
  if (!c.children) return collection(c.collection, 0);
  return choices(
    'Pick a sub-category 👇',
    [
      ...c.children.map((s) => ({ id: `col:${s.collection}:0`, title: s.title })),
      { id: 'retail', title: '⬅️ Back' },
    ],
    { header: c.title }
  );
}

async function collection(handle, pageNo) {
  const { cat, sub } = parentOfCollection(handle);
  const title = (sub || cat || { title: 'Products' }).title;
  const products = await shop.getCollectionProducts(handle);
  const back = sub ? { id: `cat:${cat.key}`, title: '⬅️ Back' } : { id: 'retail', title: '⬅️ Back' };

  if (!products.length) {
    return [
      buttons(`Sorry, nothing in *${title}* is in stock right now.`, [
        back,
        { id: 'start', title: '🏠 Main menu' },
      ]),
    ];
  }

  const items = products.map((p) => {
    const min = Math.min(...p.variants.map((v) => v.price));
    return {
      id: `prod:${handle}:${p.handle}`,
      title: p.title,
      line: `${p.title} — ${p.variants.length > 1 ? 'from ' : ''}${rs(min)}`,
    };
  });
  return choices('Choose a product 👇', paged(items, pageNo, `col:${handle}:${pageNo + 1}`, back), {
    header: title,
    startNum: pageNo * PER_PAGE,
  });
}

async function product(col, handle, pageNo = 0) {
  const p = await findProduct(col, handle);
  if (!p || !p.variants.length) {
    return [buttons('Sorry, this product is currently unavailable.', [{ id: 'start', title: '🏠 Main menu' }])];
  }
  if (p.variants.length === 1) return variant(col, handle, p.variants[0].id, p);

  const items = p.variants.map((v) => ({
    id: `var:${col || '-'}:${handle}:${v.id}`,
    title: v.title,
    line: `${v.title} — ${rs(v.price)}`,
  }));
  const back = col ? { id: `col:${col}:0`, title: '⬅️ Back' } : null;
  return choices(
    `Choose a size for *${p.title}* 👇`,
    paged(items, pageNo, `prod:${col || '-'}:${handle}:${pageNo + 1}`, back),
    { header: p.title, startNum: pageNo * PER_PAGE }
  );
}

async function variant(col, handle, variantId, known) {
  const p = known || (await findProduct(col, handle));
  const v = p && p.variants.find((x) => x.id === String(variantId));
  if (!v) return [buttons('Sorry, that option is no longer available.', [{ id: 'start', title: '🏠 Main menu' }])];
  const name = v.title && v.title !== 'Default Title' ? `${p.title} — ${v.title}` : p.title;
  return [
    buyLink(
      `*${name}*\n💰 ${rs(v.price)}\n\nTap *Buy Now* to open this product on our website with your selection ready to add to cart. 🛒`,
      shop.productUrl(handle, v.id),
      p.image
    ),
  ];
}

// ---------- router ----------
// input: { text?: string, replyId?: string }  -> returns an array of messages to send
async function respond(input) {
  const id = input.replyId;
  const t = (input.text || '').trim().toLowerCase();

  try {
    if (!id) {
      if (/^(retail|1)$/.test(t)) return categories();
      if (/^(corporate|bulk|2)$/.test(t)) return corporate();
      return welcome();
    }
    if (id === 'start') return welcome();
    if (id === 'retail') return categories();
    if (id === 'corporate') return corporate();

    const [kind, a, b, c] = id.split(':');
    if (kind === 'cat') return await category(a);
    if (kind === 'col') return await collection(a, Number(b) || 0);
    if (kind === 'prod') return await product(a === '-' ? null : a, b, Number(c) || 0);
    if (kind === 'var') return await variant(a === '-' ? null : a, b, c);
    return welcome();
  } catch (err) {
    console.error('Bot error:', err);
    return [
      text(`Sorry, something went wrong on our side 🙏\nYou can browse all products here: ${STORE_URL}`),
      buttons('Try again?', [{ id: 'start', title: '🏠 Main menu' }]),
    ];
  }
}

module.exports = { respond };
