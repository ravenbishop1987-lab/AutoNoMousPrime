/**
 * Brands routes
 *
 * POST /saas/brands      — create brand (plan-guarded)
 * GET  /saas/brands      — list org brands
 * GET  /saas/brands/:id  — get single brand
 * PATCH /saas/brands/:id — update brand
 */

import { Router } from 'express'
import { requireAuth, attachOrg, requireRole } from '../middleware/auth.js'
import { guardBrandLimit, guardConnectedSiteLimit } from '../middleware/planGuard.js'
import { supabase } from '../db/supabase.js'

const router = Router()

// POST /saas/brands
router.post('/', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), guardBrandLimit, async (req, res) => {
  const { name, niche, tone = 'professional', cta_default_url, wp_url, wp_user, wp_app_password, target_keywords } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  if (String(wp_url || '').trim()) {
    let limitBlocked = false
    await guardConnectedSiteLimit(req, {
      status(code) {
        limitBlocked = true
        return {
          json(payload) {
            res.status(code).json(payload)
          },
        }
      },
    }, () => {})
    if (limitBlocked) return
  }

  const { data: brand, error } = await supabase
    .from('brands')
    .insert({ org_id: req.org.id, name, niche, tone, cta_default_url, wp_url, wp_user, wp_app_password, target_keywords })
    .select()
    .single()

  if (error) throw error
  res.status(201).json({ ok: true, brand })
})

// GET /saas/brands
router.get('/', requireAuth, attachOrg, async (req, res) => {
  const { data: brands, error } = await supabase
    .from('brands')
    .select('id, name, niche, tone, cta_default_url, wp_url, target_keywords, created_at')
    .eq('org_id', req.org.id)
    .order('created_at')

  if (error) throw error
  res.json({ ok: true, brands })
})

// GET /saas/brands/:id
router.get('/:id', requireAuth, attachOrg, async (req, res) => {
  const { data: brand, error } = await supabase
    .from('brands')
    .select('*')
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .single()

  if (error || !brand) return res.status(404).json({ error: 'Brand not found' })
  res.json({ ok: true, brand })
})

// PATCH /saas/brands/:id
router.patch('/:id', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const allowed = ['name', 'niche', 'tone', 'cta_default_url', 'wp_url', 'wp_user', 'wp_app_password', 'target_keywords', 'voice_style']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))

  const { data: brand, error } = await supabase
    .from('brands')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()

  if (error || !brand) return res.status(404).json({ error: 'Brand not found' })
  res.json({ ok: true, brand })
})

export default router
