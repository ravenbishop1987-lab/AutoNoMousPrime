/**
 * Lightweight in-memory rate limiting middleware.
 *
 * This is intentionally simple and per-process only — good enough for
 * protecting sensitive routes (auth, jobs, billing) in a single-node setup.
 * For multi-node deployments, replace with Redis or a provider service.
 */

const buckets = new Map()

function makeKey(req, strategy) {
  if (strategy === 'org' && req.org?.id) return `org:${req.org.id}`
  if (strategy === 'user' && req.userId) return `user:${req.userId}`
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  return `ip:${ip}`
}

export function rateLimit({
  windowMs = 60_000,
  max = 30,
  strategy = 'ip', // 'ip' | 'org' | 'user'
  message = 'Too many requests, please slow down.',
} = {}) {
  return (req, res, next) => {
    const now = Date.now()
    const key = makeKey(req, strategy)
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs }

    if (now > bucket.resetAt) {
      bucket.count = 0
      bucket.resetAt = now + windowMs
    }

    bucket.count += 1
    buckets.set(key, bucket)

    if (bucket.count > max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000)
      res.setHeader('Retry-After', String(retryAfterSec))
      return res.status(429).json({
        error: 'rate_limited',
        message,
        retry_after_seconds: retryAfterSec,
      })
    }

    next()
  }
}

