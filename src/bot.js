// Conversation logic. Stateless: every button carries an ID that says where
// the customer is (e.g. "col:kashmiri-saffron:0"), so no database is needed.
//
// Flow:  any message -> [Retail | Corporate]
//        Corporate   -> email address
//        Retail      -> Category -> Sub-category -> Product -> Size/variant -> "Buy Now" link
//
// All choices are shown as tappable buttons directly in the chat (no "View options" step).
// WhatsApp allows max 3 buttons per message, so longer menus are split over a few messages.

const { MENU, CORPORATE_EMAIL, BRAND, STORE_URL, TAGLINE, DELIVERY_NOTE, WELCOME_IMAGE } = require('./config');
const hours = require('./hours');
const shop = require('./shopify');

const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');
const rs = (n) => 'Rs. ' + Math.round(n).toLocaleString('en-IN');

const PER_PAGE = 7; // items per page before a "More" button (7 + More + Back = 3 messages max)

// ---------- message builders (WhatsApp Cloud API payloads) ----------
function buttons(body, btns, header, footer) {
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
  if (header && typeof header === 'object') m.interactive.header = header;
  else if (header) m.interactive.header = { type: 'text', text: cut(header, 60) };
  if (footer) m.interactive.footer = { text: cut(footer, 60) };
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
      footer: { text: 'Secure checkout on organickashmir.com' },
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
  if (rest.length > out.length) out.push({ id: moreId, title: 'More ›' });
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
const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';
const MAIN = { id: 'start', title: '🏠 Main Menu' };
const AGENT = { id: 'agent', title: '💬 Talk to Executive' };

function welcome(note, name) {
  const hello = firstName(name) ? `Hello ${firstName(name)},` : 'Hello,';
  const body =
    (note ? note + '\n\n' : '') +
    `${hello}\nWelcome to *${BRAND}*.\n\n${TAGLINE}\n\nHow may we assist you today?`;
  return [
    buttons(
      body,
      [
        { id: 'retail', title: '🛍️ Shop Products' },
        { id: 'corporate', title: '🏢 Corporate & Bulk' },
        AGENT,
      ],
      WELCOME_IMAGE ? { type: 'image', image: { link: WELCOME_IMAGE } } : null,
      DELIVERY_NOTE || null
    ),
  ];
}

function corporate() {
  return [
    buttons(
      `*Corporate & Bulk Orders*\n\n${BRAND} partners with hotels, businesses and gifting teams for curated hampers and bulk supplies of saffron, honey and other Kashmiri produce.\n\nPlease email your requirement — products, quantities and timeline — to:\n*${CORPORATE_EMAIL}*\n\nOur corporate team will get back to you promptly. You may also speak with an executive here.`,
      [AGENT, MAIN]
    ),
  ];
}

const AGENT_TEXT = /^(3|agent|executive|human|talk to (an? )?(executive|agent|human|someone|team))$/i;
function isAgentRequest(input) {
  return input.replyId === 'agent' || (!input.replyId && AGENT_TEXT.test((input.text || '').trim()));
}

function agent(name) {
  const thanks = firstName(name) ? `Thank you, ${firstName(name)}.` : 'Thank you.';
  const when = hours.isOpen()
    ? 'An executive will reply to you in this chat shortly.'
    : `Our team is available ${hours.describe()} (IST). An executive will reply to you in this chat as soon as we are back.`;
  return [
    text(
      `🔔 *Executive requested*\n\n${thanks} Your request has been passed to our team. ${when}\n\nYou are welcome to share your question or order details here in the meantime.\n\n_Type *menu* at any time to return to the main menu._`
    ),
  ];
}

function thanks() {
  return [buttons(`You're most welcome! It was a pleasure assisting you. 🌸`, [{ id: 'retail', title: '🛍️ Shop Products' }, MAIN])];
}

function categories() {
  return choices(
    'Please choose a category.',
    MENU.map((c) => ({ id: `cat:${c.key}`, title: c.title })),
    { header: 'Shop by Category', moreText: 'More categories' }
  );
}

async function category(key) {
  const c = findCategory(key);
  if (!c) return categories();
  if (!c.children) return collection(c.collection, 0);
  return choices(
    'Please select a collection.',
    [
      ...c.children.map((s) => ({ id: `col:${s.collection}:0`, title: s.title })),
      { id: 'retail', title: '‹ Back' },
    ],
    { header: c.title, moreText: 'More collections' }
  );
}

async function collection(handle, pageNo) {
  const { cat, sub } = parentOfCollection(handle);
  const title = (sub || cat || { title: 'Products' }).title;
  const products = await shop.getCollectionProducts(handle);
  const back = sub ? { id: `cat:${cat.key}`, title: '‹ Back' } : { id: 'retail', title: '‹ Back' };

  if (!products.length) {
    return [
      buttons(
        `The *${title}* collection is currently out of stock. Please explore our other categories or speak with an executive.`,
        [back, AGENT]
      ),
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
  return choices('Please choose a product.', paged(items, pageNo, `col:${handle}:${pageNo + 1}`, back), {
    header: title,
    startNum: pageNo * PER_PAGE,
    moreText: 'More products',
  });
}

async function product(col, handle, pageNo = 0) {
  const p = await findProduct(col, handle);
  if (!p || !p.variants.length) {
    return [buttons('This product is currently unavailable. Please explore our other products.', [{ id: 'retail', title: '🛍️ Shop Products' }, AGENT])];
  }
  if (p.variants.length === 1) return variant(col, handle, p.variants[0].id, p);

  const items = p.variants.map((v) => ({
    id: `var:${col || '-'}:${handle}:${v.id}`,
    title: v.title,
    line: `${v.title} — ${rs(v.price)}${v.compareAt > v.price ? ` ~${rs(v.compareAt)}~` : ''}`,
  }));
  const back = col ? { id: `col:${col}:0`, title: '‹ Back' } : null;
  return choices(
    `Please select a size for *${p.title}*.`,
    paged(items, pageNo, `prod:${col || '-'}:${handle}:${pageNo + 1}`, back),
    { header: p.title, startNum: pageNo * PER_PAGE, moreText: 'More sizes' }
  );
}

async function variant(col, handle, variantId, known) {
  const p = known || (await findProduct(col, handle));
  const v = p && p.variants.find((x) => x.id === String(variantId));
  if (!v) return [buttons('This option is no longer available. Please choose another.', [{ id: 'retail', title: '🛍️ Shop Products' }, MAIN])];

  const hasSize = v.title && v.title !== 'Default Title';
  let price = `*${rs(v.price)}*`;
  if (v.compareAt > v.price) {
    const off = Math.round((1 - v.price / v.compareAt) * 100);
    price += `  ~${rs(v.compareAt)}~  (${off}% off)`;
  }
  const lines = [`*${p.title}*`, ''];
  if (hasSize) lines.push(`Size: ${v.title}`);
  lines.push(`Price: ${price}`, '');
  lines.push('✓ Sourced directly from Kashmir');
  if (DELIVERY_NOTE) lines.push(`✓ ${DELIVERY_NOTE}`);
  lines.push('', 'Tap *Buy Now* to complete your purchase on our website.');

  return [
    buyLink(lines.join('\n'), shop.productUrl(handle, v.id), v.image || p.image),
    buttons('Would you like to continue?', [
      { id: col ? `col:${col}:0` : 'retail', title: '🛍️ Keep Shopping' },
      AGENT,
      MAIN,
    ]),
  ];
}

// ---------- router ----------
// input: { text?, replyId?, note?, name? }  -> returns an array of messages to send
const THANKS = /^(thanks?|thank you|thank u|thx|ty|ok(ay)?( thanks?)?|great|done|👍|🙏)[\s!.]*$/i;

async function respond(input) {
  const id = input.replyId;
  const t = (input.text || '').trim().toLowerCase();

  try {
    if (!id) {
      if (/^(retail|shop|1)$/.test(t)) return categories();
      if (/^(corporate|bulk|2)$/.test(t)) return corporate();
      if (AGENT_TEXT.test(t)) return agent(input.name);
      if (THANKS.test(t)) return thanks();
      return welcome(input.note, input.name);
    }
    if (id === 'start') return welcome(null, input.name);
    if (id === 'retail') return categories();
    if (id === 'corporate') return corporate();
    if (id === 'agent') return agent(input.name);

    const [kind, a, b, c] = id.split(':');
    if (kind === 'cat') return await category(a);
    if (kind === 'col') return await collection(a, Number(b) || 0);
    if (kind === 'prod') return await product(a === '-' ? null : a, b, Number(c) || 0);
    if (kind === 'var') return await variant(a === '-' ? null : a, b, c);
    return welcome(null, input.name);
  } catch (err) {
    console.error('Bot error:', err);
    return [
      buttons(
        `We're sorry — we couldn't load that just now. Please try again, or browse our full range at ${STORE_URL}`,
        [MAIN, AGENT]
      ),
    ];
  }
}

module.exports = { respond, isAgentRequest };
