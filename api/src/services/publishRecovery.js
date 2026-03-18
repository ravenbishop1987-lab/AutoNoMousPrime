import { createHash } from 'crypto'

const TRANSIENT_PATTERNS = [
  'timeout',
  'timed out',
  'rate limit',
  '429',
  'too many requests',
  'temporarily unavailable',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
  'connection reset',
  'econnreset',
  'socket hang up',
  'network error',
  'dns',
]

const NON_RETRYABLE_PATTERNS = [
  'invalid credential',
  'unauthorized',
  'forbidden',
  'invalid token',
  'invalid request',
  'validation',
  'unsupported',
  'malformed',
  'permission denied',
  'quota exceeded',
]

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function buildDispatchFingerprint(payload) {
  const serialized = stableSerialize(payload || {})
  return createHash('sha256').update(serialized).digest('hex')
}

export function classifyPublishFailure({ message = '', metadata = {}, error_code = '' } = {}) {
  const merged = normalizeText([message, error_code, metadata?.error, metadata?.message].filter(Boolean).join(' '))
  if (!merged) return 'unknown'
  if (NON_RETRYABLE_PATTERNS.some(pattern => merged.includes(pattern))) return 'non_retryable'
  if (TRANSIENT_PATTERNS.some(pattern => merged.includes(pattern))) return 'transient'
  return 'unknown'
}

export function evaluateRetryPolicy({
  latestAttempt = null,
  retryMode = 'safe',
  forceRecovery = false,
  allowRepublish = false,
  maxSafeRetries = 3,
}) {
  const mode = ['safe', 'transient_only', 'force'].includes(retryMode) ? retryMode : 'safe'
  if (!latestAttempt) {
    return { allowed: true, mode, reason: 'initial_submit', classification: null }
  }

  const status = String(latestAttempt.status || '').toLowerCase()
  if (['submitted', 'accepted'].includes(status)) {
    return { allowed: false, mode, reason: 'in_flight_attempt_exists', classification: null }
  }
  if (status === 'published' && !allowRepublish) {
    return { allowed: false, mode, reason: 'already_published', classification: null }
  }

  const retryCount = Number(latestAttempt?.metadata?.retry_count || latestAttempt?.metadata?.recovery?.retry_count || 0)
  if (['failed', 'partial'].includes(status) && mode !== 'force' && !forceRecovery && retryCount >= maxSafeRetries) {
    return { allowed: false, mode, reason: 'safe_retry_limit_reached', classification: null }
  }

  if (!['failed', 'partial'].includes(status)) {
    return { allowed: mode === 'force' || forceRecovery, mode, reason: 'unsafe_replay', classification: null }
  }

  const classification = classifyPublishFailure({
    message: latestAttempt.message || '',
    metadata: latestAttempt.metadata || {},
  })

  if (mode === 'force' || forceRecovery) {
    return { allowed: true, mode, reason: 'forced_recovery', classification }
  }
  if (mode === 'transient_only' && classification !== 'transient') {
    return { allowed: false, mode, reason: 'last_failure_not_transient', classification }
  }
  if (mode === 'safe' && classification === 'non_retryable') {
    return { allowed: false, mode, reason: 'last_failure_non_retryable', classification }
  }

  return { allowed: true, mode, reason: 'safe_recovery', classification }
}

function firstString(value, keys) {
  for (const key of keys) {
    const candidate = value?.[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate)
  }
  return null
}

export function normalizePublishProviderResult(raw = {}, fallbackPlatform = null) {
  const rawStatus = normalizeText(raw.status || raw.state || raw.outcome || '')
  const hasError = Boolean(raw.error || raw.error_message)
  const status = hasError || ['error', 'failed', 'rejected'].includes(rawStatus)
    ? 'failed'
    : ['uploaded', 'published', 'success', 'ok', 'completed'].includes(rawStatus)
      ? 'published'
      : rawStatus
        ? 'partial'
        : 'partial'

  const provider_response_id = firstString(raw, ['id', 'post_id', 'media_id', 'video_id', 'upload_id', 'result_id'])
  const provider_post_url = firstString(raw, ['url', 'post_url', 'permalink', 'share_url', 'link'])
  const message = firstString(raw, ['error', 'error_message', 'message']) || (status === 'published' ? 'Publish confirmed' : 'Publish pending confirmation')

  return {
    platform: String(raw.platform || fallbackPlatform || '').trim().toLowerCase() || null,
    status,
    raw_status: rawStatus || null,
    provider_response_id,
    provider_post_url,
    message,
    classification: status === 'failed'
      ? classifyPublishFailure({ message, metadata: raw, error_code: firstString(raw, ['code', 'error_code']) })
      : null,
    raw,
  }
}
