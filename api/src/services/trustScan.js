import { supabase } from '../db/supabase.js'
import { createNotification } from './notifications.js'
import { recordActivity } from './activityLog.js'

function hoursUntil(dateValue) {
  if (!dateValue) return null
  const time = new Date(dateValue).getTime()
  if (Number.isNaN(time)) return null
  return (time - Date.now()) / (60 * 60 * 1000)
}

export async function runOperationalTrustScan(orgId, actorId = null) {
  const [jobsResp, reviewsResp] = await Promise.all([
    supabase.from('jobs').select('*').eq('org_id', orgId).is('archived_at', null).limit(300),
    supabase.from('review_threads').select('*').eq('org_id', orgId).limit(300),
  ])
  if (jobsResp.error) throw jobsResp.error
  if (reviewsResp.error) throw reviewsResp.error

  const notifications = []
  for (const job of jobsResp.data || []) {
    for (const [dueKey, type] of [
      ['publish_due_at', 'publish'],
      ['review_due_at', 'review'],
      ['revision_due_at', 'revision'],
    ]) {
      const hours = hoursUntil(job[dueKey])
      if (hours === null) continue
      if (hours < 0) {
        notifications.push(await createNotification({
          org_id: orgId,
          brand_id: job.brand_id || null,
          user_id: job.owner_user_id || job.review_assignee_user_id || job.publish_assignee_user_id || null,
          entity_type: 'job',
          entity_id: job.id,
          notification_type: `${type}_overdue`,
          title: `${job.topic} is overdue`,
          body: `${type} due date has passed.`,
          severity: 'error',
          metadata: { tab: type === 'review' ? 'reviews' : 'jobs', due_key: dueKey, target_id: job.id },
        }))
      } else if (hours <= 24) {
        notifications.push(await createNotification({
          org_id: orgId,
          brand_id: job.brand_id || null,
          user_id: job.owner_user_id || job.review_assignee_user_id || job.publish_assignee_user_id || null,
          entity_type: 'job',
          entity_id: job.id,
          notification_type: `${type}_at_risk`,
          title: `${job.topic} is at risk`,
          body: `${type} due date is within 24 hours.`,
          severity: 'warning',
          metadata: { tab: type === 'review' ? 'reviews' : 'jobs', due_key: dueKey, target_id: job.id },
        }))
      }
    }
  }

  for (const thread of reviewsResp.data || []) {
    const hours = hoursUntil(thread.due_at)
    if (hours === null) continue
    if (hours < 0) {
      notifications.push(await createNotification({
        org_id: orgId,
        brand_id: thread.brand_id || null,
        user_id: thread.assignee_user_id || null,
        entity_type: 'review',
        entity_id: thread.job_id,
        notification_type: 'review_overdue',
        title: 'Review overdue',
        body: 'A review deadline has passed.',
        severity: 'error',
        metadata: { tab: 'reviews', target_id: thread.job_id },
      }))
    }
  }

  await recordActivity({
    org_id: orgId,
    brand_id: null,
    entity_type: 'system',
    entity_id: orgId,
    action: 'trust.scan.completed',
    actor_type: actorId ? 'user' : 'system',
    actor_id: actorId,
    summary: `Operational trust scan completed with ${notifications.length} notifications`,
    metadata: { count: notifications.length },
  })

  return { count: notifications.length, notifications }
}
