import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { getAnalyticsOverview } from '../services/analytics.js'

const router = Router()

async function getPortalConfig(orgId) {
  const { data, error } = await supabase
    .from('client_portal_configs')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

async function getPortalPermissions(orgId, memberId) {
  const { data, error } = await supabase
    .from('client_portal_permissions')
    .select('*')
    .eq('org_id', orgId)
    .eq('member_id', memberId)
  if (error) throw error
  return data || []
}

async function getPortalBranding(orgId) {
  const { data, error } = await supabase
    .from('workspace_branding')
    .select('*')
    .eq('workspace_id', orgId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

router.get('/settings', requireAuth, attachOrg, requireRole(['owner', 'admin', 'client']), async (req, res) => {
  const config = await getPortalConfig(req.org.id)
  const permissions = req.orgMembership?.role === 'client'
    ? await getPortalPermissions(req.org.id, req.orgMembership.id)
    : []
  res.json({ ok: true, config, permissions })
})

router.post('/settings', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const payload = {
    org_id: req.org.id,
    portal_slug: req.body.portal_slug || null,
    is_enabled: req.body.is_enabled === true,
    allow_approvals: req.body.allow_approvals !== false,
    allow_calendar: req.body.allow_calendar !== false,
    allow_reports: req.body.allow_reports !== false,
    allowed_report_keys: Array.isArray(req.body.allowed_report_keys) ? req.body.allowed_report_keys : ['overview', 'analytics', 'revenue'],
    welcome_message: req.body.welcome_message || null,
    theme: req.body.theme || {},
    created_by: req.userId,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('client_portal_configs')
    .upsert(payload, { onConflict: 'org_id' })
    .select()
    .single()
  if (error) throw error
  res.json({ ok: true, config: data })
})

router.get('/clients', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const [membersResp, permsResp] = await Promise.all([
    supabase.from('org_members').select('id, email, role, invite_status, created_at, joined_at').eq('org_id', req.org.id).eq('role', 'client').order('created_at', { ascending: false }),
    supabase.from('client_portal_permissions').select('*').eq('org_id', req.org.id).order('created_at', { ascending: false }),
  ])
  if (membersResp.error) throw membersResp.error
  if (permsResp.error) throw permsResp.error
  const permsByMember = new Map()
  for (const item of permsResp.data || []) {
    const current = permsByMember.get(item.member_id) || []
    current.push(item)
    permsByMember.set(item.member_id, current)
  }
  const items = (membersResp.data || []).map(member => ({
    ...member,
    permissions: permsByMember.get(member.id) || [],
  }))
  res.json({ ok: true, items })
})

router.post('/clients', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const email = String(req.body.email || '').trim()
  if (!email) return res.status(400).json({ error: 'email is required' })

  const memberResp = await supabase
    .from('org_members')
    .insert({
      org_id: req.org.id,
      email,
      role: 'client',
      invite_status: 'pending',
      invited_by: req.userId,
    })
    .select()
    .single()
  if (memberResp.error) throw memberResp.error

  const permissionsPayload = {
    org_id: req.org.id,
    member_id: memberResp.data.id,
    brand_id: req.body.brand_id || null,
    can_view_approvals: req.body.can_view_approvals !== false,
    can_view_calendar: req.body.can_view_calendar !== false,
    can_view_reports: req.body.can_view_reports !== false,
    allowed_report_keys: Array.isArray(req.body.allowed_report_keys) ? req.body.allowed_report_keys : ['overview', 'analytics'],
    created_by: req.userId,
  }
  const permissionsResp = await supabase
    .from('client_portal_permissions')
    .insert(permissionsPayload)
    .select()
    .single()
  if (permissionsResp.error) throw permissionsResp.error

  res.status(201).json({ ok: true, member: memberResp.data, permissions: permissionsResp.data })
})

router.patch('/clients/:memberId', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const memberId = req.params.memberId
  if ('invite_status' in req.body || 'email' in req.body) {
    const memberUpdates = {}
    if (req.body.email) memberUpdates.email = req.body.email
    if (req.body.invite_status) memberUpdates.invite_status = req.body.invite_status
    const memberResp = await supabase
      .from('org_members')
      .update(memberUpdates)
      .eq('id', memberId)
      .eq('org_id', req.org.id)
      .eq('role', 'client')
      .select()
      .single()
    if (memberResp.error) throw memberResp.error
  }

  if (req.body.permissions) {
    const payload = {
      org_id: req.org.id,
      member_id: memberId,
      brand_id: req.body.permissions.brand_id || null,
      can_view_approvals: req.body.permissions.can_view_approvals !== false,
      can_view_calendar: req.body.permissions.can_view_calendar !== false,
      can_view_reports: req.body.permissions.can_view_reports !== false,
      allowed_report_keys: Array.isArray(req.body.permissions.allowed_report_keys) ? req.body.permissions.allowed_report_keys : ['overview', 'analytics'],
      created_by: req.userId,
      updated_at: new Date().toISOString(),
    }
    const permissionsResp = await supabase
      .from('client_portal_permissions')
      .upsert(payload, { onConflict: 'member_id,brand_id' })
      .select()
      .single()
    if (permissionsResp.error) throw permissionsResp.error
    return res.json({ ok: true, permissions: permissionsResp.data })
  }

  res.json({ ok: true })
})

router.get('/overview', requireAuth, attachOrg, requireRole(['owner', 'admin', 'reviewer', 'client']), async (req, res) => {
  const config = await getPortalConfig(req.org.id)
  const isClient = req.orgMembership?.role === 'client'
  const permissions = isClient ? await getPortalPermissions(req.org.id, req.orgMembership.id) : []
  const allowedBrandIds = isClient
    ? permissions.map(item => item.brand_id).filter(Boolean)
    : []
  const scopedToAllBrands = !isClient || permissions.some(item => !item.brand_id)

  let approvalsQuery = supabase
    .from('review_threads')
    .select('id, current_status, updated_at, jobs(id, topic, brand_id, created_at)')
    .eq('org_id', req.org.id)
    .order('updated_at', { ascending: false })
    .limit(20)

  let calendarQuery = supabase
    .from('publish_targets')
    .select('id, platform, scheduled_at, publish_result_status, meta_title, brand_id')
    .eq('org_id', req.org.id)
    .order('scheduled_at', { ascending: true })
    .limit(20)

  const [approvalsResp, calendarResp] = await Promise.all([approvalsQuery, calendarQuery])
  if (approvalsResp.error) throw approvalsResp.error
  if (calendarResp.error) throw calendarResp.error

  const scopedApprovals = (approvalsResp.data || []).filter(item => (
    !isClient || scopedToAllBrands || allowedBrandIds.includes(item.jobs?.brand_id)
  ))
  const scopedCalendar = (calendarResp.data || []).filter(item => (
    !isClient || scopedToAllBrands || allowedBrandIds.includes(item.brand_id)
  ))

  let reports = null
  const canViewReports = !isClient || permissions.some(item => item.can_view_reports)
  if (config?.allow_reports !== false && canViewReports) {
    reports = await getAnalyticsOverview(req.org.id)
  }

  res.json({
    ok: true,
    config,
    branding: await getPortalBranding(req.org.id),
    permissions,
    approvals: scopedApprovals,
    calendar: scopedCalendar,
    reports,
  })
})

router.get('/public/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim()
  if (!slug) return res.status(400).json({ error: 'portal slug is required' })

  const config = await supabase
    .from('client_portal_configs')
    .select('*')
    .eq('portal_slug', slug)
    .eq('is_enabled', true)
    .maybeSingle()

  if (config.error) throw config.error
  if (!config.data?.org_id) return res.status(404).json({ error: 'Portal not found' })

  const orgId = config.data.org_id
  const [branding, orgResp, approvalsResp, calendarResp, reports] = await Promise.all([
    getPortalBranding(orgId),
    supabase.from('orgs').select('id, name, email').eq('id', orgId).maybeSingle(),
    config.data.allow_approvals === false
      ? Promise.resolve({ data: [] })
      : supabase
          .from('review_threads')
          .select('id, current_status, updated_at, jobs(id, topic, brand_id, created_at)')
          .eq('org_id', orgId)
          .order('updated_at', { ascending: false })
          .limit(20),
    config.data.allow_calendar === false
      ? Promise.resolve({ data: [] })
      : supabase
          .from('publish_targets')
          .select('id, platform, scheduled_at, publish_result_status, meta_title, brand_id')
          .eq('org_id', orgId)
          .order('scheduled_at', { ascending: true })
          .limit(20),
    config.data.allow_reports === false ? Promise.resolve(null) : getAnalyticsOverview(orgId),
  ])

  if (orgResp.error) throw orgResp.error
  if (approvalsResp.error) throw approvalsResp.error
  if (calendarResp.error) throw calendarResp.error

  res.json({
    ok: true,
    config: config.data,
    branding,
    workspace: orgResp.data || null,
    approvals: approvalsResp.data || [],
    calendar: calendarResp.data || [],
    reports,
  })
})

export default router
