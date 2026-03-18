import { useEffect, useState } from 'react'
import {
  cancelSubscription,
  changePlan,
  createBillingCheckout,
  createPortalSession,
  getBillingStatus,
  type BillingStatus,
} from '../api'
import LoadingSpinner from './LoadingSpinner'

const PLAN_ORDER = ['starter', 'pro', 'agency'] as const

const PLAN_COPY: Record<typeof PLAN_ORDER[number], { label: string; price: string; summary: string }> = {
  starter: {
    label: 'Starter',
    price: '$49/mo',
    summary: 'Blog + image pipeline, WordPress publishing, social scheduling across all 7 platforms. 30 runs/month.',
  },
  pro: {
    label: 'Pro',
    price: '$149/mo',
    summary: 'Full pipeline (blog + image + audio + video), comment auto-reply, autonomous mode, AI daily topics. 100 runs/month.',
  },
  agency: {
    label: 'Agency',
    price: '$399/mo',
    summary: 'Everything in Pro, unlimited runs, 10 brands, named AI personas per brand, and dedicated support.',
  },
}

const PLAN_LIMITS: Record<typeof PLAN_ORDER[number], Record<string, number>> = {
  starter: {
    content_jobs: 30,
    voice_minutes: 0,
    video_jobs: 0,
    brands: 1,
    connected_sites: 1,
    team_members: 1,
  },
  pro: {
    content_jobs: 100,
    voice_minutes: -1,
    video_jobs: -1,
    brands: 3,
    connected_sites: 3,
    team_members: 3,
  },
  agency: {
    content_jobs: -1,
    voice_minutes: -1,
    video_jobs: -1,
    brands: 10,
    connected_sites: 10,
    team_members: 10,
  },
}

const usageRows = [
  { key: 'content_jobs', label: 'Pipeline runs' },
  { key: 'brands', label: 'Brands' },
  { key: 'connected_sites', label: 'Connected sites' },
  { key: 'team_members', label: 'Team members' },
] as const

function formatLimit(value: number) {
  return value === -1 ? 'Unlimited' : String(value)
}

function usagePercent(used: number, limit: number) {
  if (limit <= 0 || limit === -1) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

function statusTone(status?: BillingStatus['billing_state']) {
  if (!status) return 'badge-gray'
  if (status.failed_payment) return 'badge-red'
  if (status.canceled) return 'badge-yellow'
  if (status.active) return 'badge-green'
  return 'badge-gray'
}

export default function BillingPanel() {
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [workingPlan, setWorkingPlan] = useState<string | null>(null)
  const usageMap = (status?.usage || {}) as Record<string, number | { period_start: string; period_end: string | null } | undefined>
  const currentTier = status?.plan?.tier || 'starter'
  const currentPlanCopy = PLAN_COPY[currentTier as keyof typeof PLAN_COPY] || PLAN_COPY.starter
  const planLimits = (status?.entitlements || PLAN_LIMITS[currentTier as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.starter) as Record<string, number>
  const billingStateLabel = status?.billing_state?.status || status?.subscription?.status || (status?.has_payment_method ? 'inactive' : 'no active subscription')
  const billingWindowStart = status?.usage.billing_window?.period_start ? new Date(status.usage.billing_window.period_start).toLocaleDateString() : 'n/a'
  const billingWindowEnd = status?.usage.billing_window?.period_end
    ? new Date(status.usage.billing_window.period_end).toLocaleDateString()
    : status?.subscription
      ? 'open'
      : 'Not started'
  const currentPlanName = status?.plan?.name || currentPlanCopy.label
  const usageSummary = usageRows.map(item => {
    const used = Number(usageMap[`${item.key}_used`] ?? 0)
    const limit = Number(usageMap[`${item.key}_limit`] ?? planLimits[item.key] ?? 0)
    return {
      ...item,
      used,
      limit,
      percent: usagePercent(used, limit),
    }
  })
  const attentionItems = [
    !status?.subscription && !status?.has_payment_method ? 'No active subscription is attached to this workspace yet.' : '',
    status?.subscription?.failed_payment ? 'Payment attention required before billing can continue normally.' : '',
    status?.subscription?.cancel_at_period_end ? 'This subscription is set to cancel at the end of the current period.' : '',
    usageSummary.some(item => item.limit !== -1 && item.limit > 0 && item.used >= item.limit)
      ? 'One or more workspace limits have been reached.'
      : '',
  ].filter(Boolean)
  const featureRows = [
    {
      label: 'Blog + Image Pipeline',
      value: 'All plans',
      note: 'SEO research, long-form blog post, AI image, WordPress publish',
    },
    {
      label: 'Social Publishing (7 platforms)',
      value: 'All plans',
      note: 'WordPress, YouTube, Instagram, TikTok, Facebook, Twitter, LinkedIn',
    },
    {
      label: 'Full Video Pipeline',
      value: currentTier === 'starter' ? 'Pro & Agency' : 'Enabled',
      note: currentTier === 'starter' ? 'Upgrade to Pro for audio + narrated video creation' : 'TTS narration + slide video — 16:9, 9:16, 1:1 formats',
    },
    {
      label: 'Comment Auto-Reply',
      value: currentTier === 'starter' ? 'Pro & Agency' : 'Enabled',
      note: currentTier === 'starter' ? 'Upgrade to Pro to auto-reply across all platforms' : 'AI replies to comments on all platforms + WordPress blog',
    },
    {
      label: 'Autonomous Mode',
      value: currentTier === 'starter' ? 'Pro & Agency' : 'Enabled',
      note: currentTier === 'starter' ? 'Upgrade to Pro to disable approval gates' : 'Fully hands-free — no approval required before publishing',
    },
    {
      label: 'AI Daily Topic Generation',
      value: currentTier === 'starter' ? 'Pro & Agency' : 'Enabled',
      note: currentTier === 'starter' ? 'Starter uses preset topic rotation only' : 'AI generates fresh niche-relevant topics every day',
    },
    {
      label: 'Named AI Personas',
      value: currentTier === 'agency' ? 'Enabled' : 'Agency only',
      note: currentTier === 'agency' ? 'Per-brand AI personas with custom tone and instructions' : 'Upgrade to Agency for per-brand AI persona management',
    },
    {
      label: 'Analytics & Reporting',
      value: currentTier === 'starter' ? 'Basic' : 'Full',
      note: currentTier === 'starter' ? 'Usage stats and output counts' : 'Full analytics — content, social, replies, SEO scores',
    },
  ]

  async function load() {
    setLoading(true)
    try {
      setStatus(await getBillingStatus())
      setNotice('')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load billing')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCheckout(plan: typeof PLAN_ORDER[number]) {
    try {
      setWorkingPlan(plan)
      const result = await createBillingCheckout(plan)
      if (result.url) {
        window.location.href = result.url
        return
      }
      setNotice('Checkout URL was not returned.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not start checkout')
    } finally {
      setWorkingPlan(null)
    }
  }

  async function handleChangePlan(plan: typeof PLAN_ORDER[number]) {
    try {
      setWorkingPlan(plan)
      await changePlan(plan)
      await load()
      setNotice(`Plan changed to ${PLAN_COPY[plan].label}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not change plan')
    } finally {
      setWorkingPlan(null)
    }
  }

  async function handlePortal() {
    try {
      setWorkingPlan('portal')
      const result = await createPortalSession()
      if (result.url) {
        window.location.href = result.url
        return
      }
      setNotice('Billing portal URL was not returned.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not open billing portal')
    } finally {
      setWorkingPlan(null)
    }
  }

  async function handleCancel() {
    try {
      setWorkingPlan('cancel')
      await cancelSubscription()
      await load()
      setNotice('Subscription will cancel at period end.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not cancel subscription')
    } finally {
      setWorkingPlan(null)
    }
  }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 24px', display: 'grid', gap: 18 }}>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Billing</div>
            <div className="panel-title">Subscription and usage</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              Check billing status, current plan limits, and upgrade options from one place.
            </div>
          </div>
        </div>
        {loading ? (
          <LoadingSpinner fullPanel />
        ) : (
          <>
            <div className="two-col-grid">
              <div style={{ display: 'grid', gap: 10 }}>
                <div className="summary-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <div className="summary-card">
                    <div className="summary-label">Current plan</div>
                    <div className="summary-value summary-value-sm">{currentPlanName}</div>
                    <div className="muted-copy">{currentPlanCopy.price}</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-label">Billing window</div>
                    <div className="summary-value summary-value-sm">{billingWindowEnd}</div>
                    <div className="muted-copy">Current period end</div>
                  </div>
                </div>
                <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
                  Current tier: {currentTier}. {currentPlanCopy.summary}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className={`badge ${statusTone(status?.billing_state)}`}>
                    {billingStateLabel}
                  </span>
                  {status?.subscription?.cancel_at_period_end ? <span className="badge badge-yellow">Cancels at period end</span> : null}
                  {status?.subscription?.failed_payment ? <span className="badge badge-red">Payment attention required</span> : null}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  Billing window: {billingWindowStart}
                  {' '}to{' '}
                  {billingWindowEnd}
                </div>
                {attentionItems.length ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div className="section-title" style={{ marginBottom: 0 }}>Needs attention</div>
                    {attentionItems.map(item => (
                      <div key={item} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(240,180,41,.08)', fontSize: 13 }}>
                        {item}
                      </div>
                    ))}
                  </div>
                ) : status?.billing_state?.active || status?.subscription ? (
                  <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(63,185,80,.08)', fontSize: 13 }}>
                    Billing is in a healthy state right now.
                  </div>
                ) : (
                  <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(88,166,255,.08)', fontSize: 13 }}>
                    This workspace is using the current plan defaults, but there is no active paid subscription on file yet.
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div className="section-title" style={{ marginBottom: 0 }}>Current usage</div>
                {usageSummary.map(item => {
                  return (
                    <div key={item.key} style={{ display: 'grid', gap: 6 }}>
                      <div style={usageRow}>
                        <span>{item.label}</span>
                        <strong>{item.used} / {formatLimit(item.limit)}</strong>
                      </div>
                      {item.limit > 0 && item.limit !== -1 ? (
                        <div style={{ height: 8, borderRadius: 999, background: 'var(--surface2)', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${item.percent}%`,
                              height: '100%',
                              background: item.percent >= 100 ? '#f85149' : item.percent >= 80 ? '#e3b341' : 'var(--accent)',
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="summary-grid">
              {featureRows.map(item => (
                <div key={item.label} className="summary-card">
                  <div className="summary-label">{item.label}</div>
                  <div className="summary-value summary-value-sm">{item.value}</div>
                  <div className="muted-copy">Current membership feature state</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn-secondary" disabled={!status?.has_payment_method || workingPlan === 'portal'} onClick={handlePortal}>
                {workingPlan === 'portal' ? 'Opening...' : 'Open Billing Portal'}
              </button>
              <button className="btn-ghost" disabled={!status?.subscription || workingPlan === 'cancel'} onClick={handleCancel}>
                {workingPlan === 'cancel' ? 'Updating...' : 'Cancel At Period End'}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="section-title">Plans</div>
        <div className="muted-copy" style={{ marginBottom: 4 }}>
          Upgrade when you need more workspace capacity. The current plan is highlighted below.
        </div>
        <div className="three-col-grid">
          {PLAN_ORDER.map(plan => {
            const current = status?.plan?.tier === plan && Boolean(status?.subscription || status?.has_payment_method)
            const limits = plan === 'starter'
              ? [
                  '30 content jobs / mo',
                  '1 brand · 1 connected site',
                  '1 team member',
                  'AI Publishing Queue',
                  'Distribution Agent',
                  'Basic analytics',
                  'Voice & video: not included',
                ]
              : plan === 'pro'
                ? [
                    '100 content jobs / mo',
                    '3 brands · 3 connected sites',
                    '3 team members',
                    'AI Publishing Queue',
                    'Distribution Agent',
                    '180 voice min · 20 video jobs',
                    'White-label branding',
                    'Client portal',
                    'Full analytics & revenue reporting',
                  ]
                : [
                    'Unlimited content jobs',
                    '10 brands · 10 connected sites',
                    '10 team members',
                    'AI Publishing Queue',
                    'Distribution Agent',
                    'Unlimited voice & video',
                    'Full white-label (logo, colors, app label)',
                    'Client portal',
                    'Full analytics & revenue reporting',
                    'Dedicated support',
                  ]

            return (
              <div key={plan} style={{ border: current ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius: 12, padding: 18, display: 'grid', gap: 12 }}>
                <div>
                  <div style={{ color: '#e6edf3', fontSize: 20, fontWeight: 700 }}>{PLAN_COPY[plan].label}</div>
                  <div style={{ color: '#58a6ff', marginTop: 4 }}>{PLAN_COPY[plan].price}</div>
                </div>
                <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>{PLAN_COPY[plan].summary}</div>
                <div style={{ display: 'grid', gap: 6, color: '#e6edf3', fontSize: 13 }}>
                  {limits.map(item => <div key={item}>{item}</div>)}
                </div>
                <button
                  className={current ? 'btn-secondary' : 'btn-primary'}
                  disabled={loading || workingPlan === plan}
                  onClick={() => {
                    if (!status?.subscription || !status.has_payment_method) {
                      handleCheckout(plan)
                      return
                    }
                    if (!current) {
                      handleChangePlan(plan)
                    }
                  }}
                >
                  {workingPlan === plan
                    ? 'Working...'
                    : current
                      ? 'Current Plan'
                      : !status?.subscription || !status?.has_payment_method
                        ? `Choose ${PLAN_COPY[plan].label}`
                        : `Switch To ${PLAN_COPY[plan].label}`}
                </button>
              </div>
            )
          })}
        </div>
        {notice && <div style={{ color: notice.toLowerCase().includes('could not') ? '#f85149' : 'var(--muted)', fontSize: 13 }}>{notice}</div>}
      </section>
    </div>
  )
}

const usageRow = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 0',
  borderBottom: '1px solid var(--border)',
  color: '#e6edf3',
  fontSize: 13,
} as const
