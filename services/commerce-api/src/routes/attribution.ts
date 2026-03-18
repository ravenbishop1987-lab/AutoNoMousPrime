import { Router } from 'express'
import crypto from 'node:crypto'
import { db } from '../lib/db.js'

export const attributionRouter = Router()

attributionRouter.post('/click', (req, res) => {
  const metadataJson = JSON.stringify(req.body.metadata || {})
  db.prepare(`
    INSERT INTO attribution_events
    (id, post_id, platform, cta_id, landing_page_id, offer_id, event_type, revenue_cents, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    String(req.body.post_id || '').trim(),
    String(req.body.platform || '').trim(),
    String(req.body.cta_id || '').trim(),
    String(req.body.landing_page_id || '').trim(),
    String(req.body.offer_id || '').trim(),
    'click',
    0,
    metadataJson,
  )
  res.json({ ok: true })
})

attributionRouter.post('/page-view', (req, res) => {
  const metadataJson = JSON.stringify(req.body.metadata || {})
  db.prepare(`
    INSERT INTO attribution_events
    (id, post_id, platform, cta_id, landing_page_id, offer_id, event_type, revenue_cents, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    String(req.body.post_id || '').trim(),
    String(req.body.platform || '').trim(),
    '',
    String(req.body.landing_page_id || '').trim(),
    String(req.body.offer_id || '').trim(),
    'page_view',
    0,
    metadataJson,
  )
  res.json({ ok: true })
})

attributionRouter.get('/events', (_req, res) => {
  const items = db.prepare(`
    SELECT id, post_id, platform, cta_id, landing_page_id, offer_id, event_type,
           stripe_session_id, stripe_customer_id, revenue_cents, metadata_json, created_at
    FROM attribution_events
    ORDER BY created_at DESC
    LIMIT 100
  `).all()
  res.json({ ok: true, items })
})

attributionRouter.get('/summary', (_req, res) => {
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
      SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS cta_clicks,
      SUM(CASE WHEN event_type = 'checkout_started' THEN 1 ELSE 0 END) AS checkout_started,
      SUM(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS purchases
    FROM attribution_events
  `).get() as {
    page_views: number | null
    cta_clicks: number | null
    checkout_started: number | null
    purchases: number | null
  }

  const pages = db.prepare(`
    SELECT
      lp.id,
      lp.name,
      lp.slug,
      SUM(CASE WHEN ae.event_type = 'page_view' THEN 1 ELSE 0 END) AS visits,
      SUM(CASE WHEN ae.event_type = 'click' THEN 1 ELSE 0 END) AS clicks,
      SUM(CASE WHEN ae.event_type = 'checkout_started' THEN 1 ELSE 0 END) AS checkout_started,
      SUM(CASE WHEN ae.event_type = 'purchase' THEN 1 ELSE 0 END) AS purchases,
      COALESCE(SUM(CASE WHEN ae.event_type = 'purchase' THEN ae.revenue_cents ELSE 0 END), 0) AS revenue_cents
    FROM landing_pages lp
    LEFT JOIN attribution_events ae ON ae.landing_page_id = lp.id
    GROUP BY lp.id, lp.name, lp.slug
    ORDER BY visits DESC, clicks DESC, revenue_cents DESC
    LIMIT 10
  `).all()

  res.json({
    ok: true,
    totals: {
      page_views: Number(totals.page_views || 0),
      cta_clicks: Number(totals.cta_clicks || 0),
      checkout_started: Number(totals.checkout_started || 0),
      purchases: Number(totals.purchases || 0),
    },
    pages,
  })
})
