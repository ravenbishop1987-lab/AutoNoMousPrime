import { Router } from 'express'
import { attachOrg, requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'

const router = Router()

async function upsertOnboarding(workspaceId, patch) {
  const { data, error } = await supabase
    .from('workspace_onboarding')
    .upsert({ workspace_id: workspaceId, ...patch }, { onConflict: 'workspace_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

router.get('/', requireAuth, attachOrg, async (req, res) => {
  const { data, error } = await supabase
    .from('workspace_onboarding')
    .select('*')
    .eq('workspace_id', req.org.id)
    .maybeSingle()
  if (error) throw error
  res.json({ ok: true, onboarding: data })
})

router.post('/step', requireAuth, attachOrg, requireRole(['owner', 'admin', 'editor']), async (req, res) => {
  const { step, completed = true, metadata = {} } = req.body
  if (!step?.trim()) return res.status(400).json({ error: 'step is required' })

  const { data: existing } = await supabase
    .from('workspace_onboarding')
    .select('*')
    .eq('workspace_id', req.org.id)
    .maybeSingle()

  const completedSteps = new Set(existing?.completed_steps || [])
  if (completed) completedSteps.add(step.trim())

  const onboarding = await upsertOnboarding(req.org.id, {
    current_step: step.trim(),
    completed_steps: Array.from(completedSteps),
    is_complete: metadata.is_complete === true || existing?.is_complete === true,
    first_brand_id: metadata.first_brand_id || existing?.first_brand_id || null,
    first_job_id: metadata.first_job_id || existing?.first_job_id || null,
    first_scheduled_entry_id: metadata.first_scheduled_entry_id || existing?.first_scheduled_entry_id || null,
  })

  res.json({ ok: true, onboarding })
})

router.post('/complete', requireAuth, attachOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const onboarding = await upsertOnboarding(req.org.id, {
    current_step: 'complete',
    is_complete: true,
  })
  res.json({ ok: true, onboarding })
})

export default router
