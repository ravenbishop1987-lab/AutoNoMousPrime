import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { SYSTEM_TEMPLATES } from '../lib/systemTemplates.js'

const router = Router()

router.get('/', requireAuth, attachOrg, async (req, res) => {
  const kind = String(req.query.template_kind || '').trim()
  const visibility = String(req.query.visibility || '').trim()
  let query = supabase
    .from('content_templates')
    .select('*')
    .eq('org_id', req.org.id)
    .order('updated_at', { ascending: false })

  if (kind) query = query.eq('template_kind', kind)
  if (visibility) query = query.eq('visibility', visibility)

  const { data, error } = await query
  if (error) throw error

  const systemItems = SYSTEM_TEMPLATES.filter(item => (!kind || item.template_kind === kind))
  res.json({ ok: true, items: [...systemItems, ...(data || [])] })
})

router.get('/library', requireAuth, attachOrg, async (req, res) => {
  const kind = String(req.query.template_kind || '').trim()
  const items = SYSTEM_TEMPLATES.filter(item => (!kind || item.template_kind === kind))
  res.json({ ok: true, items })
})

router.post('/', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const payload = {
    org_id: req.org.id,
    brand_id: req.body.brand_id || null,
    template_kind: req.body.template_kind,
    scope: req.body.scope || 'workspace',
    visibility: req.body.visibility || 'workspace',
    name: req.body.name,
    description: req.body.description || null,
    body_template: req.body.body_template || '',
    config: req.body.config || {},
    tags: Array.isArray(req.body.tags) ? req.body.tags : [],
    is_active: req.body.is_active !== false,
    created_by: req.userId,
  }

  if (!payload.template_kind || !payload.name) {
    return res.status(400).json({ error: 'template_kind and name are required' })
  }

  const { data, error } = await supabase.from('content_templates').insert(payload).select().single()
  if (error) throw error
  res.status(201).json({ ok: true, item: data })
})

router.patch('/:id', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const allowed = ['brand_id', 'name', 'description', 'body_template', 'config', 'tags', 'visibility', 'scope', 'is_active']
  const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)))
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('content_templates')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()

  if (error || !data) return res.status(404).json({ error: 'Template not found' })
  res.json({ ok: true, item: data })
})

router.post('/:id/duplicate', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const systemTemplate = SYSTEM_TEMPLATES.find(item => item.id === req.params.id)
  let source = systemTemplate
  if (!source) {
    const { data, error } = await supabase
      .from('content_templates')
      .select('*')
      .eq('id', req.params.id)
      .eq('org_id', req.org.id)
      .maybeSingle()
    if (error) throw error
    source = data
  }

  if (!source) return res.status(404).json({ error: 'Template not found' })

  const payload = {
    org_id: req.org.id,
    brand_id: req.body.brand_id || null,
    template_kind: source.template_kind,
    scope: 'workspace',
    visibility: 'workspace',
    name: `${source.name} Copy`,
    description: source.description || null,
    body_template: source.body_template || '',
    config: source.config || {},
    tags: source.tags || [],
    is_active: true,
    created_by: req.userId,
  }
  const { data, error } = await supabase.from('content_templates').insert(payload).select().single()
  if (error) throw error
  res.status(201).json({ ok: true, item: data })
})

export default router
