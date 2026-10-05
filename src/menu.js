// Live category menu, read from the navigation menu on organickashmir.com.
// Add, remove, rename or reorder items in Shopify's menu (Online Store → Navigation)
// and the bot follows automatically. Menu items can link to collections or straight to products;
// anything with nothing in stock is hidden.
// If the website menu can't be read, the fixed MENU in config.js is used instead.
const { STORE_URL, MENU: FALLBACK } = require('./config');
const shop = require('./shopify');

const CACHE_MS = Number(process.env.CACHE_MINUTES || 2) * 60 * 1000;
let cache = { at: 0, menu: null };

const decode = (s) =>
  String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

// "HIMALAYAN HONEY" -> "Himalayan Honey"; keeps "|" and short words sensible
function niceTitle(t) {
  const s = decode(t);
  if (s !== s.toUpperCase()) return s; // already mixed case: keep as written
  return s
    .toLowerCase()
    .replace(/(^|[\s|&(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(And|Of|The|For|In|With)\b/g, (w) => w.toLowerCase())
    .replace(/^./, (c) => c.toUpperCase());
}

// What a menu link points to: a collection, a product, or neither (pages, blogs, etc.)
//   /collections/honey                  -> collection "honey"
//   /products/white-honey               -> product "white-honey"
//   /collections/honey/products/x       -> product "x"
function linkTarget(href) {
  const path = String(href || '').replace(/^https?:\/\/[^/]+/i, '').replace(/&amp;/g, '&');
  const product = (path.match(/^\/(?:collections\/[^/?#]+\/)?products\/([^/?#]+)/) || [])[1] || null;
  const collection = product ? null : (path.match(/^\/collections\/([^/?#]+)/) || [])[1] || null;
  return { collection: collection === 'all' ? null : collection, product };
}

// Parse the theme's mobile navigation: <ul class="mobile-nav"> ... <ul class="mobile-nav__sublist"> ...
function parseNav(html) {
  const start = html.search(/<ul[^>]*class="[^"]*\bmobile-nav\b(?!__)[^"]*"/);
  if (start < 0) return null;
  const re = /<ul[^>]*class="[^"]*mobile-nav__sublist[^"]*"[^>]*>|<\/ul>|<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  re.lastIndex = html.indexOf('>', start) + 1;
  const items = [];
  let inSub = false;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<ul')) {
      inSub = true;
      continue;
    }
    if (m[0] === '</ul>') {
      if (inSub) {
        inSub = false;
        continue;
      }
      break; // end of the main menu
    }
    const { collection, product } = linkTarget(m[1]);
    const title = niceTitle(m[2]);
    if (!title) continue;
    if (inSub) {
      const parent = items[items.length - 1];
      if (parent && product) parent.children.push({ title, product });
      else if (parent && collection) parent.children.push({ title, collection });
    } else {
      items.push({ title, collection, product, children: [] });
    }
  }
  return items;
}

// Does this menu link currently have something to sell?
async function inStock(link) {
  try {
    if (link.product) {
      const p = await shop.getProduct(link.product);
      return !!(p && p.variants.length);
    }
    return (await shop.getCollectionProducts(link.collection)).length > 0;
  } catch (_) {
    return false;
  }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Short line under a category, e.g. "White Honey, Raw Forest Honey, Saffron Honey & more"
function describe(children) {
  const names = children.map((c) => c.title);
  let s = '';
  for (let i = 0; i < names.length; i++) {
    const next = s ? `${s}, ${names[i]}` : names[i];
    if (next.length > 50) return s ? `${s} & more` : names[i].slice(0, 50);
    s = next;
  }
  return s;
}

async function build() {
  const res = await fetch(`${STORE_URL}/?_=${Date.now()}`, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (OrganicKashmirWhatsAppBot)' } });
  if (!res.ok) throw new Error(`homepage HTTP ${res.status}`);
  const items = parseNav(await res.text());
  if (!items || !items.length) throw new Error('menu not found on homepage');

  // Check stock for every link at once (keeps the bot quick)
  const built = await Promise.all(
    items.map(async (it) => {
      const ok = await Promise.all(it.children.map(inStock));
      const children = it.children.filter((_, i) => ok[i]);
      const key = slug(it.collection || it.product || it.title);
      if (!key) return null;
      if (children.length) return { key, title: it.title, description: describe(children), children };
      // no sub-menu (or nothing in it is in stock): use the category's own link
      if ((it.collection || it.product) && (await inStock(it))) {
        const entry = { key, title: it.title, description: '' };
        if (it.product) entry.product = it.product;
        else entry.collection = it.collection;
        const old = FALLBACK.find((f) => (f.collection && f.collection === it.collection) || f.title.toLowerCase() === it.title.toLowerCase());
        if (old) entry.description = old.description;
        return entry;
      }
      return null; // nothing to sell here right now
    })
  );
  // drop empty categories and any duplicate keys
  const seen = new Set();
  const menu = built.filter((e) => e && !seen.has(e.key) && seen.add(e.key));
  if (!menu.length) throw new Error('menu has nothing in stock');
  return menu;
}

async function get() {
  if (cache.menu && Date.now() - cache.at < CACHE_MS) return cache.menu;
  try {
    cache = { at: Date.now(), menu: await build() };
  } catch (e) {
    console.error('Live menu unavailable, using config.js menu:', e.message);
    cache = { at: Date.now(), menu: FALLBACK };
  }
  return cache.menu;
}

function clearCache() {
  cache = { at: 0, menu: null };
}

module.exports = { get, clearCache, parseNav, niceTitle, linkTarget, build };
