/**
 * Email Sender Service
 * Gmail SMTP via Nodemailer — tracking pixel, link wrapping, CAN-SPAM footer
 */

import nodemailer from 'nodemailer'
import crypto from 'crypto'
import { supabase } from '../db/supabase.js'

// ── SMTP transporter ─────────────────────────────────────────────────────────

async function getSmtpConfig(orgId) {
  // Try DB first
  if (supabase) {
    const { data } = await supabase
      .from('email_smtp_configs')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle()
    if (data) return data
  }
  // Fallback to env vars
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) throw new Error('SMTP not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD or configure via Settings.')
  return {
    from_name: process.env.FROM_NAME || 'Autonomous Prime',
    gmail_user: gmailUser,
    gmail_app_password: gmailPass,
    base_url: process.env.BASE_URL || 'http://localhost:3001',
  }
}

function createTransporter(config) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.gmail_user, pass: config.gmail_app_password },
  })
}

// ── HTML processing ───────────────────────────────────────────────────────────

function wrapLinks(html, trackingId, baseUrl) {
  // Wrap all external links with click-tracking redirect
  return html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (match, url) => {
      if (url.includes('/email-track/')) return match // don't double-wrap
      const encoded = encodeURIComponent(url)
      return `href="${baseUrl}/saas/email-track/click/${trackingId}?url=${encoded}"`
    }
  )
}

function addTrackingPixel(html, trackingId, baseUrl) {
  const pixel = `<img src="${baseUrl}/saas/email-track/open/${trackingId}" width="1" height="1" style="display:none;width:1px;height:1px" alt="" />`
  if (html.includes('</body>')) return html.replace('</body>', `${pixel}</body>`)
  return html + pixel
}

function addCanSpamFooter(html, unsubToken, baseUrl, fromName) {
  const unsubUrl = `${baseUrl}/saas/email-track/unsubscribe/${unsubToken}`
  const footer = `
<div style="margin-top:40px;padding:20px 0;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#9ca3af;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.8">
  <p style="margin:0 0 6px">You received this email because you subscribed to updates from <strong>${fromName}</strong>.</p>
  <p style="margin:0">
    <a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a>
    &nbsp;&middot;&nbsp;
    <a href="#" style="color:#9ca3af;text-decoration:underline">Update preferences</a>
  </p>
</div>`
  if (html.includes('</body>')) return html.replace('</body>', `${footer}</body>`)
  return html + footer
}

function personalize(text, subscriber) {
  if (!text) return text
  return text
    .replace(/\{\{first_name\}\}/gi, subscriber.first_name || 'there')
    .replace(/\{\{last_name\}\}/gi, subscriber.last_name || '')
    .replace(/\{\{email\}\}/gi, subscriber.email)
    .replace(/\{\{full_name\}\}/gi, [subscriber.first_name, subscriber.last_name].filter(Boolean).join(' ') || 'there')
}

// ── Main send function ────────────────────────────────────────────────────────

export async function sendSequenceEmail({
  orgId, subscriberId, stepId, enrollmentId, sequenceId,
  toEmail, subject, bodyHtml, bodyPlain, unsubToken, subscriber = {},
}) {
  const config = await getSmtpConfig(orgId)
  const transporter = createTransporter(config)
  const baseUrl = (config.base_url || 'http://localhost:3001').replace(/\/$/, '')
  const trackingId = crypto.randomBytes(16).toString('hex')

  // Personalise content
  const finalSubject = personalize(subject, { email: toEmail, ...subscriber })
  let finalHtml = personalize(bodyHtml, { email: toEmail, ...subscriber })

  // Add tracking
  finalHtml = wrapLinks(finalHtml, trackingId, baseUrl)
  finalHtml = addTrackingPixel(finalHtml, trackingId, baseUrl)
  finalHtml = addCanSpamFooter(finalHtml, unsubToken, baseUrl, config.from_name)

  // Create log entry first (so we have the ID for tracking)
  let logId = null
  if (supabase) {
    const { data: logEntry } = await supabase
      .from('email_send_log')
      .insert({
        org_id: orgId,
        enrollment_id: enrollmentId || null,
        subscriber_id: subscriberId || null,
        sequence_id: sequenceId || null,
        step_id: stepId || null,
        to_email: toEmail,
        subject: finalSubject,
        status: 'pending',
        tracking_id: trackingId,
      })
      .select('id')
      .single()
    logId = logEntry?.id
  }

  try {
    await transporter.sendMail({
      from: `"${config.from_name}" <${config.gmail_user}>`,
      to: toEmail,
      subject: finalSubject,
      html: finalHtml,
      text: bodyPlain ? personalize(bodyPlain, { email: toEmail, ...subscriber }) : undefined,
    })

    if (supabase && logId) {
      await supabase
        .from('email_send_log')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', logId)
    }
    return { ok: true, trackingId, logId }
  } catch (err) {
    if (supabase && logId) {
      await supabase
        .from('email_send_log')
        .update({ status: 'failed', error_message: err.message })
        .eq('id', logId)
    }
    throw err
  }
}

export async function sendBroadcastEmail({
  orgId, broadcastId, subscriberId, toEmail, subject,
  bodyHtml, bodyPlain, unsubToken, subscriber = {},
}) {
  const config = await getSmtpConfig(orgId)
  const transporter = createTransporter(config)
  const baseUrl = (config.base_url || 'http://localhost:3001').replace(/\/$/, '')
  const trackingId = crypto.randomBytes(16).toString('hex')

  const finalSubject = personalize(subject, { email: toEmail, ...subscriber })
  let finalHtml = personalize(bodyHtml, { email: toEmail, ...subscriber })
  finalHtml = wrapLinks(finalHtml, trackingId, baseUrl)
  finalHtml = addTrackingPixel(finalHtml, trackingId, baseUrl)
  finalHtml = addCanSpamFooter(finalHtml, unsubToken, baseUrl, config.from_name)

  let logId = null
  if (supabase) {
    const { data: logEntry } = await supabase
      .from('email_send_log')
      .insert({
        org_id: orgId,
        broadcast_id: broadcastId || null,
        subscriber_id: subscriberId || null,
        to_email: toEmail,
        subject: finalSubject,
        status: 'pending',
        tracking_id: trackingId,
      })
      .select('id')
      .single()
    logId = logEntry?.id
  }

  try {
    await transporter.sendMail({
      from: `"${config.from_name}" <${config.gmail_user}>`,
      to: toEmail,
      subject: finalSubject,
      html: finalHtml,
      text: bodyPlain ? personalize(bodyPlain, { email: toEmail, ...subscriber }) : undefined,
    })
    if (supabase && logId) {
      await supabase
        .from('email_send_log')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', logId)
    }
    return { ok: true, trackingId, logId }
  } catch (err) {
    if (supabase && logId) {
      await supabase
        .from('email_send_log')
        .update({ status: 'failed', error_message: err.message })
        .eq('id', logId)
    }
    throw err
  }
}

export async function sendTestEmail({ orgId, toEmail }) {
  const config = await getSmtpConfig(orgId)
  const transporter = createTransporter(config)
  await transporter.sendMail({
    from: `"${config.from_name}" <${config.gmail_user}>`,
    to: toEmail,
    subject: '✅ Autonomous Prime — SMTP Connection Test',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px">
        <h2 style="color:#1a1a2e;margin:0 0 16px">SMTP configured correctly ✓</h2>
        <p style="color:#555;line-height:1.6">Your Gmail SMTP is connected and working. Emails from Autonomous Prime sequences will be delivered from <strong>${config.gmail_user}</strong>.</p>
        <p style="color:#999;font-size:12px;margin-top:24px">Sent by Autonomous Prime Email System</p>
      </div>`,
  })
  return { ok: true }
}
