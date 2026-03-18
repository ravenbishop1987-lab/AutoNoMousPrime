/**
 * Email Analytics Routes
 * Overview metrics, per-sequence breakdown, step drop-off
 */

import { Router } from 'express'
import { requireAuth, attachOrg } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'

const router = Router()

// GET /saas/email-analytics
// Overview: sent, opens, clicks, unsubs, active subscribers
router.get('/', requireAuth, attachOrg, async (req, res) => {
  const { from, to, sequence_id, tag } = req.query
  const orgId = req.org.id

  // Build date filter
  const dateFilter = (col) => {
    let f = {}
    if (from) f.gte = { [col]: from }
    if (to) f.lte = { [col]: to }
    return f
  }

  // Run queries in parallel
  const [
    sentResult,
    openResult,
    clickResult,
    unsubResult,
    activeSubsResult,
    enrollmentsResult,
    completedResult,
    sequencesResult,
  ] = await Promise.all([
    // Total sent
    supabase.from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'sent')
      .then(r => r.count || 0),

    // Opens
    supabase.from('email_tracking_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('event_type', 'open')
      .then(r => r.count || 0),

    // Clicks
    supabase.from('email_tracking_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('event_type', 'click')
      .then(r => r.count || 0),

    // Unsubscribes
    supabase.from('email_tracking_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('event_type', 'unsubscribe')
      .then(r => r.count || 0),

    // Active subscribers
    supabase.from('email_subscribers')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'active')
      .then(r => r.count || 0),

    // Total enrollments
    supabase.from('email_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .then(r => r.count || 0),

    // Completed enrollments
    supabase.from('email_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'completed')
      .then(r => r.count || 0),

    // Sequences list
    supabase.from('email_sequences')
      .select('id, name')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .then(r => r.data || []),
  ])

  const sent = sentResult
  const opens = openResult
  const clicks = clickResult
  const unsubs = unsubResult
  const openRate = sent > 0 ? Math.round((opens / sent) * 100) : 0
  const clickRate = sent > 0 ? Math.round((clicks / sent) * 100) : 0
  const unsubRate = sent > 0 ? Math.round((unsubs / sent) * 100) : 0
  const completionRate = enrollmentsResult > 0 ? Math.round((completedResult / enrollmentsResult) * 100) : 0

  res.json({
    ok: true,
    totals: {
      sent,
      opens,
      clicks,
      unsubs,
      open_rate: openRate,
      click_rate: clickRate,
      unsub_rate: unsubRate,
      active_subscribers: activeSubsResult,
      total_enrollments: enrollmentsResult,
      completed_enrollments: completedResult,
      completion_rate: completionRate,
    },
    sequences: sequencesResult,
  })
})

// GET /saas/email-analytics/sequences
// Per-sequence breakdown
router.get('/sequences', requireAuth, attachOrg, async (req, res) => {
  const orgId = req.org.id

  const { data: sequences } = await supabase
    .from('email_sequences')
    .select('id, name, trigger_type, status, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (!sequences?.length) return res.json({ ok: true, sequences: [] })

  // For each sequence, get metrics
  const results = await Promise.all(sequences.map(async (seq) => {
    const [sentR, openR, clickR, unsubR, enrollR, completedR] = await Promise.all([
      supabase.from('email_send_log').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('sequence_id', seq.id).eq('status', 'sent').then(r => r.count || 0),
      supabase.from('email_tracking_events').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('sequence_id', seq.id).eq('event_type', 'open').then(r => r.count || 0),
      supabase.from('email_tracking_events').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('sequence_id', seq.id).eq('event_type', 'click').then(r => r.count || 0),
      supabase.from('email_tracking_events').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('sequence_id', seq.id).eq('event_type', 'unsubscribe').then(r => r.count || 0),
      supabase.from('email_enrollments').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('sequence_id', seq.id).then(r => r.count || 0),
      supabase.from('email_enrollments').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('sequence_id', seq.id).eq('status', 'completed').then(r => r.count || 0),
    ])
    return {
      ...seq,
      sent: sentR,
      opens: openR,
      clicks: clickR,
      unsubs: unsubR,
      open_rate: sentR > 0 ? Math.round((openR / sentR) * 100) : 0,
      click_rate: sentR > 0 ? Math.round((clickR / sentR) * 100) : 0,
      unsub_rate: sentR > 0 ? Math.round((unsubR / sentR) * 100) : 0,
      total_enrolled: enrollR,
      completed: completedR,
      completion_rate: enrollR > 0 ? Math.round((completedR / enrollR) * 100) : 0,
    }
  }))

  res.json({ ok: true, sequences: results })
})

// GET /saas/email-analytics/step-dropoff/:sequenceId
// Per-step drop-off data
router.get('/step-dropoff/:sequenceId', requireAuth, attachOrg, async (req, res) => {
  const orgId = req.org.id
  const { sequenceId } = req.params

  const { data: steps } = await supabase
    .from('email_steps')
    .select('id, step_number, subject, delay_days')
    .eq('sequence_id', sequenceId)
    .eq('org_id', orgId)
    .order('step_number', { ascending: true })

  if (!steps?.length) return res.json({ ok: true, steps: [] })

  const results = await Promise.all(steps.map(async (step) => {
    const [sentR, openR, clickR] = await Promise.all([
      supabase.from('email_send_log').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('step_id', step.id).eq('status', 'sent').then(r => r.count || 0),
      supabase.from('email_tracking_events').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('step_id', step.id).eq('event_type', 'open').then(r => r.count || 0),
      supabase.from('email_tracking_events').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('step_id', step.id).eq('event_type', 'click').then(r => r.count || 0),
    ])
    return {
      step_number: step.step_number,
      subject: step.subject,
      delay_days: step.delay_days,
      sent: sentR,
      opens: openR,
      clicks: clickR,
      open_rate: sentR > 0 ? Math.round((openR / sentR) * 100) : 0,
      click_rate: sentR > 0 ? Math.round((clickR / sentR) * 100) : 0,
    }
  }))

  res.json({ ok: true, steps: results })
})

export default router
