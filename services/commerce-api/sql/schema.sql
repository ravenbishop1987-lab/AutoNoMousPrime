CREATE TABLE stripe_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  raw_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stripe_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  unit_amount INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'usd',
  recurring_interval TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  raw_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  landing_page_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE landing_pages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  url TEXT NOT NULL,
  template TEXT DEFAULT 'offer',
  hero_title TEXT DEFAULT '',
  hero_subtitle TEXT DEFAULT '',
  cta_text TEXT DEFAULT '',
  cta_link TEXT DEFAULT '',
  offer_summary TEXT DEFAULT '',
  benefits_json TEXT DEFAULT '[]',
  includes_json TEXT DEFAULT '[]',
  faq_json TEXT DEFAULT '[]',
  proof_json TEXT DEFAULT '[]',
  theme_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE post_ctas (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  platform TEXT NOT NULL,
  cta_text TEXT NOT NULL,
  cta_link TEXT NOT NULL,
  cta_type TEXT NOT NULL,
  variant_json TEXT NOT NULL,
  landing_page_id TEXT,
  offer_id TEXT,
  tracking_slug TEXT DEFAULT '',
  variant_label TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE attribution_events (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  platform TEXT,
  cta_id TEXT,
  landing_page_id TEXT,
  offer_id TEXT,
  event_type TEXT NOT NULL,
  stripe_session_id TEXT,
  stripe_customer_id TEXT,
  revenue_cents INTEGER DEFAULT 0,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE revenue_events (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT UNIQUE,
  post_id TEXT,
  platform TEXT,
  cta_id TEXT,
  landing_page_id TEXT,
  offer_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  kind TEXT NOT NULL,
  description TEXT DEFAULT '',
  stripe_customer_id TEXT DEFAULT '',
  stripe_subscription_id TEXT DEFAULT '',
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscription_events (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  offer_id TEXT,
  landing_page_id TEXT,
  status TEXT NOT NULL,
  billing_status TEXT DEFAULT '',
  failed_payment INTEGER DEFAULT 0,
  metadata_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
