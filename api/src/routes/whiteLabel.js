import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'

const router = Router()

router.get('/', requireAuth, attachOrg, requireRole(['owner', 'admin', 'client']), async (req, res) => {
  const { data, error } = await supabase
    .from('workspace_branding')
    .select('*')
    .eq('workspace_id', req.org.id)
    .maybeSingle()
  if (error) throw error
  res.json({ ok: true, item: data || null })
})

router.post('/', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const payload = {
    workspace_id: req.org.id,
    brand_name: req.body.brand_name || null,
    app_label: req.body.app_label || null,
    logo_url: req.body.logo_url || null,
    favicon_url: req.body.favicon_url || null,
    marketing_site_url: req.body.marketing_site_url || null,
    custom_domain: req.body.custom_domain || null,
    domain_status: req.body.domain_status || 'draft',
    primary_color: req.body.primary_color || null,
    accent_color: req.body.accent_color || null,
    theme: req.body.theme || {},
    css_variables: req.body.css_variables || {},
    custom_css: req.body.custom_css || null,
    support_email: req.body.support_email || null,
    created_by: req.userId,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('workspace_branding')
    .upsert(payload, { onConflict: 'workspace_id' })
    .select()
    .single()
  if (error) throw error
  res.json({ ok: true, item: data })
})

export default router
