/**
 * Plan guard middleware and helpers.
 *
 * Limits enforced:
 *   - monthly content jobs
 *   - monthly voice minutes
 *   - monthly video jobs
 *   - brands
 *   - connected sites
 *   - team members
 */

import { supabase } from '../db/supabase.js'
import { getPlanConfig, getPlanLimit, isUnlimited, isWithinLimit } from '../lib/planConfig.js'
import { classifyJobRequest, getUsageSummary } from '../services/usageSummary.js'

function buildLimitError({ label, metric, planTier, limit, used, requested = 1 }) {
  return {
    status: 402,
    body: {
      error: `${label} limit reached for your current plan`,
      metric,
      plan: planTier,
      limit,
      used,
      requested,
      upgrade_url: '/billing',
    },
  }
}

function throwLimitError(payload) {
  const error = new Error(payload.body.error)
  error.status = payload.status
  error.payload = payload.body
  throw error
}

function respondLimitError(res, payload) {
  return res.status(payload.status).json(payload.body)
}

export async function assertWithinPlanMetric(org, metricKey, used, requested = 1, label = metricKey) {
  const limit = getPlanLimit(org.plan_tier, metricKey)
  if (isWithinLimit(limit, used, requested)) {
    return { limit, used, requested }
  }

  throwLimitError(buildLimitError({
    label,
    metric: metricKey,
    planTier: org.plan_tier,
    limit,
    used,
    requested,
  }))
}

export async function assertCanRunJob(org, jobLike = {}) {
  const usage = await getUsageSummary(org)
  const jobShape = classifyJobRequest(jobLike)

  await assertWithinPlanMetric(org, 'content_jobs', usage.content_jobs_used, 1, 'Monthly content jobs')

  if (jobShape.is_video_job) {
    await assertWithinPlanMetric(org, 'video_jobs', usage.video_jobs_used, 1, 'Monthly video jobs')
  }

  if (jobShape.estimated_voice_minutes > 0) {
    await assertWithinPlanMetric(
      org,
      'voice_minutes',
      usage.voice_minutes_used,
      jobShape.estimated_voice_minutes,
      'Monthly voice minutes',
    )
  }

  return {
    usage,
    jobShape,
    plan: getPlanConfig(org.plan_tier),
  }
}

export async function guardJobLimit(req, res, next) {
  try {
    await assertCanRunJob(req.org, {
      job_type: req.body?.job_type || 'content_pipeline',
      input_payload: req.body?.input_payload || {},
      aspect_ratio: req.body?.aspect_ratio || '16:9',
    })
    next()
  } catch (error) {
    if (error?.payload) return respondLimitError(res, { status: error.status || 402, body: error.payload })
    next(error)
  }
}

export async function guardBrandLimit(req, res, next) {
  try {
    const { count } = await supabase
      .from('brands')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', req.org.id)

    const limit = getPlanLimit(req.org.plan_tier, 'brands')
    if (!isUnlimited(limit) && Number(count || 0) >= Number(limit)) {
      return respondLimitError(res, buildLimitError({
        label: 'Brand',
        metric: 'brands',
        planTier: req.org.plan_tier,
        limit,
        used: Number(count || 0),
      }))
    }
    next()
  } catch (error) {
    next(error)
  }
}

export async function guardTeamMemberLimit(req, res, next) {
  try {
    const { count } = await supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', req.org.id)
      .neq('invite_status', 'revoked')

    const limit = getPlanLimit(req.org.plan_tier, 'team_members')
    if (!isUnlimited(limit) && Number(count || 0) >= Number(limit)) {
      return respondLimitError(res, buildLimitError({
        label: 'Team member',
        metric: 'team_members',
        planTier: req.org.plan_tier,
        limit,
        used: Number(count || 0),
      }))
    }
    next()
  } catch (error) {
    next(error)
  }
}

export async function guardConnectedSiteLimit(req, res, next) {
  try {
    // In non-production environments we don't want plan limits to block setup
    // and testing, so we skip this guard entirely. This ensures local/dev
    // workspaces can configure multiple sites and integrations freely.
    if (process.env.NODE_ENV !== 'production') {
      return next()
    }

    const usage = await getUsageSummary(req.org)
    const limit = getPlanLimit(req.org.plan_tier, 'connected_sites')
    if (!isUnlimited(limit) && Number(usage.connected_sites_used || 0) >= Number(limit)) {
      return respondLimitError(res, buildLimitError({
        label: 'Connected site',
        metric: 'connected_sites',
        planTier: req.org.plan_tier,
        limit,
        used: Number(usage.connected_sites_used || 0),
      }))
    }
    next()
  } catch (error) {
    next(error)
  }
}

export function guardFeature(featureKey) {
  return (req, res, next) => {
    const plan = getPlanConfig(req.org?.plan_tier)
    if (!plan.features?.[featureKey]) {
      return res.status(402).json({
        error: `${featureKey} is not available on your current plan`,
        plan: req.org?.plan_tier,
        upgrade_url: '/billing',
      })
    }
    next()
  }
}

export async function incrementJobUsage(orgId) {
  await supabase.rpc('increment_jobs_used', { org_id_input: orgId })
}
