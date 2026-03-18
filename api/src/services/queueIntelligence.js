import { getJobValidationState } from './validations.js'
import { buildReadinessChecklist, computeSlaState, isOverdue } from './operationalTrust.js'

export function classifyQueueState({ job, latestRun = null, reviewThread = null, validationSummary }) {
  if (['canceled'].includes(job?.status) || latestRun?.status === 'canceled') {
    return { queue_state: 'canceled', blocked_reasons: [], next_action: 'Reopen job', ready_for_publish: false }
  }
  if (latestRun?.status === 'failed' || job?.status === 'failed') {
    return { queue_state: 'failed', blocked_reasons: ['run_failed'], next_action: 'Retry failed run', ready_for_publish: false }
  }
  if (['queued', 'running', 'retrying'].includes(latestRun?.status || job?.status)) {
    return { queue_state: 'running', blocked_reasons: [], next_action: 'Wait for execution', ready_for_publish: false }
  }
  if (reviewThread?.current_status === 'pending' || job?.status === 'awaiting_review') {
    return { queue_state: 'awaiting_approval', blocked_reasons: ['approval_required'], next_action: 'Review output', ready_for_publish: false }
  }

  const blocking = validationSummary?.blocking_rules || []
  if (blocking.includes('asset.primary_image.present') || blocking.includes('asset.audio.present') || blocking.includes('asset.video.present')) {
    return { queue_state: 'missing_assets', blocked_reasons: blocking, next_action: 'Attach required assets', ready_for_publish: false }
  }
  if (blocking.includes('cta.url.present')) {
    return { queue_state: 'missing_cta', blocked_reasons: blocking, next_action: 'Add CTA', ready_for_publish: false }
  }
  if (blocking.includes('schedule.datetime.present') || blocking.includes('job.platform.present')) {
    return { queue_state: 'missing_schedule', blocked_reasons: blocking, next_action: 'Set schedule and platform', ready_for_publish: false }
  }
  if (blocking.length) {
    return { queue_state: 'blocked', blocked_reasons: blocking, next_action: 'Fix validation issues', ready_for_publish: false }
  }
  if (['approved', 'completed'].includes(job?.status)) {
    return { queue_state: 'completed', blocked_reasons: [], next_action: 'Published or complete', ready_for_publish: true }
  }
  return { queue_state: 'ready', blocked_reasons: [], next_action: 'Publish or schedule', ready_for_publish: true }
}

export async function enrichJobQueueState(orgId, job, latestRun = null, reviewThread = null) {
  const validationState = await getJobValidationState(orgId, job.id)
  const queue = classifyQueueState({
    job,
    latestRun,
    reviewThread,
    validationSummary: validationState.summary,
  })
  return {
    ...queue,
    owner_user_id: job?.owner_user_id || null,
    review_assignee_user_id: job?.review_assignee_user_id || reviewThread?.assignee_user_id || null,
    publish_assignee_user_id: job?.publish_assignee_user_id || null,
    waiting_on: job?.waiting_on || reviewThread?.waiting_on || null,
    overdue: isOverdue(job, reviewThread),
    sla_state: computeSlaState(job, queue, reviewThread),
    readiness_checklist: buildReadinessChecklist(validationState, reviewThread),
    validation_summary: validationState.summary,
    validations: validationState.validations,
  }
}
