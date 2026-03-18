import { Router } from 'express'
import crypto from 'node:crypto'
import Stripe from 'stripe'
import { config } from '../config.js'
import { db } from '../lib/db.js'

export const stripeRouter = Router()
const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null

function upsertSubscriptionEvent(input: {
  stripeEventId?: string
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  offerId?: string
  landingPageId?: string
  status: string
  billingStatus?: string
  failedPayment?: boolean
  metadata?: Record<string, unknown>
}) {
  db.prepare(`
    INSERT INTO subscription_events
    (id, stripe_event_id, stripe_customer_id, stripe_subscription_id, offer_id, landing_page_id, status, billing_status, failed_payment, metadata_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(stripe_event_id) DO UPDATE SET
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      offer_id = excluded.offer_id,
      landing_page_id = excluded.landing_page_id,
      status = excluded.status,
      billing_status = excluded.billing_status,
      failed_payment = excluded.failed_payment,
      metadata_json = excluded.metadata_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    crypto.randomUUID(),
    input.stripeEventId || '',
    input.stripeCustomerId || '',
    input.stripeSubscriptionId || '',
    input.offerId || '',
    input.landingPageId || '',
    input.status,
    input.billingStatus || input.status,
    input.failedPayment ? 1 : 0,
    JSON.stringify(input.metadata || {}),
  )
}

stripeRouter.post('/checkout-session', async (req, res) => {
  if (!stripe) {
    res.status(400).json({ ok: false, error: 'Stripe secret key is not configured' })
    return
  }
  try {
    const mode = String(req.body.mode || 'payment').trim() === 'subscription' ? 'subscription' : 'payment'
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: req.body.price_id, quantity: 1 }],
      success_url: req.body.success_url || `${config.appUrl}/success`,
      cancel_url: req.body.cancel_url || `${config.appUrl}/cancel`,
      metadata: {
        post_id: req.body.post_id || '',
        platform: req.body.platform || '',
        cta_id: req.body.cta_id || '',
        landing_page_id: req.body.landing_page_id || '',
        offer_id: req.body.offer_id || '',
      },
    })

    db.prepare(`
      INSERT INTO attribution_events (id, post_id, platform, cta_id, landing_page_id, offer_id, event_type, stripe_session_id, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      req.body.post_id || '',
      req.body.platform || '',
      req.body.cta_id || '',
      req.body.landing_page_id || '',
      req.body.offer_id || '',
      'checkout_started',
      session.id,
      JSON.stringify(req.body.metadata || {}),
    )

    res.json({ ok: true, url: session.url })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Stripe checkout failed' })
  }
})

stripeRouter.post('/webhook', async (req, res) => {
  if (!stripe || !config.stripeWebhookSecret) {
    res.status(400).json({ ok: false, error: 'Stripe webhook is not configured' })
    return
  }
  try {
    const signature = req.headers['stripe-signature']
    if (!signature || Array.isArray(signature)) {
      res.status(400).json({ ok: false, error: 'Missing stripe-signature header' })
      return
    }
    const event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret)
    if (event.type === 'product.created' || event.type === 'product.updated') {
      const product = event.data.object as Stripe.Product
      db.prepare(`
        INSERT INTO stripe_products (id, name, description, active, raw_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          active = excluded.active,
          raw_json = excluded.raw_json
      `).run(
        product.id,
        product.name || product.id,
        product.description || '',
        product.active ? 1 : 0,
        JSON.stringify(product),
      )
    }
    if (event.type === 'price.created' || event.type === 'price.updated') {
      const price = event.data.object as Stripe.Price
      db.prepare(`
        INSERT INTO stripe_prices (id, product_id, unit_amount, currency, recurring_interval, active, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          product_id = excluded.product_id,
          unit_amount = excluded.unit_amount,
          currency = excluded.currency,
          recurring_interval = excluded.recurring_interval,
          active = excluded.active,
          raw_json = excluded.raw_json
      `).run(
        price.id,
        typeof price.product === 'string' ? price.product : price.product?.id || '',
        price.unit_amount || 0,
        price.currency || 'usd',
        price.recurring?.interval || '',
        price.active ? 1 : 0,
        JSON.stringify(price),
      )
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const amount = session.amount_total || 0
      const metadata = session.metadata || {}

      db.prepare(`
        INSERT OR IGNORE INTO revenue_events
        (id, stripe_event_id, post_id, platform, cta_id, landing_page_id, offer_id, amount_cents, currency, kind, stripe_customer_id, stripe_subscription_id, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        event.id,
        metadata.post_id || '',
        metadata.platform || '',
        metadata.cta_id || '',
        metadata.landing_page_id || '',
        metadata.offer_id || '',
        amount,
        session.currency || 'usd',
        session.mode === 'subscription' ? 'subscription' : 'payment',
        session.customer ? String(session.customer) : '',
        session.subscription ? String(session.subscription) : '',
        JSON.stringify(metadata),
      )

      db.prepare(`
        INSERT INTO attribution_events
        (id, post_id, platform, cta_id, landing_page_id, offer_id, event_type, stripe_session_id, stripe_customer_id, revenue_cents, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        metadata.post_id || '',
        metadata.platform || '',
        metadata.cta_id || '',
        metadata.landing_page_id || '',
        metadata.offer_id || '',
        'purchase',
        session.id,
        session.customer ? String(session.customer) : '',
        amount,
        JSON.stringify(metadata),
      )

      if (session.mode === 'subscription') {
        let subscriptionStatus = 'active'
        let billingStatus = 'active'
        if (session.subscription && typeof session.subscription === 'string') {
          try {
            const subscription = await stripe.subscriptions.retrieve(session.subscription)
            subscriptionStatus = subscription.status || subscriptionStatus
            billingStatus = subscription.status || billingStatus
          } catch {
            // Keep the optimistic state if Stripe retrieval fails.
          }
        }

        upsertSubscriptionEvent({
          stripeEventId: event.id,
          stripeCustomerId: session.customer ? String(session.customer) : '',
          stripeSubscriptionId: session.subscription ? String(session.subscription) : '',
          offerId: String(metadata.offer_id || ''),
          landingPageId: String(metadata.landing_page_id || ''),
          status: subscriptionStatus,
          billingStatus,
          failedPayment: false,
          metadata,
        })
      }
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription
      const metadata = subscription.metadata || {}
      upsertSubscriptionEvent({
        stripeEventId: event.id,
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
        stripeSubscriptionId: subscription.id,
        offerId: String(metadata.offer_id || ''),
        landingPageId: String(metadata.landing_page_id || ''),
        status: subscription.status || (event.type === 'customer.subscription.deleted' ? 'canceled' : 'active'),
        billingStatus: subscription.status || '',
        failedPayment: ['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(subscription.status || ''),
        metadata,
      })
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice
      const parent = invoice.parent && typeof invoice.parent === 'object' ? invoice.parent : null
      const metadata = invoice.metadata || {}
      const subscriptionId = String((invoice as unknown as { subscription?: string | null }).subscription || '')
      upsertSubscriptionEvent({
        stripeEventId: event.id,
        stripeCustomerId: invoice.customer ? String(invoice.customer) : '',
        stripeSubscriptionId: subscriptionId,
        offerId: String(metadata.offer_id || ''),
        landingPageId: String(metadata.landing_page_id || ''),
        status: 'past_due',
        billingStatus: String(invoice.status || 'failed'),
        failedPayment: true,
        metadata: {
          ...metadata,
          amount_due: invoice.amount_due || 0,
          attempt_count: invoice.attempt_count || 0,
          billing_reason: invoice.billing_reason || '',
          parent,
        },
      })
    }

    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Webhook failed' })
  }
})
