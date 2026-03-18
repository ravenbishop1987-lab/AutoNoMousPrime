/**
 * Autonomous Prime — Node.js SaaS API
 *
 * Handles: auth (Clerk), orgs, billing (Stripe), plan limits, job submission
 * Port: 3001 (React proxies /saas/* here; Python FastAPI stays on :8000)
 *
 * Start: node src/index.js  |  npm run dev (watch mode)
 */

import 'express-async-errors'
import './env.js'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { clerkMiddleware } from '@clerk/express'

// Stub Clerk out when keys are not configured so the server boots in dev
const hasClerk = !!process.env.CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY
if (!hasClerk) console.warn('[AP API] Clerk keys not set — auth middleware disabled (dev mode)')

import orgsRouter    from './routes/orgs.js'
import billingRouter from './routes/billing.js'
import webhookRouter from './routes/webhooks.js'
import jobsRouter    from './routes/jobs.js'
import brandsRouter  from './routes/brands.js'
import workspacesRouter from './routes/workspaces.js'
import reviewsRouter from './routes/reviews.js'
import integrationsRouter from './routes/integrations.js'
import onboardingRouter from './routes/onboarding.js'
import internalRouter from './routes/internal.js'
import assetsRouter from './routes/assets.js'
import activityRouter from './routes/activity.js'
import queueRouter from './routes/queue.js'
import providerSettingsRouter from './routes/providerSettings.js'
import notificationsRouter from './routes/notifications.js'
import savedViewsRouter from './routes/savedViews.js'
import analyticsRouter from './routes/analytics.js'
import templatesRouter from './routes/templates.js'
import clientPortalRouter from './routes/clientPortal.js'
import whiteLabelRouter from './routes/whiteLabel.js'
import suggestionsRouter from './routes/suggestions.js'
import usageRouter from './routes/usage.js'
import emailSequencesRouter from './routes/emailSequences.js'
import emailSubscribersRouter from './routes/emailSubscribers.js'
import emailSmtpRouter from './routes/emailSmtp.js'
import emailTrackingRouter from './routes/emailTracking.js'
import emailAnalyticsRouter from './routes/emailAnalytics.js'
import emailFormsRouter from './routes/emailForms.js'
import emailBroadcastsRouter from './routes/emailBroadcasts.js'
import { rateLimit } from './middleware/rateLimit.js'
import { apiLimiter } from './middleware/apiLimiter.js'
import { startEmailScheduler } from './services/emailScheduler.js'

const app  = express()
const PORT = process.env.PORT || process.env.SAAS_API_PORT || 3001
app.set('etag', false)

// ── Stripe webhooks must receive raw body BEFORE json() middleware ──────────
app.use('/saas/webhooks/stripe', express.raw({ type: 'application/json' }))

// ── Global middleware ────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(morgan('dev'))
app.use(express.json())
app.use('/saas', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  next()
})

// Baseline abuse protection for all SaaS endpoints (skip webhooks).
app.use('/saas', (req, res, next) => {
  if (req.path.startsWith('/webhooks')) return next()
  return apiLimiter(req, res, next)
})
if (hasClerk) {
  app.use(clerkMiddleware())
} else {
  // Dev stub — attach a fake auth so routes don't crash without Clerk
  app.use((req, _res, next) => {
    req.auth = { userId: 'dev-user' }
    next()
  })
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/saas/orgs',     orgsRouter)
app.use('/saas/workspaces', workspacesRouter)
app.use(
  '/saas/billing',
  // Guard billing endpoints against abuse
  rateLimit({ windowMs: 60_000, max: 20, strategy: 'org', message: 'Too many billing requests, please slow down.' }),
  billingRouter,
)
app.use('/saas/webhooks', webhookRouter)
app.use(
  '/saas/jobs',
  // Jobs can be heavy; limit per org
  rateLimit({ windowMs: 60_000, max: 60, strategy: 'org', message: 'Too many job requests, please slow down.' }),
  jobsRouter,
)
app.use('/saas/brands',   brandsRouter)
app.use('/saas/reviews',  reviewsRouter)
app.use('/saas/integrations', integrationsRouter)
app.use('/saas/provider-settings', providerSettingsRouter)
app.use('/saas/onboarding', onboardingRouter)
app.use('/saas/internal', internalRouter)
app.use('/saas/assets', assetsRouter)
app.use('/saas/activity', activityRouter)
app.use('/saas/queue', queueRouter)
app.use('/saas/notifications', notificationsRouter)
app.use('/saas/saved-views', savedViewsRouter)
app.use('/saas/analytics', analyticsRouter)
app.use('/saas/templates', templatesRouter)
app.use('/saas/client-portal', clientPortalRouter)
app.use('/saas/white-label', whiteLabelRouter)
app.use('/saas/suggestions', suggestionsRouter)
app.use('/saas/usage', usageRouter)
app.use('/saas/email-sequences', emailSequencesRouter)
app.use('/saas/email-subscribers', emailSubscribersRouter)
app.use('/saas/email-smtp', emailSmtpRouter)
app.use('/saas/email-track', emailTrackingRouter) // public — no auth
app.use('/saas/email-analytics', emailAnalyticsRouter)
app.use('/saas/email-forms', emailFormsRouter)  // public submit + auth CRUD
app.use('/saas/email-broadcasts', emailBroadcastsRouter)

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/saas/health', (_req, res) => {
  res.json({ ok: true, service: 'autonomous-prime-api', ts: new Date().toISOString() })
})

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[API Error]', err.message)
  const status = err.status || err.statusCode || 500
  res.status(status).json({ error: err.message || 'Internal server error' })
})

// In Node's `--watch` mode on Windows, restarts can occasionally race and leave the
// previous listener alive briefly. Store the server globally and close before re-listening.
const prevServer = globalThis.__apSaasServer
if (prevServer && typeof prevServer.close === 'function') {
  try {
    prevServer.close()
  } catch {
    // ignore
  }
}

const server = app.listen(PORT, () => {
  console.log(`[AP API] Running on http://localhost:${PORT}`)
  startEmailScheduler()
})
globalThis.__apSaasServer = server

const shutdown = () => {
  try {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref?.()
  } catch {
    process.exit(0)
  }
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
