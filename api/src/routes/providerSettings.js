import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { upsertProviderSetting, listProviderSettings } from '../services/providerSettings.js'
import { supabase } from '../db/supabase.js'
import { createNotification } from '../services/notifications.js'
import { recordActivity } from '../services/activityLog.js'

const router = Router()

router.get('/', requireAuth, attachOrg, async (req, res) => {
  const items = await listProviderSettings(req.org.id)
  res.json({ ok: true, items })
})

router.post('/', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const item = await upsertProviderSetting(req.org.id, req.userId, req.body)
  await recordActivity({
    org_id: req.org.id,
    brand_id: item.brand_id || null,
    entity_type: 'provider_credential',
    entity_id: item.id,
    action: 'provider.credential.saved',
    actor_type: 'user',
    actor_id: req.userId,
    summary: `${item.display_name} credentials saved`,
    metadata: { provider_key: item.provider_key, access_level: item.access_level },
  })
  res.status(201).json({ ok: true, item })
})

router.patch('/:id', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const updates = {}
  for (const key of ['display_name', 'config', 'secret_refs', 'status', 'category', 'brand_id', 'access_level', 'admin_only', 'last_rotated_at', 'last_used_at']) {
    if (key in req.body) updates[key] = req.body[key]
  }
  updates.updated_by = req.userId
  const { data, error } = await supabase
    .from('provider_credentials')
    .update(updates)
    .eq('org_id', req.org.id)
    .eq('id', req.params.id)
    .select()
    .single()
  if (error || !data) return res.status(404).json({ error: 'Provider setting not found' })
  res.json({ ok: true, item: data })
})

router.post('/:id/test', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const now = new Date().toISOString()
  const { data: existing, error: existingError } = await supabase
    .from('provider_credentials')
    .select('*')
    .eq('org_id', req.org.id)
    .eq('id', req.params.id)
    .single()
  if (existingError || !existing) return res.status(404).json({ error: 'Provider setting not found' })

  const secretRefs = existing.secret_refs || {}
  const hasPrimarySecret = Boolean(secretRefs.primary || secretRefs.secret || secretRefs.api_key)
  const success = hasPrimarySecret
  const message = success
    ? 'Secret reference is saved and ready for provider-specific use.'
    : 'No secret reference is saved yet. Add one before relying on this provider.'

  const { data, error } = await supabase
    .from('provider_credentials')
    .update({
      last_tested_at: now,
      last_test_status: success ? 'connected' : 'failed',
      last_test_message: message,
      status: success ? 'configured' : 'incomplete',
      updated_by: req.userId,
    })
    .eq('org_id', req.org.id)
    .eq('id', req.params.id)
    .select()
    .single()
  if (error || !data) return res.status(404).json({ error: 'Provider setting not found' })
  if (!success) {
    await createNotification({
      org_id: req.org.id,
      brand_id: data.brand_id || null,
      entity_type: 'provider_credential',
      entity_id: data.id,
      notification_type: 'provider_disconnected',
      title: `${data.display_name} needs attention`,
      body: message,
      severity: 'warning',
      metadata: { provider_key: data.provider_key },
    })
  }
  res.json({ ok: true, item: data })
})

export default router
