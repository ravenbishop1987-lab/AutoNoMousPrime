import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../config.js'

mkdirSync(dirname(config.dbPath), { recursive: true })
export const db = new DatabaseSync(config.dbPath)

db.exec(`
CREATE TABLE IF NOT EXISTS stripe_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  raw_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stripe_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  unit_amount INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'usd',
  recurring_interval TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  raw_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checkout_url TEXT,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  landing_page_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS landing_pages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  url TEXT NOT NULL,
  template TEXT DEFAULT 'offer',
  content_json TEXT DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS post_ctas (
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attribution_events (
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS revenue_events (
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription_events (
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`)

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

ensureColumn('landing_pages', 'hero_title', "TEXT DEFAULT ''")
ensureColumn('landing_pages', 'hero_subtitle', "TEXT DEFAULT ''")
ensureColumn('landing_pages', 'cta_text', "TEXT DEFAULT ''")
ensureColumn('landing_pages', 'cta_link', "TEXT DEFAULT ''")
ensureColumn('landing_pages', 'offer_summary', "TEXT DEFAULT ''")
ensureColumn('landing_pages', 'template', "TEXT DEFAULT 'offer'")
ensureColumn('landing_pages', 'content_json', "TEXT DEFAULT '{}'")
ensureColumn('landing_pages', 'benefits_json', "TEXT DEFAULT '[]'")
ensureColumn('landing_pages', 'includes_json', "TEXT DEFAULT '[]'")
ensureColumn('landing_pages', 'faq_json', "TEXT DEFAULT '[]'")
ensureColumn('landing_pages', 'proof_json', "TEXT DEFAULT '[]'")
ensureColumn('landing_pages', 'theme_json', "TEXT DEFAULT '{}'")
ensureColumn('post_ctas', 'tracking_slug', "TEXT DEFAULT ''")
ensureColumn('post_ctas', 'variant_label', "TEXT DEFAULT ''")
ensureColumn('offers', 'checkout_url', "TEXT DEFAULT ''")
ensureColumn('attribution_events', 'metadata_json', "TEXT DEFAULT '{}'")
ensureColumn('revenue_events', 'description', "TEXT DEFAULT ''")
ensureColumn('revenue_events', 'stripe_customer_id', "TEXT DEFAULT ''")
ensureColumn('revenue_events', 'stripe_subscription_id', "TEXT DEFAULT ''")
ensureColumn('revenue_events', 'metadata_json', "TEXT DEFAULT '{}'")
