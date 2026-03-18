import { Router } from 'express'
import { supabase } from '../db/supabase.js'
import { createNotification } from '../services/notifications.js'
import { recordActivity } from '../services/activityLog.js'
import { normalizePublishProviderResult } from '../services/publishRecovery.js'
import { getPlanLimit, isUnlimited } from '../lib/planConfig.js'
import { getUsageSummary } from '../services/usageSummary.js'

const router = Router()
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN || 'autonomous-prime-internal'

router.use((req, res, next) => {
  const token = req.headers['x-internal-token']
  if (token !== INTERNAL_TOKEN) return res.status(401).json({ error: 'Invalid internal token' })
  next()
})

router.post('/jobs/:jobId/runs/:runId/status', async (req, res) => {
  const { status, message = '', python_pipeline_id = null, error_code = null, error_message = null } = req.body
  const now = new Date().toISOString()

  const [{ error: runError }, { error: jobError }] = await Promise.all([
    supabase.from('job_runs').update({
      status,
      python_pipeline_id,
      error_code,
      error_message,
      started_at: status === 'running' ? now : undefined,
      completed_at: ['completed', 'failed', 'canceled'].includes(status) ? now : undefined,
      updated_at: now,
    }).eq('id', req.params.runId).eq('job_id', req.params.jobId),
    supabase.from('jobs').update({
      status: status === 'completed' ? 'awaiting_review' : status,
      pipeline_id: python_pipeline_id,
      latest_run_id: req.params.runId,
      error_msg: error_message,
      updated_at: now,
    }).eq('id', req.params.jobId),
  ])

  const { data: run } = await supabase.from('job_runs').select('org_id, brand_id').eq('id', req.params.runId).single()
  if (run?.org_id) {
    await supabase.from('job_events').insert({
      job_id: req.params.jobId,
      job_run_id: req.params.runId,
      org_id: run.org_id,
      brand_id: run.brand_id,
      event_type: 'run.status',
      to_status: status,
      message,
      metadata: req.body,
      actor_type: 'worker',
    })
  }

  if (runError) throw runError
  if (jobError) throw jobError
  res.json({ ok: true })
})

router.post('/jobs/:jobId/runs/:runId/steps', async (req, res) => {
  const { step_key, provider = null, status, input_payload = {}, output_payload = {}, error_message = null } = req.body
  if (!step_key?.trim()) return res.status(400).json({ error: 'step_key is required' })

  const { data: run, error: runError } = await supabase
    .from('job_runs')
    .select('id, org_id, brand_id')
    .eq('id', req.params.runId)
    .eq('job_id', req.params.jobId)
    .single()

  if (runError || !run) return res.status(404).json({ error: 'Run not found' })

  const now = new Date().toISOString()
  const { data: step, error } = await supabase
    .from('job_steps')
    .upsert({
      job_run_id: run.id,
      step_key: step_key.trim(),
      provider,
      status,
      input_payload,
      output_payload,
      error_message,
      started_at: status === 'running' ? now : undefined,
      completed_at: ['completed', 'failed', 'skipped', 'canceled'].includes(status) ? now : undefined,
      updated_at: now,
    }, { onConflict: 'job_run_id,step_key' })
    .select()
    .single()

  if (error) throw error

  await supabase.from('job_events').insert({
    job_id: req.params.jobId,
    job_run_id: run.id,
    org_id: run.org_id,
    brand_id: run.brand_id,
    event_type: 'step.status',
    to_status: status,
    message: step_key.trim(),
    metadata: req.body,
    actor_type: 'worker',
  })

  res.json({ ok: true, step })
})

router.post('/jobs/:jobId/runs/:runId/assets', async (req, res) => {
  const { type, provider = null, storage_url = null, local_path = null, metadata = {} } = req.body
  const { data: run, error: runError } = await supabase
    .from('job_runs')
    .select('id, org_id, brand_id')
    .eq('id', req.params.runId)
    .eq('job_id', req.params.jobId)
    .single()

  if (runError || !run) return res.status(404).json({ error: 'Run not found' })

  const { data: asset, error } = await supabase
    .from('assets')
    .insert({
      job_id: req.params.jobId,
      job_run_id: run.id,
      org_id: run.org_id,
      brand_id: run.brand_id,
      type,
      provider,
      storage_url,
      local_path,
      metadata,
    })
    .select()
    .single()

  if (error) throw error
  res.json({ ok: true, asset })
})

router.post('/assets/upsert', async (req, res) => {
  const { org_id, job_id, job_run_id = null, brand_id = null, type, provider = null, storage_url = null, local_path = null, metadata = {} } = req.body
  if (!org_id || !job_id || !type) return res.status(400).json({ error: 'org_id, job_id, and type are required' })

  const { data, error } = await supabase
    .from('assets')
    .insert({
      org_id,
      job_id,
      job_run_id,
      brand_id,
      type,
      provider,
      storage_url,
      local_path,
      metadata,
    })
    .select()
    .single()
  if (error) throw error
  res.json({ ok: true, asset: data })
})

router.post('/jobs/:jobId/queue-state', async (req, res) => {
  const {
    job_run_id = null,
    queue_state,
    blocked_reasons = [],
    next_action = null,
    ready_for_publish = false,
    latest_run_status = null,
    review_status = null,
    validation_summary = {},
  } = req.body

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, org_id, brand_id')
    .eq('id', req.params.jobId)
    .single()

  if (jobError || !job) return res.status(404).json({ error: 'Job not found' })

  const payload = {
    job_id: job.id,
    org_id: job.org_id,
    brand_id: job.brand_id,
    queue_state,
    blocked_reasons,
    next_action,
    ready_for_publish,
    latest_run_status,
    review_status,
    validation_summary,
  }

  const { data, error } = await supabase
    .from('queue_snapshots')
    .upsert(payload, { onConflict: 'job_id' })
    .select()
    .single()
  if (error) throw error

  await supabase.from('jobs').update({
    waiting_on: blocked_reasons?.length ? next_action || queue_state : null,
    sla_state: queue_state === 'blocked' ? 'blocked' : undefined,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id)

  await supabase.from('job_events').insert({
    job_id: job.id,
    job_run_id,
    org_id: job.org_id,
    brand_id: job.brand_id,
    event_type: 'queue.state',
    to_status: queue_state,
    message: next_action || queue_state,
    metadata: req.body,
    actor_type: 'worker',
  })

  if ((blocked_reasons || []).length) {
    await createNotification({
      org_id: job.org_id,
      brand_id: job.brand_id,
      entity_type: 'job',
      entity_id: job.id,
      notification_type: 'job_blocked',
      title: 'Job blocked',
      body: next_action || queue_state,
      severity: 'warning',
      metadata: { blocked_reasons },
    })
  }

  res.json({ ok: true, snapshot: data })
})

router.post('/jobs/:jobId/publish-result', async (req, res) => {
  const { platforms = null, wordpress = null } = req.body
  const now = new Date().toISOString()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, org_id, brand_id')
    .eq('id', req.params.jobId)
    .single()

  if (jobError || !job) return res.status(404).json({ error: 'Job not found' })

  const normalizedResults = []
  if (wordpress && typeof wordpress === 'object') {
    normalizedResults.push(normalizePublishProviderResult({ ...wordpress, platform: 'wordpress' }, 'wordpress'))
  }
  if (platforms && typeof platforms === 'object') {
    for (const [platform, rawResult] of Object.entries(platforms)) {
      normalizedResults.push(normalizePublishProviderResult({ ...(rawResult || {}), platform }, platform))
    }
  }
  if (!normalizedResults.length) {
    return res.status(400).json({ error: 'No provider publish results were supplied' })
  }

  const { data: targetRows, error: targetError } = await supabase
    .from('publish_targets')
    .select('*')
    .eq('job_id', job.id)
  if (targetError) throw targetError

  const targetByPlatform = new Map((targetRows || []).map(target => [String(target.platform || '').toLowerCase(), target]))
  const targetIds = (targetRows || []).map(target => target.id)
  const { data: attemptRows } = targetIds.length
    ? await supabase
        .from('publish_attempts')
        .select('*')
        .eq('job_id', job.id)
        .in('publish_target_id', targetIds)
        .order('submitted_at', { ascending: false })
    : { data: [] }
  const latestAttemptByTarget = new Map()
  for (const row of attemptRows || []) {
    if (!latestAttemptByTarget.has(row.publish_target_id)) latestAttemptByTarget.set(row.publish_target_id, row)
  }

  let finalState = 'published'
  let replayCount = 0
  let processedCount = 0

  for (const result of normalizedResults) {
    const platform = String(result.platform || '').toLowerCase()
    if (!platform) continue
    const target = targetByPlatform.get(platform)
    if (!target) continue
    processedCount += 1

    const publishResultStatus = result.status === 'published' ? 'published' : result.status === 'failed' ? 'failed' : 'partial'
    const targetStatus = publishResultStatus === 'published' ? 'published' : publishResultStatus === 'failed' ? 'failed' : 'blocked'

    const { error: targetUpdateError } = await supabase
      .from('publish_targets')
      .update({
        status: targetStatus,
        schedule_state: publishResultStatus === 'published' ? 'published' : 'scheduled',
        publish_result_status: publishResultStatus,
        provider_response_id: result.provider_response_id || null,
        provider_post_url: result.provider_post_url || null,
        last_confirmed_at: now,
        last_error_message: publishResultStatus === 'failed' ? result.message : null,
        published_at: publishResultStatus === 'published' ? now : null,
      })
      .eq('id', target.id)
    if (targetUpdateError) throw targetUpdateError

    const latestAttempt = latestAttemptByTarget.get(target.id) || null
    const replayedCallback = Boolean(
      latestAttempt
      && String(latestAttempt.status || '').toLowerCase() === publishResultStatus
      && String(latestAttempt.provider_response_id || '') === String(result.provider_response_id || '')
      && String(latestAttempt.provider_post_url || '') === String(result.provider_post_url || ''),
    )

    if (replayedCallback) {
      replayCount += 1
      const { error: replayError } = await supabase
        .from('publish_attempts')
        .update({
          message: result.message || latestAttempt.message,
          metadata: {
            ...(latestAttempt.metadata || {}),
            callback_replay_count: Number(latestAttempt?.metadata?.callback_replay_count || 0) + 1,
            last_callback_at: now,
            last_callback_payload: result.raw || {},
          },
        })
        .eq('id', latestAttempt.id)
      if (replayError) throw replayError
    } else if (latestAttempt && ['submitted', 'accepted', 'partial'].includes(String(latestAttempt.status || '').toLowerCase())) {
      const { error: lifecycleUpdateError } = await supabase
        .from('publish_attempts')
        .update({
          status: publishResultStatus,
          provider_response_id: result.provider_response_id || null,
          provider_post_url: result.provider_post_url || null,
          accepted_at: publishResultStatus === 'partial' ? (latestAttempt.accepted_at || now) : latestAttempt.accepted_at || null,
          published_at: publishResultStatus === 'published' ? now : null,
          failed_at: publishResultStatus === 'failed' ? now : null,
          message: result.message,
          metadata: {
            ...(latestAttempt.metadata || {}),
            callback_status: result.raw_status || null,
            callback_payload: result.raw || {},
            failure_classification: result.classification || null,
            last_callback_at: now,
          },
        })
        .eq('id', latestAttempt.id)
      if (lifecycleUpdateError) throw lifecycleUpdateError
    } else {
      const { error: createAttemptError } = await supabase.from('publish_attempts').insert({
        job_id: job.id,
        publish_target_id: target.id,
        org_id: job.org_id,
        brand_id: job.brand_id,
        platform: target.platform,
        status: publishResultStatus,
        provider_response_id: result.provider_response_id || null,
        provider_post_url: result.provider_post_url || null,
        accepted_at: publishResultStatus === 'partial' ? now : null,
        published_at: publishResultStatus === 'published' ? now : null,
        failed_at: publishResultStatus === 'failed' ? now : null,
        message: result.message || 'Publish result recorded',
        metadata: {
          source: 'provider_callback',
          callback_status: result.raw_status || null,
          callback_payload: result.raw || {},
          failure_classification: result.classification || null,
        },
      })
      if (createAttemptError) throw createAttemptError
    }

    if (publishResultStatus === 'failed') finalState = 'failed'
    else if (publishResultStatus !== 'published' && finalState !== 'failed') finalState = 'partial'
  }

  if (!processedCount) {
    return res.status(409).json({ error: 'No matching publish targets found for provider results' })
  }

  await supabase.from('jobs').update({
    status: finalState === 'published' ? 'completed' : finalState === 'failed' ? 'failed' : 'running',
    waiting_on: finalState === 'published' ? null : 'provider_publish_confirmation',
    published_at: finalState === 'published' ? now : null,
    updated_at: now,
  }).eq('id', job.id)

  await supabase.from('job_events').insert({
    job_id: job.id,
    job_run_id: null,
    org_id: job.org_id,
    brand_id: job.brand_id,
    event_type: 'publish.result',
    to_status: finalState,
    message: replayCount ? 'Publish result recorded (with replayed callbacks deduped)' : 'Publish result recorded',
    metadata: {
      ...req.body,
      normalized_results: normalizedResults.map(item => ({
        platform: item.platform,
        status: item.status,
        raw_status: item.raw_status,
        provider_response_id: item.provider_response_id,
        provider_post_url: item.provider_post_url,
        classification: item.classification,
      })),
      callback_replay_count: replayCount,
    },
    actor_type: 'worker',
  })

  await Promise.all([
    recordActivity({
      org_id: job.org_id,
      brand_id: job.brand_id,
      entity_type: 'job',
      entity_id: job.id,
      action: `publish.${finalState}`,
      actor_type: 'worker',
      summary: replayCount
        ? `Publish ${finalState} for job ${job.id} (deduped ${replayCount} replay callbacks)`
        : `Publish ${finalState} for job ${job.id}`,
      metadata: req.body,
    }),
    createNotification({
      org_id: job.org_id,
      brand_id: job.brand_id,
      entity_type: 'job',
      entity_id: job.id,
      notification_type: finalState === 'published' ? 'publish_published' : finalState === 'failed' ? 'publish_failed' : 'publish_partial',
      title: finalState === 'published' ? 'Content published' : finalState === 'failed' ? 'Publish failed' : 'Publish partially completed',
      body: replayCount ? 'Provider result recorded. Duplicate callback events were deduped.' : 'Provider result recorded.',
      severity: finalState === 'published' ? 'success' : finalState === 'failed' ? 'error' : 'warning',
      metadata: { ...req.body, callback_replay_count: replayCount },
    }),
  ])

  res.json({ ok: true, status: finalState, callback_replay_count: replayCount })
})

// ── Email sequence creation (called by funnel agent) ─────────────────────────

// POST /saas/internal/email-sequences
router.post('/email-sequences', async (req, res) => {
  const { org_id, name, description, trigger_type = 'new_subscriber', status = 'active', steps = [] } = req.body
  if (!org_id || !name?.trim()) return res.status(400).json({ error: 'org_id and name are required' })

  const { data: seq, error: seqError } = await supabase
    .from('email_sequences')
    .insert({ org_id, name: name.trim(), description, trigger_type, status })
    .select()
    .single()
  if (seqError) throw seqError

  if (Array.isArray(steps) && steps.length) {
    const stepRows = steps.map((step, i) => ({
      sequence_id: seq.id,
      org_id,
      step_number: i + 1,
      subject: step.subject || `Email ${i + 1}`,
      body_html: step.body_html || '',
      body_plain: step.body_plain || '',
      delay_days: parseInt(step.delay_days ?? step.send_day ?? i * 2) || 0,
      is_active: true,
    }))
    const { error: stepsError } = await supabase.from('email_steps').insert(stepRows)
    if (stepsError) throw stepsError
  }

  res.status(201).json({ ok: true, sequence: seq, step_count: steps.length })
})

// ── Funnel opt-in: create subscriber + enroll in sequence ────────────────────

// POST /saas/internal/opt-in
router.post('/opt-in', async (req, res) => {
  const { email, name, org_id, sequence_id } = req.body
  if (!email?.trim() || !org_id) return res.status(400).json({ error: 'email and org_id are required' })

  // Upsert subscriber
  const { data: existing } = await supabase
    .from('email_subscribers')
    .select('id, status')
    .eq('org_id', org_id)
    .eq('email', email.trim().toLowerCase())
    .single()

  let subscriberId
  if (existing) {
    subscriberId = existing.id
    // Re-activate if unsubscribed
    if (existing.status === 'unsubscribed') {
      await supabase.from('email_subscribers').update({ status: 'active' }).eq('id', existing.id)
    }
  } else {
    const nameParts = (name || '').trim().split(/\s+/)
    const { data: created, error } = await supabase
      .from('email_subscribers')
      .insert({
        org_id,
        email: email.trim().toLowerCase(),
        first_name: nameParts[0] || '',
        last_name: nameParts.slice(1).join(' ') || '',
        source: 'landing_page',
        status: 'active',
      })
      .select('id')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    subscriberId = created.id
  }

  // Enroll in sequence if provided
  if (sequence_id && subscriberId) {
    try {
      const { enrollSubscriber } = await import('../services/emailScheduler.js')
      await enrollSubscriber({ orgId: org_id, subscriberId, sequenceId: sequence_id })
    } catch (err) {
      // Ignore duplicate enrollment errors
    }
  }

  res.json({ ok: true, subscriber_id: subscriberId })
})

// TTS credit check — called by Python voice agent before synthesizing
router.get('/orgs/:orgId/tts-check', async (req, res) => {
  const { orgId } = req.params

  const { data: org, error } = await supabase
    .from('orgs')
    .select('id, plan_tier')
    .eq('id', orgId)
    .single()

  if (error || !org) {
    // Fail open — no org found or Supabase not configured
    return res.json({ allowed: true, minutes_used: 0, minutes_limit: -1, reason: 'org_not_found' })
  }

  const limit = getPlanLimit(org.plan_tier, 'voice_minutes')

  if (isUnlimited(limit)) {
    return res.json({ allowed: true, minutes_used: 0, minutes_limit: -1 })
  }

  if (limit === 0) {
    return res.json({ allowed: false, minutes_used: 0, minutes_limit: 0, reason: 'plan_not_included' })
  }

  const summary = await getUsageSummary(org)
  const minutesUsed = summary.voice_minutes_used
  const allowed = minutesUsed < limit

  return res.json({
    allowed,
    minutes_used: minutesUsed,
    minutes_limit: limit,
    minutes_remaining: Math.max(0, limit - minutesUsed),
    reason: allowed ? null : 'credits_exhausted',
  })
})

export default router
