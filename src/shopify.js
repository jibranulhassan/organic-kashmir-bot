// Reads products straight from the public Shopify storefront JSON, with a short cache,
// so the WhatsApp menu always matches the website (new products, prices, stock).
const { STORE_URL } = require('./config');

// How long product data is kept before re-reading the website (default 2 minutes)
const CACHE_MS = Number(process.env.CACHE_MINUTES || 2) * 60 * 1000;
const cache = new Map();

async function getJson(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(STORE_URL + path + sep + '_=' + Date.now(), { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`Shopify ${path} -> HTTP ${res.status}`);
  const data = await res.json();
  cache.set(path, { at: Date.now(), data });
  return data;
}

// Products in a collection that have at least one variant in stock.
async function getCollectionProducts(handle) {
  const data = await getJson(`/collections/${encodeURIComponent(handle)}/products.json?limit=250`);
  return (data.products || [])
    .map(simplify)
    .filter((p) => p.variants.length > 0);
}

// One product by handle. Uses the storefront ".js" endpoint because it says which sizes are in stock.
async function getProduct(handle) {
  let data;
  try {
    data = await getJson(`/products/${encodeURIComponent(handle)}.js`);
  } catch (e) {
    if (/HTTP 404/.test(e.message)) return null; // product removed or hidden
    throw e;
  }
  return data && data.id ? simplifyJs(data) : null;
}

const https = (u) => (u ? (String(u).startsWith('//') ? 'https:' + u : String(u)) : null);

// Same shape as simplify(), from the ".js" format (prices in paise, image URLs as strings)
function simplifyJs(p) {
  const variants = (p.variants || [])
    .filter((v) => v.available !== false)
    .map((v) => ({
      id: String(v.id),
      title: v.title,
      price: Number(v.price) / 100,
      compareAt: Number(v.compare_at_price) / 100 || 0,
      image: v.featured_image && v.featured_image.src ? https(v.featured_image.src) : null,
    }));
  return {
    id: String(p.id),
    handle: p.handle,
    title: p.title,
    image: https(p.featured_image || (p.images && p.images[0])),
    variants,
  };
}

function simplify(p) {
  const variants = (p.variants || [])
    .filter((v) => v.available !== false) // products.json has "available"; product.json may not
    .map((v) => ({
      id: String(v.id),
      title: v.title,
      price: Number(v.price),
      compareAt: Number(v.compare_at_price) || 0, // original price, when on sale
      image: v.featured_image && v.featured_image.src ? v.featured_image.src : null,
    }));
  return {
    id: String(p.id),
    handle: p.handle,
    title: p.title,
    image: p.images && p.images[0] ? p.images[0].src : null,
    variants,
  };
}

// Shopify "cart permalink": opens checkout with these items already in the cart
// items: [{ variantId, quantity }]
function checkoutUrl(items) {
  const path = items.map((i) => `${i.variantId}:${Math.max(1, Number(i.quantity) || 1)}`).join(',');
  return `${STORE_URL}/cart/${path}?utm_source=whatsapp&utm_medium=bot`;
}

function productUrl(handle, variantId) {
  const q = new URLSearchParams({ utm_source: 'whatsapp', utm_medium: 'bot' });
  if (variantId) q.set('variant', variantId);
  return `${STORE_URL}/products/${handle}?${q.toString()}`;
}

function clearCache() {
  cache.clear();
}

module.exports = { getCollectionProducts, getProduct, productUrl, checkoutUrl, clearCache, _cache: cache };
