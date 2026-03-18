import { Router } from 'express'
import { db } from '../lib/db.js'
import { previewCta } from '../lib/cta.js'
import { makeId } from '../lib/ids.js'

export const ctasRouter = Router()

ctasRouter.post('/preview', (req, res) => {
  const preview = previewCta(req.body)
  res.json({
    ok: true,
    platform: req.body.platform,
    preview,
  })
})

ctasRouter.post('/', (req, res) => {
  const id = String(req.body.id || makeId('cta'))
  const preview = previewCta(req.body)
  const trackingSlug = String(req.body.tracking_slug || `${req.body.platform || 'cta'}-${id}`).trim()
  const variantLabel = String(req.body.variant_label || req.body.variant_name || preview?.primary || req.body.cta_text || '').trim()
  db.prepare(`
    INSERT INTO post_ctas
    (id, post_id, platform, cta_text, cta_link, cta_type, variant_json, landing_page_id, offer_id, tracking_slug, variant_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.body.post_id || '',
    req.body.platform,
    req.body.cta_text,
    req.body.cta_link,
    req.body.cta_type,
    JSON.stringify(preview),
    req.body.landing_page_id || '',
    req.body.offer_id || '',
    trackingSlug,
    variantLabel,
  )
  res.json({ ok: true, id, tracking_slug: trackingSlug, variant_label: variantLabel, preview })
})

ctasRouter.get('/', (_req, res) => {
  const items = db.prepare(`
    SELECT id, post_id, platform, cta_text, cta_link, cta_type, variant_json,
           landing_page_id, offer_id, tracking_slug, variant_label, created_at
    FROM post_ctas
    ORDER BY created_at DESC
    LIMIT 100
  `).all().map((row: any) => ({
    ...row,
    variant_json: (() => {
      try {
        return JSON.parse(String(row.variant_json || '{}'))
      } catch {
        return {}
      }
    })(),
  }))
  res.json({ ok: true, items })
})
