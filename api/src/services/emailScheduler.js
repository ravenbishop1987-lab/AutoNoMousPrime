/**
 * Email Scheduler Service
 * node-cron job — runs every 15 min, sends due sequence emails
 */

import cron from 'node-cron'
import { supabase } from '../db/supabase.js'
import { sendSequenceEmail } from './emailSender.js'

async function processScheduledEmails() {
  if (!supabase) return // no DB configured — skip

  const now = new Date().toISOString()
  console.log(`[EmailScheduler] Checking for due emails at ${now}`)

  // Fetch all active enrollments that are due
  const { data: dueEnrollments, error } = await supabase
    .from('email_enrollments')
    .select(`
      id, org_id, subscriber_id, sequence_id, current_step, status, next_send_at,
      subscriber:email_subscribers!subscriber_id(id, email, first_name, last_name, status, unsubscribe_token),
      sequence:email_sequences!sequence_id(id, name, status)
    `)
    .eq('status', 'active')
    .lte('next_send_at', now)
    .limit(100)

  if (error) {
    console.error('[EmailScheduler] Query error:', error.message)
    return
  }

  if (!dueEnrollments?.length) return
  console.log(`[EmailScheduler] Processing ${dueEnrollments.length} due enrollments`)

  for (const enrollment of dueEnrollments) {
    await processEnrollment(enrollment)
  }
}

async function processEnrollment(enrollment) {
  const now = new Date().toISOString()
  try {
    // Cancel if subscriber unsubscribed
    if (enrollment.subscriber?.status === 'unsubscribed' || enrollment.subscriber?.status === 'bounced') {
      await supabase.from('email_enrollments').update({ status: 'unsubscribed' }).eq('id', enrollment.id)
      return
    }

    // Skip if sequence is paused or archived
    if (!enrollment.sequence || enrollment.sequence.status !== 'active') return

    // Get the current step
    const { data: step } = await supabase
      .from('email_steps')
      .select('*')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_number', enrollment.current_step)
      .eq('is_active', true)
      .maybeSingle()

    if (!step) {
      // No active step at this index — mark sequence complete
      await supabase
        .from('email_enrollments')
        .update({ status: 'completed', completed_at: now })
        .eq('id', enrollment.id)
      return
    }

    // Send the email
    await sendSequenceEmail({
      orgId: enrollment.org_id,
      subscriberId: enrollment.subscriber_id,
      stepId: step.id,
      enrollmentId: enrollment.id,
      sequenceId: enrollment.sequence_id,
      toEmail: enrollment.subscriber.email,
      subject: step.subject,
      bodyHtml: step.body_html,
      bodyPlain: step.body_plain,
      unsubToken: enrollment.subscriber.unsubscribe_token,
      subscriber: enrollment.subscriber,
    })

    // Find next active step
    const { data: nextStep } = await supabase
      .from('email_steps')
      .select('step_number, delay_days')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('is_active', true)
      .gt('step_number', enrollment.current_step)
      .order('step_number', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (nextStep) {
      const nextSendAt = new Date()
      nextSendAt.setDate(nextSendAt.getDate() + (nextStep.delay_days || 0))
      await supabase
        .from('email_enrollments')
        .update({
          current_step: nextStep.step_number,
          last_sent_at: now,
          next_send_at: nextSendAt.toISOString(),
        })
        .eq('id', enrollment.id)
    } else {
      // No more steps — complete
      await supabase
        .from('email_enrollments')
        .update({ status: 'completed', last_sent_at: now, completed_at: now })
        .eq('id', enrollment.id)
    }

    console.log(`[EmailScheduler] ✓ Sent step ${enrollment.current_step} to ${enrollment.subscriber.email}`)
  } catch (err) {
    console.error(`[EmailScheduler] ✗ Failed enrollment ${enrollment.id}:`, err.message)
    // Don't crash the whole loop — next run will retry
  }
}

// ── Enroll a subscriber in a sequence (call this from routes) ─────────────────

export async function enrollSubscriber({ orgId, subscriberId, sequenceId }) {
  if (!supabase) throw new Error('Database not configured')

  // Check subscriber exists + is active
  const { data: subscriber } = await supabase
    .from('email_subscribers')
    .select('id, email, first_name, last_name, status, unsubscribe_token')
    .eq('id', subscriberId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!subscriber) throw new Error('Subscriber not found')
  if (subscriber.status === 'unsubscribed') throw new Error('Subscriber is unsubscribed')

  // Duplicate enrollment protection
  const { data: existing } = await supabase
    .from('email_enrollments')
    .select('id, status')
    .eq('subscriber_id', subscriberId)
    .eq('sequence_id', sequenceId)
    .maybeSingle()
  if (existing && existing.status === 'active') throw new Error('Already enrolled in this sequence')

  // Get first active step
  const { data: firstStep } = await supabase
    .from('email_steps')
    .select('*')
    .eq('sequence_id', sequenceId)
    .eq('is_active', true)
    .order('step_number', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!firstStep) throw new Error('Sequence has no active steps')

  const now = new Date()

  // Create or re-activate enrollment
  const enrollmentData = {
    org_id: orgId,
    subscriber_id: subscriberId,
    sequence_id: sequenceId,
    current_step: firstStep.step_number,
    status: 'active',
    enrolled_at: now.toISOString(),
    next_send_at: now.toISOString(), // send step 1 on next scheduler run (or immediately)
    last_sent_at: null,
    completed_at: null,
  }

  let enrollment
  if (existing) {
    const { data } = await supabase
      .from('email_enrollments')
      .update(enrollmentData)
      .eq('id', existing.id)
      .select()
      .single()
    enrollment = data
  } else {
    const { data } = await supabase
      .from('email_enrollments')
      .insert(enrollmentData)
      .select()
      .single()
    enrollment = data
  }

  // Send step 1 immediately (don't wait for cron)
  await sendSequenceEmail({
    orgId,
    subscriberId,
    stepId: firstStep.id,
    enrollmentId: enrollment.id,
    sequenceId,
    toEmail: subscriber.email,
    subject: firstStep.subject,
    bodyHtml: firstStep.body_html,
    bodyPlain: firstStep.body_plain,
    unsubToken: subscriber.unsubscribe_token,
    subscriber,
  })

  // Queue step 2 if it exists
  const { data: step2 } = await supabase
    .from('email_steps')
    .select('step_number, delay_days')
    .eq('sequence_id', sequenceId)
    .eq('is_active', true)
    .gt('step_number', firstStep.step_number)
    .order('step_number', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (step2) {
    const next = new Date()
    next.setDate(next.getDate() + (step2.delay_days || 1))
    await supabase
      .from('email_enrollments')
      .update({ current_step: step2.step_number, last_sent_at: now.toISOString(), next_send_at: next.toISOString() })
      .eq('id', enrollment.id)
  } else {
    // Only one step — mark complete
    await supabase
      .from('email_enrollments')
      .update({ status: 'completed', last_sent_at: now.toISOString(), completed_at: now.toISOString() })
      .eq('id', enrollment.id)
  }

  return { ok: true, enrollment }
}

// ── Start cron ───────────────────────────────────────────────────────────────

export function startEmailScheduler() {
  cron.schedule('*/15 * * * *', () => {
    processScheduledEmails().catch(err => console.error('[EmailScheduler] Uncaught error:', err.message))
  })
  console.log('[EmailScheduler] Started — runs every 15 minutes')
}
