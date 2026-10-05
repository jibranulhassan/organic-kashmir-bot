// Product feed for Meta Commerce Manager (WhatsApp Catalog), built live from organickashmir.com.
//   https://YOUR-BOT.onrender.com/catalog.csv
// In Commerce Manager: Catalog → Data sources → Data feed → Scheduled feed → paste this URL (daily).
// One row per size (variant). Item IDs look like "ok_<variant id>", matching CATALOG_ITEM_ID.
const { STORE_URL, BRAND, CATALOG_ITEM_ID } = require('./config');
const shop = require('./shopify');

let cache = { at: 0, csv: '' };

async function allProducts() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${STORE_URL}/products.json?limit=250&page=${page}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`products.json page ${page} -> HTTP ${res.status}`);
    const data = await res.json();
    const items = data.products || [];
    out.push(...items);
    if (items.length < 250) break;
  }
  return out;
}

const plain = (html) =>
  String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

async function buildCsv() {
  if (Date.now() - cache.at < 30 * 60 * 1000 && cache.csv) return cache.csv;
  const cols = ['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link', 'image_link', 'brand', 'item_group_id', 'size'];
  const rows = [cols.join(',')];
  for (const p of await allProducts()) {
    const images = p.images || [];
    const desc = plain(p.body_html).slice(0, 4900) || p.title;
    for (const v of p.variants || []) {
      const sized = v.title && v.title !== 'Default Title';
      const img = (v.featured_image && v.featured_image.src) || (images[0] && images[0].src);
      if (!img) continue; // Meta requires an image
      const price = Number(v.price);
      const compare = Number(v.compare_at_price) || 0;
      const id = CATALOG_ITEM_ID.replace('{product_id}', p.id).replace('{variant_id}', v.id);
      rows.push(
        [
          id,
          (sized ? `${p.title} - ${v.title}` : p.title).slice(0, 150),
          desc,
          v.available === false ? 'out of stock' : 'in stock',
          'new',
          // show the original price with the sale price when the item is discounted
          `${(compare > price ? compare : price).toFixed(2)} INR`,
          compare > price ? `${price.toFixed(2)} INR` : '',
          shop.productUrl(p.handle, v.id),
          img,
          BRAND,
          p.id,
          sized ? v.title : '',
        ]
          .map(csvCell)
          .join(',')
      );
    }
  }
  cache = { at: Date.now(), csv: rows.join('\n') + '\n' };
  return cache.csv;
}

// Returns true if it handled the request
function handle(req, res, url) {
  if (url.pathname !== '/catalog.csv') return false;
  buildCsv()
    .then((csv) => {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(csv);
    })
    .catch((e) => {
      console.error('Feed error:', e.message);
      res.writeHead(500);
      res.end('feed error');
    });
  return true;
}

function clearCache() {
  cache = { at: 0, csv: '' };
}

module.exports = { handle, buildCsv, clearCache };
