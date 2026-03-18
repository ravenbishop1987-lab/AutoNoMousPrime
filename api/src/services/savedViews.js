import { supabase } from '../db/supabase.js'

export async function listSavedViews(orgId, userId, viewType = null) {
  let query = supabase
    .from('saved_views')
    .select('*')
    .eq('org_id', orgId)
    .or(`user_id.is.null,user_id.eq.${userId}`)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  if (viewType) query = query.eq('view_type', viewType)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function saveView(orgId, userId, payload) {
  const normalized = {
    org_id: orgId,
    user_id: payload.shared ? null : userId,
    view_type: payload.view_type,
    name: String(payload.name || '').trim(),
    filters: payload.filters || {},
    is_default: Boolean(payload.is_default),
  }
  if (!normalized.name) {
    const error = new Error('Saved view name is required.')
    error.status = 400
    throw error
  }

  const { data, error } = await supabase.from('saved_views').insert(normalized).select().single()
  if (error) throw error
  return data
}
