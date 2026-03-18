import { supabase } from '../db/supabase.js'

const DEFAULT_MINUTES = 15

export async function getEntityLock(orgId, entityType, entityId) {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('entity_locks')
    .select('*')
    .eq('org_id', orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .gte('expires_at', now)
    .maybeSingle()
  if (error) throw error
  return data || null
}

export async function acquireEntityLock(orgId, entityType, entityId, userId, lockReason = null, ttlMinutes = DEFAULT_MINUTES, metadata = {}) {
  const existing = await getEntityLock(orgId, entityType, entityId)
  if (existing && existing.locked_by !== userId) {
    const error = new Error('This item is currently being edited by another user.')
    error.status = 409
    throw error
  }

  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()
  const payload = {
    org_id: orgId,
    entity_type: entityType,
    entity_id: entityId,
    locked_by: userId,
    lock_reason: lockReason,
    expires_at: expiresAt,
    metadata,
  }

  const builder = existing
    ? supabase.from('entity_locks').update(payload).eq('id', existing.id).eq('org_id', orgId)
    : supabase.from('entity_locks').insert(payload)
  const { data, error } = await builder.select().single()
  if (error) throw error
  return data
}

export async function releaseEntityLock(orgId, entityType, entityId, userId) {
  const { error } = await supabase
    .from('entity_locks')
    .delete()
    .eq('org_id', orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('locked_by', userId)
  if (error) throw error
  return { ok: true }
}
