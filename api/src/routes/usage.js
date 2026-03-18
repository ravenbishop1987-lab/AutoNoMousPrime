import { Router } from 'express'
import { requireAuth, attachOrg } from '../middleware/auth.js'
import { getUsageSummary } from '../services/usageSummary.js'
import { getPlanConfig, getPlanLimit, isUnlimited, formatLimit } from '../lib/planConfig.js'
import { supabase } from '../db/supabase.js'

const router = Router()

router.get('/', requireAuth, attachOrg, async (req, res) => {
  const org = req.org
  const planConfig = getPlanConfig(org.plan_tier)

  let subscription = null
  try {
    const { data } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('org_id', org.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    subscription = data
  } catch { /* no subscription */ }

  const summary = await getUsageSummary(org, subscription)
  const limits = planConfig.limits

  const metrics = [
    {
      key: 'voice_minutes',
      label: 'Voice / TTS',
      used: summary.voice_minutes_used,
      limit: limits.voice_minutes,
      unit: 'min',
      description: 'Minutes of audio synthesized via ElevenLabs this billing period',
    },
    {
      key: 'content_jobs',
      label: 'Content Jobs',
      used: summary.content_jobs_used,
      limit: limits.content_jobs,
      unit: 'jobs',
      description: 'Blog posts, articles, and content pipelines run this month',
    },
    {
      key: 'video_jobs',
      label: 'Video Jobs',
      used: summary.video_jobs_used,
      limit: limits.video_jobs,
      unit: 'videos',
      description: 'Videos assembled and rendered this billing period',
    },
  ].map(metric => ({
    ...metric,
    unlimited: isUnlimited(metric.limit),
    limit_display: formatLimit(metric.limit),
    percent: isUnlimited(metric.limit) || metric.limit === 0
      ? 0
      : Math.min(100, Math.round((metric.used / metric.limit) * 100)),
    exhausted: !isUnlimited(metric.limit) && metric.limit > 0 && metric.used >= metric.limit,
  }))

  res.json({
    ok: true,
    plan: { tier: planConfig.tier, name: planConfig.name },
    billing_window: summary.billing_window,
    metrics,
  })
})

export default router
