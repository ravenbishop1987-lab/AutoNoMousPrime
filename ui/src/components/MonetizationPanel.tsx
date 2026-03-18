import { useEffect, useState } from 'react'
import type { CommerceRevenueData, RevenueData } from '../api'
import BillingPanel from './BillingPanel'
import RevenuePanel from './RevenuePanel'
import UsagePanel from './UsagePanel'

type View = 'overview' | 'billing' | 'revenue' | 'usage'

interface Props {
  revenue: RevenueData | null
  commerceRevenue: CommerceRevenueData | null
  onRefresh: () => void
  initialView?: View
}

const VIEWS: Array<{ key: View; label: string; description: string }> = [
  { key: 'overview', label: 'Overview', description: 'Subscription health and revenue reporting in one place.' },
  { key: 'billing', label: 'Billing', description: 'Plans, limits, payment health, and subscription state.' },
  { key: 'revenue', label: 'Revenue', description: 'Attribution, conversions, and monetization events.' },
  { key: 'usage', label: 'Usage', description: 'API token consumption, task counts, and cost breakdown.' },
]

export default function MonetizationPanel({
  revenue,
  commerceRevenue,
  onRefresh,
  initialView = 'overview',
}: Props) {
  const [view, setView] = useState<View>(initialView)

  useEffect(() => {
    setView(initialView)
  }, [initialView])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Monetization</div>
            <div className="panel-title">Billing and revenue</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              Manage subscriptions, usage limits, conversions, and attributed revenue without splitting the workflow across two tabs.
            </div>
          </div>
          <div className="inline-wrap">
            {VIEWS.map(item => (
              <button
                key={item.key}
                type="button"
                className={view === item.key ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setView(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="muted-copy">{VIEWS.find(item => item.key === view)?.description}</div>
      </section>

      {view === 'overview' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="two-col-grid">
            <section className="card" style={{ display: 'grid', gap: 10 }}>
              <div className="section-title">Subscription & Billing</div>
              <div style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: 13 }}>
                Manage your plan, payment state, seat limits, and pipeline run quotas. Upgrade to unlock video assembly, autonomous mode, and multi-brand management.
              </div>
              <button type="button" className="btn-ghost" onClick={() => setView('billing')}>
                Open Billing
              </button>
            </section>

            <section className="card" style={{ display: 'grid', gap: 10 }}>
              <div className="section-title">Revenue & Commerce</div>
              <div style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: 13 }}>
                Track CTA performance, landing-page conversions, product sales, and all attributed monetization events in one place.
              </div>
              <button type="button" className="btn-ghost" onClick={() => setView('revenue')}>
                Open Revenue
              </button>
            </section>
          </div>

          {/* Feature summary */}
          <section className="card" style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.08em', marginBottom: 16 }}>PLATFORM CAPABILITIES</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {[
                { icon: '🚀', title: 'Content Pipeline',        desc: 'Blog · Image · Audio · Video — fully automated' },
                { icon: '📡', title: '7-Platform Publishing',   desc: 'WordPress, YouTube, IG, TikTok, FB, Twitter, LinkedIn' },
                { icon: '📧', title: 'Email Sequences',         desc: 'Drip campaigns with open/click tracking built in' },
                { icon: '📋', title: 'Capture Forms',           desc: 'Embeddable opt-in forms → auto-enroll into sequences' },
                { icon: '👥', title: 'Subscriber Management',   desc: 'Import, tag, bulk-enroll, CSV upload' },
                { icon: '📈', title: 'Email Analytics',         desc: 'Open rate, CTR, unsubscribes, step drop-off charts' },
                { icon: '💬', title: 'Comment Auto-Reply',      desc: 'AI replies across all platforms every 15 minutes' },
                { icon: '🔍', title: 'SEO Research + Reports',  desc: 'Keywords, meta, schema, printable HTML reports' },
                { icon: '🛒', title: 'Commerce + Monetization', desc: 'Product pages, storefronts, Stripe checkout' },
                { icon: '🎨', title: 'White-Label Branding',    desc: 'Custom logo, colors, CSS, and domain (Agency)' },
              ].map(f => (
                <div key={f.title} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{f.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{f.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <section className="card" style={{ display: 'grid', gap: 10 }}>
              <div className="section-title">Usage This Period</div>
              <div style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: 13 }}>
                Track API token consumption, pipeline runs, and limits against your current plan quota.
              </div>
              <button type="button" className="btn-ghost" onClick={() => setView('usage')}>
                View Usage
              </button>
            </section>
            <section className="card" style={{ display: 'grid', gap: 10 }}>
              <div className="section-title">Email Marketing</div>
              <div style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: 13 }}>
                Full email analytics — open rates, click-through, unsubscribes, subscriber growth, and per-sequence step drop-off.
              </div>
              <button
                type="button" className="btn-ghost"
                onClick={() => window.dispatchEvent(new CustomEvent('ap:navigate', { detail: { tab: 'email-analytics' } }))}
              >
                View Email Analytics
              </button>
            </section>
          </div>
        </div>
      )}

      {view === 'billing' && <BillingPanel />}
      {view === 'usage' && <UsagePanel />}
      {view === 'revenue' && (
        <RevenuePanel
          revenue={revenue}
          commerceRevenue={commerceRevenue}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}
