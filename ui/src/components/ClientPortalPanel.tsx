import { useEffect, useMemo, useState } from 'react'
import {
  type AnalyticsOverview,
  createClientPortalMember,
  getClientPortalMembers,
  getClientPortalOverview,
  getClientPortalSettings,
  getWorkspaceSession,
  saveClientPortalSettings,
  type ClientPortalConfig,
  type ClientPortalMember,
  type WorkspaceSession,
} from '../api'

const PORTAL_VIEWS = [
  { key: 'setup', label: 'Setup' },
  { key: 'members', label: 'Members' },
  { key: 'preview', label: 'Preview' },
] as const

export default function ClientPortalPanel() {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [config, setConfig] = useState<Partial<ClientPortalConfig>>({ is_enabled: false, allow_approvals: true, allow_calendar: true, allow_reports: true, allowed_report_keys: ['overview', 'analytics'] })
  const [members, setMembers] = useState<ClientPortalMember[]>([])
  const [overview, setOverview] = useState<{ approvals: Array<Record<string, unknown>>; calendar: Array<Record<string, unknown>>; reports: AnalyticsOverview | null } | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<(typeof PORTAL_VIEWS)[number]['key']>('setup')

  const isClient = session?.membership?.role === 'client'
  const clientCount = members.length
  const portalUrl = useMemo(() => {
    const slug = String(config.portal_slug || '').trim()
    if (!slug) return ''
    return `${window.location.origin}/portal/${encodeURIComponent(slug)}`
  }, [config.portal_slug])
  const previewCards = [
    { title: 'Approvals', value: String(overview?.approvals.length || 0) },
    { title: 'Calendar Items', value: String(overview?.calendar.length || 0) },
    { title: 'Jobs', value: String((overview?.reports as any)?.jobs?.total || 0) },
    { title: 'Success Rate', value: `${(overview?.reports as any)?.runs?.success_rate || 0}%` },
  ]

  async function load() {
    try {
      const current = await getWorkspaceSession()
      setSession(current)
      const currentIsClient = current.membership?.role === 'client'
      if (!current.active_workspace?.id) return
      const [settingsResp, overviewResp] = await Promise.all([
        getClientPortalSettings(current.active_workspace.id),
        getClientPortalOverview(current.active_workspace.id),
      ])
      setConfig(settingsResp.config || { is_enabled: false, allow_approvals: true, allow_calendar: true, allow_reports: true, allowed_report_keys: ['overview', 'analytics'] })
      setOverview({
        approvals: overviewResp.approvals || [],
        calendar: overviewResp.calendar || [],
        reports: overviewResp.reports || null,
      })
      if (!currentIsClient) {
        const membersResp = await getClientPortalMembers(current.active_workspace.id)
        setMembers(membersResp.items || [])
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load client portal')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function saveSettings() {
    if (!session?.active_workspace?.id) return
    try {
      await saveClientPortalSettings(session.active_workspace.id, config)
      setNotice('Client portal settings saved.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save client portal settings')
    }
  }

  async function inviteClient() {
    if (!session?.active_workspace?.id || !inviteEmail.trim()) return
    try {
      await createClientPortalMember(session.active_workspace.id, {
        email: inviteEmail.trim(),
        can_view_approvals: true,
        can_view_calendar: true,
        can_view_reports: true,
        allowed_report_keys: ['overview', 'analytics'],
      })
      setInviteEmail('')
      setNotice('Client invited to the portal.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not invite client')
    }
  }

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '32px 24px', display: 'grid', gap: 18 }}>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Client portal</div>
            <div className="panel-title">{isClient ? 'Your client view' : 'Client-facing visibility'}</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              {isClient
                ? 'This view shows the approvals, calendar items, and reporting surfaces exposed to clients.'
                : 'Set up a limited client experience for approvals, scheduling visibility, and selected reporting without exposing the full operator workspace.'}
            </div>
          </div>
          {!isClient ? (
            <div className="inline-wrap">
              {PORTAL_VIEWS.map(item => (
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
          ) : null}
        </div>

        {!isClient ? (
          <div className="summary-grid">
            <MiniCard title="Portal" value={config.is_enabled ? 'On' : 'Off'} compact />
            <MiniCard title="Client members" value={String(clientCount)} compact />
            <MiniCard title="Approvals visible" value={config.allow_approvals !== false ? 'Yes' : 'No'} compact />
            <MiniCard title="Calendar visible" value={config.allow_calendar !== false ? 'Yes' : 'No'} compact />
            <MiniCard title="Reports visible" value={config.allow_reports !== false ? 'Yes' : 'No'} compact />
          </div>
        ) : null}
      </section>

      {!isClient && view === 'setup' && (
        <div className="two-col-grid">
          <section className="card" style={{ display: 'grid', gap: 12 }}>
            <div className="section-title">Portal Settings</div>
            <div className="muted-copy">Choose what clients can see before you start inviting them.</div>
            <label style={checkboxLabel}><input type="checkbox" checked={config.is_enabled === true} onChange={e => setConfig(current => ({ ...current, is_enabled: e.target.checked }))} />Enable client portal</label>
            <label style={checkboxLabel}><input type="checkbox" checked={config.allow_approvals !== false} onChange={e => setConfig(current => ({ ...current, allow_approvals: e.target.checked }))} />Show approvals</label>
            <label style={checkboxLabel}><input type="checkbox" checked={config.allow_calendar !== false} onChange={e => setConfig(current => ({ ...current, allow_calendar: e.target.checked }))} />Show calendar</label>
            <label style={checkboxLabel}><input type="checkbox" checked={config.allow_reports !== false} onChange={e => setConfig(current => ({ ...current, allow_reports: e.target.checked }))} />Show reports</label>
            <label>Portal Slug</label>
            <input value={String(config.portal_slug || '')} onChange={e => setConfig(current => ({ ...current, portal_slug: e.target.value }))} placeholder="acme-client-portal" />
            {portalUrl ? (
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                Portal URL: <a href={portalUrl} target="_blank" rel="noreferrer" style={{ color: '#58a6ff' }}>{portalUrl}</a>
              </div>
            ) : null}
            <label>Welcome Message</label>
            <textarea value={String(config.welcome_message || '')} onChange={e => setConfig(current => ({ ...current, welcome_message: e.target.value }))} rows={4} placeholder="Welcome to your client portal." />
            <button className="btn-primary" onClick={saveSettings}>Save Portal Settings</button>
          </section>

          <section className="card" style={{ display: 'grid', gap: 12 }}>
            <div className="section-title">Client Access</div>
            <div className="muted-copy">Invite clients after the portal basics are configured.</div>
            <label>Email</label>
            <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="client@example.com" />
            <button className="btn-ghost" onClick={inviteClient}>Invite Client</button>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              Clients are workspace members with scoped portal visibility. Core operational routes remain hidden because the `client` role is only allowed on portal and analytics surfaces.
            </div>
          </section>
        </div>
      )}

      {!isClient && view === 'members' && (
        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="title-row">
            <div className="panel-stack" style={{ gap: 4 }}>
              <div className="section-title">Client Members</div>
              <div className="muted-copy">{clientCount} invited client{clientCount === 1 ? '' : 's'}</div>
            </div>
          </div>
          {!members.length ? (
            <div style={{ color: 'var(--muted)' }}>No client members have been invited yet.</div>
          ) : (
            members.map(member => (
              <div key={member.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <strong style={{ color: '#e6edf3' }}>{member.email}</strong>
                  <span className="badge badge-gray">{member.invite_status}</span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  Permissions: {(member.permissions || []).map(item => [
                    item.can_view_approvals ? 'approvals' : '',
                    item.can_view_calendar ? 'calendar' : '',
                    item.can_view_reports ? 'reports' : '',
                  ].filter(Boolean).join(', ')).join(' | ') || 'No permissions set'}
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {(isClient || view === 'preview') && (
      <>
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="section-title">{isClient ? 'Your Portal View' : 'Portal Preview'}</div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {previewCards.map(card => <MiniCard key={card.title} title={card.title} value={card.value} />)}
        </div>
      </section>

      <div className="two-col-grid">
        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="section-title">Approvals</div>
          {(overview?.approvals || []).length ? (
            (overview?.approvals || []).slice(0, 8).map(item => (
              <div key={String(item.id)} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                <strong style={{ color: '#e6edf3' }}>{String((item.jobs as any)?.topic || 'Approval item')}</strong>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>{String(item.current_status || 'pending')}</div>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--muted)' }}>No approval items are visible in the portal yet.</div>
          )}
        </section>

        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="section-title">Calendar</div>
          {(overview?.calendar || []).length ? (
            (overview?.calendar || []).slice(0, 8).map(item => (
              <div key={String(item.id)} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                <strong style={{ color: '#e6edf3' }}>{String(item.meta_title || item.platform || 'Scheduled item')}</strong>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>{String(item.scheduled_at || 'Unscheduled')}</div>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--muted)' }}>No calendar items are visible in the portal yet.</div>
          )}
        </section>
      </div>
      </>
      )}

      {notice && <div className="card" style={{ color: 'var(--muted)' }}>{notice}</div>}
    </div>
  )
}

function MiniCard({ title, value, compact = false }: { title: string; value: string; compact?: boolean }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{title}</div>
      <div style={{ color: '#e6edf3', fontSize: compact ? 22 : 28, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

const checkboxLabel = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  color: 'var(--muted)',
} as const
