import { Router } from 'express'
import { attachOrg, requireAuth } from '../middleware/auth.js'
import { getJobActivity, listActivity } from '../services/activityLog.js'

const router = Router()

router.get('/', requireAuth, attachOrg, async (req, res) => {
  const items = await listActivity(req.org.id, req.query)
  res.json({ ok: true, items })
})

router.get('/jobs/:jobId', requireAuth, attachOrg, async (req, res) => {
  const items = await getJobActivity(req.org.id, req.params.jobId)
  res.json({ ok: true, items })
})

export default router
