import { Router } from 'express'
import { db } from '../lib/db.js'

export const revenueRouter = Router()

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    if (typeof value === 'string' && value.trim()) return JSON.parse(value) as T
  } catch {
    // Ignore malformed rows and fall back.
  }
  return fallback
}

revenueRouter.get('/summary', (_req, res) => {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(amount_cents), 0) AS totalRevenueCents,
      COUNT(*) AS orderCount,
      SUM(CASE WHEN kind = 'subscription' THEN 1 ELSE 0 END) AS subscriptionCount
    FROM revenue_events
  `).get() as { totalRevenueCents: number; orderCount: number; subscriptionCount: number }

  const timeline = db.prepare(`
    SELECT substr(created_at, 1, 7) AS month, COALESCE(SUM(amount_cents), 0) AS revenue_cents, COUNT(*) AS orders
    FROM revenue_events
    GROUP BY substr(created_at, 1, 7)
    ORDER BY month DESC
    LIMIT 12
  `).all()

  const analyticsTotals = db.prepare(`
    SELECT
      SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
      SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS cta_clicks,
      SUM(CASE WHEN event_type = 'checkout_started' THEN 1 ELSE 0 END) AS checkout_started,
      SUM(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS purchases
    FROM attribution_events
  `).get() as {
    page_views: number | null
    cta_clicks: number | null
    checkout_started: number | null
    purchases: number | null
  }

  const revenueByOffer = db.prepare(`
    SELECT
      re.offer_id,
      COALESCE(o.name, re.offer_id, 'Unassigned') AS offer_name,
      COALESCE(SUM(re.amount_cents), 0) AS revenue_cents,
      COUNT(*) AS order_count
    FROM revenue_events re
    LEFT JOIN offers o ON o.id = re.offer_id
    GROUP BY re.offer_id, offer_name
    ORDER BY revenue_cents DESC, order_count DESC
  `).all()

  const revenueByLandingPage = db.prepare(`
    SELECT
      lp.id,
      COALESCE(lp.name, re.landing_page_id, 'Unassigned') AS landing_page_name,
      COALESCE(lp.slug, '') AS slug,
      COALESCE(SUM(re.amount_cents), 0) AS revenue_cents,
      COUNT(*) AS order_count
    FROM revenue_events re
    LEFT JOIN landing_pages lp ON lp.id = re.landing_page_id
    GROUP BY lp.id, landing_page_name, slug
    ORDER BY revenue_cents DESC, order_count DESC
  `).all()

  const revenueByPlatform = db.prepare(`
    SELECT
      COALESCE(NULLIF(platform, ''), 'unknown') AS platform,
      COALESCE(SUM(amount_cents), 0) AS revenue_cents,
      COUNT(*) AS order_count
    FROM revenue_events
    GROUP BY COALESCE(NULLIF(platform, ''), 'unknown')
    ORDER BY revenue_cents DESC, order_count DESC
  `).all()

  const revenueByPost = db.prepare(`
    SELECT
      COALESCE(NULLIF(post_id, ''), 'unattributed') AS post_id,
      COALESCE(NULLIF(platform, ''), 'unknown') AS platform,
      COALESCE(SUM(amount_cents), 0) AS revenue_cents,
      COUNT(*) AS order_count
    FROM revenue_events
    GROUP BY COALESCE(NULLIF(post_id, ''), 'unattributed'), COALESCE(NULLIF(platform, ''), 'unknown')
    ORDER BY revenue_cents DESC, order_count DESC
    LIMIT 25
  `).all()

  const ctaEventStats = db.prepare(`
    SELECT
      cta_id,
      SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS click_count,
      SUM(CASE WHEN event_type = 'checkout_started' THEN 1 ELSE 0 END) AS checkout_count,
      SUM(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS purchase_count
    FROM attribution_events
    WHERE COALESCE(cta_id, '') != ''
    GROUP BY cta_id
  `).all() as Array<{ cta_id: string; click_count: number; checkout_count: number; purchase_count: number }>

  const ctaRevenueStats = db.prepare(`
    SELECT
      cta_id,
      COALESCE(SUM(amount_cents), 0) AS revenue_cents
    FROM revenue_events
    WHERE COALESCE(cta_id, '') != ''
    GROUP BY cta_id
  `).all() as Array<{ cta_id: string; revenue_cents: number }>

  const ctaStatMap = new Map(ctaEventStats.map(item => [item.cta_id, item]))
  const ctaRevenueMap = new Map(ctaRevenueStats.map(item => [item.cta_id, item]))

  const ctaRows = db.prepare(`
    SELECT
      c.id,
      c.platform,
      c.post_id,
      c.cta_text,
      c.variant_label,
      c.variant_json,
      c.landing_page_id,
      c.offer_id
    FROM post_ctas c
    ORDER BY c.created_at DESC
    LIMIT 25
  `).all().map((row: any) => {
    const variant = parseJson<Record<string, unknown>>(row.variant_json, {})
    const stats = ctaStatMap.get(row.id)
    const revenueStats = ctaRevenueMap.get(row.id)
    return {
      id: row.id,
      platform: row.platform,
      post_id: row.post_id,
      cta_text: row.cta_text,
      variant_label: row.variant_label || String(variant.primary || row.cta_text || 'Variant'),
      click_count: Number(stats?.click_count || 0),
      checkout_count: Number(stats?.checkout_count || 0),
      purchase_count: Number(stats?.purchase_count || 0),
      revenue_cents: Number(revenueStats?.revenue_cents || 0),
      landing_page_id: row.landing_page_id,
      offer_id: row.offer_id,
      variant,
    }
  }).sort((a, b) => b.revenue_cents - a.revenue_cents || b.purchase_count - a.purchase_count || b.click_count - a.click_count)

  const pageEventStats = db.prepare(`
    SELECT
      landing_page_id,
      SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS visits,
      SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clicks,
      SUM(CASE WHEN event_type = 'checkout_started' THEN 1 ELSE 0 END) AS checkout_started,
      SUM(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS purchases
    FROM attribution_events
    WHERE COALESCE(landing_page_id, '') != ''
    GROUP BY landing_page_id
  `).all() as Array<{ landing_page_id: string; visits: number; clicks: number; checkout_started: number; purchases: number }>

  const pageRevenueStats = db.prepare(`
    SELECT
      landing_page_id,
      COALESCE(SUM(amount_cents), 0) AS revenue_cents
    FROM revenue_events
    WHERE COALESCE(landing_page_id, '') != ''
    GROUP BY landing_page_id
  `).all() as Array<{ landing_page_id: string; revenue_cents: number }>

  const pageStatMap = new Map(pageEventStats.map(item => [item.landing_page_id, item]))
  const pageRevenueMap = new Map(pageRevenueStats.map(item => [item.landing_page_id, item]))

  const pageRows = db.prepare(`
    SELECT
      lp.id,
      lp.name,
      lp.slug
    FROM landing_pages lp
    ORDER BY lp.created_at DESC
    LIMIT 25
  `).all().map((row: any) => ({
    ...row,
    visits: Number(pageStatMap.get(row.id)?.visits || 0),
    clicks: Number(pageStatMap.get(row.id)?.clicks || 0),
    checkout_started: Number(pageStatMap.get(row.id)?.checkout_started || 0),
    purchases: Number(pageStatMap.get(row.id)?.purchases || 0),
    revenue_cents: Number(pageRevenueMap.get(row.id)?.revenue_cents || 0),
  })).sort((a, b) => b.revenue_cents - a.revenue_cents || b.purchases - a.purchases || b.visits - a.visits)

  const subscriptionStates = db.prepare(`
    SELECT
      COALESCE(NULLIF(status, ''), 'unknown') AS status,
      COALESCE(NULLIF(billing_status, ''), COALESCE(NULLIF(status, ''), 'unknown')) AS billing_status,
      SUM(CASE WHEN failed_payment = 1 THEN 1 ELSE 0 END) AS failed_payment_count,
      COUNT(*) AS total
    FROM subscription_events
    GROUP BY status, billing_status
    ORDER BY total DESC
  `).all()

  const latestSubscriptionEvents = db.prepare(`
    SELECT
      stripe_subscription_id,
      stripe_customer_id,
      offer_id,
      landing_page_id,
      status,
      billing_status,
      failed_payment,
      created_at,
      updated_at,
      metadata_json
    FROM subscription_events
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 20
  `).all().map((row: any) => ({
    ...row,
    failed_payment: Boolean(row.failed_payment),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
  }))

  const recentRevenueEvents = db.prepare(`
    SELECT
      id,
      post_id,
      platform,
      cta_id,
      landing_page_id,
      offer_id,
      amount_cents,
      currency,
      kind,
      stripe_customer_id,
      stripe_subscription_id,
      metadata_json,
      created_at
    FROM revenue_events
    ORDER BY created_at DESC
    LIMIT 20
  `).all().map((row: any) => ({
    ...row,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
  }))

  res.json({
    ok: true,
    totals,
    timeline,
    revenue_breakdown: {
      offers: revenueByOffer,
      landing_pages: revenueByLandingPage,
      ctas: ctaRows,
      posts: revenueByPost,
      platforms: revenueByPlatform,
    },
    analytics: {
      totals: {
        page_views: Number(analyticsTotals.page_views || 0),
        cta_clicks: Number(analyticsTotals.cta_clicks || 0),
        checkout_started: Number(analyticsTotals.checkout_started || 0),
        purchases: Number(analyticsTotals.purchases || 0),
      },
      cta_variants: ctaRows,
      pages: pageRows,
      landing_pages: pageRows,
    },
    subscriptions: {
      states: subscriptionStates,
      latest: latestSubscriptionEvents,
    },
    recent_events: recentRevenueEvents,
  })
})

revenueRouter.get('/timeline', (_req, res) => {
  const items = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COALESCE(SUM(amount_cents), 0) AS revenue_cents, COUNT(*) AS orders
    FROM revenue_events
    GROUP BY substr(created_at, 1, 10)
    ORDER BY day DESC
    LIMIT 30
  `).all()
  res.json({ ok: true, items })
})
