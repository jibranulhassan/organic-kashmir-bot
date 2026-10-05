// Private Shopify data (customers & orders) through the Shopify Admin API.
//
// Settings (Render → Environment):
//   ORDERS_ENABLED         set to true to show the "My Orders" option (off by default)
//   SHOPIFY_STORE          your store's myshopify domain, e.g. organic-kashmir.myshopify.com
//   SHOPIFY_CLIENT_ID      from your app in the Shopify Dev Dashboard
//   SHOPIFY_CLIENT_SECRET  from your app in the Shopify Dev Dashboard
//   (or SHOPIFY_ADMIN_TOKEN — only if you already have an older custom app with a shpat_ token)
//
// Dev Dashboard tokens expire every 24 hours; this file fetches a new one automatically.
// App scopes needed: read_customers, read_orders

const STORE = (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

// My Orders is switched OFF unless ORDERS_ENABLED=true is set in Render
const enabled = () => process.env.ORDERS_ENABLED === 'true' && !!(STORE && (process.env.SHOPIFY_ADMIN_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)));

let tokenCache = { token: null, until: 0 };
async function token() {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  if (tokenCache.token && Date.now() < tokenCache.until) return tokenCache.token;
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error('Shopify token error: ' + JSON.stringify(data));
  const life = (Number(data.expires_in) || 86400) * 1000;
  tokenCache = { token: data.access_token, until: Date.now() + life - 10 * 60 * 1000 }; // renew 10 min early
  return tokenCache.token;
}

async function gql(query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/${VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await token() },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors) throw new Error('Shopify API error: ' + JSON.stringify(data.errors || data));
  return data.data;
}

// Phone formats stores commonly hold for an Indian number
function phoneVariants(waNumber) {
  const d = String(waNumber).replace(/\D/g, '');
  const out = new Set(['+' + d, d]);
  if (d.startsWith('91') && d.length === 12) out.add(d.slice(2)).add('0' + d.slice(2));
  return [...out];
}

const ORDER_FIELDS = `
  name createdAt displayFinancialStatus displayFulfillmentStatus cancelledAt statusPageUrl
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 10) { nodes { title quantity } }
  fulfillments(first: 5) { status displayStatus trackingInfo(first: 1) { company number url } }
`;

// Customer + recent orders for the WhatsApp number the message came from (or null)
async function customerByWhatsApp(waNumber) {
  for (const phone of phoneVariants(waNumber)) {
    const data = await gql(
      `query($q: String!) { customers(first: 1, query: $q) { nodes {
         id firstName lastName email numberOfOrders
         orders(first: 3, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER_FIELDS} } }
       } } }`,
      { q: `phone:${JSON.stringify(phone)}` }
    );
    const c = data.customers.nodes[0];
    if (c) return c;
  }
  return null;
}

module.exports = { enabled, customerByWhatsApp };
