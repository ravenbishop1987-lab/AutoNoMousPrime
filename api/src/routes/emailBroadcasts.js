/**
 * Email Broadcasts Routes
 * One-time email blasts to all or filtered subscribers
 *
 * DB table required — run in Supabase SQL Editor:
 *
 * CREATE TABLE IF NOT EXISTS email_broadcasts (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   org_id UUID NOT NULL,
 *   name TEXT NOT NULL,
 *   subject TEXT NOT NULL DEFAULT '',
 *   body_html TEXT NOT NULL DEFAULT '',
 *   body_plain TEXT,
 *   status TEXT NOT NULL DEFAULT 'draft',  -- draft | sending | sent | failed
 *   filter_status TEXT DEFAULT 'active',   -- active | all
 *   filter_tag TEXT,                        -- optional tag filter
 *   recipient_count INT DEFAULT 0,
 *   sent_count INT DEFAULT 0,
 *   failed_count INT DEFAULT 0,
 *   sent_at TIMESTAMPTZ,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE INDEX IF NOT EXISTS email_broadcasts_org_idx ON email_broadcasts(org_id);
 */

import { Router } from 'express'
import { requireAuth, attachOrg, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { sendBroadcastEmail } from '../services/emailSender.js'

const router = Router()
const RW = ['owner', 'admin', 'editor']

// GET /saas/email-broadcasts
router.get('/', requireAuth, attachOrg, async (req, res) => {
  const { data, error } = await supabase
    .from('email_broadcasts')
    .select('*')
    .eq('org_id', req.org.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  res.json({ ok: true, broadcasts: data || [] })
})

// POST /saas/email-broadcasts
router.post('/', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const { name, subject, body_html, body_plain, filter_status = 'active', filter_tag } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
  const { data, error } = await supabase
    .from('email_broadcasts')
    .insert({
      org_id: req.org.id,
      name: name.trim(),
      subject: subject?.trim() || '',
      body_html: body_html || '',
      body_plain: body_plain || null,
      filter_status,
      filter_tag: filter_tag || null,
      status: 'draft',
    })
    .select()
    .single()
  if (error) throw error
  res.status(201).json({ ok: true, broadcast: data })
})

// GET /saas/email-broadcasts/:id
router.get('/:id', requireAuth, attachOrg, async (req, res) => {
  const { data, error } = await supabase
    .from('email_broadcasts')
    .select('*')
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .single()
  if (error || !data) return res.status(404).json({ error: 'Broadcast not found' })
  res.json({ ok: true, broadcast: data })
})

// PATCH /saas/email-broadcasts/:id
router.patch('/:id', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  const allowed = ['name', 'subject', 'body_html', 'body_plain', 'filter_status', 'filter_tag']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  updates.updated_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('email_broadcasts')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()
  if (error || !data) return res.status(404).json({ error: 'Broadcast not found' })
  res.json({ ok: true, broadcast: data })
})

// DELETE /saas/email-broadcasts/:id
router.delete('/:id', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { error } = await supabase
    .from('email_broadcasts')
    .delete()
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
  if (error) throw error
  res.json({ ok: true })
})

// POST /saas/email-broadcasts/:id/send  — fire the blast
router.post('/:id/send', requireAuth, attachOrg, requireRole(RW), async (req, res) => {
  // Load broadcast
  const { data: broadcast, error: bErr } = await supabase
    .from('email_broadcasts')
    .select('*')
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .single()
  if (bErr || !broadcast) return res.status(404).json({ error: 'Broadcast not found' })
  if (broadcast.status === 'sending') return res.status(409).json({ error: 'Broadcast is already sending' })
  if (broadcast.status === 'sent') return res.status(409).json({ error: 'Broadcast already sent' })
  if (!broadcast.subject?.trim()) return res.status(400).json({ error: 'Subject is required before sending' })
  if (!broadcast.body_html?.trim()) return res.status(400).json({ error: 'Body is required before sending' })

  // Build subscriber query
  let query = supabase
    .from('email_subscribers')
    .select('id, email, first_name, last_name, unsubscribe_token, tags')
    .eq('org_id', req.org.id)
    .neq('status', 'unsubscribed')
    .neq('status', 'bounced')

  if (broadcast.filter_status && broadcast.filter_status !== 'all') {
    query = query.eq('status', broadcast.filter_status)
  }
  if (broadcast.filter_tag) {
    query = query.contains('tags', [broadcast.filter_tag])
  }

  const { data: subscribers, error: sErr } = await query
  if (sErr) throw sErr
  if (!subscribers?.length) return res.status(400).json({ error: 'No subscribers match the filter' })

  // Mark as sending
  await supabase
    .from('email_broadcasts')
    .update({ status: 'sending', recipient_count: subscribers.length, updated_at: new Date().toISOString() })
    .eq('id', broadcast.id)

  // Respond immediately — send in background
  res.json({ ok: true, recipient_count: subscribers.length, message: `Sending to ${subscribers.length} subscribers...` })

  // Fire emails asynchronously
  let sentCount = 0
  let failedCount = 0
  for (const sub of subscribers) {
    try {
      await sendBroadcastEmail({
        orgId: req.org.id,
        broadcastId: broadcast.id,
        subscriberId: sub.id,
        toEmail: sub.email,
        subject: broadcast.subject,
        bodyHtml: broadcast.body_html,
        bodyPlain: broadcast.body_plain,
        unsubToken: sub.unsubscribe_token,
        subscriber: sub,
      })
      sentCount++
    } catch {
      failedCount++
    }
  }

  // Mark as sent
  await supabase
    .from('email_broadcasts')
    .update({
      status: failedCount === subscribers.length ? 'failed' : 'sent',
      sent_count: sentCount,
      failed_count: failedCount,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', broadcast.id)
})

// GET /saas/email-broadcasts/:id/preview  — recipient count estimate
router.get('/:id/preview', requireAuth, attachOrg, async (req, res) => {
  const { data: broadcast } = await supabase
    .from('email_broadcasts')
    .select('filter_status, filter_tag')
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .single()
  if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' })

  let query = supabase
    .from('email_subscribers')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', req.org.id)
    .neq('status', 'unsubscribed')
    .neq('status', 'bounced')

  if (broadcast.filter_status && broadcast.filter_status !== 'all') {
    query = query.eq('status', broadcast.filter_status)
  }
  if (broadcast.filter_tag) {
    query = query.contains('tags', [broadcast.filter_tag])
  }

  const { count } = await query
  res.json({ ok: true, recipient_count: count || 0 })
})

export default router
