import { supabase } from '../db/supabase.js'

function startOfCurrentMonthIso() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString()
}

export function getBillingWindow(subscription = null) {
  const fallbackStart = startOfCurrentMonthIso()
  return {
    period_start: subscription?.current_period_start
      ? new Date(subscription.current_period_start * 1000).toISOString()
      : fallbackStart,
    period_end: subscription?.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
  }
}

function parseNumeric(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isVideoJob(job) {
  const payload = job?.input_payload && typeof job.input_payload === 'object' ? job.input_payload : {}
  const signals = [
    job?.job_type,
    payload.content_type,
    payload.publish_content_type,
    payload.platform,
    payload.primary_format,
  ]
    .map(value => String(value || '').toLowerCase())
    .filter(Boolean)

  if (payload.video_requested === true || payload.generate_video === true) return true
  return signals.some(value => (
    value.includes('video')
    || value.includes('reel')
    || value.includes('short')
    || ['youtube', 'tiktok', 'instagram'].includes(value)
  ))
}

function estimateVoiceMinutesFromJob(job) {
  const payload = job?.input_payload && typeof job.input_payload === 'object' ? job.input_payload : {}
  const explicit = [
    payload.voice_minutes_estimate,
    payload.estimated_voice_minutes,
    payload.narration_minutes,
    payload.audio_minutes,
    payload.duration_minutes,
  ].map(parseNumeric).find(value => value > 0)

  if (explicit) return explicit
  if (payload.voice_enabled === false || payload.generate_voice === false) return 0
  if (isVideoJob(job)) return 1
  return 0
}

export function classifyJobRequest(jobLike = {}) {
  return {
    is_video_job: isVideoJob(jobLike),
    estimated_voice_minutes: estimateVoiceMinutesFromJob(jobLike),
  }
}

export async function getUsageSummary(org, subscription = null) {
  const billingWindow = getBillingWindow(subscription)
  const periodStart = billingWindow.period_start

  const [
    brandsResp,
    membersResp,
    brandSitesResp,
    connectionsResp,
    audioAssetsResp,
    jobsResp,
  ] = await Promise.all([
    supabase
      .from('brands')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id),
    supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id)
      .neq('invite_status', 'revoked'),
    supabase
      .from('brands')
      .select('id, wp_url')
      .eq('org_id', org.id),
    supabase
      .from('provider_connections')
      .select('id, brand_id, provider_key, category, status, config')
      .eq('org_id', org.id),
    supabase
      .from('assets')
      .select('duration_seconds, metadata')
      .eq('org_id', org.id)
      .eq('type', 'audio')
      .gte('created_at', periodStart),
    supabase
      .from('jobs')
      .select('id, job_type, input_payload')
      .eq('org_id', org.id)
      .gte('created_at', periodStart),
  ])

  const siteKeys = new Set()
  for (const brand of brandSitesResp.data || []) {
    const wpUrl = String(brand.wp_url || '').trim()
    if (wpUrl) siteKeys.add(`brand:${wpUrl.toLowerCase()}`)
  }
  for (const connection of connectionsResp.data || []) {
    const config = connection.config && typeof connection.config === 'object' ? connection.config : {}
    const isCms = String(connection.category || '').toLowerCase() === 'cms'
      || String(connection.provider_key || '').toLowerCase() === 'wordpress'
    if (!isCms) continue
    if (String(connection.status || '').toLowerCase() === 'disconnected') continue
    const configuredUrl = String(config.url || config.wp_url || '').trim()
    if (configuredUrl) {
      siteKeys.add(`provider:${configuredUrl.toLowerCase()}`)
    } else if (connection.brand_id) {
      siteKeys.add(`provider-brand:${connection.brand_id}`)
    } else {
      siteKeys.add(`provider:${connection.id}`)
    }
  }

  const voiceSeconds = (audioAssetsResp.data || []).reduce((sum, asset) => {
    const direct = parseNumeric(asset.duration_seconds)
    if (direct > 0) return sum + direct
    const metadata = asset.metadata && typeof asset.metadata === 'object' ? asset.metadata : {}
    return sum + parseNumeric(metadata.duration_seconds)
  }, 0)

  const videoJobsUsed = (jobsResp.data || []).filter(isVideoJob).length

  return {
    content_jobs_used: Number(org.jobs_used_this_month || 0),
    voice_minutes_used: Math.ceil(voiceSeconds / 60),
    video_jobs_used: videoJobsUsed,
    brands_used: Number(brandsResp.count || 0),
    connected_sites_used: siteKeys.size,
    team_members_used: Number(membersResp.count || 0),
    billing_window: billingWindow,
  }
}
