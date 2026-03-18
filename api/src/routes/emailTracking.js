/**
 * Email Tracking Routes — PUBLIC (no auth required)
 * Open pixel, click redirect, unsubscribe handler
 */

import { Router } from 'express'
import { supabase } from '../db/supabase.js'

const router = Router()

// 1x1 transparent GIF
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

async function logTrackingEvent({ trackingId, eventType, linkUrl, req }) {
  if (!supabase) return
  try {
    const { data: log } = await supabase
      .from('email_send_log')
      .select('id, org_id, subscriber_id, sequence_id, step_id')
      .eq('tracking_id', trackingId)
      .maybeSingle()
    if (!log) return

    await supabase.from('email_tracking_events').insert({
      org_id: log.org_id,
      send_log_id: log.id,
      subscriber_id: log.subscriber_id,
      sequence_id: log.sequence_id,
      step_id: log.step_id,
      event_type: eventType,
      link_url: linkUrl || null,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
    })
  } catch { /* never crash tracking */ }
}

// GET /saas/email-track/open/:trackingId
// Open-tracking pixel
router.get('/open/:trackingId', async (req, res) => {
  await logTrackingEvent({ trackingId: req.params.trackingId, eventType: 'open', req })
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': PIXEL_GIF.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  })
  res.end(PIXEL_GIF)
})

// GET /saas/email-track/click/:trackingId?url=<encoded>
// Click tracking redirect
router.get('/click/:trackingId', async (req, res) => {
  const destination = req.query.url
  await logTrackingEvent({ trackingId: req.params.trackingId, eventType: 'click', linkUrl: destination, req })
  if (!destination) return res.redirect('/')
  // Safety: only allow http/https destinations
  try {
    const parsed = new URL(decodeURIComponent(destination))
    if (!['http:', 'https:'].includes(parsed.protocol)) return res.redirect('/')
    res.redirect(302, parsed.toString())
  } catch {
    res.redirect('/')
  }
})

// GET /saas/email-track/unsubscribe/:token
// One-click unsubscribe
router.get('/unsubscribe/:token', async (req, res) => {
  const { token } = req.params
  if (!supabase) return res.send('<h2>Unsubscribed successfully.</h2>')

  try {
    const { data: subscriber } = await supabase
      .from('email_subscribers')
      .select('id, email, org_id')
      .eq('unsubscribe_token', token)
      .maybeSingle()

    if (!subscriber) {
      return res.status(404).send('<h2>Invalid unsubscribe link.</h2>')
    }

    // Mark subscriber as unsubscribed
    await supabase
      .from('email_subscribers')
      .update({ status: 'unsubscribed' })
      .eq('id', subscriber.id)

    // Cancel all active enrollments
    await supabase
      .from('email_enrollments')
      .update({ status: 'unsubscribed' })
      .eq('subscriber_id', subscriber.id)
      .eq('status', 'active')

    // Log the event (find most recent send log for this subscriber)
    const { data: recentLog } = await supabase
      .from('email_send_log')
      .select('id, org_id, sequence_id, step_id')
      .eq('subscriber_id', subscriber.id)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentLog) {
      await supabase.from('email_tracking_events').insert({
        org_id: recentLog.org_id,
        send_log_id: recentLog.id,
        subscriber_id: subscriber.id,
        sequence_id: recentLog.sequence_id,
        step_id: recentLog.step_id,
        event_type: 'unsubscribe',
        ip_address: req.ip,
        user_agent: req.get('user-agent'),
      })
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Unsubscribed</title>
      <style>body{font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#333}
      h2{color:#111}p{color:#666;line-height:1.6}</style></head>
      <body>
        <h2>You've been unsubscribed ✓</h2>
        <p>${subscriber.email} has been removed from all email sequences.<br/>
        You will no longer receive emails from this list.</p>
      </body>
      </html>`)
  } catch (err) {
    console.error('[EmailTracking] Unsubscribe error:', err.message)
    res.status(500).send('<h2>An error occurred. Please try again.</h2>')
  }
})

export default router
