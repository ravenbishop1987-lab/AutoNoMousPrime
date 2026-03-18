import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

// Baseline API limiter (in-process). Good enough for single-node/local dev.
// For multi-node/prod, replace with a shared store (Redis).
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req),
})

