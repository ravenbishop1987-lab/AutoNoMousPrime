import { useEffect, useMemo, useState } from 'react'
import {
  acquireReviewLock,
  addReviewComment,
  approveReview,
  assignReview,
  bulkUpdateReviews,
  getJobOutputPreview,
  getReviewLock,
  getReviewThreads,
  getWorkspaceSession,
  rejectReview,
  releaseReviewLock,
  requestRevision,
  type EntityLock,
  type JobOutputPreview,
  type ReviewThread,
  type WorkspaceSession,
} from '../api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

function formatWhen(value?: string | null) {
  if (!value) return 'No due date'
  return new Date(value).toLocaleString()
}

function badgeClass(value?: string) {
  if (value === 'approved') return 'badge-green'
  if (value === 'rejected') return 'badge-red'
  if (value === 'revision_requested' || value === 'pending') return 'badge-yellow'
  return 'badge-gray'
}

function formatState(value?: string | null) {
  if (!value) return 'unknown'
  return value.replace(/_/g, ' ')
}

function nextStepForThread(thread: ReviewThread) {
  if (thread.current_status === 'revision_requested') return 'Waiting on revised draft'
  if (thread.current_status === 'approved') return 'Ready to move forward'
  if (thread.current_status === 'rejected') return 'Closed'
  return thread.waiting_on || 'Needs a reviewer decision'
}

function mapLockError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('row-level security policy')) {
    return 'Live edit lock is unavailable right now. You can still review this item.'
  }
  if (message.includes('currently being edited by another user')) {
    return 'Another user already has this review open.'
  }
  return 'Review lock unavailable right now.'
}

export default function ReviewInboxPanel() {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [threads, setThreads] = useState<ReviewThread[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selected, setSelected] = useState<ReviewThread | null>(null)
  const [lock, setLock] = useState<EntityLock | null>(null)
  const [lockNotice, setLockNotice] = useState('')
  const [note, setNote] = useState('')
  const [assignment, setAssignment] = useState({ assignee_user_id: '', due_at: '', waiting_on: '' })
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<JobOutputPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  async function load() {
    try {
      const current = await getWorkspaceSession()
      setSession(current)
      if (!current.active_workspace?.id) return
      const data = await getReviewThreads(current.active_workspace.id)
      setThreads(data.threads)
      if (selected?.job_id) {
        const match = data.threads.find(item => item.job_id === selected.job_id)
        if (match) setSelected(match)
      } else if (data.threads.length) {
        setSelected(data.threads[0])
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load reviews')
    }
  }

  useAutoRefresh(load, [], { intervalMs: 10000 })

  useEffect(() => {
    const handleJobUpdate = () => { load() }
    window.addEventListener('ap:job-update', handleJobUpdate)
    window.addEventListener('ap:status-update', handleJobUpdate)
    return () => {
      window.removeEventListener('ap:job-update', handleJobUpdate)
      window.removeEventListener('ap:status-update', handleJobUpdate)
    }
  }, [])

  useEffect(() => {
    const stored = window.localStorage.getItem('ap-navigation-target')
    if (!stored) return
    try {
      const target = JSON.parse(stored)
      if (target.tab === 'reviews' && target.review_job_id) {
        setSelected({ id: '', job_id: target.review_job_id, current_status: 'pending', created_at: '', updated_at: '' })
      }
    } catch {
      // ignore malformed local storage
    }
  }, [])

  const filteredThreads = useMemo(() => {
    return threads.filter(thread => {
      const matchesStatus = !statusFilter || thread.current_status === statusFilter
      const matchesSearch = !search || (thread.jobs?.topic || '').toLowerCase().includes(search.toLowerCase())
      return matchesStatus && matchesSearch
    })
  }, [threads, statusFilter, search])

  useEffect(() => {
    if (!filteredThreads.length) {
      setSelected(null)
      return
    }
    if (!selected?.job_id || !filteredThreads.some(thread => thread.job_id === selected.job_id)) {
      setSelected(filteredThreads[0])
    }
  }, [filteredThreads, selected?.job_id])

  useEffect(() => {
    if (!selected?.jobs?.topic) { setPreview(null); return }
    let active = true
    setPreviewLoading(true)
    getJobOutputPreview(selected.jobs.topic)
      .then(data => { if (active) setPreview(data) })
      .catch(() => { if (active) setPreview(null) })
      .finally(() => { if (active) setPreviewLoading(false) })
    return () => { active = false }
  }, [selected?.jobs?.topic])

  useEffect(() => {
    async function syncLock() {
      if (!session?.active_workspace?.id || !selected?.job_id) return
      setLock(null)
      setLockNotice('')
      try {
        await acquireReviewLock(session.active_workspace.id, selected.job_id, { reason: 'review_decision' })
      } catch (error) {
        setLockNotice(mapLockError(error))
      }

      try {
        const result = await getReviewLock(session.active_workspace.id, selected.job_id)
        setLock(result.item)
      } catch {
        setLock(null)
      }

      setAssignment({
        assignee_user_id: selected.assignee_user_id || '',
        due_at: selected.due_at ? String(selected.due_at).slice(0, 16) : '',
        waiting_on: selected.waiting_on || '',
      })
    }
    syncLock()
    return () => {
      if (session?.active_workspace?.id && selected?.job_id) {
        releaseReviewLock(session.active_workspace.id, selected.job_id).catch(() => null)
      }
    }
  }, [session?.active_workspace?.id, selected?.job_id])

  async function handle(action: 'approve' | 'reject' | 'revision') {
    if (!session?.active_workspace?.id || !selected?.job_id) return
    try {
      if (action === 'approve') await approveReview(session.active_workspace.id, selected.job_id, note)
      if (action === 'reject') await rejectReview(session.active_workspace.id, selected.job_id, note)
      if (action === 'revision') await requestRevision(session.active_workspace.id, selected.job_id, note)
      if (note.trim()) await addReviewComment(session.active_workspace.id, selected.job_id, { body: note.trim() })
      setNotice(action === 'approve' ? 'Review approved.' : action === 'revision' ? 'Revision requested.' : 'Review rejected.')
      setNote('')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Review action failed')
    }
  }

  async function saveAssignment() {
    if (!session?.active_workspace?.id || !selected?.job_id) return
    try {
      await assignReview(session.active_workspace.id, selected.job_id, {
        assignee_user_id: assignment.assignee_user_id || null,
        due_at: assignment.due_at || null,
        waiting_on: assignment.waiting_on || null,
      })
      setNotice('Review assignment updated.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update review assignment')
    }
  }

  async function runBulk(action: 'assign' | 'approve') {
    if (!session?.active_workspace?.id || !selectedIds.length) return
    try {
      await bulkUpdateReviews(session.active_workspace.id, {
        job_ids: selectedIds,
        action,
        assignee_user_id: assignment.assignee_user_id || null,
        due_at: assignment.due_at || null,
        waiting_on: assignment.waiting_on || null,
      })
      setNotice(`Bulk review action ${action} applied.`)
      setSelectedIds([])
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not run review bulk action')
    }
  }

  const pendingCount = threads.filter(thread => thread.current_status === 'pending').length
  const revisionCount = threads.filter(thread => thread.current_status === 'revision_requested').length
  const approvedCount = threads.filter(thread => thread.current_status === 'approved').length
  const hasFilters = Boolean(search || statusFilter)
  const historyItems = selected
    ? [
        ...(selected.review_actions || []).map(action => ({
          id: `action-${action.id}`,
          title: formatState(action.action),
          body: action.note || 'No note',
          createdAt: action.created_at,
        })),
        ...(selected.review_comments || []).map(comment => ({
          id: `comment-${comment.id}`,
          title: 'Comment',
          body: comment.body,
          createdAt: comment.created_at,
        })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : []

  return (
    <div className="panel-shell panel-stack">
      <section className="card panel-stack">
        <div className="section-title">Review inbox</div>
        <div className="summary-grid">
          <div className="summary-card"><div className="summary-label">Open reviews</div><div className="summary-value">{filteredThreads.length}</div></div>
          <div className="summary-card"><div className="summary-label">Pending</div><div className="summary-value">{pendingCount}</div></div>
          <div className="summary-card"><div className="summary-label">Revision requested</div><div className="summary-value">{revisionCount}</div></div>
          <div className="summary-card"><div className="summary-label">Approved</div><div className="summary-value">{approvedCount}</div></div>
        </div>
      </section>

      <div className="panel-grid">
        <section className="card panel-stack">
          <div className="title-row">
            <div>
              <div className="section-title">Review queue</div>
              <div className="muted-copy">Pick an item, make a decision, and move it forward.</div>
            </div>
            {hasFilters ? <button className="btn-ghost" onClick={() => { setSearch(''); setStatusFilter('') }}>Clear filters</button> : null}
          </div>

          <div className="control-grid">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by topic" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All review states</option>
              <option value="pending">Pending</option>
              <option value="revision_requested">Revision requested</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          {selectedIds.length ? (
            <div className="action-banner">
              <div>
                <strong>{selectedIds.length}</strong> selected
              </div>
              <div className="inline-wrap">
                <button className="btn-ghost" onClick={() => runBulk('assign')}>Assign</button>
                <button className="btn-ghost" onClick={() => runBulk('approve')}>Approve</button>
              </div>
            </div>
          ) : null}

          {!filteredThreads.length ? <div className="empty-state">No review items match the current filters.</div> : null}
          {filteredThreads.map(thread => (
            <div key={thread.id || thread.job_id} className={`list-card ${selected?.job_id === thread.job_id ? 'list-card-active' : ''}`}>
              <div className="title-row">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(thread.job_id)}
                    onChange={e => setSelectedIds(current => e.target.checked ? [...current, thread.job_id] : current.filter(id => id !== thread.job_id))}
                  />
                  <span />
                </label>
                <button className="list-card-button" onClick={() => setSelected(thread)}>
                  <div className="list-card-title">{thread.jobs?.topic || 'Untitled job'}</div>
                  <div className="list-card-meta">
                    <span>{thread.assignee_user_id || 'Unassigned'}</span>
                    <span>{formatWhen(thread.due_at)}</span>
                  </div>
                </button>
              </div>
              <div className="inline-wrap">
                <span className={`badge ${badgeClass(thread.current_status)}`}>{formatState(thread.current_status)}</span>
              </div>
              <div className="muted-copy">Next step: {nextStepForThread(thread)}</div>
            </div>
          ))}
        </section>

        <section className="card panel-stack">
          <div className="section-title">Review detail</div>
          {!selected ? (
            <div className="empty-state">Select a review item to approve, request changes, or reject it.</div>
          ) : (
            <>
              <div className="title-row">
                <div>
                  <div className="panel-title">{selected.jobs?.topic || 'Untitled job'}</div>
                  <div className="list-card-meta">
                    <span>Current state {formatState(selected.current_status)}</span>
                    <span>{formatWhen(selected.due_at)}</span>
                    <span>{selected.assignee_user_id || 'Unassigned'}</span>
                  </div>
                </div>
                <span className={`badge ${badgeClass(selected.current_status)}`}>{formatState(selected.current_status)}</span>
              </div>

              <div className="summary-grid">
                <div className="summary-card">
                  <div className="summary-label">Reviewer</div>
                  <div className="summary-value summary-value-sm">{selected.assignee_user_id || 'Unassigned'}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Due</div>
                  <div className="summary-value summary-value-sm">{formatWhen(selected.due_at)}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Next step</div>
                  <div className="summary-value summary-value-sm">{nextStepForThread(selected)}</div>
                </div>
              </div>

              {lock ? <div className="notice-inline">Review lock held by {lock.locked_by} until {new Date(lock.expires_at).toLocaleString()}</div> : null}
              {lockNotice ? <div className="muted-copy">{lockNotice}</div> : null}

              <details className="details-card" open>
                <summary>Content Preview</summary>
                <div className="details-body panel-stack">
                  {previewLoading ? (
                    <div className="muted-copy">Loading content...</div>
                  ) : !preview?.found ? (
                    <div className="muted-copy">Content not yet available. Run the pipeline to generate this job's article and image.</div>
                  ) : (
                    <>
                      {preview.image_url ? (
                        <img
                          src={preview.image_url}
                          alt="Generated hero"
                          style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                        />
                      ) : null}
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{preview.filename}</div>
                      <pre style={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: 'var(--text)',
                        background: 'var(--surface2)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        maxHeight: 320,
                        overflowY: 'auto',
                      }}>
                        {preview.content}
                      </pre>
                    </>
                  )}
                </div>
              </details>

              <details className="details-card" open>
                <summary>Assignment</summary>
                <div className="details-body panel-stack">
                  <div className="control-grid">
                    <input value={assignment.assignee_user_id} onChange={e => setAssignment(current => ({ ...current, assignee_user_id: e.target.value }))} placeholder="Reviewer user id" />
                    <input type="datetime-local" value={assignment.due_at} onChange={e => setAssignment(current => ({ ...current, due_at: e.target.value }))} />
                    <input value={assignment.waiting_on} onChange={e => setAssignment(current => ({ ...current, waiting_on: e.target.value }))} placeholder="What is this waiting on?" />
                  </div>
                  <button className="btn-ghost" onClick={saveAssignment}>Save assignment</button>
                </div>
              </details>

              <details className="details-card" open>
                <summary>Decision</summary>
                <div className="details-body panel-stack">
                  <div className="muted-copy">Approve if this is ready to move forward. Request revision if changes are needed. Reject only if the work should be closed out.</div>
                  <textarea rows={6} value={note} onChange={e => setNote(e.target.value)} placeholder="Add review notes, revision direction, or rejection reason" />
                  <div className="inline-wrap">
                    <button className="btn-success" onClick={() => handle('approve')}>Approve</button>
                    <button className="btn-primary" onClick={() => handle('revision')}>Request revision</button>
                    <button className="btn-ghost" onClick={() => handle('reject')}>Reject</button>
                  </div>
                </div>
              </details>

              <details className="details-card">
                <summary>History</summary>
                <div className="details-body compact-list">
                  {!historyItems.length ? <div className="muted-copy">No prior review notes yet.</div> : null}
                  {historyItems.map(item => (
                    <div key={item.id} className="compact-card">
                      <div className="title-row">
                        <strong style={{ textTransform: 'capitalize' }}>{item.title}</strong>
                        <span className="muted-copy">{formatWhen(item.createdAt)}</span>
                      </div>
                      <div className="muted-copy">{item.body}</div>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
          {notice ? <div className="muted-copy">{notice}</div> : null}
        </section>
      </div>
    </div>
  )
}
