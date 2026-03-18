import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { getPublicClientPortal, type PublicClientPortal as PublicClientPortalData } from '../api'

function portalTheme(branding?: PublicClientPortalData['branding']) {
  const cssVars = branding?.css_variables && typeof branding.css_variables === 'object'
    ? Object.entries(branding.css_variables).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
    : []

  return {
    '--portal-accent': branding?.primary_color || '#58a6ff',
    '--portal-accent-2': branding?.accent_color || '#3fb950',
    ...Object.fromEntries(cssVars),
  } as CSSProperties
}

export default function PublicClientPortal({ slug }: { slug: string }) {
  const [portal, setPortal] = useState<PublicClientPortalData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getPublicClientPortal(slug)
      .then(result => {
        if (!active) return
        setPortal(result)
        setError('')
      })
      .catch(exc => {
        if (!active) return
        setPortal(null)
        setError(exc instanceof Error ? exc.message : 'Could not load portal')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [slug])

  useEffect(() => {
    const label = portal?.branding?.app_label || portal?.branding?.brand_name || portal?.workspace?.name || 'Client Portal'
    document.title = label
  }, [portal])

  const cards = useMemo(() => {
    const reports = portal?.reports
    return [
      { label: 'Pending approvals', value: String((portal?.approvals || []).filter(item => String(item.current_status || '') === 'pending').length) },
      { label: 'Upcoming schedule', value: String((portal?.calendar || []).length) },
      { label: 'Jobs in window', value: String(reports?.jobs.total || 0) },
      { label: 'Success rate', value: `${reports?.runs.success_rate || 0}%` },
    ]
  }, [portal])

  if (loading) {
    return <div style={loadingShell}>Loading portal...</div>
  }

  if (!portal?.config || error) {
    return <div style={loadingShell}>{error || 'Portal not found.'}</div>
  }

  const label = portal.branding?.app_label || portal.branding?.brand_name || portal.workspace?.name || 'Client Portal'
  const logoUrl = portal.branding?.logo_url || ''

  return (
    <div style={{ ...portalShell, ...portalTheme(portal.branding) }}>
      <div style={heroCard}>
        <div style={heroHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {logoUrl ? <img src={logoUrl} alt={label} style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover' }} /> : <div style={logoBadge}>CP</div>}
            <div>
              <div style={eyebrow}>Client Portal</div>
              <h1 style={heroTitle}>{label}</h1>
            </div>
          </div>
          <div style={workspaceMeta}>
            <div>{portal.workspace?.name || 'Workspace'}</div>
            <div>{portal.workspace?.email || portal.branding?.support_email || ''}</div>
          </div>
        </div>
        <p style={heroText}>
          {portal.config.welcome_message || 'Review current approvals, scheduled work, and delivery health from one client-facing view.'}
        </p>
      </div>

      <section style={statsGrid}>
        {cards.map(card => (
          <div key={card.label} style={statCard}>
            <div style={statLabel}>{card.label}</div>
            <div style={statValue}>{card.value}</div>
          </div>
        ))}
      </section>

      <div style={contentGrid}>
        <section style={panelCard}>
          <div style={panelTitle}>Approvals</div>
          {!portal.approvals.length ? (
            <div style={mutedCopy}>No approval items are visible right now.</div>
          ) : (
            portal.approvals.slice(0, 10).map(item => (
              <div key={String(item.id)} style={listRow}>
                <strong>{String((item.jobs as { topic?: string } | undefined)?.topic || 'Approval item')}</strong>
                <span style={listMeta}>{String(item.current_status || 'pending')}</span>
              </div>
            ))
          )}
        </section>

        <section style={panelCard}>
          <div style={panelTitle}>Calendar</div>
          {!portal.calendar.length ? (
            <div style={mutedCopy}>No scheduled items are visible right now.</div>
          ) : (
            portal.calendar.slice(0, 10).map(item => (
              <div key={String(item.id)} style={listRow}>
                <strong>{String(item.meta_title || item.platform || 'Scheduled item')}</strong>
                <span style={listMeta}>{String(item.scheduled_at || 'Unscheduled')}</span>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  )
}

const portalShell = {
  minHeight: '100vh',
  background: 'linear-gradient(180deg, #0d1117 0%, #111827 100%)',
  color: '#e6edf3',
  padding: '32px 20px 56px',
} as const

const loadingShell = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  background: '#0d1117',
  color: '#c9d1d9',
} as const

const heroCard = {
  maxWidth: 1180,
  margin: '0 auto 18px',
  padding: 24,
  borderRadius: 20,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'linear-gradient(145deg, rgba(88,166,255,0.14), rgba(17,24,39,0.94))',
  display: 'grid',
  gap: 16,
} as const

const heroHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  alignItems: 'center',
  flexWrap: 'wrap',
} as const

const logoBadge = {
  width: 40,
  height: 40,
  borderRadius: 10,
  background: 'var(--portal-accent)',
  color: '#081018',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 800,
} as const

const eyebrow = {
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: '#8b949e',
} as const

const heroTitle = {
  margin: 0,
  fontSize: 'clamp(28px, 4vw, 44px)',
} as const

const heroText = {
  margin: 0,
  maxWidth: 760,
  color: '#c9d1d9',
  lineHeight: 1.6,
} as const

const workspaceMeta = {
  display: 'grid',
  gap: 4,
  textAlign: 'right' as const,
  color: '#8b949e',
  fontSize: 13,
} as const

const statsGrid = {
  maxWidth: 1180,
  margin: '0 auto 18px',
  display: 'grid',
  gap: 14,
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
} as const

const statCard = {
  padding: 18,
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(17,24,39,0.86)',
} as const

const statLabel = {
  fontSize: 12,
  color: '#8b949e',
  marginBottom: 6,
} as const

const statValue = {
  fontSize: 28,
  fontWeight: 800,
} as const

const contentGrid = {
  maxWidth: 1180,
  margin: '0 auto',
  display: 'grid',
  gap: 18,
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
} as const

const panelCard = {
  padding: 20,
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(17,24,39,0.86)',
  display: 'grid',
  gap: 12,
} as const

const panelTitle = {
  fontSize: 16,
  fontWeight: 700,
} as const

const listRow = {
  display: 'grid',
  gap: 4,
  paddingBottom: 12,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
} as const

const listMeta = {
  fontSize: 12,
  color: '#8b949e',
} as const

const mutedCopy = {
  color: '#8b949e',
  lineHeight: 1.6,
} as const
