import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { dispatchRun } from '../lib/pipelineDispatch.js'
import { assertCanRunJob, incrementJobUsage } from '../middleware/planGuard.js'
import { createNotification } from '../services/notifications.js'
import { recordActivity } from '../services/activityLog.js'
import { acquireEntityLock, getEntityLock, releaseEntityLock } from '../services/locks.js'
import { createJobSnapshot } from '../services/snapshots.js'

const router = Router()

async function getThreadForJob(jobId, orgId) {
  const { data } = await supabase
    .from('review_threads')
    .select('*')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  return data
}

async function ensureThread(job, orgId) {
  const existing = await getThreadForJob(job.id, orgId)
  if (existing) return existing
  const { data, error } = await supabase
    .from('review_threads')
    .insert({ job_id: job.id, org_id: orgId, brand_id: job.brand_id, current_status: 'pending' })
    .select()
    .single()
  if (error) throw error
  return data
}

router.get('/', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const { data, error } = await supabase
    .from('review_threads')
    .select('*, jobs(id, topic, status, created_at, brand_id), review_actions(id, action, note, created_by, created_at), review_comments(id, body, created_by, created_at)')
    .eq('org_id', req.org.id)
    .order('updated_at', { ascending: false })

  if (error) throw error
  res.json({ ok: true, threads: data || [] })
})

router.get('/jobs/:jobId', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const thread = await getThreadForJob(req.params.jobId, req.org.id)
  if (!thread) return res.status(404).json({ error: 'Review thread not found' })

  const [{ data: actions }, { data: comments }] = await Promise.all([
    supabase.from('review_actions').select('*').eq('thread_id', thread.id).order('created_at', { ascending: true }),
    supabase.from('review_comments').select('*').eq('thread_id', thread.id).order('created_at', { ascending: true }),
  ])

  res.json({ ok: true, thread, actions: actions || [], comments: comments || [] })
})

router.post('/jobs/:jobId/assign', requireAuth, attachOrg, requireRole(['owner', 'admin', 'reviewer']), async (req, res) => {
  const { assignee_user_id = null, due_at = null, waiting_on = null } = req.body
  const { data: job } = await supabase.from('jobs').select('id, brand_id, topic').eq('id', req.params.jobId).eq('org_id', req.org.id).single()
  if (!job) return res.status(404).json({ error: 'Job not found' })

  const thread = await ensureThread(job, req.org.id)
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('review_threads')
    .update({ assignee_user_id, due_at, waiting_on, updated_at: now })
    .eq('id', thread.id)
    .select()
    .single()
  if (error) throw error

  await Promise.all([
    supabase.from('jobs').update({ review_assignee_user_id: assignee_user_id, review_due_at: due_at, waiting_on, updated_at: now }).eq('id', job.id),
    recordActivity({
      org_id: req.org.id,
      brand_id: job.brand_id || null,
      entity_type: 'review',
      entity_id: job.id,
      action: 'review.assigned',
      actor_type: 'user',
      actor_id: req.userId,
      summary: `Review assigned for ${job.topic}`,
      metadata: { assignee_user_id, due_at, waiting_on },
    }),
  ])
  res.json({ ok: true, thread: data })
})

router.post('/jobs/:jobId/lock', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const item = await acquireEntityLock(req.org.id, 'review', req.params.jobId, req.userId, req.body.reason || 'reviewing', req.body.ttl_minutes || 15, req.body.metadata || {})
  res.json({ ok: true, item })
})

router.get('/jobs/:jobId/lock', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const item = await getEntityLock(req.org.id, 'review', req.params.jobId)
  res.json({ ok: true, item })
})

router.delete('/jobs/:jobId/lock', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  await releaseEntityLock(req.org.id, 'review', req.params.jobId, req.userId)
  res.json({ ok: true })
})

router.post('/jobs/:jobId/comment', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const { body, anchor_type = null, anchor_ref = null, job_run_id = null, parent_comment_id = null } = req.body
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' })

  const { data: job } = await supabase.from('jobs').select('id, brand_id').eq('id', req.params.jobId).eq('org_id', req.org.id).single()
  if (!job) return res.status(404).json({ error: 'Job not found' })

  const thread = await ensureThread(job, req.org.id)
  const [{ data: comment, error: commentError }, { error: actionError }] = await Promise.all([
    supabase.from('review_comments').insert({
      thread_id: thread.id,
      job_id: job.id,
      job_run_id,
      parent_comment_id,
      body: body.trim(),
      anchor_type,
      anchor_ref,
      created_by: req.userId,
    }).select().single(),
    supabase.from('review_actions').insert({
      thread_id: thread.id,
      job_id: job.id,
      action: 'comment',
      note: body.trim(),
      created_by: req.userId,
    }),
  ])

  if (commentError) throw commentError
  if (actionError) throw actionError
  res.status(201).json({ ok: true, comment })
})

async function recordDecision(req, res, action, jobStatus, threadStatus) {
  const { note = '' } = req.body
  const { data: job } = await supabase.from('jobs').select('*').eq('id', req.params.jobId).eq('org_id', req.org.id).single()
  if (!job) return res.status(404).json({ error: 'Job not found' })

  const thread = await ensureThread(job, req.org.id)
  const now = new Date().toISOString()
  const [{ error: actionError }, { error: threadError }, { error: jobError }] = await Promise.all([
    supabase.from('review_actions').insert({
      thread_id: thread.id,
      job_id: job.id,
      revision_number: job.current_revision_number ?? 1,
      action,
      note,
      created_by: req.userId,
    }),
    supabase.from('review_threads').update({ current_status: threadStatus, updated_at: now }).eq('id', thread.id),
    supabase.from('jobs').update({ status: jobStatus, updated_at: now }).eq('id', job.id),
  ])

  if (actionError) throw actionError
  if (threadError) throw threadError
  if (jobError) throw jobError
  await Promise.all([
    recordActivity({
      org_id: req.org.id,
      brand_id: job.brand_id || null,
      entity_type: 'review',
      entity_id: job.id,
      action: `review.${action}`,
      actor_type: 'user',
      actor_id: req.userId,
      summary: `${action} review for ${job.topic}`,
      metadata: { thread_status: threadStatus },
    }),
    createNotification({
      org_id: req.org.id,
      brand_id: job.brand_id || null,
      user_id: job.submitted_by || null,
      entity_type: 'review',
      entity_id: job.id,
      notification_type: action === 'approve' ? 'review_approved' : 'review_rejected',
      title: `${job.topic} ${action === 'approve' ? 'approved' : 'rejected'}`,
      body: note || `Review marked ${threadStatus}.`,
      severity: action === 'approve' ? 'success' : 'warning',
    }),
  ])
  res.json({ ok: true, status: jobStatus })
}

router.post('/jobs/:jobId/approve', requireAuth, attachOrg, requireRole(['owner', 'admin', 'reviewer']), async (req, res) =>
  recordDecision(req, res, 'approve', 'approved', 'approved'))

router.post('/jobs/:jobId/reject', requireAuth, attachOrg, requireRole(['owner', 'admin', 'reviewer']), async (req, res) =>
  recordDecision(req, res, 'reject', 'rejected', 'rejected'))

router.post('/jobs/:jobId/request-revision', requireAuth, attachOrg, requireRole(['owner', 'admin', 'reviewer']), async (req, res) => {
  const { note = '' } = req.body
  const { data: job } = await supabase.from('jobs').select('*').eq('id', req.params.jobId).eq('org_id', req.org.id).single()
  if (!job) return res.status(404).json({ error: 'Job not found' })

  const thread = await ensureThread(job, req.org.id)
  const latestRunResp = await supabase
    .from('job_runs')
    .select('*')
    .eq('job_id', job.id)
    .order('run_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const latestRun = latestRunResp.data
  const runNumber = (latestRun?.run_number || 0) + 1
  const revisionNumber = (job.current_revision_number || 1) + 1
  const now = new Date().toISOString()

  const { data: run, error: runError } = await supabase
    .from('job_runs')
    .insert({
      job_id: job.id,
      org_id: req.org.id,
      brand_id: job.brand_id,
      run_number: runNumber,
      triggered_by: req.userId,
      trigger_type: 'revision',
      status: 'retrying',
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()

  if (runError) throw runError

  await createJobSnapshot(req.org.id, job, 'before_revision', req.userId)
  await Promise.all([
    supabase.from('review_actions').insert({
      thread_id: thread.id,
      job_id: job.id,
      revision_number: revisionNumber,
      action: 'request_revision',
      note,
      created_by: req.userId,
    }),
    supabase.from('review_threads').update({ current_status: 'revision_requested', updated_at: now }).eq('id', thread.id),
    supabase.from('jobs').update({
      status: 'revision_requested',
      current_revision_number: revisionNumber,
      waiting_on: 'revision',
      latest_run_id: run.id,
      updated_at: now,
    }).eq('id', job.id),
  ])
  await Promise.all([
    recordActivity({
      org_id: req.org.id,
      brand_id: job.brand_id || null,
      entity_type: 'review',
      entity_id: job.id,
      action: 'review.request_revision',
      actor_type: 'user',
      actor_id: req.userId,
      summary: `Revision requested for ${job.topic}`,
      metadata: { revision_number: revisionNumber },
    }),
    createNotification({
      org_id: req.org.id,
      brand_id: job.brand_id || null,
      user_id: job.submitted_by || job.owner_user_id || null,
      entity_type: 'review',
      entity_id: job.id,
      notification_type: 'revision_requested',
      title: `Revision requested for ${job.topic}`,
      body: note || 'A reviewer requested changes.',
      severity: 'warning',
    }),
  ])

  try {
    await assertCanRunJob(req.org, job)
  } catch (limitError) {
    if (limitError?.payload) return res.status(limitError.status || 402).json(limitError.payload)
    throw limitError
  }
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
  } catch (error) {
    await Promise.all([
      supabase.from('job_runs').update({ status: 'failed', error_message: error.message, completed_at: now, updated_at: now }).eq('id', run.id),
      supabase.from('jobs').update({ status: 'failed', error_msg: error.message, updated_at: now }).eq('id', job.id),
    ])
    return res.status(500).json({ error: error.message })
  }

  res.json({ ok: true, status: 'running', run_id: run.id })
})

router.post('/bulk', requireAuth, attachOrg, requireRole(['owner', 'admin', 'reviewer']), async (req, res) => {
  const { job_ids = [], action, assignee_user_id = null, due_at = null, waiting_on = null } = req.body
  if (!Array.isArray(job_ids) || !job_ids.length) return res.status(400).json({ error: 'job_ids is required' })

  if (action === 'assign') {
    await supabase.from('review_threads').update({ assignee_user_id, due_at, waiting_on, updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('job_id', job_ids)
    await supabase.from('jobs').update({ review_assignee_user_id: assignee_user_id, review_due_at: due_at, waiting_on, updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('id', job_ids)
    return res.json({ ok: true, updated: job_ids.length })
  }

  if (action === 'approve') {
    await supabase.from('review_threads').update({ current_status: 'approved', updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('job_id', job_ids)
    await supabase.from('jobs').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('id', job_ids)
    return res.json({ ok: true, updated: job_ids.length })
  }

  return res.status(400).json({ error: 'Unsupported review bulk action' })
})

export default router
