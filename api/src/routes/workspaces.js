import { Router } from 'express'
import { attachOrg, getAuth, requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { guardTeamMemberLimit } from '../middleware/planGuard.js'

const router = Router()

router.get('/session', requireAuth, attachOrg, async (req, res) => {
  const { userId } = getAuth(req)

  const disableAuth = process.env.DISABLE_AUTH === 'true'
  const { data: memberships, error } = disableAuth
    ? await supabase
        .from('orgs')
        .select('id, name, plan_tier, jobs_used_this_month, email')
        .order('created_at', { ascending: true })
    : await supabase
        .from('org_members')
        .select('id, org_id, role, invite_status, orgs(id, name, plan_tier, jobs_used_this_month, email)')
        .eq('clerk_user_id', userId)
        .neq('invite_status', 'revoked')
        .order('created_at', { ascending: true })

  if (error) throw error

  const { data: onboarding } = await supabase
    .from('workspace_onboarding')
    .select('*')
    .eq('workspace_id', req.org.id)
    .maybeSingle()

  res.json({
    ok: true,
    user: { id: userId },
    active_workspace: req.org,
    membership: req.orgMembership,
    workspaces: disableAuth
      ? (memberships || []).map(item => ({
          id: item.id,
          name: item.name,
          plan_tier: item.plan_tier,
          role: 'owner',
          invite_status: 'accepted',
        }))
      : (memberships || []).map(item => ({
          id: item.orgs?.id,
          name: item.orgs?.name,
          plan_tier: item.orgs?.plan_tier,
          role: item.role,
          invite_status: item.invite_status,
        })),
    onboarding,
    onboarding_required: !onboarding?.is_complete,
  })
})

router.get('/', requireAuth, async (req, res) => {
  const { userId } = getAuth(req)
  const disableAuth = process.env.DISABLE_AUTH === 'true'
  const { data, error } = disableAuth
    ? await supabase
        .from('orgs')
        .select('id, name, plan_tier, jobs_used_this_month, email')
        .order('created_at', { ascending: true })
    : await supabase
        .from('org_members')
        .select('id, org_id, role, invite_status, orgs(id, name, plan_tier, jobs_used_this_month, email)')
        .eq('clerk_user_id', userId)
        .neq('invite_status', 'revoked')
        .order('created_at', { ascending: true })

  if (error) throw error
  res.json({
    ok: true,
    workspaces: disableAuth
      ? (data || []).map(item => ({
          id: item.id,
          name: item.name,
          plan_tier: item.plan_tier,
          jobs_used_this_month: item.jobs_used_this_month ?? 0,
          role: 'owner',
          invite_status: 'accepted',
        }))
      : (data || []).map(item => ({
          id: item.orgs?.id,
          name: item.orgs?.name,
          plan_tier: item.orgs?.plan_tier,
          jobs_used_this_month: item.orgs?.jobs_used_this_month ?? 0,
          role: item.role,
          invite_status: item.invite_status,
        })),
  })
})

router.post('/', requireAuth, async (req, res) => {
  const { userId, email: authEmail } = getAuth(req)
  const { name, email } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  const { data: org, error: orgError } = await supabase
    .from('orgs')
    .insert({ name: name.trim(), email: email || null, plan_tier: 'starter' })
    .select()
    .single()

  if (orgError) throw orgError

  const { error: memberError } = await supabase
    .from('org_members')
    .insert({
      org_id: org.id,
      clerk_user_id: userId,
      email: email || authEmail || `${userId}@local`,
      role: 'owner',
      invite_status: 'accepted',
      joined_at: new Date().toISOString(),
    })

  if (memberError) throw memberError

  await supabase.from('workspace_onboarding').upsert({
    workspace_id: org.id,
    current_step: 'workspace',
    completed_steps: ['workspace'],
    is_complete: false,
  })

  res.status(201).json({ ok: true, workspace: org })
})

router.get('/:workspaceId/members', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const { data, error } = await supabase
    .from('org_members')
    .select('id, clerk_user_id, email, role, invite_status, invited_by, joined_at, created_at')
    .eq('org_id', req.params.workspaceId)
    .order('created_at', { ascending: true })

  if (error) throw error
  res.json({ ok: true, members: data || [] })
})

router.post('/:workspaceId/members', requireAuth, attachOrg, requireRole(['owner', 'admin']), guardTeamMemberLimit, async (req, res) => {
  const { email, role = 'editor' } = req.body
  if (!email?.trim()) return res.status(400).json({ error: 'email is required' })
  if (!['admin', 'editor', 'reviewer', 'client'].includes(role)) return res.status(400).json({ error: 'invalid role' })

  const { data, error } = await supabase
    .from('org_members')
    .insert({
      org_id: req.params.workspaceId,
      email: email.trim(),
      role,
      invite_status: 'pending',
      invited_by: req.userId,
    })
    .select()
    .single()

  if (error) throw error
  res.status(201).json({ ok: true, member: data })
})

router.patch('/:workspaceId/members/:memberId', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { role, invite_status } = req.body
  const updates = {}
  if (role && ['owner', 'admin', 'editor', 'reviewer'].includes(role)) updates.role = role
  if (invite_status && ['pending', 'accepted', 'revoked'].includes(invite_status)) updates.invite_status = invite_status

  const { data, error } = await supabase
    .from('org_members')
    .update(updates)
    .eq('id', req.params.memberId)
    .eq('org_id', req.params.workspaceId)
    .select()
    .single()

  if (error || !data) return res.status(404).json({ error: 'Member not found' })
  res.json({ ok: true, member: data })
})

router.delete('/:workspaceId/members/:memberId', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { error } = await supabase
    .from('org_members')
    .delete()
    .eq('id', req.params.memberId)
    .eq('org_id', req.params.workspaceId)

  if (error) throw error
  res.json({ ok: true })
})

export default router
