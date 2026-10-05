// Conversation logic. Stateless: every button carries an ID that says where
// the customer is (e.g. "cat:honey:0"), so no database is needed.
//
// Flow:  "hi" (or any first message) -> welcome [Shop Products | Talk to Executive]
//        Shop Products  -> carousel of categories (photo cards)
//        Category       -> carousel of all its products (photo, name, price)
//        Product        -> carousel of its sizes, each with a "Buy Now" button to the website
//
// Carousels: one message, 2–10 swipeable cards. If WhatsApp ever rejects a carousel,
// the same items are sent as a single list instead (see _fallbacks / whatsapp.js).

const { MENU, CORPORATE_EMAIL, BRAND, TAGLINE, DELIVERY_NOTE, WELCOME_IMAGE, STORE_URL } = require('./config');
const hours = require('./hours');
const shop = require('./shopify');

const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');
const rs = (n) => 'Rs. ' + Math.round(n).toLocaleString('en-IN');
const PAGE = 9; // products per carousel page (+1 "More" card = 10, WhatsApp's maximum)

// Smaller, fast-loading version of a Shopify image
function img(url, width = 800) {
  if (!url) return WELCOME_IMAGE || null;
  if (!/cdn\.shopify\.com|\/cdn\/shop\//.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'width=' + width;
}

// ---------- message builders (WhatsApp Cloud API payloads) ----------
function buttons(body, btns, header, footer) {
  const m = {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: { buttons: btns.map((b) => ({ type: 'reply', reply: { id: b.id, title: cut(b.title, 20) } })) },
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

function buyCard(body, url, image) {
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

// One-tap list with all items together (used as the carousel fallback)
function list(header, body, buttonText, rows) {
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: cut(header, 60) },
      body: { text: cut(body, 1024) },
      footer: { text: 'Type "hi" anytime to start again' },
      action: {
        button: cut(buttonText, 20),
        sections: [
          {
            title: cut(header, 24),
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: cut(r.title, 24),
              ...(r.desc ? { description: cut(r.desc, 72) } : {}),
            })),
          },
        ],
      },
    },
  };
}

// Swipeable carousel. cards: [{ image, body, button: {id,title} | {url,title} }]
// All cards must use the same button kind (WhatsApp rule).
function carousel(body, cards, fallback) {
  const build = (withType) => ({
    type: 'interactive',
    interactive: {
      type: 'carousel',
      body: { text: cut(body, 1024) },
      action: {
        cards: cards.map((c, i) => {
          const card = {
            card_index: i,
            header: { type: 'image', image: { link: c.image } },
            body: { text: cardText(c.body) },
          };
          if (withType) card.type = 'cta_url';
          card.action = c.button.url
            ? { name: 'cta_url', parameters: { display_text: cut(c.button.title, 20), url: c.button.url } }
            : { buttons: [{ type: 'quick_reply', quick_reply: { id: c.button.id, title: cut(c.button.title, 20) } }] };
          return card;
        }),
      },
    },
  });
  const m = build(true);
  m._fallbacks = [build(false), ...(fallback ? [fallback] : [])];
  return m;
}

// Card text: max 160 characters and max 2 line breaks
function cardText(s) {
  const lines = String(s).split('\n');
  const t = lines.length > 3 ? [lines[0], lines[1], lines.slice(2).join(' ')].join('\n') : s;
  return cut(t, 160);
}

// ---------- catalog helpers ----------
const findCategory = (key) => MENU.find((c) => c.key === key);
const collectionsOf = (c) => (c.collection ? [c.collection] : (c.children || []).map((s) => s.collection));

// All in-stock products of a category (sub-collections merged, no duplicates)
async function categoryProducts(c) {
  const seen = new Set();
  const out = [];
  for (const col of collectionsOf(c)) {
    let items = [];
    try {
      items = await shop.getCollectionProducts(col);
    } catch (e) {
      console.error(`Collection ${col}:`, e.message);
    }
    for (const p of items) if (!seen.has(p.handle)) seen.add(p.handle), out.push(p);
  }
  return out;
}

async function findProduct(catKey, handle) {
  const c = catKey && findCategory(catKey);
  if (c) {
    const p = (await categoryProducts(c)).find((x) => x.handle === handle);
    if (p) return p;
  }
  return shop.getProduct(handle);
}

const minPrice = (p) => Math.min(...p.variants.map((v) => v.price));
const isSized = (v) => v.title && v.title !== 'Default Title';

function priceLine(v) {
  let s = `*${rs(v.price)}*`;
  if (v.compareAt > v.price) s += `  ~${rs(v.compareAt)}~  ${Math.round((1 - v.price / v.compareAt) * 100)}% off`;
  return s;
}

// ---------- screens (each returns an array of messages) ----------
const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';
const MAIN = { id: 'start', title: '🏠 Main Menu' };
const AGENT = { id: 'agent', title: '💬 Talk to Executive' };
const SHOP = { id: 'retail', title: '🛍️ Shop Products' };

function welcome(note, name) {
  const hello = firstName(name) ? `Hello ${firstName(name)},` : 'Hello,';
  const body = (note ? note + '\n\n' : '') + `${hello}\nWelcome to *${BRAND}*.\n\n${TAGLINE}\n\nHow may we assist you today?`;
  return [
    buttons(body, [SHOP, AGENT], WELCOME_IMAGE ? { type: 'image', image: { link: WELCOME_IMAGE } } : null, DELIVERY_NOTE || null),
  ];
}

function corporate() {
  return [
    buttons(
      `*Corporate & Bulk Orders*\n\nFor corporate gifting and bulk orders, please email your requirement to *${CORPORATE_EMAIL}*, or speak with an executive here.`,
      [AGENT, MAIN]
    ),
  ];
}

const AGENT_TEXT = /^(2|3|agent|executive|human|talk to (an? )?(executive|agent|human|someone|team))$/i;
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
      `🔔 *Executive requested*\n\n${thanks} Your request has been passed to our team. ${when}\n\nYou are welcome to share your question or order details here in the meantime. You can also write to us at ${CORPORATE_EMAIL}.\n\n_Send *hi* at any time to return to the main menu._`
    ),
  ];
}

function thanks() {
  return [buttons(`You're most welcome! It was a pleasure assisting you. 🌸`, [SHOP, MAIN])];
}

// Shop Products -> category carousel (photo of a product from each category)
async function categories() {
  const cards = [];
  for (const c of MENU) {
    let photo = null;
    try {
      const first = (await shop.getCollectionProducts(collectionsOf(c)[0]))[0];
      photo = first && first.image;
    } catch (_) {}
    cards.push({ image: img(photo), body: `*${c.title}*\n${c.description || ''}`, button: { id: `cat:${c.key}:0`, title: 'Explore' } });
  }
  return [
    carousel(
      `*Shop by Category* 🛍️\nSwipe to browse our collections and tap *Explore*.`,
      cards,
      list('Shop by Category', 'Please choose a category.', 'View categories', MENU.map((c) => ({ id: `cat:${c.key}:0`, title: c.title, desc: c.description })))
    ),
  ];
}

// Category -> product carousel (all products, with photos and prices)
async function category(key, pageNo = 0) {
  const c = findCategory(key);
  if (!c) return categories();
  const products = await categoryProducts(c);
  if (!products.length) {
    return [buttons(`Our *${c.title}* range is currently out of stock. Please explore our other categories or speak with an executive.`, [SHOP, AGENT])];
  }

  const start = pageNo * PAGE;
  const pageItems = products.slice(start, start + PAGE);
  const more = products.length > start + PAGE;

  // A single product: show its card directly
  if (products.length === 1) return product(key, products[0].handle, products[0]);

  const cards = pageItems.map((p) => ({
    image: img(p.image),
    body: `*${p.title}*\n${p.variants.length > 1 ? 'From ' : ''}${rs(minPrice(p))}`,
    button: { id: `prod:${key}:${p.handle}`, title: p.variants.length > 1 ? 'Choose Size' : 'Select' },
  }));
  if (more) {
    cards.push({
      image: img(WELCOME_IMAGE),
      body: `*More from ${c.title}*\n${products.length - start - PAGE} more product(s)`,
      button: { id: `cat:${key}:${pageNo + 1}`, title: 'See More' },
    });
  }
  // keep button counts identical across cards (WhatsApp rule): all cards have exactly one button
  if (cards.length === 1) cards.push({ image: img(WELCOME_IMAGE), body: '*Browse all categories*', button: { id: 'retail', title: 'All Categories' } });

  const rows = pageItems.map((p) => ({ id: `prod:${key}:${p.handle}`, title: p.title, desc: `${p.variants.length > 1 ? 'From ' : ''}${rs(minPrice(p))}` }));
  if (more) rows.push({ id: `cat:${key}:${pageNo + 1}`, title: 'More products ›' });
  return [
    carousel(
      `*${c.title}*${pageNo ? ` (page ${pageNo + 1})` : ''}\nSwipe to see all ${pageNo ? '' : products.length + ' '}products 👉`,
      cards,
      list(c.title, 'Please choose a product.', 'View products', rows)
    ),
  ];
}

// Product -> size carousel, each card with "Buy Now" straight to the website
async function product(catKey, handle, known) {
  const p = known || (await findProduct(catKey, handle));
  if (!p || !p.variants.length) return [buttons('This product is currently unavailable. Please explore our other products.', [SHOP, AGENT])];

  const afterBuy = buttons('Would you like to continue?', [
    { id: catKey ? `cat:${catKey}:0` : 'retail', title: '🛍️ Keep Shopping' },
    AGENT,
    MAIN,
  ]);

  // One size (or no sizes): a single product card
  if (p.variants.length === 1) {
    const v = p.variants[0];
    const lines = [`*${p.title}*`, ''];
    if (isSized(v)) lines.push(`Size: ${v.title}`);
    lines.push(`Price: ${priceLine(v)}`, '', '✓ Sourced directly from Kashmir');
    if (DELIVERY_NOTE) lines.push(`✓ ${DELIVERY_NOTE}`);
    return [buyCard(lines.join('\n'), shop.productUrl(p.handle, v.id), img(v.image || p.image)), afterBuy];
  }

  const sizes = p.variants.slice(0, 10);
  const cards = sizes.map((v) => ({
    image: img(v.image || p.image),
    body: `*${p.title}*\nSize: ${v.title}\n${priceLine(v)}`,
    button: { url: shop.productUrl(p.handle, v.id), title: 'Buy Now' },
  }));
  // Fallback if carousels are rejected: list of sizes -> single buy card
  const fb = list(p.title, `Please select a size for *${p.title}*.`, 'Choose size', sizes.map((v) => ({ id: `var:${catKey || '-'}:${p.handle}:${v.id}`, title: v.title, desc: rs(v.price) })));
  return [
    carousel(
      `*${p.title}*\nSwipe to choose your size, then tap *Buy Now* to complete your purchase on our website.${DELIVERY_NOTE ? `\n\n✓ ${DELIVERY_NOTE}` : ''}`,
      cards,
      fb
    ),
    afterBuy,
  ];
}

// A specific size (used by the list fallback and older buttons)
async function variant(catKey, handle, variantId) {
  const p = await findProduct(catKey, handle);
  const v = p && p.variants.find((x) => x.id === String(variantId));
  if (!v) return [buttons('This option is no longer available. Please choose another.', [SHOP, MAIN])];
  const lines = [`*${p.title}*`, '', ...(isSized(v) ? [`Size: ${v.title}`] : []), `Price: ${priceLine(v)}`, '', '✓ Sourced directly from Kashmir'];
  if (DELIVERY_NOTE) lines.push(`✓ ${DELIVERY_NOTE}`);
  return [
    buyCard(lines.join('\n'), shop.productUrl(handle, v.id), img(v.image || p.image)),
    buttons('Would you like to continue?', [{ id: catKey ? `cat:${catKey}:0` : 'retail', title: '🛍️ Keep Shopping' }, AGENT, MAIN]),
  ];
}

// ---------- router ----------
// input: { text?, replyId?, note?, name? }  -> returns an array of messages to send
const THANKS = /^(thanks?|thank you|thank u|thx|ty|ok(ay)?( thanks?)?|great|done|👍|🙏)[\s!.]*$/i;

// Older button IDs from earlier versions: map a collection handle to its category
function catOfCollection(handle) {
  const c = MENU.find((m) => collectionsOf(m).includes(handle));
  return c ? c.key : null;
}

async function respond(input) {
  const id = input.replyId;
  const t = (input.text || '').trim().toLowerCase();

  try {
    if (!id) {
      if (/^(retail|shop|1)$/.test(t)) return await categories();
      if (/^(corporate|bulk)$/.test(t)) return corporate();
      if (AGENT_TEXT.test(t)) return agent(input.name);
      if (THANKS.test(t)) return thanks();
      return welcome(input.note, input.name);
    }
    if (id === 'start') return welcome(null, input.name);
    if (id === 'retail') return await categories();
    if (id === 'corporate') return corporate();
    if (id === 'agent') return agent(input.name);

    const [kind, a, b, c] = id.split(':');
    if (kind === 'cat') return await category(a, Number(b) || 0);
    if (kind === 'prod') {
      const catKey = findCategory(a) ? a : catOfCollection(a); // new IDs use category keys
      return await product(catKey, b);
    }
    if (kind === 'var') {
      const catKey = a === '-' ? null : findCategory(a) ? a : catOfCollection(a);
      return await variant(catKey, b, c);
    }
    if (kind === 'col') return await category(catOfCollection(a) || '', 0);
    return welcome(null, input.name);
  } catch (err) {
    console.error('Bot error:', err);
    return [buttons(`We're sorry — we couldn't load that just now. Please try again, or browse our full range at ${STORE_URL}`, [MAIN, AGENT])];
  }
}

module.exports = { respond, isAgentRequest };
