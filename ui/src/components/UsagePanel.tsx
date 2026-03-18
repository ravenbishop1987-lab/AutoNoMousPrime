import { useEffect, useState } from 'react'
import { getUsage, getEmailAnalytics, type UsageMetric, type UsageSummary, type EmailAnalyticsTotals } from '../api'
import LoadingSpinner from './LoadingSpinner'

function ProgressBar({ percent, exhausted }: { percent: number; exhausted: boolean }) {
  const color = exhausted ? '#f85149' : percent >= 80 ? '#d29922' : '#3fb950'
  return (
    <div style={{ height: 5, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, percent)}%`, background: color, borderRadius: 4, transition: 'width .4s' }} />
    </div>
  )
}

function MetricRow({ metric }: { metric: UsageMetric }) {
  const limitLabel = metric.unlimited ? 'Unlimited' : metric.limit === 0 ? 'Not included' : `${metric.limit} ${metric.unit}`
  const pct = !metric.unlimited && metric.limit > 0 ? metric.percent : null
  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: pct !== null ? 8 : 0 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{metric.label}</span>
          {metric.description && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>{metric.description}</span>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 16, color: metric.exhausted ? '#f85149' : 'var(--text)' }}>
          {metric.unlimited
            ? <span style={{ color: '#3fb950' }}>Unlimited</span>
            : metric.limit === 0
              ? <span style={{ color: 'var(--muted)' }}>Not included</span>
              : `${metric.used.toLocaleString()} / ${limitLabel}`
          }
        </div>
      </div>
      {pct !== null && <ProgressBar percent={pct} exhausted={metric.exhausted} />}
    </div>
  )
}

function EmailStatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{ background: `${color}0d`, border: `1px solid ${color}28`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function UsagePanel() {
  const [usage,  setUsage]  = useState<UsageSummary | null>(null)
  const [email,  setEmail]  = useState<EmailAnalyticsTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,  setError]  = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.allSettled([
      getUsage().then(setUsage),
      getEmailAnalytics().then(r => setEmail(r.totals ?? null)),
    ])
      .then(([usageResult]) => {
        if (usageResult.status === 'rejected') {
          setError(usageResult.reason?.message || 'Failed to load usage')
        }
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner fullPanel />

  if (error || !usage) {
    return (
      <div className="card" style={{ padding: 32 }}>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          {error || 'Usage data unavailable — Supabase not configured.'}
        </div>
      </div>
    )
  }

  const periodStart = new Date(usage.billing_window.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const periodEnd = usage.billing_window.period_end
    ? new Date(usage.billing_window.period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 900 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Usage</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            Billing period: {periodStart}{periodEnd ? ` – ${periodEnd}` : ' – present'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Plan:</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', textTransform: 'capitalize' }}>
            {usage.plan.name}
          </span>
          <button
            className="btn-ghost"
            style={{ fontSize: 12, padding: '5px 12px' }}
            onClick={() => window.dispatchEvent(new CustomEvent('ap:navigate', { detail: { tab: 'billing' } }))}
          >
            Upgrade →
          </button>
        </div>
      </div>

      {/* Plan usage meters */}
      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: '4px 24px 4px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.08em', padding: '14px 0 4px' }}>PLAN LIMITS</div>
        {usage.metrics.map(metric => (
          <MetricRow key={metric.key} metric={metric} />
        ))}
      </div>

      {/* Email usage summary */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.08em', marginBottom: 12 }}>EMAIL MARKETING — ALL TIME</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          <EmailStatCard label="EMAILS SENT"        value={(email?.sent ?? 0).toLocaleString()}          color="#58a6ff" />
          <EmailStatCard label="OPEN RATE"          value={`${email?.open_rate ?? 0}%`}                  color="#3fb950" sub={`${email?.opens ?? 0} opens`} />
          <EmailStatCard label="CLICK-THROUGH"      value={`${email?.click_rate ?? 0}%`}                 color="#e3b341" sub={`${email?.clicks ?? 0} clicks`} />
          <EmailStatCard label="UNSUBSCRIBES"       value={(email?.unsubs ?? 0).toLocaleString()}         color="#f85149" sub={`${email?.unsub_rate ?? 0}% rate`} />
          <EmailStatCard label="ACTIVE SUBSCRIBERS" value={(email?.active_subscribers ?? 0).toLocaleString()} color="#a78bfa" />
          <EmailStatCard label="COMPLETION RATE"    value={`${email?.completion_rate ?? 0}%`}             color="#3fb950" sub={`${email?.completed_enrollments ?? 0} completed`} />
        </div>
        <div style={{ marginTop: 10, textAlign: 'right' }}>
          <button
            className="btn-ghost"
            style={{ fontSize: 12, padding: '5px 12px' }}
            onClick={() => window.dispatchEvent(new CustomEvent('ap:navigate', { detail: { tab: 'email-analytics' } }))}
          >
            Full Email Analytics →
          </button>
        </div>
      </div>

      {/* What's included quick reference */}
      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: '18px 22px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.08em', marginBottom: 14 }}>INCLUDED IN YOUR PLAN</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {[
            'Content pipeline (blog + image + video)',
            '7-platform social publishing',
            'SEO research + printable reports',
            'AI Chat assistant',
            'Email sequences + scheduling',
            'Subscriber management + CSV import',
            'Embeddable capture forms',
            'Open / click / unsubscribe tracking',
            'Email analytics dashboard',
            'Asset library (images, audio, video)',
            'Commerce + Stripe checkout',
            'White-label branding (Agency)',
          ].map(f => (
            <div key={f} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--muted)', alignItems: 'flex-start' }}>
              <span style={{ color: '#3fb950', flexShrink: 0 }}>✓</span>
              {f}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
