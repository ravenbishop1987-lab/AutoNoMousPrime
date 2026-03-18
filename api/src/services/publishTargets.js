import { supabase } from '../db/supabase.js'

function derivePlatform(job) {
  const payload = job?.input_payload && typeof job.input_payload === 'object' ? job.input_payload : {}
  return String(payload.platform || payload.publish_platform || '').trim()
}

function deriveContentType(job) {
  const payload = job?.input_payload && typeof job.input_payload === 'object' ? job.input_payload : {}
  return String(payload.content_type || payload.publish_content_type || job?.job_type || 'content_pipeline').trim()
}

export async function upsertPublishTargetFromJob(job, actorId = null) {
  const payload = job?.input_payload && typeof job.input_payload === 'object' ? job.input_payload : {}
  const platform = derivePlatform(job)
  if (!platform) return null

  const baseTarget = {
    job_id: job.id,
    org_id: job.org_id,
    brand_id: job.brand_id || null,
    platform,
    content_type: deriveContentType(job),
    cta_url: String(payload.cta_url || '').trim() || null,
    cta_label: String(payload.cta_label || '').trim() || null,
    meta_title: String(payload.meta_title || payload.title || job.topic || '').trim() || null,
    meta_description: String(payload.meta_description || payload.description || '').trim() || null,
    schedule_state: payload.scheduled_at ? 'scheduled' : 'unscheduled',
    scheduled_at: payload.scheduled_at || null,
    status: 'draft',
    created_by: actorId,
  }

  const extendedTarget = {
    ...baseTarget,
    offer_id: String(payload.offer_id || '').trim() || null,
    offer_name: String(payload.offer_name || '').trim() || null,
    cta_id: String(payload.cta_id || '').trim() || null,
    landing_page_id: String(payload.landing_page_id || '').trim() || null,
    landing_page_url: String(payload.landing_page_url || payload.landing_page || '').trim() || null,
    expected_revenue_cents: Number(payload.expected_revenue_cents || 0) || null,
    monetization_path: {
      offer_id: String(payload.offer_id || '').trim() || null,
      offer_name: String(payload.offer_name || '').trim() || null,
      cta_id: String(payload.cta_id || '').trim() || null,
      cta_label: String(payload.cta_label || '').trim() || null,
      landing_page_id: String(payload.landing_page_id || '').trim() || null,
      landing_page_url: String(payload.landing_page_url || payload.landing_page || '').trim() || null,
      expected_revenue_cents: Number(payload.expected_revenue_cents || 0) || 0,
    },
  }

  const { data: existing } = await supabase
    .from('publish_targets')
    .select('*')
    .eq('job_id', job.id)
    .eq('platform', platform)
    .limit(1)
    .maybeSingle()

  const executeUpsert = async (target) => {
    const builder = existing
      ? supabase.from('publish_targets').update(target).eq('id', existing.id)
      : supabase.from('publish_targets').insert(target)
    return builder.select().single()
  }

  let response = await executeUpsert(extendedTarget)
  if (response.error && /column/i.test(String(response.error.message || ''))) {
    response = await executeUpsert(baseTarget)
  }
  if (response.error) throw response.error
  return response.data
}

export async function getPublishTargetsForJob(orgId, jobId) {
  const { data, error } = await supabase
    .from('publish_targets')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}
