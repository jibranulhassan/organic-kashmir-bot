// Menu structure — mirrors the navigation menu on organickashmir.com.
// Each "collection" value is the Shopify collection handle (the part after /collections/ in the URL).
// To add/rename a category, edit this list. Products and variants are read live from the website.
// WhatsApp limits: titles max 24 characters, descriptions max 72, max 10 rows per list.

module.exports = {
  STORE_URL: (process.env.STORE_URL || 'https://www.organickashmir.com').replace(/\/$/, ''),
  CORPORATE_EMAIL: process.env.CORPORATE_EMAIL || 'info@organickashmir.com',
  BRAND: 'Organic Kashmir',

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
        { title: 'Natural & Essential Oils', collection: 'natural-essential-oils' },
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
