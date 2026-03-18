/**
 * Email Subscribers Routes
 * CRUD for contacts, bulk import, tag management
 */

import { Router } from 'express'
import { requireAuth, attachOrg, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { enrollSubscriber } from '../services/emailScheduler.js'

const router = Router()
const RW = ['owner', 'admin', 'editor']

// GET /saas/email-subscribers
router.get('/', requireAuth, attachOrg, async (req, res) => {
  const { search, status, tag, sequence_id, page = 1, limit = 50 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  let query = supabase
    .from('email_subscribers')
    .select(`
      *,
      enrollments:email_enrollments(
        id, sequence_id, current_step, status, enrolled_at, last_sent_at,
        sequence:email_sequences!sequence_id(name)
      )
    `, { count: 'exact' })
    .eq('org_id', req.org.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1)

  if (search) {
    query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
  }
  if (status) query = query.eq('status', status)
  if (tag) query = query.contains('tags', [tag])

  const { data, count, error } = await query
  if (error) throw error
  res.json({ ok: true, subscribers: data || [], total: count || 0 })
})

// POST /saas/email-subscribers
router.post('/', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const { email, first_name, last_name, tags = [], source = 'manual', metadata = {} } = req.body
  if (!email?.trim()) return res.status(400).json({ error: 'email is required' })

  const { data, error } = await supabase
    .from('email_subscribers')
    .insert({ org_id: req.org.id, email: email.trim().toLowerCase(), first_name, last_name, tags, source, metadata })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email already exists' })
    throw error
  }
  res.status(201).json({ ok: true, subscriber: data })
})

// POST /saas/email-subscribers/bulk
router.post('/bulk', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const { subscribers } = req.body
  if (!Array.isArray(subscribers) || !subscribers.length) {
    return res.status(400).json({ error: 'subscribers array required' })
  }

  const rows = subscribers
    .filter(s => s.email?.trim())
    .map(s => ({
      org_id: req.org.id,
      email: s.email.trim().toLowerCase(),
      first_name: s.first_name || null,
      last_name: s.last_name || null,
      tags: s.tags || [],
      source: s.source || 'bulk_import',
      metadata: s.metadata || {},
    }))

  const { data, error } = await supabase
    .from('email_subscribers')
    .upsert(rows, { onConflict: 'org_id,email', ignoreDuplicates: false })
    .select('id, email')
  if (error) throw error
  res.json({ ok: true, imported: data?.length || 0, subscribers: data })
})

// GET /saas/email-subscribers/:id
router.get('/:id', requireAuth, attachOrg, async (req, res) => {
  const { data, error } = await supabase
    .from('email_subscribers')
    .select(`
      *,
      enrollments:email_enrollments(
        id, sequence_id, current_step, status, enrolled_at, last_sent_at, next_send_at,
        sequence:email_sequences!sequence_id(name)
      ),
      send_log:email_send_log(id, subject, status, sent_at, sequence_id)
    `)
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .single()
  if (error || !data) return res.status(404).json({ error: 'Subscriber not found' })
  res.json({ ok: true, subscriber: data })
})

// PATCH /saas/email-subscribers/:id
router.patch('/:id', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const allowed = ['first_name', 'last_name', 'tags', 'status', 'metadata', 'source']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  const { data, error } = await supabase
    .from('email_subscribers')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()
  if (error || !data) return res.status(404).json({ error: 'Subscriber not found' })
  res.json({ ok: true, subscriber: data })
})

// DELETE /saas/email-subscribers/:id
router.delete('/:id', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { error } = await supabase
    .from('email_subscribers')
    .delete()
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
  if (error) throw error
  res.json({ ok: true })
})

// POST /saas/email-subscribers/:id/enroll
router.post('/:id/enroll', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const { sequence_id } = req.body
  if (!sequence_id) return res.status(400).json({ error: 'sequence_id required' })
  try {
    const result = await enrollSubscriber({ orgId: req.org.id, subscriberId: req.params.id, sequenceId: sequence_id })
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// POST /saas/email-subscribers/:id/tags
router.post('/:id/tags', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const { tags } = req.body
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags array required' })
  const { data: current } = await supabase
    .from('email_subscribers')
    .select('tags')
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .single()
  if (!current) return res.status(404).json({ error: 'Subscriber not found' })
  const merged = [...new Set([...(current.tags || []), ...tags])]
  const { data, error } = await supabase
    .from('email_subscribers')
    .update({ tags: merged })
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()
  if (error) throw error
  res.json({ ok: true, subscriber: data })
})

export default router
