/**
 * Stripe webhook handler — /saas/webhooks/stripe
 *
 * Handles subscription lifecycle and payment events.
 * Receives raw body (configured in index.js before json() middleware).
 *
 * Events handled:
 *   checkout.session.completed        → create/update subscription record
 *   customer.subscription.updated     → sync plan tier, status
 *   customer.subscription.deleted     → downgrade to starter
 *   invoice.payment_succeeded         → log payment, reset job counter on new period
 *   invoice.payment_failed            → mark past_due in DB
 */

import { Router } from 'express'
import Stripe      from 'stripe'
import { supabase } from '../db/supabase.js'

const router = Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', { apiVersion: '2025-01-27.acacia' })
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''

const PRICE_TO_TIER = {
  [process.env.STRIPE_PRICE_ID_STARTER]: 'starter',
  [process.env.STRIPE_PRICE_ID_PRO]:     'pro',
  [process.env.STRIPE_PRICE_ID_AGENCY]:  'agency',
}

async function recordBillingStateEvent({
  orgId,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  eventType,
  subscriptionStatus = null,
  billingStatus = null,
  planTier = null,
  failedPayment = false,
  payload = {},
}) {
  const response = await supabase.from('billing_state_events').insert({
    org_id: orgId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId,
    event_type: eventType,
    subscription_status: subscriptionStatus,
    billing_status: billingStatus,
    plan_tier: planTier,
    failed_payment: failedPayment,
    payload,
  })
  if (response.error && !/billing_state_events/i.test(String(response.error.message || ''))) {
    throw response.error
  }
}

router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature']
  let event

  if (!WEBHOOK_SECRET) {
    // Dev mode: no secret configured — accept unsigned events from localhost tooling
    // (e.g. `stripe listen --forward-to localhost:3001/saas/webhooks/stripe`)
    // Do NOT allow this in production — always set STRIPE_WEBHOOK_SECRET in .env
    console.warn('[Webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature verification (dev mode only)')
    try {
      const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body)
      event = JSON.parse(body)
    } catch (err) {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }
  } else {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET)
    } catch (err) {
      console.error('[Webhook] Signature failed:', err.message)
      return res.status(400).json({ error: 'Invalid signature' })
    }
  }

  if (!process.env.STRIPE_SECRET_KEY || !event?.type) {
    return res.json({ received: true, stub: true })
  }

  // Idempotency guard: record provider event ID; skip if we've seen it before
  const eventId = event.id
  if (eventId) {
    const { error: insertError } = await supabase.from('webhook_events').insert({
      provider: 'stripe',
      event_id: eventId,
      event_type: event.type,
      payload: event.data?.object || {},
    })
    // Supabase/Postgres unique_violation error code
    if (insertError && String(insertError.code) === '23505') {
      console.warn('[Webhook] Duplicate Stripe event received, skipping:', eventId)
      return res.json({ received: true, duplicate: true })
    }
    if (insertError && String(insertError.message || '').includes('webhook_events')) {
      console.error('[Webhook] Failed to persist webhook_events row:', insertError.message)
    }
  }

  // Respond immediately — Stripe requires a timely 2xx. Work is done async below.
  res.json({ received: true })

  let status = 'processed'
  try {
    await handleEvent(event)
  } catch (err) {
    status = 'failed'
    console.error('[Webhook] handleEvent failed:', err)
  } finally {
    if (eventId) {
      // Schema currently stores processed_at only; keep status in logs for now.
      // (If you want DB-level status/error tracking, we can add columns.)
      await supabase
        .from('webhook_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('provider', 'stripe')
        .eq('event_id', eventId)
    }
  }
})

async function handleEvent(event) {
  const obj = event.data.object

  switch (event.type) {

    case 'checkout.session.completed': {
      const orgId    = obj.metadata?.org_id
      const planTier = obj.metadata?.plan_tier || 'starter'
      const custId   = obj.customer

      if (!orgId) { console.warn('[Webhook] checkout.session.completed missing org_id'); break }

      await supabase.from('orgs').update({
        plan_tier:            planTier,
        stripe_customer_id:   custId,
        subscription_status:  'active',
      }).eq('id', orgId)

      // Upsert subscription record
      if (obj.subscription) {
        await upsertSubscription(orgId, obj.subscription, planTier, 'active')
      }
      await recordBillingStateEvent({
        orgId,
        stripeCustomerId: custId,
        stripeSubscriptionId: obj.subscription || null,
        eventType: event.type,
        subscriptionStatus: 'active',
        billingStatus: 'active',
        planTier,
        payload: obj,
      })

      console.log(`[Webhook] Checkout complete: org=${orgId} plan=${planTier}`)
      break
    }

    case 'customer.subscription.updated': {
      const sub      = await stripe.subscriptions.retrieve(obj.id, { expand: ['items.data.price'] })
      const orgId    = sub.metadata?.org_id
      const priceId  = sub.items.data[0]?.price?.id
      const planTier = PRICE_TO_TIER[priceId] || 'starter'

      if (!orgId) { console.warn('[Webhook] subscription.updated missing org_id'); break }

      await supabase.from('orgs').update({
        plan_tier:           planTier,
        subscription_status: sub.status,
      }).eq('id', orgId)

      await upsertSubscription(orgId, sub.id, planTier, sub.status)
      await recordBillingStateEvent({
        orgId,
        stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : null,
        stripeSubscriptionId: sub.id,
        eventType: event.type,
        subscriptionStatus: sub.status,
        billingStatus: sub.status,
        planTier,
        failedPayment: ['past_due', 'incomplete', 'incomplete_expired', 'unpaid'].includes(sub.status),
        payload: sub,
      })
      console.log(`[Webhook] Subscription updated: org=${orgId} plan=${planTier} status=${sub.status}`)
      break
    }

    case 'customer.subscription.deleted': {
      const sub   = obj
      const orgId = sub.metadata?.org_id

      if (!orgId) { console.warn('[Webhook] subscription.deleted missing org_id'); break }

      await supabase.from('orgs').update({
        plan_tier:           'starter',
        subscription_status: 'canceled',
      }).eq('id', orgId)

      await supabase.from('subscriptions')
        .update({ status: 'canceled' })
        .eq('stripe_subscription_id', sub.id)
      await recordBillingStateEvent({
        orgId,
        stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : null,
        stripeSubscriptionId: sub.id,
        eventType: event.type,
        subscriptionStatus: 'canceled',
        billingStatus: 'canceled',
        planTier: 'starter',
        payload: sub,
      })

      console.log(`[Webhook] Subscription canceled: org=${orgId}`)
      break
    }

    case 'invoice.payment_succeeded': {
      const custId   = obj.customer
      const amountPd = obj.amount_paid   // cents
      const period   = obj.lines?.data?.[0]?.period

      // Find org by stripe_customer_id
      const { data: org } = await supabase
        .from('orgs')
        .select('id, plan_tier')
        .eq('stripe_customer_id', custId)
        .maybeSingle()

      if (!org) { console.warn(`[Webhook] payment_succeeded: no org for customer ${custId}`); break }

      // Reset monthly job counter at start of new billing period
      await supabase.from('orgs')
        .update({ jobs_used_this_month: 0, subscription_status: 'active' })
        .eq('id', org.id)

      // Log payment event
      await supabase.from('revenue_events').insert({
        org_id:      org.id,
        type:        'subscription_payment',
        amount_cents: amountPd,
        description: `${org.plan_tier} plan payment`,
        period_start: period?.start ? new Date(period.start * 1000).toISOString() : null,
        period_end:   period?.end   ? new Date(period.end   * 1000).toISOString() : null,
      })
      await recordBillingStateEvent({
        orgId: org.id,
        stripeCustomerId: custId,
        stripeSubscriptionId: obj.subscription || null,
        eventType: event.type,
        subscriptionStatus: 'active',
        billingStatus: 'active',
        planTier: org.plan_tier,
        payload: obj,
      })

      console.log(`[Webhook] Payment succeeded: org=${org.id} $${amountPd / 100}`)
      break
    }

    case 'invoice.payment_failed': {
      const custId = obj.customer
      const { data: org } = await supabase
        .from('orgs')
        .select('id')
        .eq('stripe_customer_id', custId)
        .maybeSingle()

      if (org) {
        await supabase.from('orgs').update({ subscription_status: 'past_due' }).eq('id', org.id)
        await recordBillingStateEvent({
          orgId: org.id,
          stripeCustomerId: custId,
          stripeSubscriptionId: obj.subscription || null,
          eventType: event.type,
          subscriptionStatus: 'past_due',
          billingStatus: 'past_due',
          failedPayment: true,
          payload: obj,
        })
        console.warn(`[Webhook] Payment FAILED: org=${org.id}`)
      }
      break
    }

    default:
      console.log(`[Webhook] Unhandled event: ${event.type}`)
  }
}

async function upsertSubscription(orgId, subscriptionIdOrObj, planTier, status) {
  const subId = typeof subscriptionIdOrObj === 'string'
    ? subscriptionIdOrObj
    : subscriptionIdOrObj?.id
  const currentPeriodStart = typeof subscriptionIdOrObj === 'object' && subscriptionIdOrObj?.current_period_start
    ? new Date(subscriptionIdOrObj.current_period_start * 1000).toISOString()
    : null
  const currentPeriodEnd = typeof subscriptionIdOrObj === 'object' && subscriptionIdOrObj?.current_period_end
    ? new Date(subscriptionIdOrObj.current_period_end * 1000).toISOString()
    : null
  const cancelAtPeriodEnd = typeof subscriptionIdOrObj === 'object'
    ? Boolean(subscriptionIdOrObj?.cancel_at_period_end)
    : false

  if (!subId) return

  await supabase.from('subscriptions').upsert({
    org_id:                 orgId,
    stripe_subscription_id: subId,
    plan_tier:              planTier,
    status,
    current_period_start:   currentPeriodStart,
    current_period_end:     currentPeriodEnd,
    cancel_at_period_end:   cancelAtPeriodEnd,
    updated_at:             new Date().toISOString(),
  }, { onConflict: 'stripe_subscription_id' })
}

export default router
