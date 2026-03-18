import { useMemo, useState } from 'react'
import { getActivity, type ActivityItem, getWorkspaceSession, type WorkspaceSession } from '../api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

export default function ActivityPanel() {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [items, setItems] = useState<ActivityItem[]>([])
  const [entityType, setEntityType] = useState('')
  const [activityView, setActivityView] = useState<'all' | 'jobs' | 'reviews' | 'publishing'>('all')
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (activityView === 'jobs') return item.entity_type === 'job'
      if (activityView === 'reviews') return item.entity_type === 'review'
      if (activityView === 'publishing') return ['publish_attempt', 'publish_target', 'post'].includes(item.entity_type)
      return true
    })
  }, [activityView, items])

  const jobCount = items.filter(item => item.entity_type === 'job').length
  const reviewCount = items.filter(item => item.entity_type === 'review').length
  const publishCount = items.filter(item => ['publish_attempt', 'publish_target', 'post'].includes(item.entity_type)).length
  const latestTimestamp = items[0]?.created_at ? new Date(items[0].created_at).toLocaleString() : 'No activity yet'

  async function load() {
    try {
      const current = await getWorkspaceSession()
      setSession(current)
      if (!current.active_workspace?.id) return
      const result = await getActivity(current.active_workspace.id, {
        entity_type: entityType || undefined,
        search: search || undefined,
      })
      setItems(result.items)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load activity')
    }
  }

  useAutoRefresh(load, [entityType, search], { intervalMs: 10000 })

  return (
    <div className="panel-shell panel-stack">
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Activity</div>
            <div className="panel-title">Workspace audit feed</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              Review recent system actions, filter by area, and inspect the latest operational events without digging through raw logs.
            </div>
          </div>
          <div className="inline-wrap">
            <button type="button" className={activityView === 'all' ? 'btn-primary' : 'btn-ghost'} onClick={() => setActivityView('all')}>All</button>
            <button type="button" className={activityView === 'jobs' ? 'btn-primary' : 'btn-ghost'} onClick={() => setActivityView('jobs')}>Jobs</button>
            <button type="button" className={activityView === 'reviews' ? 'btn-primary' : 'btn-ghost'} onClick={() => setActivityView('reviews')}>Reviews</button>
            <button type="button" className={activityView === 'publishing' ? 'btn-primary' : 'btn-ghost'} onClick={() => setActivityView('publishing')}>Publishing</button>
          </div>
        </div>

        <div className="summary-grid">
          <div className="summary-card"><div className="summary-label">All activity</div><div className="summary-value">{items.length}</div><div className="muted-copy">Loaded records</div></div>
          <div className="summary-card"><div className="summary-label">Jobs</div><div className="summary-value">{jobCount}</div><div className="muted-copy">Job events</div></div>
          <div className="summary-card"><div className="summary-label">Reviews</div><div className="summary-value">{reviewCount}</div><div className="muted-copy">Review events</div></div>
          <div className="summary-card"><div className="summary-label">Publishing</div><div className="summary-value">{publishCount}</div><div className="muted-copy">Publish activity</div></div>
          <div className="summary-card"><div className="summary-label">Latest event</div><div className="summary-value summary-value-sm">{latestTimestamp}</div><div className="muted-copy">Most recent activity</div></div>
        </div>

        <div className="responsive-search-filter">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search history" />
          <select value={entityType} onChange={e => setEntityType(e.target.value)}>
            <option value="">All entity types</option>
            <option value="job">Jobs</option>
            <option value="review">Reviews</option>
            <option value="post">Posts</option>
            <option value="publish_attempt">Publish attempts</option>
            <option value="publish_target">Publish targets</option>
          </select>
        </div>
      </section>

      <section className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="title-row">
          <div className="panel-stack" style={{ gap: 4 }}>
            <div className="section-title">Timeline</div>
            <div className="muted-copy">{filteredItems.length} event{filteredItems.length === 1 ? '' : 's'} shown</div>
          </div>
        </div>

        {(filteredItems || []).map(item => (
          <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <strong style={{ color: '#e6edf3' }}>{item.summary}</strong>
              <span className="badge badge-gray">{item.action}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-blue">{item.entity_type}</span>
              <span className="badge badge-gray">{item.actor_type}</span>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              {item.actor_id ? `Actor: ${item.actor_id}` : 'System activity'} · {new Date(item.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </section>

      {notice && <div className="card" style={{ color: 'var(--muted)' }}>{notice}</div>}
      {!filteredItems.length && session?.active_workspace?.id && <div className="card" style={{ color: 'var(--muted)' }}>No activity matches the current filters.</div>}
    </div>
  )
}
