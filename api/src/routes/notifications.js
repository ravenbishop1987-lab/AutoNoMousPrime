import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { listNotifications, markNotificationRead } from '../services/notifications.js'
import { runOperationalTrustScan } from '../services/trustScan.js'

const router = Router()

router.get('/', requireAuth, attachOrg, async (req, res) => {
  const items = await listNotifications(req.org.id, req.userId, {
    unread_only: String(req.query.unread_only || '') === 'true',
  })
  res.json({ ok: true, items })
})

router.post('/:id/read', requireAuth, attachOrg, async (req, res) => {
  const item = await markNotificationRead(req.org.id, req.params.id)
  res.json({ ok: true, item })
})

router.post('/run-scan', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor', 'reviewer']), async (req, res) => {
  const result = await runOperationalTrustScan(req.org.id, req.userId)
  res.json({ ok: true, ...result })
})

export default router
