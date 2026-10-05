// Live category menu, read from the navigation menu on organickashmir.com.
// Add, remove, rename or reorder collections in Shopify's menu (Online Store → Navigation)
// and the bot follows automatically. Collections with nothing in stock are hidden.
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
    const href = m[1] || '';
    const col = (href.match(/^\/collections\/([^/?#]+)/) || [])[1];
    const title = niceTitle(m[2]);
    if (!title) continue;
    if (inSub) {
      const parent = items[items.length - 1];
      if (parent && col) parent.children.push({ title, collection: col });
    } else {
      items.push({ title, collection: col || null, children: [] });
    }
  }
  return items;
}

async function inStock(collection) {
  try {
    return (await shop.getCollectionProducts(collection)).length > 0;
  } catch (_) {
    return false;
  }
}

async function build() {
  const res = await fetch(`${STORE_URL}/?_=${Date.now()}`, { headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`homepage HTTP ${res.status}`);
  const items = parseNav(await res.text());
  if (!items || !items.length) throw new Error('menu not found on homepage');

  const menu = [];
  for (const it of items) {
    // keep only collections that currently have products in stock
    const children = [];
    for (const ch of it.children) if (await inStock(ch.collection)) children.push(ch);
    const old = FALLBACK.find((f) => f.collection === it.collection || f.title.toLowerCase() === it.title.toLowerCase());
    const entry = { key: it.collection || it.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: it.title, description: old ? old.description : '' };
    if (children.length) entry.children = children;
    else if (it.collection && (await inStock(it.collection))) entry.collection = it.collection;
    else continue; // nothing to sell here right now
    menu.push(entry);
  }
  if (!menu.length) throw new Error('menu has no collections in stock');
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

module.exports = { get, clearCache, parseNav, niceTitle };
