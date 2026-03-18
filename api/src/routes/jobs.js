import { Router } from 'express'
import { z } from 'zod'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { assertCanRunJob, guardJobLimit, incrementJobUsage } from '../middleware/planGuard.js'
import { supabase } from '../db/supabase.js'
import { cancelRun, dispatchRun, dispatchTask } from '../lib/pipelineDispatch.js'
import { enrichJobQueueState } from '../services/queueIntelligence.js'
import { getJobValidationState, persistJobValidationState } from '../services/validations.js'
import { getPublishTargetsForJob, upsertPublishTargetFromJob } from '../services/publishTargets.js'
import { buildReadinessChecklist, computeSlaState, deriveDueDate } from '../services/operationalTrust.js'
import { createJobSnapshot, listJobSnapshots } from '../services/snapshots.js'
import { createNotification } from '../services/notifications.js'
import { acquireEntityLock, getEntityLock, releaseEntityLock } from '../services/locks.js'
import { recordActivity } from '../services/activityLog.js'
import { buildDispatchFingerprint, evaluateRetryPolicy } from '../services/publishRecovery.js'

const router = Router()

const createJobSchema = z.object({
  topic: z.string().trim().min(1, 'topic is required'),
  keywords: z.array(z.string().trim()).optional(),
  aspect_ratio: z.string().trim().optional(),
  brand_id: z.string().uuid().optional().or(z.null()).optional(),
  input_payload: z.record(z.any()).optional(),
})

function handleZodError(res, error) {
  const flattened = error.flatten()
  return res.status(400).json({
    error: 'validation_failed',
    details: flattened.fieldErrors,
  })
}

function enrichOperationalFields(job, queue, reviewThread = null) {
  return {
    owner_user_id: job.owner_user_id || null,
    review_assignee_user_id: job.review_assignee_user_id || reviewThread?.assignee_user_id || null,
    publish_assignee_user_id: job.publish_assignee_user_id || null,
    waiting_on: job.waiting_on || reviewThread?.waiting_on || null,
    due_at: deriveDueDate(job, reviewThread),
    overdue: queue?.overdue || false,
    sla_state: computeSlaState(job, queue, reviewThread),
  }
}

async function createJobOperationalNotification(req, job, notificationType, title, body, severity = 'info', metadata = {}) {
  return createNotification({
    org_id: req.org.id,
    brand_id: job.brand_id || null,
    user_id: job.owner_user_id || job.review_assignee_user_id || job.publish_assignee_user_id || null,
    entity_type: 'job',
    entity_id: job.id,
    notification_type: notificationType,
    title,
    body,
    severity,
    metadata,
  })
}

async function getLatestRun(jobId) {
  const { data } = await supabase
    .from('job_runs')
    .select('*')
    .eq('job_id', jobId)
    .order('run_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

async function getLatestPublishAttempt(orgId, jobId, publishTargetId = null, platform = null) {
  let query = supabase
    .from('publish_attempts')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('submitted_at', { ascending: false })
    .limit(1)

  if (publishTargetId) query = query.eq('publish_target_id', publishTargetId)
  if (!publishTargetId && platform) query = query.eq('platform', platform)

  const { data } = await query.maybeSingle()
  return data || null
}

router.post('/', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), guardJobLimit, async (req, res) => {
  const parsed = (() => {
    try {
      return createJobSchema.parse(req.body)
    } catch (error) {
      if (error instanceof z.ZodError) return handleZodError(res, error)
      throw error
    }
  })()
  if (!parsed || parsed === res) return

  const {
    topic,
    keywords = [],
    aspect_ratio = '16:9',
    brand_id = null,
    input_payload = {},
  } = parsed

  if (brand_id) {
    const { data: brand } = await supabase.from('brands').select('id').eq('id', brand_id).eq('org_id', req.org.id).maybeSingle()
    if (!brand) return res.status(404).json({ error: 'Brand not found' })
  }

  const now = new Date().toISOString()
  const { data: rpcData, error: rpcError } = await supabase.rpc('create_job_with_run', {
    p_org_id: req.org.id,
    p_brand_id: brand_id,
    p_topic: topic.trim(),
    p_keywords: keywords,
    p_aspect_ratio: aspect_ratio,
    p_input_payload: input_payload ?? {},
    p_submitted_by: req.userId,
    p_owner_user_id: req.userId,
  })

  if (rpcError) throw rpcError
  const job = rpcData?.job
  const run = rpcData?.run
  if (!job?.id || !run?.id) throw new Error('Failed to create job run')

  await Promise.all([
    supabase.from('review_threads').upsert({
      job_id: job.id,
      org_id: req.org.id,
      brand_id,
      current_status: 'pending',
    }, { onConflict: 'job_id' }),
    supabase.from('job_events').insert({
      job_id: job.id,
      job_run_id: run.id,
      org_id: req.org.id,
      brand_id,
      event_type: 'job.created',
      to_status: 'queued',
      message: 'Job created',
      actor_type: 'user',
      actor_id: req.userId,
      metadata: { topic: topic.trim(), aspect_ratio },
    }),
  ])

  await incrementJobUsage(req.org.id)

  try {
    const dispatched = await dispatchRun({
      job,
      run,
      topic: topic.trim(),
      keywords,
      aspect_ratio,
      workspace_id: req.org.id,
      brand_id,
      input_payload,
    })

    await Promise.all([
      supabase.from('job_runs').update({
        status: 'running',
        python_pipeline_id: dispatched.pipeline_id || null,
        started_at: now,
        updated_at: now,
      }).eq('id', run.id),
      supabase.from('jobs').update({
        status: 'running',
        pipeline_id: dispatched.pipeline_id || null,
        updated_at: now,
      }).eq('id', job.id),
    ])

    return res.status(201).json({
      ok: true,
      job: { ...job, status: 'running', latest_run_id: run.id, pipeline_id: dispatched.pipeline_id || null },
      run: { ...run, status: 'running', python_pipeline_id: dispatched.pipeline_id || null },
    })
  } catch (error) {
    await Promise.all([
      supabase.from('job_runs').update({ status: 'failed', error_message: error.message, completed_at: now, updated_at: now }).eq('id', run.id),
      supabase.from('jobs').update({ status: 'failed', error_msg: error.message, updated_at: now }).eq('id', job.id),
    ])
    return res.status(201).json({
      ok: true,
      job: { ...job, status: 'failed', error_msg: error.message, latest_run_id: run.id },
      run: { ...run, status: 'failed', error_message: error.message },
    })
  }
})

router.get('/', requireAuth, attachOrg, async (req, res) => {
  const { page = 1, limit = 20, cursor, status, brand_id, search, date_from, date_to, approval_state, queue_state } = req.query
  const pageLimit = Math.min(Number(limit), 100)

  let query = supabase
    .from('jobs')
    .select('*, brands(id, name)', { count: 'exact' })
    .eq('org_id', req.org.id)
    .order('created_at', { ascending: false })
    .limit(pageLimit)

  if (cursor) {
    query = query.lt('created_at', cursor)
  } else {
    const offset = (Number(page) - 1) * pageLimit
    query = query.range(offset, offset + pageLimit - 1)
  }

  if (status) query = query.eq('status', status)
  if (brand_id) query = query.eq('brand_id', brand_id)
  if (search) query = query.ilike('topic', `%${search}%`)
  if (date_from) query = query.gte('created_at', date_from)
  if (date_to) query = query.lte('created_at', date_to)

  const { data: jobs, count, error } = await query
  if (error) throw error

  const [runs, reviews] = jobs?.length
    ? await Promise.all([
        supabase.from('job_runs').select('*').in('job_id', jobs.map(job => job.id)).order('run_number', { ascending: false }),
        supabase.from('review_threads').select('*').in('job_id', jobs.map(job => job.id)),
      ])
    : [{ data: [] }, { data: [] }]

  const latestRuns = new Map()
  for (const run of runs.data || []) {
    if (!latestRuns.has(run.job_id)) latestRuns.set(run.job_id, run)
  }
  const reviewMap = new Map((reviews.data || []).map(item => [item.job_id, item]))

  const enriched = []
  for (const job of jobs || []) {
    const queue = await enrichJobQueueState(req.org.id, job, latestRuns.get(job.id) || null, reviewMap.get(job.id) || null)
    enriched.push({
      ...job,
      latest_run: latestRuns.get(job.id) || null,
      review_thread: reviewMap.get(job.id) || null,
      queue_state: queue.queue_state,
      blocked_reasons: queue.blocked_reasons,
      next_action: queue.next_action,
      validation_summary: queue.validation_summary,
      readiness_checklist: queue.readiness_checklist,
      ...enrichOperationalFields(job, queue, reviewMap.get(job.id) || null),
    })
  }

  const filtered = enriched.filter(job => {
    if (approval_state && job.review_thread?.current_status !== approval_state) return false
    if (queue_state && job.queue_state !== queue_state) return false
    if (req.query.platform) {
      const targetPlatform = String(job.input_payload?.platform || '').toLowerCase()
      if (targetPlatform !== String(req.query.platform).toLowerCase()) return false
    }
    if (req.query.content_type) {
      const contentType = String(job.input_payload?.content_type || job.job_type || '').toLowerCase()
      if (contentType !== String(req.query.content_type).toLowerCase()) return false
    }
    if (req.query.schedule_state) {
      const scheduleState = String(job.input_payload?.scheduled_at ? 'scheduled' : 'unscheduled')
      if (scheduleState !== String(req.query.schedule_state)) return false
    }
    if (req.query.sla_state && job.sla_state !== req.query.sla_state) return false
    if (req.query.assignee && ![job.owner_user_id, job.review_assignee_user_id, job.publish_assignee_user_id].includes(req.query.assignee)) return false
    if (String(req.query.overdue || '') === 'true' && !job.overdue) return false
    return true
  })

  const next_cursor = filtered.length === pageLimit
    ? (filtered[filtered.length - 1]?.created_at ?? null)
    : null

  res.json({
    ok: true,
    jobs: filtered,
    total: filtered.length || (count ?? 0),
    page: Number(page),
    limit: pageLimit,
    next_cursor,
  })
})

router.get('/:id', requireAuth, attachOrg, async (req, res) => {
  const { data: job, error } = await supabase
    .from('jobs')
    .select('*, brands(id, name), review_threads(*)')
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .single()

  if (error || !job) return res.status(404).json({ error: 'Job not found' })

  const [runs, events, assets, actions, comments, attempts] = await Promise.all([
    supabase.from('job_runs').select('*, job_steps(*)').eq('job_id', job.id).order('run_number', { ascending: false }),
    supabase.from('job_events').select('*').eq('job_id', job.id).order('created_at', { ascending: true }),
    supabase.from('assets').select('*').eq('job_id', job.id).order('created_at', { ascending: false }),
    supabase.from('review_actions').select('*').eq('job_id', job.id).order('created_at', { ascending: true }),
    supabase.from('review_comments').select('*').eq('job_id', job.id).order('created_at', { ascending: true }),
    supabase.from('publish_attempts').select('*').eq('job_id', job.id).order('submitted_at', { ascending: false }).limit(25),
  ])
  const publish_targets = await getPublishTargetsForJob(req.org.id, job.id)
  const validationState = await getJobValidationState(req.org.id, job.id)
  const queueState = await enrichJobQueueState(req.org.id, job, (runs.data || [])[0] || null, (job.review_threads || [])[0] || null)
  const snapshots = await listJobSnapshots(req.org.id, job.id)
  const lock = await getEntityLock(req.org.id, 'job', job.id)

  res.json({
    ok: true,
    job,
    runs: runs.data || [],
    events: events.data || [],
    assets: assets.data || [],
    publish_attempts: attempts.data || [],
    publish_targets,
    validations: validationState.validations,
    validation_summary: validationState.summary,
    queue: queueState,
    readiness_checklist: buildReadinessChecklist(validationState, (job.review_threads || [])[0] || null),
    snapshots,
    lock,
    review: {
      actions: actions.data || [],
      comments: comments.data || [],
    },
  })
})

router.post('/:id/retry', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), guardJobLimit, async (req, res) => {
  const { data: job, error } = await supabase.from('jobs').select('*').eq('id', req.params.id).eq('org_id', req.org.id).single()
  if (error || !job) return res.status(404).json({ error: 'Job not found' })
  try {
    await assertCanRunJob(req.org, job)
  } catch (limitError) {
    if (limitError?.payload) return res.status(limitError.status || 402).json(limitError.payload)
    throw limitError
  }

  const latestRun = await getLatestRun(job.id)
  if (!latestRun || !['failed', 'canceled'].includes(latestRun.status)) {
    return res.status(400).json({ error: 'Only failed or canceled jobs can be retried' })
  }

  const runNumber = (latestRun.run_number || 1) + 1
  const now = new Date().toISOString()
  const { data: run, error: runError } = await supabase
    .from('job_runs')
    .insert({
      job_id: job.id,
      org_id: req.org.id,
      brand_id: job.brand_id,
      run_number: runNumber,
      triggered_by: req.userId,
      trigger_type: 'manual_retry',
      status: 'retrying',
      retry_count: (latestRun.retry_count || 0) + 1,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()

  if (runError) throw runError

  await Promise.all([
    createJobSnapshot(req.org.id, job, 'before_retry', req.userId),
    supabase.from('jobs').update({
      status: 'retrying',
      retry_count: (job.retry_count || 0) + 1,
      waiting_on: 'content_generation',
      latest_run_id: run.id,
      updated_at: now,
    }).eq('id', job.id),
    supabase.from('job_events').insert({
      job_id: job.id,
      job_run_id: run.id,
      org_id: req.org.id,
      brand_id: job.brand_id,
      event_type: 'job.retried',
      from_status: latestRun.status,
      to_status: 'retrying',
      message: 'Manual retry requested',
      actor_type: 'user',
      actor_id: req.userId,
    }),
  ])
  await recordActivity({
    org_id: req.org.id,
    brand_id: job.brand_id || null,
    entity_type: 'job',
    entity_id: job.id,
    action: 'job.retried',
    actor_type: 'user',
    actor_id: req.userId,
    summary: `Job retried: ${job.topic}`,
    metadata: { run_number: runNumber },
  })

  await incrementJobUsage(req.org.id)

  try {
    const dispatched = await dispatchRun({
      job,
      run,
      topic: job.topic,
      keywords: job.keywords || [],
      aspect_ratio: job.aspect_ratio || '16:9',
      workspace_id: req.org.id,
      brand_id: job.brand_id,
    })
    await Promise.all([
      supabase.from('job_runs').update({ status: 'running', python_pipeline_id: dispatched.pipeline_id || null, started_at: now, updated_at: now }).eq('id', run.id),
      supabase.from('jobs').update({ status: 'running', pipeline_id: dispatched.pipeline_id || null, updated_at: now }).eq('id', job.id),
    ])
    res.json({ ok: true, run: { ...run, status: 'running', python_pipeline_id: dispatched.pipeline_id || null } })
  } catch (dispatchError) {
    await Promise.all([
      supabase.from('job_runs').update({ status: 'failed', error_message: dispatchError.message, completed_at: now, updated_at: now }).eq('id', run.id),
      supabase.from('jobs').update({ status: 'failed', error_msg: dispatchError.message, updated_at: now }).eq('id', job.id),
    ])
    res.status(500).json({ error: dispatchError.message })
  }
})

router.get('/:id/validations', requireAuth, attachOrg, async (req, res) => {
  const { data: job, error } = await supabase.from('jobs').select('id').eq('id', req.params.id).eq('org_id', req.org.id).single()
  if (error || !job) return res.status(404).json({ error: 'Job not found' })
  const state = await persistJobValidationState(req.org.id, job.id)
  res.json({ ok: true, ...state })
})

router.post('/:id/publish-check', requireAuth, attachOrg, async (req, res) => {
  const { data: job, error } = await supabase.from('jobs').select('*').eq('id', req.params.id).eq('org_id', req.org.id).single()
  if (error || !job) return res.status(404).json({ error: 'Job not found' })
  await upsertPublishTargetFromJob(job, req.userId)
  const validationState = await persistJobValidationState(req.org.id, job.id)
  const reviewResp = await supabase.from('review_threads').select('*').eq('job_id', job.id).eq('org_id', req.org.id).maybeSingle()
  const queueState = await enrichJobQueueState(req.org.id, job, null, reviewResp.data || null)
  if (!validationState.summary.ready) {
    await createJobOperationalNotification(
      req,
      job,
      'job_blocked',
      `Job blocked: ${job.topic}`,
      'Publish check found blocking readiness issues.',
      'warning',
      { blocking_rules: validationState.summary.blocking_rules },
    )
  }
  res.json({
    ok: true,
    ready: validationState.summary.ready,
    blocking_errors: validationState.validations.filter(item => item.status === 'fail' && item.severity === 'error'),
    warnings: validationState.validations.filter(item => item.status === 'fail' && item.severity === 'warning'),
    queue: queueState,
  })
})

router.post('/:id/publish', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const { data: job, error } = await supabase.from('jobs').select('*').eq('id', req.params.id).eq('org_id', req.org.id).single()
  if (error || !job) return res.status(404).json({ error: 'Job not found' })

  await createJobSnapshot(req.org.id, job, 'before_publish', req.userId)
  await upsertPublishTargetFromJob(job, req.userId)

  const validationState = await persistJobValidationState(req.org.id, job.id)
  const blocking = validationState.validations.filter(item => item.status === 'fail' && item.severity === 'error')
  if (blocking.length) {
    await createJobOperationalNotification(
      req,
      job,
      'publish_blocked',
      `Publish blocked for ${job.topic}`,
      'Fix the readiness checklist before publishing.',
      'warning',
      { blocking_rules: blocking.map(item => item.rule_key) },
    )
    await supabase.from('job_events').insert({
      job_id: job.id,
      job_run_id: job.latest_run_id || null,
      org_id: req.org.id,
      brand_id: job.brand_id,
      event_type: 'publish.blocked',
      to_status: job.status,
      message: 'Publish blocked by validation errors',
      metadata: { blocking_rules: blocking.map(item => item.rule_key) },
      actor_type: 'user',
      actor_id: req.userId,
    })
    return res.status(409).json({
      error: 'Publish blocked by validation errors',
      blocking_errors: blocking,
    })
  }

  const retryMode = String(req.body?.retry_mode || 'safe')
  const forceRecovery = Boolean(req.body?.force_recovery)
  const allowRepublish = Boolean(req.body?.allow_republish)
  const now = new Date().toISOString()
  const inputPayload = job.input_payload && typeof job.input_payload === 'object' ? job.input_payload : {}
  const publishTargets = await getPublishTargetsForJob(req.org.id, job.id)
  const primaryTarget = publishTargets[0]
  const { data: brand } = job.brand_id
    ? await supabase.from('brands').select('*').eq('id', job.brand_id).eq('org_id', req.org.id).maybeSingle()
    : { data: null }
  const { data: assets } = await supabase.from('assets').select('*').eq('job_id', job.id).eq('org_id', req.org.id).order('created_at', { ascending: false })
  const latestRunId = job.latest_run_id || null
  const latestRunSteps = latestRunId
    ? await supabase.from('job_steps').select('*').eq('job_run_id', latestRunId)
    : { data: [] }
  const stepOutputs = Object.fromEntries((latestRunSteps.data || []).map(step => [step.step_key, step.output_payload || {}]))

  const latestAssetPath = (type) => (assets?.find(asset => asset.type === type)?.local_path || '').trim()
  const blogFilepath = String(stepOutputs.blog?.filepath || inputPayload.blog_filepath || '').trim()
  const imageFilepath = String(latestAssetPath('image') || stepOutputs.image?.filepath || inputPayload.image_filepath || '').trim()
  const videoFilepath = String(latestAssetPath('video') || stepOutputs.video?.filepath || inputPayload.video_filepath || '').trim()
  const audioFilepath = String(latestAssetPath('audio') || stepOutputs.audio?.filepath || inputPayload.audio_filepath || '').trim()

  const platform = String(primaryTarget?.platform || inputPayload.platform || '').trim().toLowerCase()
  const contentType = String(primaryTarget?.content_type || inputPayload.content_type || job.job_type || '').trim()
  const dispatchFingerprint = buildDispatchFingerprint({
    job_id: job.id,
    revision_number: job.current_revision_number || 1,
    platform,
    content_type: contentType,
    blog_filepath: blogFilepath || null,
    image_filepath: imageFilepath || null,
    video_filepath: videoFilepath || null,
    audio_filepath: audioFilepath || null,
    cta_url: primaryTarget?.cta_url || inputPayload.cta_url || brand?.cta_default_url || null,
    title: primaryTarget?.meta_title || inputPayload.meta_title || job.topic,
    description: primaryTarget?.meta_description || inputPayload.meta_description || null,
  })

  const latestAttempt = await getLatestPublishAttempt(
    req.org.id,
    job.id,
    primaryTarget?.id || null,
    platform || primaryTarget?.platform || null,
  )
  const policy = evaluateRetryPolicy({
    latestAttempt,
    retryMode,
    forceRecovery,
    allowRepublish,
    maxSafeRetries: Number(process.env.PUBLISH_SAFE_RETRY_LIMIT || 3),
  })

  if (latestAttempt && ['submitted', 'accepted'].includes(String(latestAttempt.status || '').toLowerCase())) {
    const previousFingerprint = String(latestAttempt?.metadata?.dispatch_fingerprint || '')
    const isDuplicatePayload = previousFingerprint && previousFingerprint === dispatchFingerprint
    return res.status(409).json({
      error: isDuplicatePayload
        ? 'Publish already in progress for this content payload'
        : 'A publish attempt is already awaiting provider confirmation',
      recovery: {
        reason: 'in_flight_attempt_exists',
        latest_attempt_id: latestAttempt.id,
        latest_attempt_status: latestAttempt.status,
        duplicate_payload: isDuplicatePayload,
      },
    })
  }

  if (!policy.allowed) {
    return res.status(409).json({
      error: 'Publish retry blocked by recovery policy',
      recovery: {
        reason: policy.reason,
        mode: policy.mode,
        classification: policy.classification,
        latest_attempt_id: latestAttempt?.id || null,
        latest_attempt_status: latestAttempt?.status || null,
      },
    })
  }

  const updatedPayload = {
    ...inputPayload,
    publish_requested_at: now,
    publish_requested_by: req.userId,
    publish_retry_mode: policy.mode,
    publish_recovery_reason: policy.reason,
    publish_retry_of_attempt_id: latestAttempt?.id || null,
  }

  if (platform === 'wordpress' && !blogFilepath) {
    return res.status(409).json({
      error: 'Publish blocked: missing blog content file for WordPress publish',
      blocking_errors: [{ rule_key: 'asset.blog.present', message: 'Blog content file is missing.' }],
    })
  }
  if (platform !== 'wordpress' && !videoFilepath) {
    return res.status(409).json({
      error: 'Publish blocked: missing video asset for platform publish',
      blocking_errors: [{ rule_key: 'asset.video.present', message: 'Video asset is missing.' }],
    })
  }

  let dispatch = null
  let publishAttempt = null
  if (platform === 'wordpress') {
    dispatch = await dispatchTask({
      type: 'post_content',
      agent_hint: 'distribution_agent',
      payload: {
        topic: job.topic,
        title: primaryTarget?.meta_title || updatedPayload.meta_title || job.topic,
        meta_description: primaryTarget?.meta_description || updatedPayload.meta_description || '',
        excerpt: primaryTarget?.meta_description || updatedPayload.meta_description || '',
        blog_filepath: blogFilepath,
        image_filepath: imageFilepath,
        focus_keyword: updatedPayload.focus_keyword || '',
        category: updatedPayload.category || 'AI Content',
        tags: updatedPayload.tags || [],
        calendar_entry_id: updatedPayload.calendar_entry_id || null,
        job_id: job.id,
        workspace_id: req.org.id,
        brand_id: job.brand_id,
        stage_name: 'manual_publish',
      },
    })
  } else {
    dispatch = await dispatchTask({
      type: 'video_publish',
      agent_hint: 'distribution_agent',
      payload: {
        topic: job.topic,
        title: primaryTarget?.meta_title || updatedPayload.meta_title || job.topic,
        excerpt: primaryTarget?.meta_description || updatedPayload.meta_description || '',
        description: primaryTarget?.meta_description || updatedPayload.meta_description || '',
        post_url: primaryTarget?.cta_url || updatedPayload.cta_url || brand?.cta_default_url || '',
        tags: updatedPayload.tags || [],
        aspect_ratio: updatedPayload.aspect_ratio || job.aspect_ratio || '16:9',
        video_filepath: videoFilepath,
        audio_filepath: audioFilepath,
        publish_targets: platform ? [platform] : ['youtube'],
        approval_granted: true,
        job_id: job.id,
        workspace_id: req.org.id,
        brand_id: job.brand_id,
        stage_name: 'manual_publish',
      },
    })
  }

  if (primaryTarget) {
    const retryCount = Number(latestAttempt?.metadata?.retry_count || 0) + (latestAttempt ? 1 : 0)
    const attemptResp = await supabase
      .from('publish_attempts')
      .insert({
        job_id: job.id,
        publish_target_id: primaryTarget.id,
        org_id: req.org.id,
        brand_id: job.brand_id || null,
        platform: platform || primaryTarget.platform,
        status: 'submitted',
        metadata: {
          dispatch,
          dispatch_fingerprint: dispatchFingerprint,
          retry_mode: policy.mode,
          retry_count: retryCount,
          recovery: latestAttempt
            ? {
                retry_of_attempt_id: latestAttempt.id,
                reason: policy.reason,
                classification: policy.classification || null,
              }
            : null,
        },
        message: latestAttempt ? `Recovery retry from attempt ${latestAttempt.id}` : 'Publish request submitted',
        created_by: req.userId,
      })
      .select()
      .single()
    if (attemptResp.error) throw attemptResp.error
    publishAttempt = attemptResp.data
  }

  const [{ data: updatedJob, error: updateError }] = await Promise.all([
    supabase.from('jobs').update({
      status: 'running',
      waiting_on: 'provider_publish_confirmation',
      publish_assignee_user_id: job.publish_assignee_user_id || req.userId,
      input_payload: updatedPayload,
      updated_at: now,
    }).eq('id', job.id).eq('org_id', req.org.id).select().single(),
    primaryTarget
      ? supabase.from('publish_targets').update({
          status: 'ready',
          schedule_state: primaryTarget.scheduled_at ? 'scheduled' : 'unscheduled',
          publish_result_status: 'submitted',
          last_submitted_at: now,
          publish_attempt_count: (primaryTarget.publish_attempt_count || 0) + 1,
          assignee_user_id: primaryTarget.assignee_user_id || job.publish_assignee_user_id || req.userId,
          waiting_on: 'provider_confirmation',
        }).eq('id', primaryTarget.id)
      : Promise.resolve(),
    supabase.from('job_events').insert({
      job_id: job.id,
      job_run_id: job.latest_run_id || null,
      org_id: req.org.id,
      brand_id: job.brand_id,
      event_type: 'publish.requested',
      to_status: 'running',
      message: latestAttempt ? 'Publish recovery retry accepted' : 'Publish request accepted',
      metadata: {
        requested_at: now,
        dispatch,
        retry_mode: policy.mode,
        recovery_reason: policy.reason,
        retry_of_attempt_id: latestAttempt?.id || null,
      },
      actor_type: 'user',
      actor_id: req.userId,
    }),
  ])

  if (updateError) throw updateError
  await Promise.all([
    createJobOperationalNotification(
      req,
      job,
      'publish_submitted',
      `Publish submitted for ${job.topic}`,
      latestAttempt ? 'Recovery publish retry submitted to provider.' : 'Awaiting provider confirmation.',
      'info',
      {
        platform,
        publish_attempt_id: publishAttempt?.id || null,
        retry_of_attempt_id: latestAttempt?.id || null,
      },
    ),
    recordActivity({
      org_id: req.org.id,
      brand_id: job.brand_id || null,
      entity_type: 'job',
      entity_id: job.id,
      action: latestAttempt ? 'publish.retried' : 'publish.submitted',
      actor_type: 'user',
      actor_id: req.userId,
      summary: latestAttempt ? `Publish retried: ${job.topic}` : `Publish submitted: ${job.topic}`,
      metadata: {
        platform,
        publish_attempt_id: publishAttempt?.id || null,
        retry_of_attempt_id: latestAttempt?.id || null,
        retry_mode: policy.mode,
      },
    }),
  ])
  res.json({
    ok: true,
    job: updatedJob,
    message: latestAttempt ? 'Recovery publish retry accepted and dispatched.' : 'Publish request accepted and dispatched.',
    dispatch,
    recovery: {
      retry_mode: policy.mode,
      reason: policy.reason,
      classification: policy.classification,
      retry_of_attempt_id: latestAttempt?.id || null,
    },
  })
})

router.post('/:id/cancel', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const { data: job, error } = await supabase.from('jobs').select('*').eq('id', req.params.id).eq('org_id', req.org.id).single()
  if (error || !job) return res.status(404).json({ error: 'Job not found' })

  const latestRun = await getLatestRun(job.id)
  if (!latestRun || !['queued', 'running', 'retrying'].includes(latestRun.status)) {
    return res.status(400).json({ error: 'Only queued, running, or retrying jobs can be canceled' })
  }

  const now = new Date().toISOString()
  await Promise.all([
    supabase.from('job_runs').update({ status: 'canceled', completed_at: now, updated_at: now }).eq('id', latestRun.id),
    supabase.from('jobs').update({ status: 'canceled', waiting_on: null, updated_at: now }).eq('id', job.id),
    supabase.from('job_events').insert({
      job_id: job.id,
      job_run_id: latestRun.id,
      org_id: req.org.id,
      brand_id: job.brand_id,
      event_type: 'job.canceled',
      from_status: latestRun.status,
      to_status: 'canceled',
      message: 'Canceled by user',
      actor_type: 'user',
      actor_id: req.userId,
    }),
  ])

  await cancelRun(job)

  res.json({ ok: true, status: 'canceled' })
})

router.post('/:id/assign', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const { owner_user_id = null, review_assignee_user_id = null, publish_assignee_user_id = null, waiting_on = null } = req.body
  const now = new Date().toISOString()
  const { data: job, error } = await supabase
    .from('jobs')
    .update({ owner_user_id, review_assignee_user_id, publish_assignee_user_id, waiting_on, updated_at: now })
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()
  if (error || !job) return res.status(404).json({ error: 'Job not found' })

  await Promise.all([
    supabase.from('review_threads').update({ assignee_user_id: review_assignee_user_id, waiting_on: waiting_on || null, updated_at: now }).eq('job_id', job.id).eq('org_id', req.org.id),
    supabase.from('publish_targets').update({ assignee_user_id: publish_assignee_user_id, waiting_on: waiting_on || null, updated_at: now }).eq('job_id', job.id).eq('org_id', req.org.id),
    recordActivity({
      org_id: req.org.id,
      brand_id: job.brand_id || null,
      entity_type: 'job',
      entity_id: job.id,
      action: 'job.assigned',
      actor_type: 'user',
      actor_id: req.userId,
      summary: `Assignments updated for ${job.topic}`,
      metadata: { owner_user_id, review_assignee_user_id, publish_assignee_user_id, waiting_on },
    }),
  ])
  res.json({ ok: true, job })
})

router.post('/:id/deadlines', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const updates = {
    review_due_at: req.body.review_due_at || null,
    publish_due_at: req.body.publish_due_at || null,
    revision_due_at: req.body.revision_due_at || null,
    updated_at: new Date().toISOString(),
  }
  const { data: job, error } = await supabase
    .from('jobs')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()
  if (error || !job) return res.status(404).json({ error: 'Job not found' })
  await supabase.from('review_threads').update({ due_at: updates.review_due_at, updated_at: updates.updated_at }).eq('job_id', job.id).eq('org_id', req.org.id)
  res.json({ ok: true, job })
})

router.get('/:id/snapshots', requireAuth, attachOrg, async (req, res) => {
  const items = await listJobSnapshots(req.org.id, req.params.id)
  res.json({ ok: true, items })
})

router.post('/:id/lock', requireAuth, attachOrg, async (req, res) => {
  const item = await acquireEntityLock(req.org.id, 'job', req.params.id, req.userId, req.body.reason || 'editing_job', req.body.ttl_minutes || 15, req.body.metadata || {})
  res.json({ ok: true, item })
})

router.delete('/:id/lock', requireAuth, attachOrg, async (req, res) => {
  await releaseEntityLock(req.org.id, 'job', req.params.id, req.userId)
  res.json({ ok: true })
})

router.post('/bulk', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const { job_ids = [], action, owner_user_id = null, scheduled_at = null } = req.body
  if (!Array.isArray(job_ids) || !job_ids.length) return res.status(400).json({ error: 'job_ids is required' })
  if (!action) return res.status(400).json({ error: 'action is required' })

  if (action === 'assign') {
    const { error } = await supabase.from('jobs').update({ owner_user_id, updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('id', job_ids)
    if (error) throw error
    return res.json({ ok: true, updated: job_ids.length })
  }

  if (action === 'schedule') {
    const { error } = await supabase.from('publish_targets').update({ scheduled_at, schedule_state: scheduled_at ? 'scheduled' : 'unscheduled' }).eq('org_id', req.org.id).in('job_id', job_ids)
    if (error) throw error
    return res.json({ ok: true, updated: job_ids.length })
  }

  if (action === 'archive') {
    const { error } = await supabase.from('jobs').update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('id', job_ids)
    if (error) throw error
    return res.json({ ok: true, updated: job_ids.length })
  }

  if (action === 'approve') {
    const { error } = await supabase.from('review_threads').update({ current_status: 'approved', updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('job_id', job_ids)
    if (error) throw error
    await supabase.from('jobs').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('id', job_ids)
    return res.json({ ok: true, updated: job_ids.length })
  }

  if (action === 'retry') {
    const { error } = await supabase.from('jobs').update({ status: 'retrying', updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('id', job_ids)
    if (error) throw error
    return res.json({ ok: true, updated: job_ids.length })
  }

  return res.status(400).json({ error: 'Unsupported bulk action' })
})

export default router
