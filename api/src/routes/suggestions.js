import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { listOptimizationSuggestions, refreshOptimizationSuggestions } from '../services/optimizationSuggestions.js'

const router = Router()

router.get('/', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer', 'client']), async (req, res) => {
  const status = String(req.query.status || '').trim() || null
  const items = await listOptimizationSuggestions(req.org.id, status)
  res.json({ ok: true, items })
})

router.post('/run-scan', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const items = await refreshOptimizationSuggestions(req.org.id)
  res.json({ ok: true, count: items.length, items })
})

router.post('/:id/status', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const status = String(req.body.status || '').trim()
  if (!['open', 'dismissed', 'applied'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }
  const { data, error } = await supabase
    .from('optimization_suggestions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()
  if (error || !data) return res.status(404).json({ error: 'Suggestion not found' })
  res.json({ ok: true, item: data })
})

export default router
