import { useMemo, useState } from 'react'
import { getNotifications, getWorkspaceSession, markNotificationRead, runNotificationScan, type NotificationItem, type WorkspaceSession } from '../api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

function navigateFromNotification(item: NotificationItem) {
  const metadata = item.metadata || {}
  const tab = String(metadata.tab || (item.entity_type === 'review' ? 'reviews' : item.entity_type === 'provider_credential' ? 'providers' : item.entity_type === 'asset' ? 'assets' : 'jobs'))
  window.localStorage.setItem('ap-navigation-target', JSON.stringify({
    tab,
    job_id: item.entity_type === 'job' ? item.entity_id : metadata.target_id || null,
    review_job_id: item.entity_type === 'review' ? item.entity_id : metadata.target_id || null,
    provider_id: item.entity_type === 'provider_credential' ? item.entity_id : null,
    asset_id: item.entity_type === 'asset' ? item.entity_id : null,
  }))
  window.dispatchEvent(new CustomEvent('ap:navigate', { detail: { tab } }))
}

export default function NotificationsPanel() {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [severityFilter, setSeverityFilter] = useState('')
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter(item => {
      const matchesSeverity = !severityFilter || item.severity === severityFilter
      if (!matchesSeverity) return false
      if (!query) return true
      return `${item.title} ${item.body || ''} ${item.notification_type} ${item.entity_type}`.toLowerCase().includes(query)
    })
  }, [items, search, severityFilter])

  const unreadCount = items.filter(item => !item.read_at).length
  const errorCount = items.filter(item => item.severity === 'error').length
  const warningCount = items.filter(item => item.severity === 'warning').length
  const infoCount = items.filter(item => item.severity === 'info').length

  async function load() {
    try {
      const current = await getWorkspaceSession()
      setSession(current)
      if (!current.active_workspace?.id) return
      const data = await getNotifications(current.active_workspace.id, unreadOnly)
      setItems(data.items)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load notifications')
    }
  }

  useAutoRefresh(load, [unreadOnly], { intervalMs: 10000 })

  async function markRead(id: string) {
    if (!session?.active_workspace?.id) return
    try {
      await markNotificationRead(session.active_workspace.id, id)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update notification')
    }
  }

  async function runScan() {
    if (!session?.active_workspace?.id) return
    try {
      const result = await runNotificationScan(session.active_workspace.id)
      setNotice(`Operational trust scan created ${result.count} notifications.`)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not run trust scan')
    }
  }

  return (
    <div className="panel-shell panel-stack">
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Notifications</div>
            <div className="panel-title">Operational alerts and trust checks</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              Review system alerts, quality issues, and trust-scan findings, then jump directly to the affected surface.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={{ color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
              Unread only
            </label>
            <button className="btn-ghost" onClick={runScan}>Run Trust Scan</button>
          </div>
        </div>

        <div className="summary-grid">
          <div className="summary-card"><div className="summary-label">All notifications</div><div className="summary-value">{items.length}</div><div className="muted-copy">Loaded alerts</div></div>
          <div className="summary-card"><div className="summary-label">Unread</div><div className="summary-value">{unreadCount}</div><div className="muted-copy">Needs review</div></div>
          <div className="summary-card"><div className="summary-label">Errors</div><div className="summary-value">{errorCount}</div><div className="muted-copy">High-priority items</div></div>
          <div className="summary-card"><div className="summary-label">Warnings</div><div className="summary-value">{warningCount}</div><div className="muted-copy">At-risk items</div></div>
          <div className="summary-card"><div className="summary-label">Info</div><div className="summary-value">{infoCount}</div><div className="muted-copy">General updates</div></div>
        </div>
      </section>

      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="section-title">Filters</div>
        <div className="responsive-search-filter">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notifications" />
          <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}>
            <option value="">All severities</option>
            <option value="error">Errors</option>
            <option value="warning">Warnings</option>
            <option value="info">Info</option>
          </select>
        </div>
      </section>

      <section className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="title-row">
          <div className="panel-stack" style={{ gap: 4 }}>
            <div className="section-title">Feed</div>
            <div className="muted-copy">{filteredItems.length} notification{filteredItems.length === 1 ? '' : 's'} shown</div>
          </div>
        </div>
        {filteredItems.map(item => (
          <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <strong style={{ color: '#e6edf3' }}>{item.title}</strong>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!item.read_at ? <span className="badge badge-blue">unread</span> : <span className="badge badge-gray">read</span>}
                <span className={`badge ${item.severity === 'error' ? 'badge-red' : item.severity === 'warning' ? 'badge-yellow' : 'badge-green'}`}>{item.severity}</span>
              </div>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>{item.body || item.notification_type}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-gray">{item.entity_type}</span>
              <span className="badge badge-gray">{item.notification_type}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--muted)', fontSize: 12, alignItems: 'center' }}>
              <span>{new Date(item.created_at).toLocaleString()}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-ghost" onClick={() => navigateFromNotification(item)}>Open</button>
                {!item.read_at ? <button className="btn-ghost" onClick={() => markRead(item.id)}>Mark read</button> : <span>Read</span>}
              </div>
            </div>
          </div>
        ))}
      </section>

      {notice && <div className="card" style={{ color: 'var(--muted)' }}>{notice}</div>}
      {!filteredItems.length && session?.active_workspace?.id ? <div className="card" style={{ color: 'var(--muted)' }}>No notifications match the current filters.</div> : null}
    </div>
  )
}
