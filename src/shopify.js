// Reads products straight from the public Shopify storefront JSON, with a short cache,
// so the WhatsApp menu always matches the website (new products, prices, stock).
const { STORE_URL } = require('./config');

const CACHE_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map();

async function getJson(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const res = await fetch(STORE_URL + path, { headers: { Accept: 'application/json' } });
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

async function getProduct(handle) {
  const data = await getJson(`/products/${encodeURIComponent(handle)}.json`);
  return data.product ? simplify(data.product) : null;
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

module.exports = { getCollectionProducts, getProduct, productUrl, checkoutUrl, _cache: cache };
