import { supabase } from '../db/supabase.js'

function weakTitleScore(value) {
  const text = String(value || '').trim()
  if (!text) return true
  if (text.length < 30 || text.length > 90) return true
  if (!/[A-Z]/.test(text)) return true
  return false
}

function hasVideoSignal(job) {
  const payload = job?.input_payload && typeof job.input_payload === 'object' ? job.input_payload : {}
  const fields = [job?.job_type, payload.content_type, payload.platform]
    .map(value => String(value || '').toLowerCase())
  return fields.some(value => value.includes('video') || ['youtube', 'tiktok', 'instagram'].includes(value))
}

function buildSuggestion(orgId, input) {
  return {
    org_id: orgId,
    brand_id: input.brand_id || null,
    job_id: input.job_id || null,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    suggestion_type: input.suggestion_type,
    severity: input.severity || 'info',
    title: input.title,
    description: input.description || '',
    suggested_action: input.suggested_action || '',
    status: 'open',
    metadata: input.metadata || {},
  }
}

export async function refreshOptimizationSuggestions(orgId) {
  const [jobsResp, assetsResp, targetsResp, reviewsResp] = await Promise.all([
    supabase.from('jobs').select('id, brand_id, topic, job_type, input_payload, created_at, review_due_at, publish_due_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(50),
    supabase.from('assets').select('id, job_id, type').eq('org_id', orgId),
    supabase.from('publish_targets').select('id, job_id, brand_id, platform, cta_url, cta_label, meta_title, scheduled_at, publish_result_status, landing_page_id, landing_page_url').eq('org_id', orgId).order('created_at', { ascending: false }).limit(50),
    supabase.from('review_threads').select('id, job_id, current_status, updated_at').eq('org_id', orgId).order('updated_at', { ascending: false }).limit(50),
  ])

  const jobs = jobsResp.data || []
  const assets = assetsResp.data || []
  const targets = targetsResp.data || []
  const reviews = reviewsResp.data || []
  const reviewMap = new Map(reviews.map(item => [item.job_id, item]))
  const assetMap = new Map()
  for (const asset of assets) {
    const current = assetMap.get(asset.job_id) || { image: 0, audio: 0, video: 0 }
    current[asset.type] = (current[asset.type] || 0) + 1
    assetMap.set(asset.job_id, current)
  }

  const suggestions = []

  for (const target of targets) {
    if (!String(target.cta_url || '').trim() && !String(target.cta_label || '').trim()) {
      suggestions.push(buildSuggestion(orgId, {
        brand_id: target.brand_id,
        job_id: target.job_id,
        entity_type: 'publish_target',
        entity_id: target.id,
        suggestion_type: 'missing_cta',
        severity: 'critical',
        title: `Add a CTA for ${target.platform}`,
        description: 'This scheduled publish target has no CTA link or CTA label attached.',
        suggested_action: 'Attach a CTA label and destination before publishing.',
        metadata: { platform: target.platform, job_id: target.job_id },
      }))
    }

    if (weakTitleScore(target.meta_title)) {
      suggestions.push(buildSuggestion(orgId, {
        brand_id: target.brand_id,
        job_id: target.job_id,
        entity_type: 'publish_target',
        entity_id: target.id,
        suggestion_type: 'weak_title',
        severity: 'warning',
        title: `Strengthen the ${target.platform} title`,
        description: 'Title quality is weak because it is missing, too short, too long, or lacks readable casing.',
        suggested_action: 'Rewrite the title with a sharper promise and clearer outcome.',
        metadata: { platform: target.platform, current_title: target.meta_title || '' },
      }))
    }

    if (!String(target.scheduled_at || '').trim()) {
      suggestions.push(buildSuggestion(orgId, {
        brand_id: target.brand_id,
        job_id: target.job_id,
        entity_type: 'publish_target',
        entity_id: target.id,
        suggestion_type: 'schedule_gap',
        severity: 'warning',
        title: `Schedule ${target.platform} content`,
        description: 'A publish target exists but does not have a scheduled publish time.',
        suggested_action: 'Assign a schedule slot to keep the content cadence consistent.',
        metadata: { platform: target.platform },
      }))
    }
  }

  for (const job of jobs) {
    const assetCounts = assetMap.get(job.id) || { image: 0, audio: 0, video: 0 }
    const review = reviewMap.get(job.id)

    if (hasVideoSignal(job) && assetCounts.video === 0) {
      suggestions.push(buildSuggestion(orgId, {
        brand_id: job.brand_id,
        job_id: job.id,
        entity_type: 'job',
        entity_id: job.id,
        suggestion_type: 'missing_assets',
        severity: 'critical',
        title: `Missing video asset for ${job.topic}`,
        description: 'This job looks like a video publish path but no video asset is linked yet.',
        suggested_action: 'Generate or attach a video asset before publish review.',
        metadata: { asset_counts: assetCounts },
      }))
    }

    if (!hasVideoSignal(job) && assetCounts.image === 0) {
      suggestions.push(buildSuggestion(orgId, {
        brand_id: job.brand_id,
        job_id: job.id,
        entity_type: 'job',
        entity_id: job.id,
        suggestion_type: 'missing_assets',
        severity: 'warning',
        title: `Add a supporting image for ${job.topic}`,
        description: 'This job has no linked image asset, which reduces publish quality and CTA performance.',
        suggested_action: 'Attach a brand-aligned image or thumbnail.',
        metadata: { asset_counts: assetCounts },
      }))
    }

    if (review?.current_status === 'pending') {
      const ageHours = (Date.now() - new Date(review.updated_at || job.created_at).getTime()) / 3_600_000
      if (ageHours > 24) {
        suggestions.push(buildSuggestion(orgId, {
          brand_id: job.brand_id,
          job_id: job.id,
          entity_type: 'review',
          entity_id: review.id,
          suggestion_type: 'approval_bottleneck',
          severity: 'warning',
          title: `Approval bottleneck for ${job.topic}`,
          description: 'Approval has been pending for more than 24 hours.',
          suggested_action: 'Reassign the review or notify the reviewer to avoid throughput slowdown.',
          metadata: { age_hours: Number(ageHours.toFixed(1)) },
        }))
      }
    }
  }

  const scheduledTargets = targets
    .filter(item => item.scheduled_at)
    .sort((a, b) => new Date(String(a.scheduled_at)).getTime() - new Date(String(b.scheduled_at)).getTime())
  if (!scheduledTargets.length) {
    suggestions.push(buildSuggestion(orgId, {
      entity_type: 'workspace',
      entity_id: orgId,
      suggestion_type: 'schedule_gap',
      severity: 'critical',
      title: 'No scheduled content in the planner',
      description: 'The workspace does not have any scheduled publish targets right now.',
      suggested_action: 'Schedule the next 3 to 5 publish targets to maintain throughput.',
      metadata: {},
    }))
  }

  await supabase
    .from('optimization_suggestions')
    .delete()
    .eq('org_id', orgId)
    .eq('status', 'open')

  if (suggestions.length) {
    const { error } = await supabase.from('optimization_suggestions').insert(suggestions)
    if (error) throw error
  }

  return suggestions
}

export async function listOptimizationSuggestions(orgId, status = null) {
  let query = supabase
    .from('optimization_suggestions')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw error
  return data || []
}
