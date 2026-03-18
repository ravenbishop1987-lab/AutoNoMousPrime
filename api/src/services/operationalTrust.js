export function deriveDueDate(job = {}, reviewThread = null) {
  return job.publish_due_at || job.review_due_at || job.revision_due_at || reviewThread?.due_at || null
}

export function computeSlaState(job = {}, queue = null, reviewThread = null) {
  if (queue?.queue_state === 'blocked' || (queue?.blocked_reasons || []).length) return 'blocked'
  const dueDate = deriveDueDate(job, reviewThread)
  if (!dueDate) return 'on_track'
  const due = new Date(dueDate).getTime()
  const now = Date.now()
  if (Number.isNaN(due)) return 'on_track'
  if (due < now) return 'overdue'
  if (due - now < 24 * 60 * 60 * 1000) return 'at_risk'
  return 'on_track'
}

export function isOverdue(job = {}, reviewThread = null) {
  const dueDate = deriveDueDate(job, reviewThread)
  if (!dueDate) return false
  return new Date(dueDate).getTime() < Date.now()
}

export function buildReadinessChecklist(validationState, reviewThread = null) {
  const statusByRule = new Map((validationState?.validations || []).map(item => [item.rule_key, item]))
  const approvalRule = statusByRule.get('review.approved')
  return [
    { key: 'cta', label: 'CTA', status: statusByRule.get('cta.url.present')?.status || 'fail' },
    { key: 'featured_image', label: 'Featured image', status: statusByRule.get('asset.primary_image.present')?.status || 'fail' },
    { key: 'seo_title', label: 'SEO title', status: statusByRule.get('meta.title.present')?.status || 'fail' },
    { key: 'meta_description', label: 'Meta description', status: statusByRule.get('meta.description.present')?.status || 'fail' },
    { key: 'target_platform', label: 'Target platform', status: statusByRule.get('job.platform.present')?.status || 'fail' },
    { key: 'schedule', label: 'Schedule', status: statusByRule.get('schedule.datetime.present')?.status || 'fail' },
    {
      key: 'approval',
      label: 'Approval',
      status: reviewThread?.current_status === 'approved' || approvalRule?.status === 'pass' ? 'pass' : 'fail',
    },
  ]
}
