import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { getAnalyticsOverview } from '../services/analytics.js'

const router = Router()

router.get('/overview', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer', 'client']), async (req, res) => {
  const data = await getAnalyticsOverview(req.org.id)
  res.json({ ok: true, ...data })
})

export default router
