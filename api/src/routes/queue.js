import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { enrichJobQueueState } from '../services/queueIntelligence.js'

const router = Router()

router.get('/', requireAuth, attachOrg, async (req, res) => {
  const { brand_id = '', queue_state = '', search = '' } = req.query

  let query = supabase
    .from('jobs')
    .select('*, brands(id, name)')
    .eq('org_id', req.org.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (brand_id) query = query.eq('brand_id', brand_id)
  if (search) query = query.ilike('topic', `%${search}%`)

  const { data: jobs, error } = await query
  if (error) throw error

  const [runs, reviews] = await Promise.all([
    jobs?.length ? supabase.from('job_runs').select('*').in('job_id', jobs.map(item => item.id)).order('run_number', { ascending: false }) : { data: [] },
    jobs?.length ? supabase.from('review_threads').select('*').in('job_id', jobs.map(item => item.id)) : { data: [] },
  ])

  const latestRuns = new Map()
  for (const run of runs.data || []) {
    if (!latestRuns.has(run.job_id)) latestRuns.set(run.job_id, run)
  }
  const reviewMap = new Map((reviews.data || []).map(item => [item.job_id, item]))

  const items = []
  for (const job of jobs || []) {
    const queue = await enrichJobQueueState(req.org.id, job, latestRuns.get(job.id) || null, reviewMap.get(job.id) || null)
    items.push({
      ...job,
      latest_run: latestRuns.get(job.id) || null,
      review_thread: reviewMap.get(job.id) || null,
      ...queue,
    })
  }

  const filtered = queue_state ? items.filter(item => item.queue_state === queue_state) : items
  res.json({ ok: true, items: filtered })
})

router.get('/summary', requireAuth, attachOrg, async (req, res) => {
  const { data: jobs } = await supabase.from('jobs').select('id').eq('org_id', req.org.id).limit(100)
  const summary = {
    ready: 0,
    running: 0,
    blocked: 0,
    failed: 0,
    awaiting_approval: 0,
    missing_assets: 0,
    missing_cta: 0,
    missing_schedule: 0,
    completed: 0,
    canceled: 0,
  }

  for (const job of jobs || []) {
    const [jobRow, run, review] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', job.id).single(),
      supabase.from('job_runs').select('*').eq('job_id', job.id).order('run_number', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('review_threads').select('*').eq('job_id', job.id).maybeSingle(),
    ])
    const queue = await enrichJobQueueState(req.org.id, jobRow.data, run.data || null, review.data || null)
    summary[queue.queue_state] = (summary[queue.queue_state] || 0) + 1
  }

  res.json({ ok: true, summary })
})

router.post('/bulk', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const { job_ids = [], action, waiting_on = null } = req.body
  if (!Array.isArray(job_ids) || !job_ids.length) return res.status(400).json({ error: 'job_ids is required' })

  if (action === 'mark_blocked') {
    await supabase.from('jobs').update({ waiting_on: waiting_on || 'manual_block', sla_state: 'blocked', updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('id', job_ids)
    return res.json({ ok: true, updated: job_ids.length })
  }
  if (action === 'mark_ready') {
    await supabase.from('jobs').update({ waiting_on: null, sla_state: 'on_track', updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('id', job_ids)
    return res.json({ ok: true, updated: job_ids.length })
  }
  if (action === 'assign_owner') {
    await supabase.from('jobs').update({ owner_user_id: req.body.owner_user_id || null, updated_at: new Date().toISOString() }).eq('org_id', req.org.id).in('id', job_ids)
    return res.json({ ok: true, updated: job_ids.length })
  }
  return res.status(400).json({ error: 'Unsupported queue bulk action' })
})

export default router
