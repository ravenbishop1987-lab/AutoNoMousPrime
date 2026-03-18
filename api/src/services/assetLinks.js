import { supabase } from '../db/supabase.js'

export async function listAssetLinks(orgId, assetIds = []) {
  if (!assetIds.length) return []
  const { data, error } = await supabase
    .from('asset_links')
    .select('*')
    .in('asset_id', assetIds)
  if (error) throw error
  return data || []
}

export async function attachAsset(orgId, assetId, payload, userId) {
  const { data: asset, error: assetError } = await supabase
    .from('assets')
    .select('id, org_id, job_id, brand_id')
    .eq('org_id', orgId)
    .eq('id', assetId)
    .single()
  if (assetError || !asset) {
    const error = new Error('Asset not found')
    error.status = 404
    throw error
  }

  const row = {
    asset_id: assetId,
    entity_type: String(payload.entity_type || '').trim(),
    entity_id: String(payload.entity_id || '').trim(),
    role: String(payload.role || 'supporting').trim(),
    metadata: payload.metadata || {},
    created_by: userId,
  }
  if (!row.entity_type || !row.entity_id) {
    const error = new Error('entity_type and entity_id are required')
    error.status = 400
    throw error
  }

  const { data, error } = await supabase.from('asset_links').upsert(row, { onConflict: 'asset_id,entity_type,entity_id,role' }).select().single()
  if (error) throw error
  return data
}

export async function detachAsset(orgId, assetId, linkId) {
  const { error } = await supabase
    .from('asset_links')
    .delete()
    .eq('id', linkId)
    .eq('asset_id', assetId)
  if (error) throw error
  return { ok: true }
}
