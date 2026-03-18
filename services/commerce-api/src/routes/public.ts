import { Router } from 'express'
import crypto from 'node:crypto'
import { db } from '../lib/db.js'
import { config } from '../config.js'

export const publicRouter = Router()

function text(value: unknown) {
  return String(value || '').trim()
}

function esc(value: unknown) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value || '')) as T
  } catch {
    return fallback
  }
}

function pageRecord(slug: string) {
  return db.prepare(`
    SELECT lp.id, lp.name, lp.slug, lp.url, lp.template, lp.hero_title, lp.hero_subtitle, lp.cta_text, lp.cta_link,
           lp.content_json, lp.offer_summary, lp.benefits_json, lp.includes_json, lp.faq_json, lp.proof_json, lp.theme_json, lp.created_at,
           o.id AS offer_id, o.name AS offer_name, o.checkout_url, o.stripe_price_id, o.stripe_product_id
    FROM landing_pages lp
    LEFT JOIN offers o ON o.landing_page_id = lp.id
    WHERE lp.slug = ?
  `).get(slug) as any
}

function normalizePage(row: any) {
  return {
    id: text(row.id),
    name: text(row.name),
    slug: text(row.slug),
    url: text(row.url),
    template: text(row.template || 'offer'),
    content: parseJson<Record<string, unknown>>(row.content_json, {}),
    hero_title: text(row.hero_title || row.name),
    hero_subtitle: text(row.hero_subtitle || 'A focused offer page generated inside Autonomous Prime.'),
    cta_text: text(row.cta_text || 'Get Started'),
    cta_link: text(row.cta_link || row.url),
    offer_summary: text(row.offer_summary || row.offer_name || ''),
    benefits: parseJson<string[]>(row.benefits_json, []),
    includes: parseJson<string[]>(row.includes_json, []),
    faq_items: parseJson<Array<{ question: string; answer: string }>>(row.faq_json, []),
    proof_points: parseJson<string[]>(row.proof_json, []),
    theme: parseJson<Record<string, string>>(row.theme_json, {}),
    offer: {
      id: text(row.offer_id),
      name: text(row.offer_name),
      checkout_url: text(row.checkout_url),
      stripe_price_id: text(row.stripe_price_id),
      stripe_product_id: text(row.stripe_product_id),
    },
  }
}

publicRouter.get('/api/public/landing/:slug', (req, res) => {
  const row = pageRecord(req.params.slug)
  if (!row) {
    res.status(404).json({ ok: false, error: 'Landing page not found' })
    return
  }
  db.prepare(`
    INSERT INTO attribution_events
    (id, post_id, platform, cta_id, landing_page_id, offer_id, event_type, revenue_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    '',
    '',
    '',
    text(row.id),
    text(row.offer_id),
    'page_view',
    0,
  )
  res.json({ ok: true, item: normalizePage(row) })
})

publicRouter.post('/api/public/landing/:slug/checkout', async (req, res) => {
  const row = pageRecord(req.params.slug)
  if (!row) {
    res.status(404).json({ ok: false, error: 'Landing page not found' })
    return
  }
  if (text(row.checkout_url)) {
    res.json({ ok: true, url: text(row.checkout_url) })
    return
  }
  if (!text(row.stripe_price_id)) {
    res.status(400).json({ ok: false, error: 'No Stripe price is linked to this landing page offer yet.' })
    return
  }
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/stripe/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price_id: row.stripe_price_id,
        mode: 'payment',
        post_id: text(req.body.post_id),
        platform: text(req.body.platform),
        cta_id: text(req.body.cta_id),
        landing_page_id: text(row.id),
        offer_id: text(req.body.offer_id || row.offer_id),
        success_url: text(req.body.success_url),
        cancel_url: text(req.body.cancel_url),
      }),
    })
    const data = await response.json()
    res.status(response.status).json(data)
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Checkout failed' })
  }
})
