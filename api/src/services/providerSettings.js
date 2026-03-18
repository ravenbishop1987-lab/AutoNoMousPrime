import { supabase } from '../db/supabase.js'

export async function listProviderSettings(orgId) {
  const { data, error } = await supabase
    .from('provider_credentials')
    .select('*')
    .eq('org_id', orgId)
    .order('provider_key', { ascending: true })
  if (error) throw error
  return data || []
}

export async function upsertProviderSetting(orgId, userId, payload) {
  const normalized = {
    org_id: orgId,
    brand_id: payload.brand_id || null,
    provider_key: String(payload.provider_key || '').trim(),
    display_name: String(payload.display_name || payload.provider_key || '').trim(),
    category: payload.category || 'other',
    config: payload.config || {},
    secret_refs: payload.secret_refs || (payload.secret_ref ? { primary: payload.secret_ref } : {}),
    status: payload.status || 'configured',
    access_level: payload.access_level || 'workspace',
    admin_only: Boolean(payload.admin_only),
    last_rotated_at: payload.last_rotated_at || null,
    set_by: userId,
    created_by: userId,
    updated_by: userId,
  }

  let query = supabase
    .from('provider_credentials')
    .select('*')
    .eq('org_id', orgId)
    .eq('provider_key', normalized.provider_key)
  query = normalized.brand_id ? query.eq('brand_id', normalized.brand_id) : query.is('brand_id', null)
  const { data: existing } = await query.limit(1).maybeSingle()

  const builder = existing
    ? supabase.from('provider_credentials').update(normalized).eq('id', existing.id).eq('org_id', orgId)
    : supabase.from('provider_credentials').insert(normalized)
  const { data, error } = await builder.select().single()
  if (error) throw error
  return data
}
