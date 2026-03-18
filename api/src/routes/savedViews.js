import { Router } from 'express'
import { attachOrg, requireAuth } from '../middleware/auth.js'
import { listSavedViews, saveView } from '../services/savedViews.js'

const router = Router()

router.get('/', requireAuth, attachOrg, async (req, res) => {
  const items = await listSavedViews(req.org.id, req.userId, req.query.view_type || null)
  res.json({ ok: true, items })
})

router.post('/', requireAuth, attachOrg, async (req, res) => {
  const item = await saveView(req.org.id, req.userId, req.body)
  res.status(201).json({ ok: true, item })
})

export default router
