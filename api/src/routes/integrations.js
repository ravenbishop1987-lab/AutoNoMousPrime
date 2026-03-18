import { Router } from 'express'
import Stripe from 'stripe'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'
import { guardConnectedSiteLimit } from '../middleware/planGuard.js'

const router = Router()

function dedupeConnections(items) {
  const map = new Map()
  for (const item of items || []) {
    const scope = item.brand_id || 'workspace'
    const key = `${scope}:${item.provider_key}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, item)
      continue
    }

    const existingTime = new Date(existing.updated_at || existing.last_tested_at || existing.created_at || 0).getTime()
    const nextTime = new Date(item.updated_at || item.last_tested_at || item.created_at || 0).getTime()
    if (nextTime >= existingTime) {
      map.set(key, item)
    }
  }
  return Array.from(map.values())
}

async function findExistingConnection(orgId, providerKey, brandId) {
  let query = supabase
    .from('provider_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('provider_key', providerKey)

  query = brandId ? query.eq('brand_id', brandId) : query.is('brand_id', null)

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

function asConfig(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function resolveSecretReference(value) {
  const raw = firstString(value)
  if (!raw) return ''
  if (raw.startsWith('env:')) {
    return String(process.env[raw.slice(4).trim()] || '').trim()
  }
  return String(process.env[raw] || raw).trim()
}

function firstResolvedSecret(...values) {
  for (const value of values) {
    const resolved = resolveSecretReference(value)
    if (resolved) return resolved
  }
  return ''
}

function getSecretRefValue(secretRefs, keys = ['primary']) {
  const refs = asConfig(secretRefs)
  return firstResolvedSecret(...keys.map(key => refs[key]))
}

function buildEvaluation(status, mappedStatus, message, extra = {}) {
  return { status, mappedStatus, message, ...extra }
}

function normalizeWordPressBaseUrl(value) {
  return firstString(value).replace(/\/+$/, '')
}

async function findProviderCredential(orgId, providerKey, brandId) {
  const fetchLatest = async scopedBrandId => {
    let query = supabase
      .from('provider_credentials')
      .select('*')
      .eq('org_id', orgId)
      .eq('provider_key', providerKey)
      .order('updated_at', { ascending: false })
      .limit(1)

    query = scopedBrandId ? query.eq('brand_id', scopedBrandId) : query.is('brand_id', null)
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return data || null
  }

  if (brandId) {
    const brandScoped = await fetchLatest(brandId)
    if (brandScoped) return brandScoped
  }
  return fetchLatest(null)
}

async function findBrand(orgId, brandId) {
  if (!brandId) return null
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, wp_url, wp_user, wp_app_password')
    .eq('org_id', orgId)
    .eq('id', brandId)
    .maybeSingle()

  if (error) throw error
  return data || null
}

async function verifyWordPressConnection(orgId, connection) {
  const connectionConfig = asConfig(connection.config)
  const providerCredential = await findProviderCredential(orgId, 'wordpress', connection.brand_id || null)
  const credentialConfig = asConfig(providerCredential?.config)
  const brand = await findBrand(orgId, connection.brand_id || null)

  const url = normalizeWordPressBaseUrl(firstString(
    connectionConfig.url,
    connectionConfig.wp_url,
    credentialConfig.url,
    credentialConfig.wp_url,
    brand?.wp_url,
    process.env.WORDPRESS_URL,
    process.env.WP_URL,
  ))
  const username = firstString(
    connectionConfig.username,
    connectionConfig.user,
    connectionConfig.wp_user,
    credentialConfig.username,
    credentialConfig.user,
    credentialConfig.wp_user,
    brand?.wp_user,
    process.env.WORDPRESS_USERNAME,
    process.env.WP_USER,
    process.env.WORDPRESS_USER,
  )
  const password = firstResolvedSecret(
    connectionConfig.app_password,
    connectionConfig.wp_app_password,
    connection.secret_ref,
    credentialConfig.app_password,
    credentialConfig.wp_app_password,
    getSecretRefValue(providerCredential?.secret_refs, ['app_password', 'wp_app_password', 'primary', 'password']),
    brand?.wp_app_password,
    process.env.WORDPRESS_APP_PASSWORD,
    process.env.WP_APP_PASSWORD,
  )

  const missing = []
  if (!url) missing.push('site URL')
  if (!username) missing.push('username')
  if (!password) missing.push('app password')
  if (missing.length) {
    return buildEvaluation(
      'failed',
      'error',
      `WordPress is not fully configured. Missing ${missing.join(', ')}.`,
      { details: { provider: 'wordpress', missing } },
    )
  }

  const endpoint = `${url}/wp-json/wp/v2/users/me?context=edit`
  const startedAt = Date.now()
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        Accept: 'application/json',
        'User-Agent': 'AutonomousPrime/1.0',
      },
    })
    const latencyMs = Date.now() - startedAt
    const rawText = await response.text()
    let payload = null
    try {
      payload = rawText ? JSON.parse(rawText) : null
    } catch {
      payload = null
    }

    if (response.ok) {
      return buildEvaluation(
        'healthy',
        'connected',
        `WordPress authenticated successfully for ${payload?.name || payload?.slug || username}.`,
        {
          latency_ms: latencyMs,
          response_code: response.status,
          details: {
            provider: 'wordpress',
            endpoint,
            site: url,
            user: payload?.slug || username,
          },
        },
      )
    }

    return buildEvaluation(
      'failed',
      'error',
      payload?.message || `WordPress verification failed with HTTP ${response.status}.`,
      {
        latency_ms: latencyMs,
        response_code: response.status,
        details: {
          provider: 'wordpress',
          endpoint,
          site: url,
          code: payload?.code || null,
        },
      },
    )
  } catch (error) {
    return buildEvaluation(
      'failed',
      'error',
      error instanceof Error ? error.message : 'WordPress verification failed',
      {
        latency_ms: Date.now() - startedAt,
        details: {
          provider: 'wordpress',
          endpoint,
          site: url,
        },
      },
    )
  }
}

async function verifyStripeConnection(orgId, connection) {
  const connectionConfig = asConfig(connection.config)
  const providerCredential = await findProviderCredential(orgId, 'stripe', connection.brand_id || null)
  const credentialConfig = asConfig(providerCredential?.config)

  const secretKey = firstResolvedSecret(
    connectionConfig.secret_key,
    connectionConfig.api_key,
    connectionConfig.stripe_secret_key,
    connection.secret_ref,
    credentialConfig.secret_key,
    credentialConfig.api_key,
    credentialConfig.stripe_secret_key,
    getSecretRefValue(providerCredential?.secret_refs, ['secret_key', 'stripe_secret_key', 'api_key', 'primary']),
    process.env.STRIPE_SECRET_KEY,
  )

  if (!secretKey) {
    return buildEvaluation(
      'failed',
      'error',
      'Stripe is not configured. Add a secret key first.',
      { details: { provider: 'stripe', missing: ['secret_key'] } },
    )
  }

  const stripe = new Stripe(secretKey, { apiVersion: '2025-01-27.acacia' })
  const startedAt = Date.now()
  try {
    const balance = await stripe.balance.retrieve()
    const latencyMs = Date.now() - startedAt
    return buildEvaluation(
      'healthy',
      'connected',
      `Stripe secret key authenticated successfully (${balance.livemode ? 'live' : 'test'} mode).`,
      {
        latency_ms: latencyMs,
        response_code: balance.lastResponse?.statusCode || 200,
        details: {
          provider: 'stripe',
          livemode: Boolean(balance.livemode),
          available_balances: Array.isArray(balance.available) ? balance.available.length : 0,
          pending_balances: Array.isArray(balance.pending) ? balance.pending.length : 0,
        },
      },
    )
  } catch (error) {
    return buildEvaluation(
      'failed',
      'error',
      error instanceof Error ? error.message : 'Stripe verification failed',
      {
        latency_ms: Date.now() - startedAt,
        details: {
          provider: 'stripe',
          error_type: error?.type || null,
        },
      },
    )
  }
}

async function evaluateIntegrationTest(orgId, connection) {
  const provider = String(connection.provider_key || '').toLowerCase()

  if (provider === 'wordpress') {
    return verifyWordPressConnection(orgId, connection)
  }

  if (provider === 'stripe') {
    return verifyStripeConnection(orgId, connection)
  }

  if (['claude', 'elevenlabs', 'abacus'].includes(provider)) {
    return buildEvaluation(
      'failed',
      'error',
      `Live verification is not wired yet for ${connection.display_name}.`,
      { details: { provider } },
    )
  }

  return buildEvaluation(
    'failed',
    'error',
    'No provider-specific verification is available for this integration yet.',
    { details: { provider } },
  )
}

function normalizeConnectionForDisplay(connection) {
  return connection
}

router.get('/', requireAuth, attachOrg, async (req, res) => {
  const { data, error } = await supabase
    .from('provider_connections')
    .select('*, provider_health_checks(id, status, latency_ms, response_code, message, checked_at)')
    .eq('org_id', req.org.id)
    .order('provider_key', { ascending: true })

  if (error) throw error
  res.json({ ok: true, integrations: dedupeConnections(data || []).map(normalizeConnectionForDisplay) })
})

router.get('/health', requireAuth, attachOrg, async (req, res) => {
  const { data, error } = await supabase
    .from('provider_connections')
    .select('id, provider_key, display_name, category, status, brand_id, last_tested_at, last_success_at, last_error_at, last_error_message')
    .eq('org_id', req.org.id)
    .order('provider_key', { ascending: true })

  if (error) throw error
  const deduped = dedupeConnections(data || []).map(normalizeConnectionForDisplay)
  res.json({
    ok: true,
    summary: deduped.map(item => ({
      id: item.id,
      provider_key: item.provider_key,
      display_name: item.display_name,
      category: item.category,
      status: item.status,
      scope: item.brand_id ? 'brand' : 'workspace',
      last_tested_at: item.last_tested_at,
      last_success_at: item.last_success_at,
      last_error_at: item.last_error_at,
      last_error_message: item.last_error_message,
    })),
  })
})

router.post('/', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res, next) => {
  const {
    provider_key,
    display_name,
    category = 'other',
    brand_id = null,
    config = {},
    secret_ref = null,
    status = 'disconnected',
  } = req.body

  if (!provider_key?.trim()) return res.status(400).json({ error: 'provider_key is required' })

  const providerKeyLower = String(provider_key || '').trim().toLowerCase()
  const categoryLower = String(category || '').trim().toLowerCase()
  if (providerKeyLower === 'wordpress' || categoryLower === 'cms') {
    let limitBlocked = false
    await guardConnectedSiteLimit(req, {
      status(code) {
        limitBlocked = true
        return {
          json(payload) {
            res.status(code).json(payload)
          },
        }
      },
    }, next)
    if (limitBlocked) return
  }

  const normalizedProviderKey = provider_key.trim()
  const existing = await findExistingConnection(req.org.id, normalizedProviderKey, brand_id)
  const payload = {
      org_id: req.org.id,
      brand_id,
      provider_key: normalizedProviderKey,
      display_name: display_name || normalizedProviderKey,
      category,
      config,
      secret_ref,
      status,
      created_by: req.userId,
    }

  const builder = existing
    ? supabase.from('provider_connections').update(payload).eq('id', existing.id).eq('org_id', req.org.id)
    : supabase.from('provider_connections').insert(payload)

  const { data, error } = await builder.select().single()

  if (error) throw error
  res.status(201).json({ ok: true, integration: data })
})

router.patch('/:id', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const updates = {}
  for (const key of ['display_name', 'category', 'config', 'secret_ref', 'status', 'brand_id']) {
    if (key in req.body) updates[key] = req.body[key]
  }
  const { data, error } = await supabase
    .from('provider_connections')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()

  if (error || !data) return res.status(404).json({ error: 'Integration not found' })
  res.json({ ok: true, integration: data })
})

router.post('/:id/test', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const { status = null, latency_ms = null, response_code = null, message = '', details = {} } = req.body

  const { data: connection, error: connectionError } = await supabase
    .from('provider_connections')
    .select('*')
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .single()

  if (connectionError || !connection) return res.status(404).json({ error: 'Integration not found' })

  const now = new Date().toISOString()
  const evaluation = status
    ? {
        status,
        mappedStatus: status === 'healthy' ? 'connected' : status === 'degraded' ? 'degraded' : 'error',
        message: message || 'Manual test recorded',
        latency_ms,
        response_code,
        details,
      }
    : await evaluateIntegrationTest(req.org.id, connection)

  const [{ data: check, error: checkError }, { error: updateError }] = await Promise.all([
    supabase.from('provider_health_checks').insert({
      provider_connection_id: connection.id,
      org_id: req.org.id,
      brand_id: connection.brand_id,
      status: evaluation.status,
      latency_ms: evaluation.latency_ms ?? latency_ms,
      response_code: evaluation.response_code ?? response_code,
      message: evaluation.message,
      details: evaluation.details || details,
      checked_by: req.userId,
      checked_at: now,
    }).select().single(),
    supabase.from('provider_connections').update({
      status: evaluation.mappedStatus,
      last_tested_at: now,
      last_success_at: evaluation.status === 'healthy' ? now : connection.last_success_at,
      last_error_at: evaluation.status !== 'healthy' ? now : connection.last_error_at,
      last_error_message: evaluation.status !== 'healthy' ? evaluation.message : null,
    }).eq('id', connection.id),
  ])

  if (checkError) throw checkError
  if (updateError) throw updateError
  res.json({ ok: true, check })
})

export default router
