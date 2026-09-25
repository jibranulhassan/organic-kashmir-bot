# Organic Kashmir — WhatsApp Bot

When someone messages your WhatsApp number:

```
Welcome → [🛍️ Retail Customer]  [🏢 Corporate]

Corporate → "Please email us at info@organickashmir.com"

Retail → Category (Honey, Saffron | Spices, …)
       → Sub-category (e.g. Kashmiri Saffron)
       → Product (e.g. Kashmiri Saffron Mongra — From Rs. 495)
       → Size (1gm, 2gms, 5gms … with prices)
       → [Buy Now] button → opens that product on organickashmir.com with that size selected
```

* Products, prices and sizes are read **live from your Shopify store**, so when you add a product
  or change a price on the website, the bot updates on its own (within 10 minutes).
* Sold-out sizes and products are hidden automatically.
* Customers can type **menu** anytime to start over. Every list has a ⬅️ Back option.
* Links carry `utm_source=whatsapp`, so WhatsApp sales show up separately in Shopify Analytics.
* No packages to install — just Node.js 18 or newer.

---

## Test 1 — Try the menus on your computer (5 minutes, no WhatsApp needed)

1. Install Node.js (LTS) from https://nodejs.org
2. Open a terminal in this folder and run:
   ```
   npm run simulate
   ```
3. You'll see the bot's messages. Type the number of an option to "tap" it.
   At the end you'll get the real product link — paste it in your browser to check it.

---

## Test 2 — Real WhatsApp test with Meta's free test number

You do **not** need your official number for this. Meta gives you a free test number.

### A. Create the Meta app (one time)
1. Go to https://developers.facebook.com → **My Apps → Create App**.
2. Choose use case **"Connect with customers through WhatsApp"** (type: Business), and link your
   Meta Business account (Organic Kashmir).
3. In the app, open **WhatsApp → API Setup**. You'll see:
   * a **Test phone number** and its **Phone number ID** → copy the ID
   * a **Temporary access token** → copy it (it expires in 24 hours — fine for testing)
4. Under **"To"**, add **your own mobile number** and confirm the code WhatsApp sends you.
   (The test number can only chat with up to 5 numbers you add here.)

### B. Put the bot online
Meta must be able to reach the bot over the internet. Easiest free option is **Render**:

1. Put this folder in a GitHub repository (github.com → New repository → upload these files).
   ⚠️ Never upload your `.env` file — only `.env.example`.
2. Go to https://render.com → **New → Blueprint** → pick the repository. It reads `render.yaml`.
3. Fill in the environment variables it asks for:
   * `WHATSAPP_TOKEN` = the access token
   * `PHONE_NUMBER_ID` = the phone number ID
   * `VERIFY_TOKEN` = any word you make up, e.g. `organickashmir-verify-123`
   * `APP_SECRET` = (optional) App settings → Basic → App Secret
4. Deploy. Open the URL Render gives you (like `https://organic-kashmir-whatsapp-bot.onrender.com`)
   — it should say **"Organic Kashmir WhatsApp bot is running ✅"**.

> Render's free plan sleeps after 15 minutes of no traffic, so the first message after a quiet
> spell can take ~30–50 seconds to answer. For the live bot, use the $7/month plan (or Railway,
> a small VPS, etc.) so replies are instant.

*Alternative for developers:* run it on your own computer — copy `.env.example` to `.env`, fill it
in, run `npm start`, and expose it with `ngrok http 3000`.

### C. Connect the webhook
1. In the Meta app: **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL:** `https://YOUR-RENDER-URL/webhook`
3. **Verify token:** the same word you used for `VERIFY_TOKEN`. Click **Verify and save**.
4. Under **Webhook fields**, click **Subscribe** next to **messages**.

### D. Test it
From your phone, send **"hi"** to the Meta test number on WhatsApp. You should get the
Retail/Corporate buttons. Walk through to a product and tap **Buy Now**.

If nothing comes back: check the Render **Logs** tab. You should see `← 91xxxxxxxxxx: hi`.
* No log line → the webhook isn't connected or "messages" isn't subscribed (step C).
* Log line + "send failed (401)" → access token expired; paste a new one.
* "send failed (131030)" → your number isn't added in API Setup → "To".

---

## Going live on your official number

1. **Important:** a number that's active in the normal WhatsApp or WhatsApp Business *app* can't
   be used with the API at the same time. You either migrate it (you'll stop using the app on
   that number — chats then come through the API only) or use a new number for the bot.
   If your team replies to customers by hand on that number today, decide this first.
2. In **WhatsApp → API Setup → Add phone number**, add the official number, verify it by SMS/call,
   and complete **business verification** in Meta Business Settings if asked.
3. Create a **permanent token**: Business Settings → Users → **System users** → Add (Admin) →
   assign your app with *Full control* → **Generate token** with permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`.
4. In Render, replace `WHATSAPP_TOKEN` with the permanent token and `PHONE_NUMBER_ID` with the
   official number's ID. Redeploy.
5. Add a payment method in WhatsApp Manager. Replies to customers who message you first
   ("service conversations") are currently free; charges apply only to messages *you* start,
   such as marketing templates. Check Meta's current pricing page for India.

---

## Changing things

| What | Where |
|---|---|
| Corporate email | `CORPORATE_EMAIL` setting (on Render) |
| Categories / sub-categories | `src/config.js` — use the collection handle from the website URL, e.g. `/collections/kashmiri-saffron` → `kashmiri-saffron` |
| Welcome and other wording | `src/bot.js` (search for the text) |
| Products, prices, sizes | Just edit them on Shopify — nothing to change here |

WhatsApp limits to keep in mind: button labels 20 characters, list titles 24, max 10 rows per list
(the bot adds a ➡️ More row automatically for bigger collections).

## Files

* `src/server.js` — receives WhatsApp messages (webhook)
* `src/bot.js` — the conversation and menus
* `src/shopify.js` — reads products from organickashmir.com
* `src/whatsapp.js` — sends replies through the WhatsApp Cloud API
* `src/config.js` — category menu and settings
* `simulate.js` — terminal tester
