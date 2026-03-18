/**
 * Orgs routes — organization + user onboarding
 *
 * POST /saas/orgs/onboard   — create org + membership for a new Clerk user
 * GET  /saas/orgs/me        — return current user's org + plan
 * GET  /saas/orgs/members   — list org members (owner only)
 * POST /saas/orgs/members   — invite member (owner only)
 * DELETE /saas/orgs/members/:userId — remove member (owner only)
 */

import { Router } from 'express'
import { requireAuth, attachOrg, requireRole, getAuth } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'

const router = Router()

// POST /saas/orgs/onboard
// Creates org + owner membership for a newly signed-up Clerk user.
// Call this immediately after Clerk signup completes on the frontend.
router.post('/onboard', requireAuth, async (req, res) => {
  const { userId } = getAuth(req)
  const { org_name, email } = req.body

  if (!org_name) return res.status(400).json({ error: 'org_name is required' })

  // Check if user already has an org
  const { data: existing } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('clerk_user_id', userId)
    .maybeSingle()

  if (existing) {
    return res.status(409).json({ error: 'User already belongs to an organization' })
  }

  // Create org
  const { data: org, error: orgError } = await supabase
    .from('orgs')
    .insert({ name: org_name, plan_tier: 'starter', email })
    .select()
    .single()

  if (orgError) throw orgError

  // Create owner membership
  const { error: memberError } = await supabase
    .from('org_members')
    .insert({ org_id: org.id, clerk_user_id: userId, role: 'owner', email })

  if (memberError) throw memberError

  res.status(201).json({ ok: true, org })
})

// GET /saas/orgs/me
router.get('/me', requireAuth, attachOrg, async (req, res) => {
  const org = req.org
  const limits = getPlanLimits(org.plan_tier)

  // Count brands and members for usage display
  const [{ count: brandCount }, { count: memberCount }] = await Promise.all([
    supabase.from('brands').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
    supabase.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
  ])

  res.json({
    ok: true,
    org: {
      ...org,
      usage: {
        jobs_used_this_month: org.jobs_used_this_month ?? 0,
        jobs_limit: limits.jobs_per_month,
        brands_used: brandCount ?? 0,
        brands_limit: limits.brands,
        seats_used: memberCount ?? 0,
        seats_limit: limits.team_seats,
      },
    },
    role: req.orgMembership.role,
  })
})

// GET /saas/orgs/members
router.get('/members', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const { data: members, error } = await supabase
    .from('org_members')
    .select('id, clerk_user_id, email, role, created_at')
    .eq('org_id', req.org.id)
    .order('created_at')

  if (error) throw error
  res.json({ ok: true, members })
})

// POST /saas/orgs/members — invite
router.post('/members', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { email, role = 'editor' } = req.body
  if (!email) return res.status(400).json({ error: 'email is required' })
  if (!['admin', 'editor', 'reviewer'].includes(role)) return res.status(400).json({ error: 'role must be admin, editor, or reviewer' })

  // Check seat limit
  const limits = getPlanLimits(req.org.plan_tier)
  const { count } = await supabase
    .from('org_members')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', req.org.id)

  if (count >= limits.team_seats) {
    return res.status(402).json({ error: 'Team seat limit reached. Upgrade to add more members.' })
  }

  // Insert pending invite (clerk_user_id filled in when they sign up and onboard)
  const { data: member, error } = await supabase
    .from('org_members')
    .insert({ org_id: req.org.id, email, role, clerk_user_id: null, invite_status: 'pending', invited_by: req.userId })
    .select()
    .single()

  if (error) throw error
  res.status(201).json({ ok: true, member })
})

// DELETE /saas/orgs/members/:userId
router.delete('/members/:userId', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { userId } = req.params
  if (userId === req.userId) return res.status(400).json({ error: 'Cannot remove yourself' })

  const { error } = await supabase
    .from('org_members')
    .delete()
    .eq('org_id', req.org.id)
    .eq('clerk_user_id', userId)

  if (error) throw error
  res.json({ ok: true })
})

// ── Internal helper ──────────────────────────────────────────────────────────
function getPlanLimits(tier) {
  const limits = {
    starter: { jobs_per_month: 30,  brands: 1,  team_seats: 1  },
    pro:     { jobs_per_month: 100, brands: 3,  team_seats: 3  },
    agency:  { jobs_per_month: -1,  brands: 10, team_seats: 10 },
  }
  return limits[tier] ?? limits.starter
}

export default router
