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

const config = require('./config');
const liveMenu = require('./menu');
let MENU = config.MENU; // replaced by the live website menu on every message (see respond)
const { CORPORATE_EMAIL, BRAND, TAGLINE, DELIVERY_NOTE, WELCOME_IMAGE, STORE_URL, CATALOG_ID, CATALOG_ITEM_ID, CALL_NUMBER } = require('./config');
const hours = require('./hours');
const admin = require('./shopify-admin');
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
// "oils-rose-water" -> the category; "oils-rose-water~1" -> its 2nd sub-collection (e.g. Rose Water)
function findCategory(key) {
  const [base, sub] = String(key || '').split('~');
  const c = MENU.find((m) => m.key === base);
  if (!c || sub === undefined) return c;
  const s = (c.children || [])[Number(sub)];
  return s ? { key: `${base}~${sub}`, title: s.title, collection: s.collection, product: s.product, parent: c } : c;
}

// Does this category open onto sub-collections first (e.g. Essential Oils / Rose Water)?
const hasSubCollections = (c) => !c.parent && (c.children || []).some((s) => s.collection);
const collectionsOf = (c) => (c.collection ? [c.collection] : (c.children || []).map((s) => s.collection)).filter(Boolean);

// The links that make up a category, in website-menu order: collections and/or single products
const linksOf = (c) => (c.children && c.children.length ? c.children : [c]).filter((l) => l.collection || l.product);

// Products for one menu link (a whole collection, or a single product)
async function linkProducts(l) {
  try {
    if (l.product) {
      const p = await shop.getProduct(l.product);
      return p && p.variants.length ? [p] : [];
    }
    return await shop.getCollectionProducts(l.collection);
  } catch (e) {
    console.error(`Menu link ${l.product || l.collection}:`, e.message);
    return [];
  }
}

// All in-stock products of a category, in the same order as the website menu (no duplicates)
async function categoryProducts(c) {
  const lists = await Promise.all(linksOf(c).map(linkProducts));
  const seen = new Set();
  const out = [];
  for (const items of lists) for (const p of items) if (!seen.has(p.handle)) seen.add(p.handle), out.push(p);
  return out;
}

// Photo for a category card: its first product's picture
async function categoryPhoto(c) {
  const first = (await categoryProducts(c))[0];
  return first ? first.image : null;
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
const AGENT = { id: 'agent', title: CALL_NUMBER ? '📞 Talk to Executive' : '💬 Talk to Executive' };
const SHOP = { id: 'retail', title: '🛍️ Shop Products' };
const ORDERS = { id: 'orders', title: '📦 My Orders' };

function welcome(note, name) {
  const hello = firstName(name) ? `Hello ${firstName(name)},` : 'Hello,';
  const body = (note ? note + '\n\n' : '') + `${hello}\nWelcome to *${BRAND}*.\n\n${TAGLINE}\n\nHow may we assist you today?`;
  return [
    buttons(body, admin.enabled() ? [SHOP, ORDERS, AGENT] : [SHOP, AGENT], WELCOME_IMAGE ? { type: 'image', image: { link: WELCOME_IMAGE } } : null, DELIVERY_NOTE || null),
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
// True when the customer actually asked to CHAT with a person (alerts the team and pauses the bot)
function isAgentRequest(input) {
  if (input.replyId === 'agent_chat') return true;
  if (CALL_NUMBER) return false; // with a call option, "Talk to Executive" first asks Chat or Call
  return input.replyId === 'agent' || (!input.replyId && AGENT_TEXT.test((input.text || '').trim()));
}

// Talk to Executive -> "Call Now" button that opens the phone's dialer (via the bot's /call page)
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
function agentChoice(name) {
  if (!CALL_NUMBER || !PUBLIC_URL) return agent(name); // no number set -> chat with the team instead
  const when = hours.describe() ? `Available ${hours.describe()} (IST).` : '';
  const card = {
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      header: { type: 'text', text: 'Talk to an Executive' },
      body: { text: `Our customer care team will be glad to assist you personally.${when ? '\n' + when.trim() : ''}` },
      action: { name: 'cta_url', parameters: { display_text: 'Call Now', url: `${PUBLIC_URL}/call` } },
    },
  };
  return [card, buttons('Anything else?', [SHOP, MAIN])];
}

// Chat with the team (used when no CALL_NUMBER is set)
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
async function categoriesCards() {
  const photos = await Promise.all(MENU.map(categoryPhoto));
  const cards = MENU.map((c, i) => ({ image: img(photos[i]), body: `*${c.title}*\n${c.description || ''}`, button: { id: `cat:${c.key}:0`, title: 'Explore' } }));
  return [
    carousel(
      `*Shop by Category* 🛍️\nSwipe to browse our collections and tap *Explore*.`,
      cards,
      list('Shop by Category', 'Please choose a category.', 'View categories', MENU.map((c) => ({ id: `cat:${c.key}:0`, title: c.title, desc: c.description })))
    ),
  ];
}

// Category -> product carousel (all products, with photos and prices)
async function categoryCards(key, pageNo = 0) {
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

  // Several sizes: one photo card listing every size & price, then the size choice
  const varId = (v) => `var:${catKey || '-'}:${p.handle}:${v.id}`;
  const sizeLines = p.variants.map((v) => `• ${v.title} — ${priceLine(v)}`).join('\n');
  const body = cut(`*${p.title}*\n\n${sizeLines}${DELIVERY_NOTE ? `\n\n✓ ${DELIVERY_NOTE}` : ''}`, 1024);
  const photo = { type: 'image', image: { link: img(p.image) } };
  if (p.variants.length <= 3) {
    const short = (v) => { const l = `${v.title} · ${rs(v.price)}`; return l.length <= 20 ? l : cut(v.title, 20); };
    return [buttons(body + '\n\nPlease tap your size 👇', p.variants.map((v) => ({ id: varId(v), title: short(v) })), photo)];
  }
  return [
    buttons(body, [{ id: catKey ? `cat:${catKey}:0` : 'retail', title: '‹ Back' }], photo),
    list(p.title, `Please choose your size for *${p.title}*.`, 'Choose size', p.variants.slice(0, 10).map((v) => ({ id: varId(v), title: v.title, desc: rs(v.price) + (v.compareAt > v.price ? `  (was ${rs(v.compareAt)})` : '') }))),
  ];
}

// ================= Vertical photo cards (default display) =================
const photoHeader = (url) => ({ type: 'image', image: { link: img(url) } });

// Shop Products -> one photo card per category, stacked vertically
async function categoriesStack() {
  const out = [text('*Shop by Category* 🛍️\nTap *Explore* on any collection below 👇')];
  const photos = await Promise.all(MENU.map(categoryPhoto));
  MENU.forEach((c, i) => out.push(buttons(`*${c.title}*${c.description ? '\n' + c.description : ''}`, [{ id: `cat:${c.key}:0`, title: 'Explore' }], photoHeader(photos[i]))));
  return out;
}

const STACK = 8; // product cards per page

// One product as a photo card: single size -> Buy Now; several sizes -> Choose Size
function productCard(key, p) {
  if (p.variants.length === 1) {
    const v = p.variants[0];
    const m = buyCard(`*${p.title}*${isSized(v) ? `\nSize: ${v.title}` : ''}\n${priceLine(v)}`, shop.productUrl(p.handle, v.id), img(v.image || p.image));
    delete m.interactive.footer;
    return m;
  }
  const sale = p.variants.some((v) => v.compareAt > v.price) ? '  🏷️ On sale' : '';
  return buttons(`*${p.title}*\nFrom ${rs(minPrice(p))} · ${p.variants.length} sizes${sale}`, [{ id: `prod:${key}:${p.handle}`, title: 'Choose Size' }], photoHeader(p.image));
}

// Category with sub-collections -> one card per sub-collection (and per single product), to choose from
async function subCategoryStack(c) {
  const lists = await Promise.all(c.children.map(linkProducts));
  const out = [text(`*${c.title}*\nPlease choose 👇`)];
  c.children.forEach((s, i) => {
    const items = lists[i];
    if (!items.length) return; // nothing in stock here right now
    if (s.product) return out.push(productCard(c.key, items[0]));
    out.push(buttons(`*${s.title}*\n${items.length} product${items.length > 1 ? 's' : ''}`, [{ id: `cat:${c.key}~${i}:0`, title: 'Explore' }], photoHeader(items[0].image)));
  });
  if (out.length === 1) return [buttons(`Our *${c.title}* range is currently out of stock. Please explore our other collections or speak with an executive.`, [SHOP, AGENT])];
  out.push(buttons('Looking for something else?', [{ id: 'retail', title: '🛍️ All Collections' }, AGENT]));
  return out;
}

// Category -> one photo card per product, stacked vertically
async function categoryStack(key, pageNo = 0) {
  const c = findCategory(key);
  if (!c) return categoriesStack();
  if (hasSubCollections(c)) return subCategoryStack(c);
  const products = await categoryProducts(c);
  if (!products.length) {
    return [buttons(`Our *${c.title}* range is currently out of stock. Please explore our other collections or speak with an executive.`, [SHOP, AGENT])];
  }
  // A category that is a single product (e.g. Shilajit): open it straight away
  if (products.length === 1) return product(key, products[0].handle, products[0]);
  const start = pageNo * STACK;
  const pageItems = products.slice(start, start + STACK);
  const out = [text(`*${c.title}*\n${products.length} product${products.length > 1 ? 's' : ''}${pageNo ? ` · page ${pageNo + 1}` : ''} 👇`)];
  for (const p of pageItems) out.push(productCard(key, p));
  const nav = [];
  if (products.length > start + STACK) nav.push({ id: `cat:${key}:${pageNo + 1}`, title: 'More products ›' });
  if (c.parent) nav.push({ id: `cat:${c.parent.key}:0`, title: cut(`‹ ${c.parent.title}`, 20) });
  nav.push({ id: 'retail', title: '🛍️ All Collections' }, AGENT);
  out.push(buttons('Looking for something else?', nav.slice(0, 3)));
  return out;
}

// ================= WhatsApp Catalog (vertical list with photos + cart) =================
const retailerId = (p, v) => CATALOG_ITEM_ID.replace('{product_id}', p.id).replace('{variant_id}', v.id);

// Native WhatsApp product list. sections: [{ title, items: [retailerId] }] (max 10 sections, 30 items)
function productList(header, body, sections, fallbackMsgs) {
  const m = {
    type: 'interactive',
    interactive: {
      type: 'product_list',
      header: { type: 'text', text: cut(header, 60) },
      body: { text: cut(body, 1024) },
      footer: { text: 'Tap an item to see details · add to cart' },
      action: {
        catalog_id: CATALOG_ID,
        sections: sections.map((sec) => ({
          title: cut(sec.title, 24),
          product_items: sec.items.map((id) => ({ product_retailer_id: id })),
        })),
      },
    },
  };
  // If WhatsApp rejects the catalog list, fall back to photo cards (and then to a plain list)
  if (fallbackMsgs && fallbackMsgs[0]) {
    const { _fallbacks = [], ...first } = fallbackMsgs[0];
    m._fallbacks = [first, ..._fallbacks];
  }
  return m;
}

const HOW_TO_BUY =
  'Tap *View items* to browse. Open any product for photos and details, add what you like to your cart, then tap *Send* — we\'ll reply with your secure checkout link.';

// Shop Products -> catalog overview (all categories, a few products each) + list to open a full collection
async function categories() {
  if (!CATALOG_ID) return categoriesStack();
  const perCat = Math.max(1, Math.floor(30 / MENU.length));
  const sections = [];
  for (const c of MENU) {
    const products = await categoryProducts(c);
    const items = products.slice(0, perCat).map((p) => retailerId(p, p.variants.reduce((a, b) => (b.price < a.price ? b : a))));
    if (items.length) sections.push({ title: c.title, items });
  }
  const browse = list(
    'Full collections',
    'Or open a complete collection with every size:',
    'View collections',
    MENU.map((c) => ({ id: `cat:${c.key}:0`, title: c.title, desc: c.description }))
  );
  if (!sections.length) return categoriesCards();
  return [
    productList(`${BRAND} — Shop`, `*Our bestsellers by category* 🛍️\n\n${HOW_TO_BUY}`, sections.slice(0, 10), await categoriesCards()),
    browse,
  ];
}

// Category -> catalog list: one section per product, every size listed (with photos & prices)
async function category(key, pageNo = 0) {
  if (!CATALOG_ID) return categoryStack(key, pageNo);
  const c = findCategory(key);
  if (!c) return categories();
  if (hasSubCollections(c)) return categoryStack(key, pageNo);
  const products = await categoryProducts(c);
  if (!products.length) return categoryCards(key, pageNo);

  // Build pages that respect WhatsApp's limits (10 sections / 30 items per message)
  const pages = [[]];
  let count = 0;
  for (const p of products) {
    const ids = p.variants.slice(0, 30).map((v) => retailerId(p, v));
    const cur = pages[pages.length - 1];
    if (cur.length && (cur.length >= 10 || count + ids.length > 30)) {
      pages.push([]);
      count = 0;
    }
    pages[pages.length - 1].push({ title: p.title, items: ids });
    count += ids.length;
  }
  const page = pages[Math.min(pageNo, pages.length - 1)];
  const out = [
    productList(
      c.title,
      `*${c.title}*${pages.length > 1 ? ` (${pageNo + 1}/${pages.length})` : ''}\nEvery size is listed under its product.\n\n${HOW_TO_BUY}`,
      page,
      await categoryCards(key, Math.min(pageNo, Math.ceil(products.length / PAGE) - 1))
    ),
  ];
  const btns = [];
  if (pageNo + 1 < pages.length) btns.push({ id: `cat:${key}:${pageNo + 1}`, title: 'More products ›' });
  btns.push({ id: 'retail', title: '🛍️ All Collections' }, AGENT);
  out.push(buttons('Looking for something else?', btns.slice(0, 3)));
  return out;
}

// Find a Shopify variant (for order summaries)
async function lookupVariant(variantId) {
  for (const c of MENU) {
    for (const p of await categoryProducts(c)) {
      const v = p.variants.find((x) => x.id === String(variantId));
      if (v) return { p, v };
    }
  }
  return null;
}

// Customer sent their WhatsApp cart -> summary + secure checkout link on the website
async function orderReply(order, name) {
  const items = [];
  for (const it of (order && order.product_items) || []) {
    const m = String(it.product_retailer_id || '').match(/(\d+)\D*$/);
    if (!m) continue;
    const found = await lookupVariant(m[1]).catch(() => null);
    items.push({
      variantId: m[1],
      quantity: Number(it.quantity) || 1,
      price: Number(it.item_price) || (found ? found.v.price : 0),
      label: found ? `${found.p.title}${isSized(found.v) ? ' — ' + found.v.title : ''}` : 'Item',
      image: found ? found.v.image || found.p.image : null,
    });
  }
  if (!items.length) {
    return [buttons('Sorry, we could not read your cart. Please try again or speak with an executive.', [SHOP, AGENT])];
  }
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const lines = items.map((i) => `• ${i.quantity} × ${i.label} — ${rs(i.price * i.quantity)}`);
  const hi = firstName(name) ? `Thank you, ${firstName(name)}! ` : 'Thank you! ';
  const body = cut(
    `${hi}Here is your order summary:\n\n${lines.join('\n')}\n\n*Total: ${rs(total)}*${DELIVERY_NOTE ? `\n✓ ${DELIVERY_NOTE}` : ''}\n\nTap *Checkout* to pay securely on our website — your items are already in the cart.`,
    1024
  );
  const m = buyCard(body, shop.checkoutUrl(items), img(items[0].image));
  m.interactive.action.parameters.display_text = 'Checkout';
  return [m, buttons('Need anything else?', [{ id: 'retail', title: '🛍️ Keep Shopping' }, AGENT])];
}


// ================= My Orders (Shopify customer data) =================
// Looks up the customer by the WhatsApp number the message came from (verified by WhatsApp),
// so nobody can see someone else's orders by typing their number.
const STATUS = {
  FULFILLED: 'Shipped', UNFULFILLED: 'Being prepared', PARTIALLY_FULFILLED: 'Partly shipped',
  IN_PROGRESS: 'Being prepared', ON_HOLD: 'On hold', SCHEDULED: 'Scheduled', OPEN: 'Being prepared',
  PENDING_FULFILLMENT: 'Being prepared', RESTOCKED: 'Returned',
};
const DELIVERY = {
  DELIVERED: 'Delivered ✅', IN_TRANSIT: 'In transit 🚚', OUT_FOR_DELIVERY: 'Out for delivery 🚚', ATTEMPTED_DELIVERY: 'Delivery attempted',
  READY_FOR_PICKUP: 'Ready for pickup', CONFIRMED: 'Shipped 📦', LABEL_PRINTED: 'Packed 📦', LABEL_PURCHASED: 'Packed 📦', FAILURE: 'Delivery issue',
};
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

function orderCard(o) {
  const f = (o.fulfillments || []).find((x) => x.trackingInfo && x.trackingInfo.length) || (o.fulfillments || [])[0];
  const t = f && f.trackingInfo && f.trackingInfo[0];
  let status = o.cancelledAt ? 'Cancelled' : (f && DELIVERY[f.displayStatus]) || STATUS[o.displayFulfillmentStatus] || 'Order received';
  const items = o.lineItems.nodes.map((l) => `${l.quantity} × ${l.title}`);
  const money = o.totalPriceSet.shopMoney;
  const lines = [
    `*Order ${o.name}*  ·  ${fmtDate(o.createdAt)}`,
    '',
    ...items.slice(0, 4).map((i) => `• ${i}`),
    ...(items.length > 4 ? [`• +${items.length - 4} more`] : []),
    '',
    `Total: *${rs(Number(money.amount))}*`,
    `Status: *${status}*`,
  ];
  if (t && (t.company || t.number)) lines.push(`Courier: ${[t.company, t.number].filter(Boolean).join(' · ')}`);
  const url = (t && t.url) || o.statusPageUrl;
  const m = {
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: cut(lines.join('\n'), 1024) },
      action: { name: 'cta_url', parameters: { display_text: t && t.url ? 'Track Package' : 'View Order', url } },
    },
  };
  return url ? m : text(lines.join('\n'));
}

async function myOrders(from, name) {
  if (!admin.enabled()) return welcome(null, name);
  let c = null;
  try {
    c = await admin.customerByWhatsApp(from);
  } catch (e) {
    console.error('Shopify lookup failed:', e.message);
    return [buttons(`We're sorry — we couldn't fetch your orders just now. Please try again in a few minutes.`, [ORDERS, AGENT, MAIN])];
  }
  const pretty = '+' + String(from).replace(/\D/g, '');
  if (!c || !c.orders.nodes.length) {
    return [
      buttons(
        `We couldn't find any orders linked to *${pretty}*.\n\nIf you placed your order with a different phone number, please message us from that WhatsApp number, or speak with our team and we'll help you right away.`,
        [SHOP, AGENT, MAIN]
      ),
    ];
  }
  const hello = c.firstName || firstName(name);
  const out = [text(`${hello ? `Hello ${hello}, h` : 'H'}ere ${c.orders.nodes.length > 1 ? `are your ${c.orders.nodes.length} most recent orders` : 'is your most recent order'} 📦`)];
  for (const o of c.orders.nodes) out.push(orderCard(o));
  out.push(buttons('Anything else?', [SHOP, AGENT, MAIN]));
  return out;
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
  MENU = await liveMenu.get(); // follow the website's current menu
  const id = input.replyId;
  const t = (input.text || '').trim().toLowerCase();

  try {
    if (input.order) return await orderReply(input.order, input.name);
    if (!id) {
      if (/^(retail|shop|1)$/.test(t)) return await categories();
      if (/^(corporate|bulk)$/.test(t)) return corporate();
      if (/^(my )?(orders?|track( my)?( order| package)?|order status)$/.test(t)) return await myOrders(input.from, input.name);
      if (AGENT_TEXT.test(t)) return agentChoice(input.name);
      if (THANKS.test(t)) return thanks();
      return welcome(input.note, input.name);
    }
    if (id === 'start') return welcome(null, input.name);
    if (id === 'retail') return await categories();
    if (id === 'corporate') return corporate();
    if (id === 'orders') return await myOrders(input.from, input.name);
    if (id === 'agent') return agentChoice(input.name);
    if (id === 'agent_chat') return agent(input.name);
    if (id === 'agent_call') return agentChoice(input.name);

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
