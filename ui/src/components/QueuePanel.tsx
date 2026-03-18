import { useMemo, useState } from 'react'
import {
  bulkUpdateQueue,
  createSavedView,
  getQueueItems,
  getQueueSummary,
  getSavedViews,
  getWorkspaceSession,
  type QueueItem,
  type SavedViewItem,
  type WorkspaceSession,
} from '../api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

function badgeClass(value?: string) {
  if (value === 'ready' || value === 'completed') return 'badge-green'
  if (value === 'failed' || value === 'blocked' || value === 'overdue') return 'badge-red'
  if (value === 'running' || value === 'at_risk') return 'badge-blue'
  if (value === 'awaiting_approval') return 'badge-yellow'
  return 'badge-gray'
}

function formatWhen(value?: string | null) {
  if (!value) return 'Not set'
  return new Date(value).toLocaleString()
}

function formatLabel(value?: string | null) {
  if (!value) return 'Unknown'
  return value.replace(/_/g, ' ')
}

function queuePriority(item: QueueItem) {
  if (item.sla_state === 'overdue' || item.overdue) return 5
  if (item.queue_state === 'blocked' || item.queue_state === 'failed') return 4
  if (item.queue_state === 'awaiting_approval') return 3
  if (item.queue_state === 'missing_assets' || item.queue_state === 'missing_cta' || item.queue_state === 'missing_schedule') return 2
  return 1
}

function queueIssueLabel(item: QueueItem) {
  if (item.queue_state === 'awaiting_approval') return 'Waiting on approval'
  if (item.queue_state === 'missing_assets') return 'Missing required assets'
  if (item.queue_state === 'missing_cta') return 'Missing CTA setup'
  if (item.queue_state === 'missing_schedule') return 'Missing schedule or platform'
  if (item.queue_state === 'failed') return 'Run failed'
  if (item.queue_state === 'blocked') return item.blocked_reasons?.[0] ? `Blocked by ${item.blocked_reasons[0]}` : 'Blocked'
  return item.next_action || 'Ready to move'
}

function readinessSummary(item: QueueItem) {
  const checklist = item.readiness_checklist || []
  const missing = checklist.filter(check => check.status !== 'ready' && check.status !== 'approved')
  if (!missing.length) return 'No blockers in readiness checks'
  return `${missing.length} readiness item${missing.length === 1 ? '' : 's'} still need work`
}

export default function QueuePanel() {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [items, setItems] = useState<QueueItem[]>([])
  const [savedViews, setSavedViews] = useState<SavedViewItem[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [ownerUserId, setOwnerUserId] = useState('')
  const [waitingOn, setWaitingOn] = useState('')
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [queueState, setQueueState] = useState('')
  const [search, setSearch] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [viewName, setViewName] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      const current = await getWorkspaceSession()
      setSession(current)
      if (!current.active_workspace?.id) return
      const [queueData, summaryData, viewData] = await Promise.all([
        getQueueItems(current.active_workspace.id, { queue_state: queueState || undefined, search: search || undefined }),
        getQueueSummary(current.active_workspace.id),
        getSavedViews(current.active_workspace.id, 'queue'),
      ])
      setItems(queueData.items)
      setSummary(summaryData.summary || {})
      setSavedViews(viewData.items)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load queue')
    }
  }

  useAutoRefresh(load, [queueState, search], { intervalMs: 10000 })

  async function saveView() {
    if (!session?.active_workspace?.id || !viewName.trim()) return
    try {
      await createSavedView(session.active_workspace.id, {
        view_type: 'queue',
        name: viewName.trim(),
        filters: { queue_state: queueState, search },
      })
      setViewName('')
      setNotice('Saved queue view created.')
      const next = await getSavedViews(session.active_workspace.id, 'queue')
      setSavedViews(next.items)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save queue view')
    }
  }

  async function runBulk(action: 'mark_blocked' | 'mark_ready' | 'assign_owner') {
    if (!session?.active_workspace?.id || !selectedIds.length) return
    try {
      await bulkUpdateQueue(session.active_workspace.id, {
        job_ids: selectedIds,
        action,
        waiting_on: waitingOn || null,
        owner_user_id: ownerUserId || null,
      })
      setNotice(`Queue bulk action ${action} applied.`)
      setSelectedIds([])
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not run queue bulk action')
    }
  }

  const orderedItems = useMemo(() => {
    return [...items].sort((a, b) => queuePriority(b) - queuePriority(a))
  }, [items])

  const summaryCards = [
    { key: 'ready', label: 'Ready' },
    { key: 'running', label: 'Running' },
    { key: 'awaiting_approval', label: 'Needs approval' },
    { key: 'blocked', label: 'Blocked' },
    { key: 'failed', label: 'Failed' },
    { key: 'missing_assets', label: 'Missing assets' },
    { key: 'missing_cta', label: 'Missing CTA' },
    { key: 'missing_schedule', label: 'Missing schedule' },
  ].filter(item => (summary[item.key] || 0) > 0 || ['ready', 'running', 'awaiting_approval', 'blocked', 'failed'].includes(item.key))

  const hasFilters = Boolean(search || queueState)

  return (
    <div className="panel-shell panel-stack">
      <section className="card panel-stack">
        <div className="section-title">Queue</div>
        <div className="muted-copy">Use this view to see what is stuck, what needs review, and what can move forward now.</div>
        <div className="summary-grid">
          {summaryCards.map(card => (
            <div key={card.key} className="summary-card">
              <div className="summary-label">{card.label}</div>
              <div className="summary-value">{summary[card.key] || 0}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card panel-stack">
        <div className="title-row">
          <div>
            <div className="section-title">Queue filters</div>
            <div className="muted-copy">Search for a job or focus on one queue state.</div>
          </div>
          <div className="inline-wrap">
            <button className="btn-ghost" onClick={() => setShowAdvanced(current => !current)}>
              {showAdvanced ? 'Hide saved views' : 'Saved views'}
            </button>
            {hasFilters ? (
              <button className="btn-ghost" onClick={() => { setSearch(''); setQueueState('') }}>
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        <div className="control-grid">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs in queue" />
          <select value={queueState} onChange={e => setQueueState(e.target.value)}>
            <option value="">All queue states</option>
            <option value="ready">Ready</option>
            <option value="running">Running</option>
            <option value="blocked">Blocked</option>
            <option value="failed">Failed</option>
            <option value="awaiting_approval">Awaiting approval</option>
            <option value="missing_assets">Missing assets</option>
            <option value="missing_cta">Missing CTA</option>
            <option value="missing_schedule">Missing schedule</option>
          </select>
        </div>

        {showAdvanced ? (
          <>
            {savedViews.length ? (
              <div className="inline-wrap">
                {savedViews.map(view => (
                  <button
                    key={view.id}
                    className="btn-ghost"
                    onClick={() => {
                      setQueueState(String(view.filters?.queue_state || ''))
                      setSearch(String(view.filters?.search || ''))
                    }}
                  >
                    {view.name}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="control-grid">
              <input value={viewName} onChange={e => setViewName(e.target.value)} placeholder="Save view as..." />
              <button className="btn-ghost" onClick={saveView}>Save view</button>
            </div>
          </>
        ) : null}
      </section>

      {selectedIds.length ? (
        <section className="card panel-stack">
          <div className="section-title">Bulk update</div>
          <div className="action-banner">
            <div>
              <strong>{selectedIds.length}</strong> selected
            </div>
            <div className="inline-wrap">
              <button className="btn-ghost" onClick={() => runBulk('assign_owner')}>Assign owner</button>
              <button className="btn-ghost" onClick={() => runBulk('mark_blocked')}>Mark blocked</button>
              <button className="btn-ghost" onClick={() => runBulk('mark_ready')}>Mark ready</button>
            </div>
          </div>
          <div className="control-grid">
            <input value={ownerUserId} onChange={e => setOwnerUserId(e.target.value)} placeholder="Owner user id" />
            <input value={waitingOn} onChange={e => setWaitingOn(e.target.value)} placeholder="Waiting on reason" />
          </div>
        </section>
      ) : null}

      <section className="card panel-stack">
        <div className="section-title">Queue items</div>
        {!orderedItems.length && session?.active_workspace?.id ? <div className="empty-state">No queue items match the current filters.</div> : null}
        {orderedItems.map(item => (
          <div key={item.id} className="list-card">
            <div className="title-row">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={e => setSelectedIds(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}
                />
                <span />
              </label>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="list-card-title">{item.topic}</div>
                <div className="list-card-meta">
                  <span>Owner {item.owner_user_id || 'unassigned'}</span>
                  <span>Due {formatWhen(item.due_at)}</span>
                </div>
              </div>
              <div className="inline-wrap">
                <span className={`badge ${badgeClass(item.queue_state)}`}>{formatLabel(item.queue_state)}</span>
                {(item.sla_state === 'overdue' || item.sla_state === 'at_risk' || item.overdue) ? (
                  <span className={`badge ${badgeClass(item.sla_state || 'overdue')}`}>{formatLabel(item.sla_state || 'overdue')}</span>
                ) : null}
              </div>
            </div>

            <div className="muted-copy">{queueIssueLabel(item)}</div>
            <div className="muted-copy">Next step: {item.next_action || 'None'}</div>
            <div className="muted-copy">{readinessSummary(item)}</div>

            {!!item.readiness_checklist?.length ? (
              <div className="inline-wrap">
                {item.readiness_checklist
                  .filter(check => check.status !== 'ready' && check.status !== 'approved')
                  .slice(0, 3)
                  .map(check => (
                    <span key={check.key} className={`badge ${badgeClass(check.status)}`}>{check.label}</span>
                  ))}
              </div>
            ) : null}
          </div>
        ))}
      </section>

      {notice ? <div className="card muted-copy">{notice}</div> : null}
    </div>
  )
}
