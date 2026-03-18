/**
 * Email SMTP Config Routes
 * Save / retrieve Gmail SMTP settings, test send
 */

import { Router } from 'express'
import { requireAuth, attachOrg, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { sendTestEmail } from '../services/emailSender.js'

const router = Router()

// GET /saas/email-smtp/config
router.get('/config', requireAuth, attachOrg, async (req, res) => {
  const { data } = await supabase
    .from('email_smtp_configs')
    .select('id, from_name, gmail_user, base_url, is_verified, created_at, updated_at')
    .eq('org_id', req.org.id)
    .maybeSingle()
  // Never return the app password
  res.json({ ok: true, config: data || null })
})

// POST /saas/email-smtp/config
router.post('/config', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { from_name, gmail_user, gmail_app_password, base_url } = req.body
  if (!gmail_user?.trim()) return res.status(400).json({ error: 'gmail_user is required' })
  if (!gmail_app_password?.trim()) return res.status(400).json({ error: 'gmail_app_password is required' })

  const payload = {
    org_id: req.org.id,
    from_name: from_name?.trim() || 'Autonomous Prime',
    gmail_user: gmail_user.trim().toLowerCase(),
    gmail_app_password: gmail_app_password.trim(),
    base_url: (base_url || 'http://localhost:3001').replace(/\/$/, ''),
    is_verified: false,
  }

  const { data, error } = await supabase
    .from('email_smtp_configs')
    .upsert(payload, { onConflict: 'org_id' })
    .select('id, from_name, gmail_user, base_url, is_verified, updated_at')
    .single()
  if (error) throw error
  res.json({ ok: true, config: data })
})

// POST /saas/email-smtp/test
router.post('/test', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { to_email } = req.body
  if (!to_email?.trim()) return res.status(400).json({ error: 'to_email is required' })
  try {
    await sendTestEmail({ orgId: req.org.id, toEmail: to_email.trim() })
    // Mark config as verified
    await supabase
      .from('email_smtp_configs')
      .update({ is_verified: true })
      .eq('org_id', req.org.id)
    res.json({ ok: true, message: `Test email sent to ${to_email}` })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

export default router
