import { supabase } from '../db/supabase.js'

export async function listAssets(orgId, filters = {}) {
  let query = supabase
    .from('assets')
    .select('*')
    .eq('org_id', orgId)
    .neq('usage_status', 'archived')
    .order('created_at', { ascending: false })

  if (filters.brand_id) query = query.eq('brand_id', filters.brand_id)
  if (filters.asset_kind) query = query.eq('type', filters.asset_kind)
  if (filters.job_id) query = query.eq('job_id', filters.job_id)
  if (filters.job_run_id) query = query.eq('job_run_id', filters.job_run_id)

  const { data, error } = await query.limit(200)
  if (error) throw error

  const items = (data || []).filter(item => {
    if (!filters.search) return true
    const haystack = `${item.type || ''} ${item.provider || ''} ${item.storage_url || ''} ${item.local_path || ''}`.toLowerCase()
    return haystack.includes(String(filters.search).toLowerCase())
  })

  return items
}

export async function getAsset(orgId, assetId) {
  const { data, error } = await supabase.from('assets').select('*').eq('org_id', orgId).eq('id', assetId).single()
  if (error) throw error
  return data
}
