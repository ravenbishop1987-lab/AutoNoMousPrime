import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { getAsset, listAssets } from '../services/assets.js'
import { attachAsset, detachAsset, listAssetLinks } from '../services/assetLinks.js'
import { recordActivity } from '../services/activityLog.js'
import { buildAssetUsageMap } from '../services/assetUsage.js'

const router = Router()

router.get('/', requireAuth, attachOrg, async (req, res, next) => {
  try {
    const filters = req.query || {}

    let query = supabase
      .from('assets')
      .select(`
        *,
        asset_links (
          id, asset_id, entity_type, entity_id, role, created_at
        )
      `)
      .eq('org_id', req.org.id)
      .neq('usage_status', 'archived')
      .order('created_at', { ascending: false })

    if (filters.brand_id) query = query.eq('brand_id', filters.brand_id)
    if (filters.asset_kind) query = query.eq('type', filters.asset_kind)
    if (filters.job_id) query = query.eq('job_id', filters.job_id)
    if (filters.job_run_id) query = query.eq('job_run_id', filters.job_run_id)

    const { data, error } = await query.limit(200)
    if (error) return res.status(500).json({ error: error.message })

    const assets = (data || []).filter(item => {
      if (!filters.search) return true
      const haystack = `${item.type || ''} ${item.provider || ''} ${item.storage_url || ''} ${item.local_path || ''}`.toLowerCase()
      return haystack.includes(String(filters.search).toLowerCase())
    })

    const linkMap = new Map()
    for (const asset of assets) {
      const links = Array.isArray(asset.asset_links) ? asset.asset_links : []
      linkMap.set(asset.id, links)
    }

    const usageMap = await buildAssetUsageMap(req.org.id, assets, linkMap)
    res.json({
      ok: true,
      assets: assets.map(asset => ({
        ...asset,
        links: linkMap.get(asset.id) || [],
        usage: usageMap.get(asset.id) || null,
      })),
    })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', requireAuth, attachOrg, async (req, res, next) => {
  try {
    const asset = await getAsset(req.org.id, req.params.id)
    const links = await listAssetLinks(req.org.id, [asset.id])
    const linkMap = new Map([[asset.id, links]])
    const usageMap = await buildAssetUsageMap(req.org.id, [asset], linkMap)
    res.json({ ok: true, asset: { ...asset, links, usage: usageMap.get(asset.id) || null } })
  } catch (err) {
    // Preserve prior behavior: treat missing asset as 404.
    if (String(err?.message || '').toLowerCase().includes('not found')) {
      return res.status(404).json({ error: 'Asset not found' })
    }
    next(err)
  }
})

router.patch('/:id', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res, next) => {
  try {
    const updates = {}
    for (const key of ['storage_url', 'local_path', 'provider', 'metadata']) {
      if (key in req.body) updates[key] = req.body[key]
    }
    const { data, error } = await supabase
      .from('assets')
      .update(updates)
      .eq('org_id', req.org.id)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error || !data) return res.status(404).json({ error: 'Asset not found' })
    res.json({ ok: true, asset: data })
  } catch (err) {
    next(err)
  }
})

// Soft-delete an asset so it no longer appears in the Assets tab.
// This keeps historical references but hides it from normal listings.
router.delete('/:id', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('assets')
      .update({ usage_status: 'archived' })
      .eq('org_id', req.org.id)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error || !data) return res.status(404).json({ error: 'Asset not found' })

    await recordActivity({
      org_id: req.org.id,
      brand_id: data.brand_id || null,
      entity_type: 'asset',
      entity_id: data.id,
      action: 'asset.archived',
      actor_type: 'user',
      actor_id: req.userId,
      summary: `Asset archived: ${data.name || data.title || data.id}`,
      metadata: {
        type: data.type,
        provider: data.provider,
        storage_url: data.storage_url,
        local_path: data.local_path,
      },
    })

    res.json({ ok: true, asset: data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/links', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res, next) => {
  try {
    const link = await attachAsset(req.org.id, req.params.id, req.body, req.userId)
    await recordActivity({
      org_id: req.org.id,
      brand_id: null,
      entity_type: 'asset',
      entity_id: req.params.id,
      action: 'asset.linked',
      actor_type: 'user',
      actor_id: req.userId,
      summary: `Asset linked to ${link.entity_type}`,
      metadata: link,
    })
    res.status(201).json({ ok: true, link })
  } catch (err) {
    next(err)
  }
})

router.delete('/:id/links/:linkId', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res, next) => {
  try {
    await detachAsset(req.org.id, req.params.id, req.params.linkId)
    await recordActivity({
      org_id: req.org.id,
      brand_id: null,
      entity_type: 'asset',
      entity_id: req.params.id,
      action: 'asset.unlinked',
      actor_type: 'user',
      actor_id: req.userId,
      summary: 'Asset detached',
      metadata: { link_id: req.params.linkId },
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
