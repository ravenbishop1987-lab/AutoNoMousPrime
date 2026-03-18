/**
 * Billing routes — Stripe checkout, plan management, customer portal
 *
 * GET  /saas/billing/status       — current plan, usage, next renewal
 * POST /saas/billing/checkout     — create Stripe checkout session for a plan
 * POST /saas/billing/portal       — create Stripe Customer Portal session
 * POST /saas/billing/change-plan  — upgrade/downgrade subscription
 * POST /saas/billing/cancel       — cancel at period end
 */
import '../env.js'
import { Router }  from 'express'
import Stripe       from 'stripe'
import { z }        from 'zod'
import { requireAuth, attachOrg, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { getPlanConfig } from '../lib/planConfig.js'
import { getUsageSummary } from '../services/usageSummary.js'

const router = Router()
const STRIPE_LIVE = !!process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.startsWith('sk_test_placeholder')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', { apiVersion: '2025-01-27.acacia' })

if (!STRIPE_LIVE) {
  console.warn('[Billing] STRIPE_SECRET_KEY not set/placeholder — billing routes will return stubs')
}

if (
  !process.env.STRIPE_WEBHOOK_SECRET
  || process.env.STRIPE_WEBHOOK_SECRET.trim() === ''
  || process.env.STRIPE_WEBHOOK_SECRET.trim() === 'whsec_...'
) {
  console.warn('[Billing] WARNING: STRIPE_WEBHOOK_SECRET not configured — Stripe webhook events may fail')
}

const PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_ID_STARTER || '',
  pro:     process.env.STRIPE_PRICE_ID_PRO     || '',
  agency:  process.env.STRIPE_PRICE_ID_AGENCY  || '',
}

const checkoutBodySchema = z.object({
  price_id: z.string().trim().min(1, 'price_id cannot be empty').optional(),
  plan_tier: z.enum(['starter', 'pro', 'agency']).optional(),
})

const changePlanBodySchema = z.object({
  plan_tier: z.enum(['starter', 'pro', 'agency'], {
    errorMap: () => ({ message: 'Invalid plan tier' }),
  }),
})

function handleZodError(res, error) {
  const flattened = error.flatten()
  return res.status(400).json({
    error: 'validation_failed',
    details: flattened.fieldErrors,
  })
}

function handleStripeError(err, res, next) {
  const type = err?.type || err?.raw?.type || ''
  if (type === 'StripeAuthenticationError') {
    return res.status(503).json({ error: 'Billing service unavailable' })
  }
  if (type === 'StripeRateLimitError') {
    return res.status(429).json({ error: 'Too many requests to billing' })
  }
  if (type === 'StripeConnectionError') {
    return res.status(503).json({ error: 'Billing service unavailable' })
  }
  if (type === 'StripeInvalidRequestError') {
    return res.status(400).json({ error: 'billing_invalid_request', message: String(err?.message || 'Invalid billing request') })
  }
  next(err)
}

// GET /saas/billing/status
router.get('/status', requireAuth, attachOrg, async (req, res, next) => {
  try {
    const org  = req.org
    const plan = getPlanConfig(org.plan_tier)

    let subscription = null
    if (STRIPE_LIVE && org.stripe_customer_id) {
      const subs = await stripe.subscriptions.list({
        customer: org.stripe_customer_id,
        status: 'all',
        limit: 1,
        expand: ['data.items.data.price'],
      })
      if (subs.data.length) {
        const sub = subs.data[0]
        subscription = {
          id:                   sub.id,
          status:               sub.status,
          plan_tier:            org.plan_tier,
          billing_status:       sub.status,
          current_period_start: sub.current_period_start,
          current_period_end:   sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
          canceled:             sub.status === 'canceled' || sub.cancel_at_period_end,
          failed_payment:       ['past_due', 'incomplete', 'incomplete_expired', 'unpaid'].includes(sub.status),
        }
      }
    }

    const usage = await getUsageSummary(org, subscription)
    const latestSubResp = await supabase
      .from('subscriptions')
      .select('*')
      .eq('org_id', org.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const storedSubscription = latestSubResp.data || null
    const billingStatus = String(subscription?.status || storedSubscription?.status || org.subscription_status || 'inactive')
    const failedPayment = Boolean(subscription?.failed_payment || ['past_due', 'incomplete', 'incomplete_expired', 'unpaid'].includes(billingStatus))

    res.json({
      ok: true,
      stub: !STRIPE_LIVE,
      plan: {
        tier:  org.plan_tier,
        name:  plan.name,
        price: plan.price_monthly_usd,
      },
      features: plan.features,
      usage: {
        content_jobs_used:    usage.content_jobs_used,
        content_jobs_limit:   plan.limits.content_jobs,
        voice_minutes_used:   usage.voice_minutes_used,
        voice_minutes_limit:  plan.limits.voice_minutes,
        video_jobs_used:      usage.video_jobs_used,
        video_jobs_limit:     plan.limits.video_jobs,
        brands_used:          usage.brands_used,
        brands_limit:         plan.limits.brands,
        connected_sites_used: usage.connected_sites_used,
        connected_sites_limit: plan.limits.connected_sites,
        team_members_used:    usage.team_members_used,
        team_members_limit:   plan.limits.team_members,
        billing_window:       usage.billing_window,
      },
      entitlements: plan.limits,
      subscription: subscription || (storedSubscription ? {
        id: storedSubscription.stripe_subscription_id,
        status: storedSubscription.status,
        plan_tier: storedSubscription.plan_tier,
        billing_status: storedSubscription.status,
        current_period_start: null,
        current_period_end: storedSubscription.current_period_end ? Math.floor(new Date(storedSubscription.current_period_end).getTime() / 1000) : null,
        cancel_at_period_end: Boolean(storedSubscription.cancel_at_period_end),
        canceled: storedSubscription.status === 'canceled' || Boolean(storedSubscription.cancel_at_period_end),
        failed_payment: ['past_due', 'incomplete', 'incomplete_expired', 'unpaid'].includes(String(storedSubscription.status || '')),
      } : null),
      billing_state: {
        status: billingStatus,
        active: ['active', 'trialing'].includes(billingStatus),
        canceled: billingStatus === 'canceled' || Boolean(subscription?.cancel_at_period_end || storedSubscription?.cancel_at_period_end),
        failed_payment: failedPayment,
      },
      has_payment_method: !!org.stripe_customer_id,
    })
  } catch (err) {
    handleStripeError(err, res, next)
  }
})

// POST /saas/billing/checkout
// Accepts: { price_id } OR { plan_tier } — price_id takes precedence
router.post('/checkout', requireAuth, attachOrg, requireRole('owner'), async (req, res) => {
  const parsed = (() => {
    try {
      return checkoutBodySchema.parse(req.body)
    } catch (error) {
      if (error instanceof z.ZodError) return handleZodError(res, error)
      throw error
    }
  })()
  // handleZodError already sent a response
  if (!parsed || parsed === res) return

  const { plan_tier, price_id: directPriceId } = parsed
  const org = req.org

  // ── Stub response when Stripe is not configured ──────────────────────────
  if (!STRIPE_LIVE) {
    return res.json({
      ok: true,
      stub: true,
      url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/account?checkout=stub`,
      session_id: 'cs_stub_' + Date.now(),
      message: 'Stripe not configured — set STRIPE_SECRET_KEY in .env to enable real checkout',
    })
  }

  // ── Resolve price ID ─────────────────────────────────────────────────────
  let priceId = directPriceId || ''
  let resolvedTier = plan_tier || 'starter'

  if (!priceId) {
    if (!['starter', 'pro', 'agency'].includes(resolvedTier)) {
      return res.status(400).json({ error: 'Invalid plan_tier — must be starter, pro, or agency' })
    }
    priceId = PRICE_IDS[resolvedTier]
    if (!priceId) {
      return res.status(500).json({ error: `Stripe price ID for '${resolvedTier}' not configured. Set STRIPE_PRICE_ID_${resolvedTier.toUpperCase()} in .env` })
    }
  } else {
    // Resolve tier from direct price_id so metadata is correct
    resolvedTier = Object.entries(PRICE_IDS).find(([, id]) => id === priceId)?.[0] || 'starter'
  }

  try {
    // ── Get or create Stripe customer ─────────────────────────────────────────
    let customerId = org.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: org.email,
        name:  org.name,
        metadata: { org_id: org.id },
      })
      customerId = customer.id
      await supabase.from('orgs').update({ stripe_customer_id: customerId }).eq('id', org.id)
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const session = await stripe.checkout.sessions.create({
      customer:              customerId,
      mode:                  'subscription',
      line_items:            [{ price: priceId, quantity: 1 }],
      success_url:           `${frontendUrl}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:            `${frontendUrl}/account?checkout=cancel`,
      allow_promotion_codes: true,
      metadata:              { org_id: org.id, plan_tier: resolvedTier },
      subscription_data:     { metadata: { org_id: org.id, plan_tier: resolvedTier } },
    })

    res.json({ ok: true, url: session.url, session_id: session.id })
  } catch (err) {
    handleStripeError(err, res, () => res.status(500).json({
      error: 'billing_request_failed',
      message: String(err?.message || 'Billing request failed'),
      stripe_type: err?.type || err?.raw?.type || null,
    }))
  }
})

// POST /saas/billing/portal
router.post('/portal', requireAuth, attachOrg, requireRole('owner'), async (req, res, next) => {
  const org = req.org
  if (!STRIPE_LIVE) {
    return res.json({ ok: true, stub: true, url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/account` })
  }
  if (!org.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account found. Subscribe to a plan first.' })
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   org.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/account`,
    })

    res.json({ ok: true, url: session.url })
  } catch (err) {
    handleStripeError(err, res, next)
  }
})

// POST /saas/billing/change-plan
router.post('/change-plan', requireAuth, attachOrg, requireRole('owner'), async (req, res, next) => {
  const parsed = (() => {
    try {
      return changePlanBodySchema.parse(req.body)
    } catch (error) {
      if (error instanceof z.ZodError) return handleZodError(res, error)
      throw error
    }
  })()
  if (!parsed || parsed === res) return

  const { plan_tier } = parsed
  const org = req.org

  if (!STRIPE_LIVE) {
    return res.json({ ok: true, stub: true, plan_tier, message: 'Stripe not configured' })
  }
  if (!['starter', 'pro', 'agency'].includes(plan_tier)) {
    return res.status(400).json({ error: 'Invalid plan tier' })
  }
  if (!org.stripe_customer_id) {
    return res.status(400).json({ error: 'No active subscription to change' })
  }

  const priceId = PRICE_IDS[plan_tier]
  if (!priceId) {
    return res.status(500).json({ error: `Price ID for '${plan_tier}' not configured` })
  }

  try {
    const subs = await stripe.subscriptions.list({ customer: org.stripe_customer_id, status: 'active', limit: 1 })
    if (!subs.data.length) {
      return res.status(400).json({ error: 'No active subscription found' })
    }

    const sub    = subs.data[0]
    const itemId = sub.items.data[0].id

    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: 'create_prorations',
      metadata: { plan_tier },
    })

    // Update org plan in DB immediately (webhook will also fire)
    await supabase.from('orgs').update({ plan_tier }).eq('id', org.id)

    res.json({ ok: true, subscription_id: updated.id, plan_tier })
  } catch (err) {
    handleStripeError(err, res, next)
  }
})

// POST /saas/billing/cancel
router.post('/cancel', requireAuth, attachOrg, requireRole('owner'), async (req, res, next) => {
  const org = req.org
  if (!STRIPE_LIVE) {
    return res.json({ ok: true, stub: true, message: 'Stripe not configured' })
  }
  if (!org.stripe_customer_id) return res.status(400).json({ error: 'No active subscription' })

  try {
    const subs = await stripe.subscriptions.list({ customer: org.stripe_customer_id, status: 'active', limit: 1 })
    if (!subs.data.length) return res.status(400).json({ error: 'No active subscription found' })

    const updated = await stripe.subscriptions.update(subs.data[0].id, { cancel_at_period_end: true })
    res.json({ ok: true, cancel_at: updated.current_period_end })
  } catch (err) {
    handleStripeError(err, res, next)
  }
})

export default router
