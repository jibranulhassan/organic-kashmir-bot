// Conversation logic. Stateless: every button/list row carries an ID that says where
// the customer is (e.g. "col:kashmiri-saffron:0"), so no database is needed.
//
// Flow:  any message -> [Retail | Corporate]
//        Corporate   -> email address
//        Retail      -> Category -> Sub-category -> Product -> Size/variant -> "Buy Now" link

const { MENU, CORPORATE_EMAIL, BRAND, STORE_URL } = require('./config');
const shop = require('./shopify');

const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');
const rs = (n) => 'Rs. ' + Math.round(n).toLocaleString('en-IN');

// ---------- message builders (WhatsApp Cloud API "interactive" payloads) ----------
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

function list(header, body, buttonText, rows, sectionTitle = 'Options') {
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: cut(header, 60) },
      body: { text: body },
      footer: { text: 'Type "menu" anytime to start over' },
      action: {
        button: cut(buttonText, 20),
        sections: [
          {
            title: cut(sectionTitle, 24),
            rows: rows.map((r) => {
              const row = { id: r.id, title: cut(r.title, 24) };
              if (r.description) row.description = cut(r.description, 72);
              return row;
            }),
          },
        ],
      },
    },
  };
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

// Fit items into WhatsApp's 10-row list limit, adding "More" and "Back" rows.
function page(items, pageNo, moreId, back) {
  const room = back ? 9 : 10;
  const start = pageNo * (room - 1);
  const remaining = items.slice(start);
  let shown, hasMore;
  if (remaining.length <= room) {
    shown = remaining;
    hasMore = false;
  } else {
    shown = remaining.slice(0, room - 1);
    hasMore = true;
  }
  const rows = [...shown];
  if (hasMore) rows.push({ id: moreId, title: '➡️ More', description: `Show more (${remaining.length - shown.length} left)` });
  if (back) rows.push(back);
  return rows;
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

// ---------- screens ----------
function welcome() {
  return buttons(
    `Welcome to *${BRAND}* 🌸\nPure saffron, honey & more — straight from Kashmir.\n\nAre you shopping as a retail customer or contacting us for corporate / bulk orders?`,
    [
      { id: 'retail', title: '🛍️ Retail Customer' },
      { id: 'corporate', title: '🏢 Corporate' },
    ]
  );
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
  return list(
    'Shop by category',
    'Choose a category to browse our products 👇',
    'View categories',
    MENU.map((c) => ({ id: `cat:${c.key}`, title: c.title, description: c.description })),
    'Categories'
  );
}

async function category(key) {
  const c = findCategory(key);
  if (!c) return categories();
  if (!c.children) return collection(c.collection, 0);
  return list(
    c.title,
    'Pick a sub-category 👇',
    'View options',
    [
      ...c.children.map((s) => ({ id: `col:${s.collection}:0`, title: s.title })),
      { id: 'retail', title: '⬅️ Back', description: 'All categories' },
    ],
    c.title
  );
}

async function collection(handle, pageNo) {
  const { cat, sub } = parentOfCollection(handle);
  const title = (sub || cat || { title: 'Products' }).title;
  const products = await shop.getCollectionProducts(handle);
  const back = sub
    ? { id: `cat:${cat.key}`, title: '⬅️ Back', description: cat.title }
    : { id: 'retail', title: '⬅️ Back', description: 'All categories' };

  if (!products.length) {
    return buttons(`Sorry, nothing in *${title}* is in stock right now.`, [
      { id: back.id, title: '⬅️ Back' },
      { id: 'start', title: '🏠 Main menu' },
    ]);
  }

  const items = products.map((p) => {
    const min = Math.min(...p.variants.map((v) => v.price));
    return {
      id: `prod:${handle}:${p.handle}`,
      title: p.title,
      description: (p.variants.length > 1 ? 'From ' : '') + rs(min) + (p.title.length > 24 ? ` · ${p.title}` : ''),
    };
  });
  return list(
    title,
    `Choose a product 👇${products.length > 9 ? `\n(${products.length} products)` : ''}`,
    'View products',
    page(items, pageNo, `col:${handle}:${pageNo + 1}`, back),
    'Products'
  );
}

async function product(col, handle, pageNo = 0) {
  const p = await findProduct(col, handle);
  if (!p || !p.variants.length) {
    return buttons('Sorry, this product is currently unavailable.', [{ id: 'start', title: '🏠 Main menu' }]);
  }
  if (p.variants.length === 1) return variant(col, handle, p.variants[0].id, p);

  const items = p.variants.map((v) => ({
    id: `var:${col || '-'}:${handle}:${v.id}`,
    title: v.title,
    description: rs(v.price),
  }));
  const back = col ? { id: `col:${col}:0`, title: '⬅️ Back', description: 'Back to products' } : null;
  return list(
    p.title,
    `Choose a size / variant of *${p.title}* 👇`,
    'Choose size',
    page(items, pageNo, `prod:${col || '-'}:${handle}:${pageNo + 1}`, back),
    'Sizes'
  );
}

async function variant(col, handle, variantId, known) {
  const p = known || (await findProduct(col, handle));
  const v = p && p.variants.find((x) => x.id === String(variantId));
  if (!v) return buttons('Sorry, that option is no longer available.', [{ id: 'start', title: '🏠 Main menu' }]);
  const name = v.title && v.title !== 'Default Title' ? `${p.title} — ${v.title}` : p.title;
  return buyLink(
    `*${name}*\n💰 ${rs(v.price)}\n\nTap *Buy Now* to open this product on our website with your selection ready to add to cart. 🛒`,
    shop.productUrl(handle, v.id),
    p.image
  );
}

// ---------- router ----------
// input: { text?: string, replyId?: string }  -> returns an array of messages to send
async function respond(input) {
  const id = input.replyId;
  const t = (input.text || '').trim().toLowerCase();

  try {
    if (!id) {
      if (/^(retail|1)$/.test(t)) return [categories()];
      if (/^(corporate|bulk|2)$/.test(t)) return corporate();
      return [welcome()];
    }
    if (id === 'start') return [welcome()];
    if (id === 'retail') return [categories()];
    if (id === 'corporate') return corporate();

    const [kind, a, b, c] = id.split(':');
    if (kind === 'cat') return [await category(a)];
    if (kind === 'col') return [await collection(a, Number(b) || 0)];
    if (kind === 'prod') return [await product(a === '-' ? null : a, b, Number(c) || 0)];
    if (kind === 'var') return [await variant(a === '-' ? null : a, b, c)];
    return [welcome()];
  } catch (err) {
    console.error('Bot error:', err);
    return [
      text(`Sorry, something went wrong on our side 🙏\nYou can browse all products here: ${STORE_URL}`),
      buttons('Try again?', [{ id: 'start', title: '🏠 Main menu' }]),
    ];
  }
}

module.exports = { respond };
