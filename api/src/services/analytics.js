import { supabase } from '../db/supabase.js'

function startOfWindow(days = 30) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function startOfWeek(date) {
  const copy = new Date(date)
  const day = copy.getUTCDay()
  const diff = (day + 6) % 7
  copy.setUTCDate(copy.getUTCDate() - diff)
  copy.setUTCHours(0, 0, 0, 0)
  return copy.toISOString().slice(0, 10)
}

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export async function getAnalyticsOverview(orgId) {
  const since = startOfWindow(30)
  const [jobsResp, runsResp, reviewsResp, targetsResp, attemptsResp, suggestionsResp] = await Promise.all([
    supabase.from('jobs').select('id, job_type, status, created_at, published_at, input_payload').eq('org_id', orgId).gte('created_at', since),
    supabase.from('job_runs').select('id, job_id, status, created_at, completed_at, brand_id').eq('org_id', orgId).gte('created_at', since),
    supabase.from('review_threads').select('id, job_id, current_status, created_at, updated_at').eq('org_id', orgId).gte('created_at', since),
    supabase.from('publish_targets').select('id, job_id, platform, schedule_state, publish_result_status, cta_url, cta_label, scheduled_at, published_at').eq('org_id', orgId).gte('created_at', since),
    supabase.from('publish_attempts').select('id, platform, status, submitted_at, published_at').eq('org_id', orgId).gte('submitted_at', since),
    supabase.from('optimization_suggestions').select('id, severity, status').eq('org_id', orgId).gte('created_at', since),
  ])

  const jobs = jobsResp.data || []
  const runs = runsResp.data || []
  const reviews = reviewsResp.data || []
  const targets = targetsResp.data || []
  const attempts = attemptsResp.data || []
  const suggestions = suggestionsResp.data || []

  const completedRuns = runs.filter(run => run.status === 'completed')
  const failedRuns = runs.filter(run => run.status === 'failed')
  const runDurationsHours = completedRuns
    .filter(run => run.completed_at)
    .map(run => (new Date(run.completed_at).getTime() - new Date(run.created_at).getTime()) / 3_600_000)
    .filter(value => value >= 0)

  const approvedReviews = reviews.filter(item => item.current_status === 'approved')
  const reviewTurnaroundHours = approvedReviews
    .map(item => (new Date(item.updated_at).getTime() - new Date(item.created_at).getTime()) / 3_600_000)
    .filter(value => value >= 0)

  const throughputMap = new Map()
  for (const job of jobs) {
    const week = startOfWeek(job.created_at)
    const current = throughputMap.get(week) || { week, jobs_created: 0, jobs_completed: 0, approvals: 0 }
    current.jobs_created += 1
    if (job.status === 'completed' || job.status === 'approved' || job.status === 'published') current.jobs_completed += 1
    throughputMap.set(week, current)
  }
  for (const review of approvedReviews) {
    const week = startOfWeek(review.updated_at || review.created_at)
    const current = throughputMap.get(week) || { week, jobs_created: 0, jobs_completed: 0, approvals: 0 }
    current.approvals += 1
    throughputMap.set(week, current)
  }

  const platformMap = new Map()
  for (const target of targets) {
    const key = String(target.platform || 'unknown')
    const current = platformMap.get(key) || {
      platform: key,
      scheduled_count: 0,
      published_count: 0,
      failed_count: 0,
      cta_coverage_count: 0,
    }
    if (target.schedule_state === 'scheduled') current.scheduled_count += 1
    if (target.publish_result_status === 'published') current.published_count += 1
    if (target.publish_result_status === 'failed') current.failed_count += 1
    if (String(target.cta_url || '').trim() || String(target.cta_label || '').trim()) current.cta_coverage_count += 1
    platformMap.set(key, current)
  }

  const approvalByState = ['pending', 'approved', 'revision_requested', 'rejected'].map(state => ({
    state,
    count: reviews.filter(item => item.current_status === state).length,
  }))

  const postPerformance = Array.from(platformMap.values()).map(item => ({
    ...item,
    activity_total: item.scheduled_count + item.published_count + item.failed_count,
  })).sort((a, b) => b.activity_total - a.activity_total)

  const successRate = runs.length ? (completedRuns.length / runs.length) * 100 : 0
  const ctaCoverageRate = targets.length
    ? (targets.filter(item => String(item.cta_url || '').trim() || String(item.cta_label || '').trim()).length / targets.length) * 100
    : 0

  const qualitySignals = {
    open_suggestions: suggestions.filter(item => item.status === 'open').length,
    critical_suggestions: suggestions.filter(item => item.status === 'open' && item.severity === 'critical').length,
    quality_improvement_suggestions: suggestions.filter(item => item.status === 'open' && item.severity !== 'info').length,
  }

  return {
    jobs: {
      total: jobs.length,
      completed: jobs.filter(job => ['completed', 'approved', 'published'].includes(job.status)).length,
      failed: jobs.filter(job => job.status === 'failed').length,
      throughput_per_week: Array.from(throughputMap.values()).sort((a, b) => a.week.localeCompare(b.week)).slice(-6),
    },
    runs: {
      total: runs.length,
      completed: completedRuns.length,
      failed: failedRuns.length,
      success_rate: Number(successRate.toFixed(1)),
      average_completion_hours: Number(average(runDurationsHours).toFixed(1)),
    },
    approvals: {
      total: reviews.length,
      approved: approvedReviews.length,
      pending: reviews.filter(item => item.current_status === 'pending').length,
      average_turnaround_hours: Number(average(reviewTurnaroundHours).toFixed(1)),
      by_state: approvalByState,
    },
    posts: {
      total_targets: targets.length,
      published: targets.filter(item => item.publish_result_status === 'published').length,
      failed: targets.filter(item => item.publish_result_status === 'failed').length,
      cta_coverage_rate: Number(ctaCoverageRate.toFixed(1)),
    },
    platform_activity: postPerformance,
    publish_attempts: {
      total: attempts.length,
      published: attempts.filter(item => item.status === 'published').length,
      failed: attempts.filter(item => item.status === 'failed').length,
    },
    quality_signals: qualitySignals,
  }
}
