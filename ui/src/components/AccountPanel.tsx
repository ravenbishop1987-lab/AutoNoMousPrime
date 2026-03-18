import { useEffect, useState } from 'react'
import { LogOut, Shield, UserRound } from 'lucide-react'
import { getWorkspaceSession, type WorkspaceSession } from '../api'
import { getSession, signOut } from '../lib/auth'

function navigate(tab: string) {
  window.dispatchEvent(new CustomEvent('ap:navigate', { detail: { tab } }))
}

const FEATURE_GROUPS = [
  {
    label: 'Content',
    color: '#58a6ff',
    items: [
      { icon: '✍️', label: 'Create',    tab: 'create',    desc: 'AI blog, newsletter, social copy' },
      { icon: '🚀', label: 'Pipeline',  tab: 'pipeline',  desc: 'End-to-end content automation' },
      { icon: '🖼', label: 'Assets',    tab: 'assets',    desc: 'Images, audio, video library' },
      { icon: '📊', label: 'Analytics', tab: 'analytics', desc: 'Performance across all channels' },
    ],
  },
  {
    label: 'Publishing',
    color: '#a78bfa',
    items: [
      { icon: '✨', label: 'Social',   tab: 'social',   desc: 'Publish to 7 platforms' },
      { icon: '💬', label: 'Replies',  tab: 'replies',  desc: 'Auto-reply to comments' },
      { icon: '🔍', label: 'SEO',      tab: 'seo',      desc: 'Research, meta, reports' },
    ],
  },
  {
    label: 'Email Marketing',
    color: '#3fb950',
    items: [
      { icon: '📧', label: 'Sequences',   tab: 'email-sequences',   desc: 'Drip campaigns + day scheduling' },
      { icon: '👥', label: 'Subscribers', tab: 'email-subscribers', desc: 'Manage + bulk enroll' },
      { icon: '📋', label: 'Forms',       tab: 'email-forms',       desc: 'Embeddable capture forms' },
      { icon: '📈', label: 'Analytics',   tab: 'email-analytics',   desc: 'Open rate, CTR, drop-off' },
    ],
  },
  {
    label: 'Monetization',
    color: '#e3b341',
    items: [
      { icon: '🛒', label: 'Commerce', tab: 'commerce', desc: 'Products + storefronts' },
      { icon: '💳', label: 'Billing',  tab: 'billing',  desc: 'Plans, usage, upgrades' },
    ],
  },
  {
    label: 'Settings',
    color: '#8b949e',
    items: [
      { icon: '⚙️', label: 'Settings',     tab: 'settings',     desc: 'Schedule, automation, personas' },
    ],
  },
]

export default function AccountPanel() {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [error, setError] = useState('')
  const authSession = getSession()

  useEffect(() => {
    getWorkspaceSession()
      .then(setSession)
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load account'))
  }, [])

  const handleSignOut = async () => {
    await signOut()
    window.location.reload()
  }

  const planTier = session?.active_workspace?.plan_tier || 'starter'

  return (
    <div style={{ maxWidth: 1040, display: 'grid', gap: 20 }}>

      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Account</h2>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>Profile, workspace, and platform access</div>
      </div>

      {/* Access + workspace cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section className="card" style={{ padding: 22, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserRound size={16} color="#58a6ff" />
            <span style={{ fontWeight: 700, fontSize: 15 }}>Access Summary</span>
          </div>
          <div style={{ display: 'grid', gap: 0 }}>
            {[
              { label: 'Email',         value: authSession?.user?.email || 'Unknown' },
              { label: 'Workspace',     value: session?.active_workspace?.name || 'None' },
              { label: 'Role',          value: session?.membership?.role || 'Unknown' },
              { label: 'Invite status', value: session?.membership?.invite_status || 'Unknown' },
              { label: 'Workspaces',    value: String(session?.workspaces?.length ?? 0) },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span style={{ color: 'var(--muted)' }}>{r.label}</span>
                <strong style={{ color: 'var(--text)' }}>{r.value}</strong>
              </div>
            ))}
          </div>
          <button type="button" className="btn-ghost" onClick={handleSignOut} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 13 }}>
            <LogOut size={13} /> Sign Out
          </button>
        </section>

        <section className="card" style={{ padding: 22, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Shield size={16} color="#3fb950" />
            <span style={{ fontWeight: 700, fontSize: 15 }}>Workspace Status</span>
          </div>
          <div style={{ display: 'grid', gap: 0 }}>
            {[
              { label: 'Plan',       value: planTier,    accent: true },
              { label: 'Onboarding', value: session?.onboarding_required ? 'Pending' : 'Complete', warn: session?.onboarding_required },
              { label: 'Auth',       value: 'Supabase' },
              { label: 'API',        value: 'Node.js SaaS :3001' },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span style={{ color: 'var(--muted)' }}>{r.label}</span>
                <strong style={{ color: r.accent ? 'var(--accent)' : r.warn ? '#f0883e' : 'var(--text)', textTransform: r.accent ? 'capitalize' : undefined }}>
                  {r.value}
                </strong>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" onClick={() => navigate('billing')} style={{ fontSize: 12, padding: '6px 14px' }}>Manage Plan</button>
            <button className="btn-ghost" onClick={() => navigate('settings')} style={{ fontSize: 12, padding: '6px 14px' }}>Settings</button>
          </div>
          {error && <div style={{ color: '#f85149', fontSize: 12 }}>{error}</div>}
        </section>
      </div>

      {/* Feature navigator */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.08em', marginBottom: 14 }}>PLATFORM FEATURES — QUICK NAV</div>
        <div style={{ display: 'grid', gap: 16 }}>
          {FEATURE_GROUPS.map(group => (
            <div key={group.label}>
              <div style={{ fontSize: 10, fontWeight: 700, color: group.color, letterSpacing: '.1em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ height: 1, width: 14, background: group.color, opacity: .5 }} />
                {group.label.toUpperCase()}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
                {group.items.map(item => (
                  <button
                    key={item.tab}
                    onClick={() => navigate(item.tab)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                      background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLButtonElement
                      el.style.borderColor = `${group.color}40`
                      el.style.background  = `${group.color}0a`
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLButtonElement
                      el.style.borderColor = 'rgba(255,255,255,.07)'
                      el.style.background  = 'rgba(255,255,255,.03)'
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{item.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Plan features checklist */}
      <section className="card" style={{ padding: '20px 24px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.08em', marginBottom: 16 }}>WHAT'S INCLUDED IN YOUR PLAN</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
          {[
            { label: 'Content Pipeline',          included: true },
            { label: 'AI Blog + Image Gen',        included: true },
            { label: 'TTS + Video Assembly',       included: planTier !== 'starter' },
            { label: '7-Platform Publishing',      included: true },
            { label: 'SEO Research + Reports',     included: true },
            { label: 'Comment Auto-Reply',         included: planTier !== 'starter' },
            { label: 'Email Sequences',            included: true },
            { label: 'Subscriber Management',      included: true },
            { label: 'Embeddable Capture Forms',   included: true },
            { label: 'Open/Click/Unsub Tracking',  included: true },
            { label: 'Email Analytics Dashboard',  included: true },
            { label: 'Full Autonomous Mode',       included: planTier !== 'starter' },
            { label: 'Named AI Personas',          included: planTier === 'agency' },
            { label: 'White-Label Branding',       included: planTier === 'agency' },
            { label: 'Multi-Brand Management',     included: planTier !== 'starter' },
          ].map(f => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ color: f.included ? '#3fb950' : 'rgba(255,255,255,.18)', flexShrink: 0, fontSize: 14 }}>
                {f.included ? '✓' : '✗'}
              </span>
              <span style={{ color: f.included ? 'var(--text)' : 'var(--muted)' }}>{f.label}</span>
            </div>
          ))}
        </div>
        {planTier === 'starter' && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Unlock video, autonomous mode, comment replies, and more on Pro</span>
            <button className="btn-primary" onClick={() => navigate('billing')} style={{ padding: '7px 16px', fontSize: 12, whiteSpace: 'nowrap' }}>
              Upgrade Plan →
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
