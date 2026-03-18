import { supabase } from '../db/supabase.js'
import { getPublishTargetsForJob } from './publishTargets.js'

function getPayloadValue(payload, ...keys) {
  for (const key of keys) {
    const value = payload?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return ''
}

function hasAssetOfType(assets, ...types) {
  return (assets || []).some(asset => types.includes(asset.type) || types.includes(asset.asset_kind))
}

export function computeJobValidations({ job, brand = null, latestRun = null, assets = [], reviewThread = null, publishTargets = [] }) {
  const payload = job?.input_payload && typeof job.input_payload === 'object' ? job.input_payload : {}
  const primaryTarget = publishTargets?.[0] || null
  const ctaUrl = String(primaryTarget?.cta_url || getPayloadValue(payload, 'cta_url', 'ctaUrl') || brand?.cta_default_url || '').trim()
  const ctaLabel = String(primaryTarget?.cta_label || getPayloadValue(payload, 'cta_label', 'ctaLabel') || '').trim()
  const platform = String(primaryTarget?.platform || getPayloadValue(payload, 'platform') || '').trim()
  const contentType = String(primaryTarget?.content_type || getPayloadValue(payload, 'content_type', 'contentType') || job?.job_type || '').trim()
  const scheduledAt = String(primaryTarget?.scheduled_at || getPayloadValue(payload, 'scheduled_at', 'schedule_at', 'publish_at') || '').trim()
  const metaTitle = String(primaryTarget?.meta_title || getPayloadValue(payload, 'meta_title', 'title') || job?.topic || '').trim()
  const metaDescription = String(primaryTarget?.meta_description || getPayloadValue(payload, 'meta_description', 'description') || '').trim()

  const requiresImage = ['content_pipeline', 'social_post', 'landing_page', 'blog_post'].includes(contentType || 'content_pipeline')
  const requiresAudio = ['podcast', 'voiceover', 'narration'].includes(contentType)
  const requiresVideo = ['video', 'short_video', 'youtube', 'reel'].includes(contentType)

  const validations = [
    {
      rule_key: 'job.topic.present',
      severity: 'error',
      status: job?.topic?.trim() ? 'pass' : 'fail',
      message: job?.topic?.trim() ? 'Topic present' : 'Topic is required.',
      field_ref: 'topic',
    },
    {
      rule_key: 'cta.url.present',
      severity: 'error',
      status: ctaUrl ? 'pass' : 'fail',
      message: ctaUrl ? 'CTA URL present' : 'CTA URL is required before publish.',
      field_ref: 'input_payload.cta_url',
    },
    {
      rule_key: 'cta.label.present',
      severity: 'warning',
      status: ctaLabel ? 'pass' : 'fail',
      message: ctaLabel ? 'CTA label present' : 'CTA label is missing.',
      field_ref: 'input_payload.cta_label',
    },
    {
      rule_key: 'job.platform.present',
      severity: 'error',
      status: platform ? 'pass' : 'fail',
      message: platform ? 'Platform selected' : 'Publishing platform is required.',
      field_ref: 'input_payload.platform',
    },
    {
      rule_key: 'meta.title.present',
      severity: 'warning',
      status: metaTitle ? 'pass' : 'fail',
      message: metaTitle ? 'Meta title present' : 'Meta title is missing.',
      field_ref: 'input_payload.meta_title',
    },
    {
      rule_key: 'meta.description.present',
      severity: 'warning',
      status: metaDescription ? 'pass' : 'fail',
      message: metaDescription ? 'Meta description present' : 'Meta description is missing.',
      field_ref: 'input_payload.meta_description',
    },
    {
      rule_key: 'schedule.datetime.present',
      severity: 'error',
      status: scheduledAt ? 'pass' : 'fail',
      message: scheduledAt ? 'Schedule set' : 'Schedule date is required.',
      field_ref: 'input_payload.scheduled_at',
    },
    {
      rule_key: 'asset.primary_image.present',
      severity: requiresImage ? 'error' : 'info',
      status: requiresImage ? (hasAssetOfType(assets, 'image', 'thumbnail') ? 'pass' : 'fail') : 'skipped',
      message: requiresImage
        ? (hasAssetOfType(assets, 'image', 'thumbnail') ? 'Primary image present' : 'Primary image is missing.')
        : 'Image not required for this content type.',
      field_ref: 'assets.image',
    },
    {
      rule_key: 'asset.audio.present',
      severity: requiresAudio ? 'error' : 'info',
      status: requiresAudio ? (hasAssetOfType(assets, 'audio') ? 'pass' : 'fail') : 'skipped',
      message: requiresAudio
        ? (hasAssetOfType(assets, 'audio') ? 'Audio present' : 'Audio asset is missing.')
        : 'Audio not required for this content type.',
      field_ref: 'assets.audio',
    },
    {
      rule_key: 'asset.video.present',
      severity: requiresVideo ? 'error' : 'info',
      status: requiresVideo ? (hasAssetOfType(assets, 'video') ? 'pass' : 'fail') : 'skipped',
      message: requiresVideo
        ? (hasAssetOfType(assets, 'video') ? 'Video present' : 'Video asset is missing.')
        : 'Video not required for this content type.',
      field_ref: 'assets.video',
    },
    {
      rule_key: 'review.approved',
      severity: 'warning',
      status: reviewThread?.current_status === 'approved' ? 'pass' : reviewThread?.current_status === 'rejected' ? 'fail' : 'skipped',
      message: reviewThread?.current_status === 'approved'
        ? 'Review approved'
        : reviewThread?.current_status === 'rejected'
          ? 'Review has been rejected.'
          : 'Approval not completed yet.',
      field_ref: 'review_threads.current_status',
    },
    {
      rule_key: 'run.latest.available',
      severity: 'warning',
      status: latestRun ? 'pass' : 'fail',
      message: latestRun ? 'Run history available' : 'No execution run recorded yet.',
      field_ref: 'job_runs',
    },
  ]

  return validations
}

export function summarizeValidations(validations) {
  const errors = validations.filter(item => item.status === 'fail' && item.severity === 'error')
  const warnings = validations.filter(item => item.status === 'fail' && item.severity === 'warning')
  return {
    ready: errors.length === 0,
    error_count: errors.length,
    warning_count: warnings.length,
    blocking_rules: errors.map(item => item.rule_key),
    checklist: {
      cta: validations.find(item => item.rule_key === 'cta.url.present')?.status === 'pass',
      featured_image: validations.find(item => item.rule_key === 'asset.primary_image.present')?.status === 'pass',
      seo_title: validations.find(item => item.rule_key === 'meta.title.present')?.status === 'pass',
      meta_description: validations.find(item => item.rule_key === 'meta.description.present')?.status === 'pass',
      target_platform: validations.find(item => item.rule_key === 'job.platform.present')?.status === 'pass',
      schedule: validations.find(item => item.rule_key === 'schedule.datetime.present')?.status === 'pass',
      approval: validations.find(item => item.rule_key === 'review.approved')?.status === 'pass',
    },
  }
}

export async function loadValidationContext(orgId, jobId) {
  const [{ data: job }, { data: assets }, { data: reviewThread }, publishTargets] = await Promise.all([
    supabase.from('jobs').select('*, brands(*)').eq('id', jobId).eq('org_id', orgId).single(),
    supabase.from('assets').select('*').eq('job_id', jobId).eq('org_id', orgId).order('created_at', { ascending: false }),
    supabase.from('review_threads').select('*').eq('job_id', jobId).eq('org_id', orgId).maybeSingle(),
    getPublishTargetsForJob(orgId, jobId),
  ])

  let latestRun = null
  if (job?.id) {
    const { data } = await supabase
      .from('job_runs')
      .select('*')
      .eq('job_id', job.id)
      .order('run_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    latestRun = data
  }

  return {
    job,
    brand: job?.brands || null,
    latestRun,
    assets: assets || [],
    reviewThread: reviewThread || null,
    publishTargets,
  }
}

export async function getJobValidationState(orgId, jobId) {
  const context = await loadValidationContext(orgId, jobId)
  const validations = computeJobValidations(context)
  return {
    validations,
    summary: summarizeValidations(validations),
  }
}

export async function persistJobValidationState(orgId, jobId) {
  const state = await getJobValidationState(orgId, jobId)
  const { job } = await loadValidationContext(orgId, jobId)
  if (!job) return state

  await supabase.from('job_validations').delete().eq('org_id', orgId).eq('job_id', jobId)
  if (state.validations.length) {
    const rows = state.validations.map(item => ({
      job_id: jobId,
      job_run_id: job.latest_run_id || null,
      org_id: orgId,
      brand_id: job.brand_id || null,
      rule_key: item.rule_key,
      severity: item.severity,
      status: item.status,
      message: item.message,
      field_ref: item.field_ref || null,
      metadata: item.metadata || {},
    }))
    const { error } = await supabase.from('job_validations').insert(rows)
    if (error) throw error
  }
  return state
}
