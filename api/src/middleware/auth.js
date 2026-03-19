/**
 * Auth middleware for SaaS routes.
 *
 * In production this relies on Clerk. In dev it falls back to a stub user.
 * Organization scoping is still enforced at the application layer.
 */

import '../env.js'
import { supabase } from '../db/supabase.js'

// Only allow disabling auth when explicitly opted-in AND not in production.
// Many local/dev runners don't set NODE_ENV; treat missing NODE_ENV as non-production.
const isProd = process.env.NODE_ENV === 'production'
const disableAuth = process.env.DISABLE_AUTH === 'true'

if (disableAuth && isProd) {
  console.error(
    '\n[AUTH] ⚠️  WARNING: DISABLE_AUTH=true is set in a production environment.\n' +
    '       All requests will be authenticated as dev-user.\n' +
    '       Remove DISABLE_AUTH from your environment variables for real auth.\n'
  )
}

const hasClerk = !!process.env.CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY
const hasSupabase = !!process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes('placeholder')
const hasSupabaseServiceRole = hasSupabase && !!process.env.SUPABASE_SERVICE_ROLE_KEY
const hasSupabaseAuth = hasSupabaseServiceRole && !!process.env.SUPABASE_ANON_KEY

const effectiveHasClerk = hasClerk && !disableAuth
const effectiveHasSupabaseAuth = hasSupabaseAuth && !disableAuth

if (disableAuth || (!effectiveHasClerk && !effectiveHasSupabaseAuth)) {
  console.warn(
    '\n' +
    '╔══════════════════════════════════════════════════════════════════╗\n' +
    '║  AUTH STUB ACTIVE                                                ║\n' +
    '║  All requests are authenticated as dev-user / dev-org (agency). ║\n' +
    '║  Set CLERK_SECRET_KEY and SUPABASE_URL in .env to enable real   ║\n' +
    '║  authentication. DO NOT run this mode in production.            ║\n' +
    '║  If you set DISABLE_AUTH=true, remove it outside development.   ║\n' +
    '║  See AUTH_SETUP.md for step-by-step setup instructions.         ║\n' +
    '╚══════════════════════════════════════════════════════════════════╝\n'
  )
}

async function getClerkMiddleware() {
  const { requireAuth: clerkRequireAuth } = await import('@clerk/express')
  return clerkRequireAuth()
}

export const requireAuth = effectiveHasClerk
  ? (req, res, next) => getClerkMiddleware().then(mw => mw(req, res, next))
  : async (req, res, next) => {
      try {
        if (!effectiveHasSupabaseAuth) {
          req.userContext = { userId: 'dev-user', email: 'dev@localhost', provider: 'dev' }
          return next()
        }

        const token = extractBearerToken(req)
        if (!token) {
          req.userContext = { userId: 'dev-user', email: 'dev@localhost', provider: 'dev' }
          return next()
        }

        const user = await getSupabaseUserFromToken(token)
        if (!user?.id) return res.status(401).json({ error: 'Invalid or expired session' })

        req.userContext = {
          userId: String(user.id),
          email: normalizeEmail(user.email || user.user_metadata?.email || ''),
          provider: 'supabase',
        }
        next()
      } catch (err) {
        next(err)
      }
    }

export function getAuth(req) {
  if (!effectiveHasClerk) return req.userContext ?? { userId: 'dev-user', email: 'dev@localhost', provider: 'dev' }
  return typeof req.auth === 'function' ? req.auth() : (req.auth ?? { userId: null })
}

const DEV_ORG = {
  id: 'dev-org',
  name: 'Dev Organization',
  plan_tier: 'agency',
  stripe_customer_id: null,
  jobs_used_this_month: 0,
  email: 'dev@localhost',
}

function extractWorkspaceId(req) {
  return (
    req.headers['x-workspace-id']
    || req.query?.workspace_id
    || req.body?.workspace_id
    || null
  )
}

function extractBearerToken(req) {
  const header = String(req.headers.authorization || '').trim()
  if (!header.toLowerCase().startsWith('bearer ')) return ''
  return header.slice(7).trim()
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

async function getSupabaseUserFromToken(accessToken) {
  const token = String(accessToken || '').trim()
  if (!token || !effectiveHasSupabaseAuth) return null

  const response = await fetch(`${String(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) return null
  const payload = await response.json()
  return payload && payload.id ? payload : null
}

async function claimPendingWorkspaceInvites(userId, email) {
  const normalizedEmail = normalizeEmail(email)
  if (!userId || !normalizedEmail || !hasSupabase) return

  const { data: pendingInvites, error } = await supabase
    .from('org_members')
    .select('id, invite_status, clerk_user_id, email')
    .is('clerk_user_id', null)
    .in('invite_status', ['pending', 'accepted'])

  if (error) throw error

  const matchingIds = (pendingInvites || [])
    .filter(item => normalizeEmail(item.email) === normalizedEmail)
    .map(item => item.id)

  if (!matchingIds.length) return

  await supabase
    .from('org_members')
    .update({
      clerk_user_id: userId,
      invite_status: 'accepted',
      joined_at: new Date().toISOString(),
    })
    .in('id', matchingIds)
}

export async function attachOrg(req, res, next) {
  try {
    const { userId, email = '' } = getAuth(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    if (!hasSupabaseServiceRole) {
      req.userId = userId
      req.userEmail = normalizeEmail(email)
      req.orgMembership = { id: 'dev-membership', role: 'owner', invite_status: 'accepted' }
      req.org = DEV_ORG
      return next()
    }

    // Dev/stub auth mode: still scope to a real workspace org when Supabase is configured.
    // This prevents "empty data" surprises when DISABLE_AUTH=true or Clerk isn't configured.
    if (disableAuth || !effectiveHasClerk) {
      const workspaceId = extractWorkspaceId(req)
      let orgQuery = supabase
        .from('orgs')
        .select('id, name, plan_tier, stripe_customer_id, subscription_status, jobs_used_this_month, email')

      if (workspaceId) orgQuery = orgQuery.eq('id', workspaceId)
      const { data: org, error: orgError } = workspaceId
        ? await orgQuery.maybeSingle()
        : await orgQuery.order('updated_at', { ascending: false }).limit(1).maybeSingle()

      if (orgError || !org) {
        req.userId = userId
        req.userEmail = normalizeEmail(email)
        req.orgMembership = { id: 'dev-membership', role: 'owner', invite_status: 'accepted' }
        req.org = DEV_ORG
        return next()
      }

      req.userId = userId
      req.userEmail = normalizeEmail(email)
      req.orgMembership = { id: 'dev-membership', role: 'owner', invite_status: 'accepted' }
      req.org = org
      return next()
    }

    await claimPendingWorkspaceInvites(userId, email)

    const workspaceId = extractWorkspaceId(req)
    let query = supabase
      .from('org_members')
      .select('id, org_id, role, invite_status, orgs(id, name, plan_tier, stripe_customer_id, subscription_status, jobs_used_this_month, email)')
      .eq('clerk_user_id', userId)
      .neq('invite_status', 'revoked')

    if (workspaceId) query = query.eq('org_id', workspaceId)

    const { data: memberships, error } = await query.order('created_at', { ascending: true })
    if (error || !memberships?.length) {
      return res.status(403).json({ error: 'No organization found for this user. Complete onboarding first.' })
    }

    const membership = memberships.find(item => item.invite_status !== 'pending') || memberships[0]

    req.userId = userId
    req.userEmail = normalizeEmail(email)
    req.orgMembership = {
      id: membership.id,
      role: membership.role,
      invite_status: membership.invite_status,
    }
    req.org = membership.orgs
    next()
  } catch (err) {
    next(err)
  }
}

export function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles]
  return (req, res, next) => {
    if (!req.orgMembership || !allowed.includes(req.orgMembership.role)) {
      return res.status(403).json({ error: `Requires role: ${allowed.join(' or ')}` })
    }
    next()
  }
}
