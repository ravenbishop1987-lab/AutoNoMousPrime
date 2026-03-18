/**
 * Email Sequences Routes
 * CRUD for sequences + steps, enrollment endpoint
 */

import { Router } from 'express'
import { requireAuth, attachOrg, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { enrollSubscriber } from '../services/emailScheduler.js'

const router = Router()
const RW = ['owner', 'admin', 'editor']

// ── Sequences CRUD ───────────────────────────────────────────────────────────

// GET /saas/email-sequences
router.get('/', requireAuth, attachOrg, async (req, res) => {
  const { data, error } = await supabase
    .from('email_sequences')
    .select('*, steps:email_steps(id, step_number, subject, delay_days, is_active)')
    .eq('org_id', req.org.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  res.json({ ok: true, sequences: data || [] })
})

// POST /saas/email-sequences
router.post('/', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const { name, description, trigger_type = 'manual', trigger_tag, status = 'active' } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
  const { data, error } = await supabase
    .from('email_sequences')
    .insert({ org_id: req.org.id, name: name.trim(), description, trigger_type, trigger_tag, status })
    .select()
    .single()
  if (error) throw error
  res.status(201).json({ ok: true, sequence: data })
})

// GET /saas/email-sequences/:id
router.get('/:id', requireAuth, attachOrg, async (req, res) => {
  const { data, error } = await supabase
    .from('email_sequences')
    .select('*, steps:email_steps(*)')
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .order('step_number', { referencedTable: 'email_steps', ascending: true })
    .single()
  if (error || !data) return res.status(404).json({ error: 'Sequence not found' })
  res.json({ ok: true, sequence: data })
})

// PATCH /saas/email-sequences/:id
router.patch('/:id', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const allowed = ['name', 'description', 'trigger_type', 'trigger_tag', 'status']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  const { data, error } = await supabase
    .from('email_sequences')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()
  if (error || !data) return res.status(404).json({ error: 'Sequence not found' })
  res.json({ ok: true, sequence: data })
})

// DELETE /saas/email-sequences/:id
router.delete('/:id', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { error } = await supabase
    .from('email_sequences')
    .delete()
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
  if (error) throw error
  res.json({ ok: true })
})

// ── Steps CRUD ───────────────────────────────────────────────────────────────

// POST /saas/email-sequences/:id/steps
router.post('/:id/steps', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const { subject, body_html, body_plain, delay_days = 0, is_active = true } = req.body
  if (!subject?.trim()) return res.status(400).json({ error: 'subject is required' })

  // Verify sequence belongs to org
  const { data: seq } = await supabase
    .from('email_sequences')
    .select('id')
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .maybeSingle()
  if (!seq) return res.status(404).json({ error: 'Sequence not found' })

  // Get next step number
  const { data: existing } = await supabase
    .from('email_steps')
    .select('step_number')
    .eq('sequence_id', req.params.id)
    .order('step_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const step_number = (existing?.step_number || 0) + 1

  const { data, error } = await supabase
    .from('email_steps')
    .insert({ sequence_id: req.params.id, org_id: req.org.id, step_number, subject, body_html: body_html || '', body_plain, delay_days: parseInt(delay_days), is_active })
    .select()
    .single()
  if (error) throw error
  res.status(201).json({ ok: true, step: data })
})

// PATCH /saas/email-sequences/:id/steps/:stepId
router.patch('/:id/steps/:stepId', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const allowed = ['subject', 'body_html', 'body_plain', 'delay_days', 'is_active', 'step_number']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  const { data, error } = await supabase
    .from('email_steps')
    .update(updates)
    .eq('id', req.params.stepId)
    .eq('sequence_id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()
  if (error || !data) return res.status(404).json({ error: 'Step not found' })
  res.json({ ok: true, step: data })
})

// DELETE /saas/email-sequences/:id/steps/:stepId
router.delete('/:id/steps/:stepId', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const { error } = await supabase
    .from('email_steps')
    .delete()
    .eq('id', req.params.stepId)
    .eq('sequence_id', req.params.id)
    .eq('org_id', req.org.id)
  if (error) throw error
  res.json({ ok: true })
})

// ── Enrollment ───────────────────────────────────────────────────────────────

// POST /saas/email-sequences/:id/enroll
router.post('/:id/enroll', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const { subscriber_ids } = req.body
  if (!Array.isArray(subscriber_ids) || !subscriber_ids.length) {
    return res.status(400).json({ error: 'subscriber_ids array required' })
  }

  const results = []
  for (const subscriberId of subscriber_ids) {
    try {
      const result = await enrollSubscriber({
        orgId: req.org.id,
        subscriberId,
        sequenceId: req.params.id,
      })
      results.push({ subscriberId, ok: true, enrollment: result.enrollment })
    } catch (err) {
      results.push({ subscriberId, ok: false, error: err.message })
    }
  }

  res.json({ ok: true, results })
})

// GET /saas/email-sequences/:id/enrollments
router.get('/:id/enrollments', requireAuth, attachOrg, async (req, res) => {
  const { data, error } = await supabase
    .from('email_enrollments')
    .select('*, subscriber:email_subscribers!subscriber_id(id, email, first_name, last_name, status)')
    .eq('sequence_id', req.params.id)
    .eq('org_id', req.org.id)
    .order('enrolled_at', { ascending: false })
    .limit(100)
  if (error) throw error
  res.json({ ok: true, enrollments: data || [] })
})

export default router
