import { supabase } from '../db/supabase.js'

const MAX_REFERENCES = 20

function createEmptyUsage() {
  return {
    draft_refs: 0,
    snapshot_refs: 0,
    published_refs: 0,
    link_refs: 0,
    total_refs: 0,
    has_published_output: false,
    references: [],
  }
}

function pushReference(usage, source, payload) {
  if (!usage) return
  if (source === 'draft') usage.draft_refs += 1
  if (source === 'snapshot') usage.snapshot_refs += 1
  if (source === 'published') {
    usage.published_refs += 1
    usage.has_published_output = true
  }
  if (source === 'link') usage.link_refs += 1
  usage.total_refs = usage.draft_refs + usage.snapshot_refs + usage.published_refs + usage.link_refs

  if (usage.references.length < MAX_REFERENCES) {
    usage.references.push({ source, ...payload })
  }
}

function isPublishedJob(job, publishTargets = []) {
  if (!job) return false
  if (job.published_at) return true
  if (String(job.status || '').toLowerCase() === 'completed') return true
  return (publishTargets || []).some(target =>
    ['published'].includes(String(target.publish_result_status || '').toLowerCase())
    || ['published'].includes(String(target.status || '').toLowerCase()),
  )
}

function buildSnapshotHaystack(snapshot) {
  return JSON.stringify({
    id: snapshot.id,
    snapshot_type: snapshot.snapshot_type,
    job_payload: snapshot.job_payload || {},
    publish_payload: snapshot.publish_payload || [],
    validation_payload: snapshot.validation_payload || {},
  }).toLowerCase()
}

export async function buildAssetUsageMap(orgId, assets = [], linksByAssetId = new Map()) {
  if (!assets.length) return new Map()

  const jobIds = [...new Set(assets.map(asset => asset.job_id).filter(Boolean))]
  const linkedJobIds = []
  const linkedPublishTargetIds = []
  for (const links of linksByAssetId.values()) {
    for (const link of links || []) {
      if (link.entity_type === 'job' && link.entity_id) linkedJobIds.push(link.entity_id)
      if (link.entity_type === 'publish_target' && link.entity_id) linkedPublishTargetIds.push(link.entity_id)
    }
  }
  const relatedJobIds = [...new Set([...jobIds, ...linkedJobIds])]
  const relatedTargetIds = [...new Set(linkedPublishTargetIds)]

  const [jobsResp, publishByJobResp, publishByIdResp, snapshotsResp] = await Promise.all([
    relatedJobIds.length
      ? supabase.from('jobs').select('id, topic, status, published_at').eq('org_id', orgId).in('id', relatedJobIds)
      : Promise.resolve({ data: [] }),
    relatedJobIds.length
      ? supabase.from('publish_targets').select('id, job_id, platform, status, publish_result_status, provider_post_url, published_at').eq('org_id', orgId).in('job_id', relatedJobIds)
      : Promise.resolve({ data: [] }),
    relatedTargetIds.length
      ? supabase.from('publish_targets').select('id, job_id, platform, status, publish_result_status, provider_post_url, published_at').eq('org_id', orgId).in('id', relatedTargetIds)
      : Promise.resolve({ data: [] }),
    jobIds.length
      ? supabase.from('job_snapshots').select('id, job_id, snapshot_type, created_at, job_payload, publish_payload, validation_payload').eq('org_id', orgId).in('job_id', jobIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])
  for (const response of [jobsResp, publishByJobResp, publishByIdResp, snapshotsResp]) {
    if (response?.error) throw response.error
  }

  const jobsById = new Map((jobsResp.data || []).map(job => [job.id, job]))
  const publishByJob = new Map()
  for (const row of publishByJobResp.data || []) {
    const current = publishByJob.get(row.job_id) || []
    current.push(row)
    publishByJob.set(row.job_id, current)
  }
  const publishById = new Map((publishByIdResp.data || []).map(row => [row.id, row]))

  const snapshotsByJob = new Map()
  const snapshotSearchById = new Map()
  for (const snapshot of snapshotsResp.data || []) {
    const current = snapshotsByJob.get(snapshot.job_id) || []
    current.push(snapshot)
    snapshotsByJob.set(snapshot.job_id, current)
    snapshotSearchById.set(snapshot.id, buildSnapshotHaystack(snapshot))
  }

  const usageMap = new Map()
  for (const asset of assets) {
    const usage = createEmptyUsage()
    const links = linksByAssetId.get(asset.id) || []
    const assetJob = jobsById.get(asset.job_id) || null
    const jobTargets = publishByJob.get(asset.job_id) || []

    if (assetJob) {
      if (isPublishedJob(assetJob, jobTargets)) {
        pushReference(usage, 'published', {
          entity_type: 'job',
          entity_id: assetJob.id,
          label: assetJob.topic || 'Published output',
          status: assetJob.status,
        })
      } else {
        pushReference(usage, 'draft', {
          entity_type: 'job',
          entity_id: assetJob.id,
          label: assetJob.topic || 'Draft job',
          status: assetJob.status,
        })
      }
    }

    for (const target of jobTargets) {
      const published = ['published'].includes(String(target.publish_result_status || '').toLowerCase())
        || ['published'].includes(String(target.status || '').toLowerCase())
      if (!published) continue
      pushReference(usage, 'published', {
        entity_type: 'publish_target',
        entity_id: target.id,
        label: `${target.platform || 'provider'} output`,
        url: target.provider_post_url || null,
      })
    }

    const snapshots = snapshotsByJob.get(asset.job_id) || []
    const matchTokens = [asset.id, asset.storage_url, asset.local_path]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(value => value.length >= 6)
    if (matchTokens.length) {
      for (const snapshot of snapshots) {
        const haystack = snapshotSearchById.get(snapshot.id) || ''
        if (!matchTokens.some(token => haystack.includes(token))) continue
        pushReference(usage, 'snapshot', {
          entity_type: 'job_snapshot',
          entity_id: snapshot.id,
          label: snapshot.snapshot_type,
          created_at: snapshot.created_at,
        })
      }
    }

    for (const link of links) {
      pushReference(usage, 'link', {
        entity_type: link.entity_type,
        entity_id: link.entity_id,
        label: `${link.entity_type} (${link.role || 'supporting'})`,
        role: link.role || 'supporting',
      })

      if (link.entity_type === 'job') {
        const linkedJob = jobsById.get(link.entity_id)
        if (linkedJob) {
          pushReference(
            usage,
            isPublishedJob(linkedJob, publishByJob.get(linkedJob.id) || []) ? 'published' : 'draft',
            {
              entity_type: 'job',
              entity_id: linkedJob.id,
              label: linkedJob.topic || 'Linked job',
              status: linkedJob.status,
            },
          )
        }
      }

      if (link.entity_type === 'publish_target') {
        const linkedTarget = publishById.get(link.entity_id)
        if (linkedTarget) {
          const published = ['published'].includes(String(linkedTarget.publish_result_status || '').toLowerCase())
            || ['published'].includes(String(linkedTarget.status || '').toLowerCase())
          pushReference(usage, published ? 'published' : 'draft', {
            entity_type: 'publish_target',
            entity_id: linkedTarget.id,
            label: `${linkedTarget.platform || 'provider'} ${published ? 'output' : 'target'}`,
            url: linkedTarget.provider_post_url || null,
          })
        }
      }
    }

    usage.total_refs = usage.draft_refs + usage.snapshot_refs + usage.published_refs + usage.link_refs
    usageMap.set(asset.id, usage)
  }

  return usageMap
}
