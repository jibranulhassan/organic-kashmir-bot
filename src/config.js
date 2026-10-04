// Menu structure — mirrors the navigation menu on organickashmir.com.
// Each "collection" value is the Shopify collection handle (the part after /collections/ in the URL).
// To add/rename a category, edit this list. Products and variants are read live from the website.
// WhatsApp limits: titles max 24 characters, descriptions max 72, max 10 rows per list.

module.exports = {
  STORE_URL: (process.env.STORE_URL || 'https://www.organickashmir.com').replace(/\/$/, ''),
  CORPORATE_EMAIL: process.env.CORPORATE_EMAIL || 'info@organickashmir.com',
  BRAND: 'Organic Kashmir',
  TAGLINE: 'Pure, hand-picked produce from the valleys of Kashmir — saffron, Himalayan honey, forest herbs and more.',
  // Shown under the welcome message and on product cards. Leave '' to hide.
  DELIVERY_NOTE: process.env.DELIVERY_NOTE !== undefined ? process.env.DELIVERY_NOTE : 'Free delivery on orders above Rs. 995',
  // Banner on the welcome message (must be a public JPG/PNG link). Leave '' for no image.
  WELCOME_IMAGE:
    process.env.WELCOME_IMAGE !== undefined
      ? process.env.WELCOME_IMAGE
      : 'https://cdn.shopify.com/s/files/1/1338/5795/files/KASHMIR_SAFFRON_ORGANIC_KASHMIR.jpg?v=1750491019',

  // Team availability (India time). Example: BUSINESS_HOURS=10:00-19:00  BUSINESS_DAYS=Mon-Sat
  // If not set, the bot never mentions working hours.
  BUSINESS_HOURS: process.env.BUSINESS_HOURS || '',
  BUSINESS_DAYS: process.env.BUSINESS_DAYS || 'Mon-Sat',

  MENU: [
    {
      key: 'bandhan',
      title: 'Bandhan Gift Hampers',
      description: 'Festive gift sets & hampers',
      collection: 'bandhan',
    },
    {
      key: 'honey',
      title: 'Himalayan Honey',
      description: 'Raw, white & flavoured honey',
      children: [
        { title: 'Raw | Himalayan White', collection: 'raw-himalayan-honey' },
        { title: 'Flavoured Honey', collection: 'flavoured-honey-1' },
      ],
    },
    {
      key: 'saffron',
      title: 'Saffron | Spices',
      description: 'Kashmiri saffron & handcrafted spices',
      children: [
        { title: 'Kashmiri Saffron', collection: 'kashmiri-saffron' },
        { title: 'Handcrafted Spices', collection: 'handcrafted-spices' },
      ],
    },
    {
      key: 'herbs',
      title: 'Forest Herbs | Teas',
      description: 'Shilajit, morels, kehwa & herbal teas',
      children: [
        { title: 'Forest Herbs', collection: 'forest-herbs-1' },
        { title: 'Herbal Teas', collection: 'herbal-teas' },
      ],
    },
    {
      key: 'beauty',
      title: 'Beauty | Wellness',
      description: 'Wellness, oils & rose water',
      children: [
        { title: 'Wellness', collection: 'wellness-1' },
        { title: 'Essential Oils', collection: 'natural-essential-oils' },
        { title: 'Rose Water', collection: 'rose-water-2' },
      ],
    },
    {
      key: 'dryfruits',
      title: 'Dry Fruits | Grains',
      description: 'Walnuts, almonds & Kashmiri grains',
      children: [
        { title: 'Dry Fruits', collection: 'dry-fruits' },
        { title: 'Grains', collection: 'grains-1' },
      ],
    },
  ],
};
