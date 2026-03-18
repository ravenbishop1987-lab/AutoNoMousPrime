const PLAN_CONFIG = {
  starter: {
    tier: 'starter',
    name: 'Starter',
    price_monthly_usd: 49,
    limits: {
      content_jobs: 30,
      voice_minutes: 0,
      video_jobs: 0,
      brands: 1,
      connected_sites: 1,
      team_members: 1,
    },
    features: {
      blog_pipeline: true,
      image_gen: true,
      voice_gen: false,
      video_gen: false,
      full_pipeline: false,
      comment_auto_reply: false,
      autonomous_mode: false,
      ai_topics: false,
      named_personas: false,
      revenue_reporting: 'basic',
      cta_reporting: false,
      monetization_planner: false,
    },
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    price_monthly_usd: 149,
    limits: {
      content_jobs: 100,
      voice_minutes: -1,
      video_jobs: -1,
      brands: 3,
      connected_sites: 3,
      team_members: 3,
    },
    features: {
      blog_pipeline: true,
      image_gen: true,
      voice_gen: true,
      video_gen: true,
      full_pipeline: true,
      comment_auto_reply: true,
      autonomous_mode: true,
      ai_topics: true,
      named_personas: false,
      revenue_reporting: 'full',
      cta_reporting: true,
      monetization_planner: true,
    },
  },
  agency: {
    tier: 'agency',
    name: 'Agency',
    price_monthly_usd: 399,
    limits: {
      content_jobs: -1,
      voice_minutes: -1,
      video_jobs: -1,
      brands: 10,
      connected_sites: 10,
      team_members: 10,
    },
    features: {
      blog_pipeline: true,
      image_gen: true,
      voice_gen: true,
      video_gen: true,
      full_pipeline: true,
      comment_auto_reply: true,
      autonomous_mode: true,
      ai_topics: true,
      named_personas: true,
      revenue_reporting: 'full',
      cta_reporting: true,
      monetization_planner: true,
    },
  },
}

export function getPlanConfig(tier) {
  return PLAN_CONFIG[tier] || PLAN_CONFIG.starter
}

export function getPlanLimit(tier, metricKey) {
  return getPlanConfig(tier).limits?.[metricKey] ?? 0
}

export function isUnlimited(limit) {
  return Number(limit) === -1
}

export function isWithinLimit(limit, used, requested = 1) {
  if (isUnlimited(limit)) return true
  return Number(used || 0) + Number(requested || 0) <= Number(limit || 0)
}

export function formatLimit(limit) {
  return isUnlimited(limit) ? 'Unlimited' : Number(limit || 0)
}

export { PLAN_CONFIG }
