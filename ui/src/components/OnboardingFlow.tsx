import { useEffect, useState } from 'react'
import {
  completeOnboarding,
  createBrand,
  createCalendarEntry,
  createJob,
  getBrands,
  getWorkspaceSession,
  saveOnboardingStep,
  submitPipeline,
  upsertIntegration,
  type BrandItem,
  type WorkspaceSession,
} from '../api'

interface Props {
  email: string
  canDismiss?: boolean
  onDismiss?: () => void
  onComplete: () => void
}

const STEPS = [
  'brand',
  'wordpress',
  'first_job',
  'schedule',
] as const

export default function OnboardingFlow({ email, canDismiss = false, onDismiss, onComplete }: Props) {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [brandName, setBrandName] = useState('')
  const [wpUrl, setWpUrl] = useState('')
  const [topic, setTopic] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')
  const [brands, setBrands] = useState<BrandItem[]>([])
  const [firstJobId, setFirstJobId] = useState('')

  async function refreshSession() {
    let current = await getWorkspaceSession().catch(() => null)
    if (!current) {
      const workspaces = await getWorkspaces().catch(() => ({ workspaces: [] }))
      const fallbackWorkspace = workspaces.workspaces?.[0]
      if (fallbackWorkspace) {
        current = await getWorkspaceSession(fallbackWorkspace.id).catch(() => null)
      }
    }
    setSession(current)
    if (current?.active_workspace?.id) {
      const brandData = await getBrands(current.active_workspace.id).catch(() => ({ brands: [] }))
      setBrands(brandData.brands)
      if (current.onboarding?.current_step) {
        const index = STEPS.indexOf(current.onboarding.current_step as typeof STEPS[number])
        if (index >= 0) setStepIndex(index)
      }
    }
  }

  useEffect(() => {
    refreshSession()
  }, [])

  async function saveStep(step: typeof STEPS[number], metadata?: Record<string, unknown>) {
    if (!session?.active_workspace?.id) return
    await saveOnboardingStep(session.active_workspace.id, { step, completed: true, metadata })
    await refreshSession()
  }

  async function next() {
    const currentStep = STEPS[stepIndex]
    try {
      setSubmitting(true)
      if (currentStep === 'brand') {
        if (!session?.active_workspace?.id) throw new Error('Workspace is required before creating a brand')
        const result = await createBrand({ name: brandName.trim() || 'Primary Brand', niche: '', tone: 'professional' }, session.active_workspace.id)
        await saveStep('brand', { first_brand_id: (result.brand as { id?: string })?.id || null })
      }

      if (currentStep === 'wordpress') {
        if (session?.active_workspace?.id) {
          await upsertIntegration(session.active_workspace.id, {
            provider_key: 'wordpress',
            display_name: 'WordPress',
            category: 'cms',
            status: wpUrl.trim() ? 'connected' : 'disconnected',
            config: { url: wpUrl.trim() },
          })
          await saveStep('wordpress')
        }
      }

      if (currentStep === 'first_job') {
        if (session?.active_workspace?.id) {
          const jobTopic = topic.trim() || 'My first Autonomous Prime job'
          const result = await createJob(session.active_workspace.id, {
            topic: jobTopic,
            brand_id: brands[0]?.id || null,
          })
          setFirstJobId(result.job.id)
          await saveStep('first_job', { first_job_id: result.job.id })
          // Kick off the pipeline so the content is generated immediately
          try {
            await submitPipeline(jobTopic, [], '16:9')
          } catch {
            // Pipeline submit failure is non-fatal — job record is created
          }
        }
      }

      if (currentStep === 'schedule') {
        const scheduled = scheduleAt.trim() || new Date(Date.now() + 86400000).toISOString()
        await createCalendarEntry({
          platform: 'wordpress',
          content_type: 'blog_post',
          scheduled_at: scheduled,
          title: topic.trim() || 'First scheduled post',
          payload: { first_job_id: firstJobId || session?.onboarding?.first_job_id || '' },
        })
        if (session?.active_workspace?.id) {
          await saveOnboardingStep(session.active_workspace.id, {
            step: 'schedule',
            completed: true,
            metadata: { first_scheduled_entry_id: scheduled, is_complete: true },
          })
          await completeOnboarding(session.active_workspace.id)
        }
        onComplete()
        return
      }

      setNotice('')
      setStepIndex(index => Math.min(index + 1, STEPS.length - 1))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not complete onboarding step')
    } finally {
      setSubmitting(false)
    }
  }

  const currentStep = STEPS[stepIndex]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 760, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, display: 'grid', gap: 18, position: 'relative' }}>
        {canDismiss ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={onDismiss}
            aria-label="Close onboarding wizard"
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              width: 36,
              height: 36,
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        ) : null}
        <div>
          <div className="section-title">Setup</div>
          <h1 style={{ color: '#e6edf3', fontSize: 28, marginTop: 6 }}>Get started with Autonomous Prime</h1>
          <p style={{ color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
            Set up your brand and publish your first piece of content in a few steps.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`, gap: 8 }}>
          {STEPS.map((step, index) => (
            <div key={step} style={{ height: 8, borderRadius: 999, background: index <= stepIndex ? 'var(--accent)' : 'var(--border)' }} />
          ))}
        </div>

        {currentStep === 'brand' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: '#e6edf3', fontWeight: 700 }}>1. Name your brand</div>
            <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="Prime Content" />
          </div>
        )}

        {currentStep === 'wordpress' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: '#e6edf3', fontWeight: 700 }}>2. Connect WordPress</div>
            <input value={wpUrl} onChange={e => setWpUrl(e.target.value)} placeholder="https://your-site.com" />
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>Skip this to connect later from Settings.</div>
          </div>
        )}

        {currentStep === 'first_job' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: '#e6edf3', fontWeight: 700 }}>3. Enter your first topic</div>
            <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Best AI tools for content creators in 2026" />
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>The pipeline will start generating immediately after you continue.</div>
          </div>
        )}

        {currentStep === 'schedule' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: '#e6edf3', fontWeight: 700 }}>4. Schedule publish date</div>
            <input value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} placeholder="2026-03-16T09:00:00" />
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>Leave blank to schedule for tomorrow.</div>
          </div>
        )}

        {notice && <div style={{ color: '#f85149', fontSize: 13 }}>{notice}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <button className="btn-ghost" disabled={stepIndex === 0} onClick={() => setStepIndex(index => Math.max(index - 1, 0))}>Back</button>
          <button className="btn-primary" disabled={submitting} onClick={next}>{submitting ? 'Working...' : currentStep === 'schedule' ? 'Finish Setup' : 'Continue'}</button>
        </div>
      </div>
    </div>
  )
}
