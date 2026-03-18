import { Router } from 'express'
import { db } from '../lib/db.js'
import { makeId } from '../lib/ids.js'

export const catalogRouter = Router()

function parseJsonField<T>(value: unknown, fallback: T): T {
  try {
    if (typeof value === 'string') return JSON.parse(value) as T
    if (value && typeof value === 'object') return value as T
  } catch {
    // ignore
  }
  return fallback
}

function normalizeLandingPage(row: any) {
  return {
    ...row,
    content_json: parseJsonField<Record<string, unknown>>(row.content_json, {}),
    benefits_json: parseJsonField<string[]>(row.benefits_json, []),
    includes_json: parseJsonField<string[]>(row.includes_json, []),
    faq_json: parseJsonField<Array<{ question: string; answer: string }>>(row.faq_json, []),
    proof_json: parseJsonField<string[]>(row.proof_json, []),
    theme_json: parseJsonField<Record<string, string>>(row.theme_json, {}),
  }
}

catalogRouter.get('/offers', (_req, res) => {
  const items = db.prepare(`
    SELECT id, name, checkout_url, stripe_product_id, stripe_price_id, landing_page_id, created_at
    FROM offers
    ORDER BY created_at DESC
  `).all()
  res.json({ ok: true, items })
})

catalogRouter.post('/offers', (req, res) => {
  const id = String(req.body.id || makeId('offer'))
  const name = String(req.body.name || '').trim()
  if (!name) {
    res.status(400).json({ ok: false, error: 'Offer name is required' })
    return
  }
  db.prepare(`
    INSERT INTO offers (id, name, checkout_url, stripe_product_id, stripe_price_id, landing_page_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    String(req.body.checkout_url || '').trim(),
    String(req.body.stripe_product_id || '').trim(),
    String(req.body.stripe_price_id || '').trim(),
    String(req.body.landing_page_id || '').trim(),
  )
  const item = db.prepare(`
    SELECT id, name, checkout_url, stripe_product_id, stripe_price_id, landing_page_id, created_at
    FROM offers
    WHERE id = ?
  `).get(id)
  res.json({ ok: true, item })
})

catalogRouter.get('/landing-pages', (_req, res) => {
  const items = db.prepare(`
    SELECT id, name, slug, url, template, content_json, hero_title, hero_subtitle, cta_text, cta_link,
           offer_summary, benefits_json, includes_json, faq_json, proof_json, theme_json, created_at
    FROM landing_pages
    ORDER BY created_at DESC
  `).all().map(normalizeLandingPage)
  res.json({ ok: true, items })
})

catalogRouter.post('/landing-pages', (req, res) => {
  const id = String(req.body.id || makeId('lp'))
  const name = String(req.body.name || '').trim()
  const slug = String(req.body.slug || '').trim()
  const url = String(req.body.url || '').trim()
  const template = String(req.body.template || 'offer').trim() || 'offer'
  const contentJson = JSON.stringify(req.body.content || {})
  const heroTitle = String(req.body.hero_title || '').trim()
  const heroSubtitle = String(req.body.hero_subtitle || '').trim()
  const ctaText = String(req.body.cta_text || '').trim()
  const ctaLink = String(req.body.cta_link || '').trim()
  const offerSummary = String(req.body.offer_summary || '').trim()
  const benefitsJson = JSON.stringify(Array.isArray(req.body.benefits) ? req.body.benefits : [])
  const includesJson = JSON.stringify(Array.isArray(req.body.includes) ? req.body.includes : [])
  const faqJson = JSON.stringify(Array.isArray(req.body.faq_items) ? req.body.faq_items : [])
  const proofJson = JSON.stringify(Array.isArray(req.body.proof_points) ? req.body.proof_points : [])
  const themeJson = JSON.stringify(req.body.theme || {})
  if (!name || !slug || !url) {
    res.status(400).json({ ok: false, error: 'Landing page name, slug, and URL are required' })
    return
  }
  db.prepare(`
    INSERT INTO landing_pages
    (id, name, slug, url, template, content_json, hero_title, hero_subtitle, cta_text, cta_link, offer_summary, benefits_json, includes_json, faq_json, proof_json, theme_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, slug, url, template, contentJson, heroTitle, heroSubtitle, ctaText, ctaLink, offerSummary, benefitsJson, includesJson, faqJson, proofJson, themeJson)
  const item = db.prepare(`
    SELECT id, name, slug, url, template, content_json, hero_title, hero_subtitle, cta_text, cta_link,
           offer_summary, benefits_json, includes_json, faq_json, proof_json, theme_json, created_at
    FROM landing_pages
    WHERE id = ?
  `).get(id)
  res.json({ ok: true, item: normalizeLandingPage(item) })
})

catalogRouter.patch('/landing-pages/:id', (req, res) => {
  const id = String(req.params.id || '').trim()
  if (!id) {
    res.status(400).json({ ok: false, error: 'Landing page id is required' })
    return
  }
  const existing = db.prepare(`
    SELECT id
    FROM landing_pages
    WHERE id = ?
  `).get(id)
  if (!existing) {
    res.status(404).json({ ok: false, error: 'Landing page not found' })
    return
  }

  const name = String(req.body.name || '').trim()
  const slug = String(req.body.slug || '').trim()
  const url = String(req.body.url || '').trim()
  const template = String(req.body.template || 'offer').trim() || 'offer'
  const contentJson = JSON.stringify(req.body.content || {})
  const heroTitle = String(req.body.hero_title || '').trim()
  const heroSubtitle = String(req.body.hero_subtitle || '').trim()
  const ctaText = String(req.body.cta_text || '').trim()
  const ctaLink = String(req.body.cta_link || '').trim()
  const offerSummary = String(req.body.offer_summary || '').trim()
  const benefitsJson = JSON.stringify(Array.isArray(req.body.benefits) ? req.body.benefits : [])
  const includesJson = JSON.stringify(Array.isArray(req.body.includes) ? req.body.includes : [])
  const faqJson = JSON.stringify(Array.isArray(req.body.faq_items) ? req.body.faq_items : [])
  const proofJson = JSON.stringify(Array.isArray(req.body.proof_points) ? req.body.proof_points : [])
  const themeJson = JSON.stringify(req.body.theme || {})

  if (!name || !slug || !url) {
    res.status(400).json({ ok: false, error: 'Landing page name, slug, and URL are required' })
    return
  }

  db.prepare(`
    UPDATE landing_pages
    SET name = ?, slug = ?, url = ?, template = ?, content_json = ?, hero_title = ?, hero_subtitle = ?,
        cta_text = ?, cta_link = ?, offer_summary = ?, benefits_json = ?, includes_json = ?, faq_json = ?,
        proof_json = ?, theme_json = ?
    WHERE id = ?
  `).run(
    name, slug, url, template, contentJson, heroTitle, heroSubtitle,
    ctaText, ctaLink, offerSummary, benefitsJson, includesJson, faqJson,
    proofJson, themeJson, id,
  )

  const item = db.prepare(`
    SELECT id, name, slug, url, template, content_json, hero_title, hero_subtitle, cta_text, cta_link,
           offer_summary, benefits_json, includes_json, faq_json, proof_json, theme_json, created_at
    FROM landing_pages
    WHERE id = ?
  `).get(id)
  res.json({ ok: true, item: normalizeLandingPage(item) })
})

catalogRouter.delete('/landing-pages/:id', (req, res) => {
  const id = String(req.params.id || '').trim()
  if (!id) {
    res.status(400).json({ ok: false, error: 'Landing page id is required' })
    return
  }

  const existing = db.prepare(`
    SELECT id
    FROM landing_pages
    WHERE id = ?
  `).get(id)
  if (!existing) {
    res.status(404).json({ ok: false, error: 'Landing page not found' })
    return
  }

  db.prepare(`DELETE FROM offers WHERE landing_page_id = ?`).run(id)
  db.prepare(`DELETE FROM landing_pages WHERE id = ?`).run(id)
  res.json({ ok: true })
})

catalogRouter.get('/stripe/products', (_req, res) => {
  const items = db.prepare(`
    SELECT id, name, description, active, created_at
    FROM stripe_products
    ORDER BY created_at DESC
  `).all()
  res.json({ ok: true, items })
})

catalogRouter.get('/stripe/prices', (_req, res) => {
  const items = db.prepare(`
    SELECT id, product_id, unit_amount, currency, recurring_interval, active, created_at
    FROM stripe_prices
    ORDER BY created_at DESC
  `).all()
  res.json({ ok: true, items })
})
