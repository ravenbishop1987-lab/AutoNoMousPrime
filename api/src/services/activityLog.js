import { supabase } from '../db/supabase.js'

export async function recordActivity(payload) {
  const { data, error } = await supabase.from('activity_log').insert(payload).select().single()
  if (error) throw error
  return data
}

function normalizeActivity(items) {
  return (items || [])
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map(item => ({
      id: item.id,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      action: item.action,
      actor_type: item.actor_type || 'system',
      actor_id: item.actor_id || null,
      summary: item.summary,
      metadata: item.metadata || {},
      created_at: item.created_at,
    }))
}

export async function listActivity(orgId, filters = {}) {
  const [activityRows, jobEvents, jobs] = await Promise.all([
    supabase.from('activity_log').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
    supabase.from('job_events').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
    supabase.from('jobs').select('id, topic, submitted_by, created_at, brand_id').eq('org_id', orgId).order('created_at', { ascending: false }).limit(100),
  ])

  const merged = [
    ...(activityRows.data || []).map(item => ({
      id: item.id,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      action: item.action,
      actor_type: item.actor_type || 'system',
      actor_id: item.actor_id || null,
      summary: item.summary || item.action,
      metadata: item.metadata || {},
      created_at: item.created_at,
      brand_id: item.brand_id || null,
    })),
    ...(jobEvents.data || []).map(item => ({
      id: `job-event-${item.id}`,
      entity_type: 'job',
      entity_id: item.job_id,
      action: item.event_type,
      actor_type: item.actor_type,
      actor_id: item.actor_id,
      summary: item.message || item.event_type,
      metadata: item.metadata || {},
      created_at: item.created_at,
      brand_id: item.brand_id || null,
    })),
    ...(jobs.data || []).map(item => ({
      id: `job-${item.id}`,
      entity_type: 'job',
      entity_id: item.id,
      action: 'job.created',
      actor_type: 'user',
      actor_id: item.submitted_by || null,
      summary: `Job created: ${item.topic}`,
      metadata: { topic: item.topic },
      created_at: item.created_at,
      brand_id: item.brand_id || null,
    })),
  ]

  const filtered = merged.filter(item => {
    if (filters.brand_id && item.brand_id !== filters.brand_id) return false
    if (filters.entity_type && item.entity_type !== filters.entity_type) return false
    if (filters.action && item.action !== filters.action) return false
    if (filters.search) {
      const haystack = `${item.summary} ${item.action} ${item.entity_type}`.toLowerCase()
      if (!haystack.includes(String(filters.search).toLowerCase())) return false
    }
    return true
  })

  return normalizeActivity(filtered)
}

export async function getJobActivity(orgId, jobId) {
  const items = await listActivity(orgId)
  return items.filter(item => item.entity_id === jobId)
}
