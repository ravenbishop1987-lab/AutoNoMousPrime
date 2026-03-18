import { useEffect, useState } from 'react'
import { marked } from 'marked'
import {
  acquireJobLock,
  assignJob,
  bulkUpdateJobs,
  cancelJob,
  createJob,
  createSavedView,
  getBrands,
  getJobDetail,
  getJobOutputPreview,
  getJobsV2,
  getSavedViews,
  getTemplates,
  getWorkspaceSession,
  publishCheckJob,
  publishJob,
  releaseJobLock,
  retryJob,
  setJobDeadlines,
  type BrandItem,
  type JobOutputPreview,
  type JobSnapshot,
  type SavedViewItem,
  type SaaSJob,
  type TemplateItem,
  type WorkspaceSession,
} from '../api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import LoadingSpinner from './LoadingSpinner'

function formatWhen(value?: string | null) {
  if (!value) return 'Not set'
  return new Date(value).toLocaleString()
}

function shortId(value?: string | null) {
  if (!value) return 'n/a'
  return String(value).slice(0, 8)
}

function badgeClass(value?: string) {
  if (value === 'completed' || value === 'approved' || value === 'ready' || value === 'published') return 'badge-green'
  if (value === 'failed' || value === 'overdue' || value === 'blocked' || value === 'rejected') return 'badge-red'
  if (value === 'running' || value === 'at_risk' || value === 'retrying') return 'badge-blue'
  if (value === 'awaiting_review' || value === 'pending' || value === 'revision_requested') return 'badge-yellow'
  return 'badge-gray'
}

function snapshotDiff(current?: JobSnapshot, previous?: JobSnapshot) {
  if (!current) return []
  const currentPayload = current.job_payload || {}
  const previousPayload = previous?.job_payload || {}
  const keys = Array.from(new Set([...Object.keys(currentPayload), ...Object.keys(previousPayload)]))
  return keys
    .filter(key => JSON.stringify(currentPayload[key]) !== JSON.stringify(previousPayload[key]))
    .map(key => ({
      key,
      previous: previousPayload[key],
      current: currentPayload[key],
    }))
}

function describeReadiness(job: SaaSJob) {
  const checklist = job.readiness_checklist || []
  const missing = checklist.filter(item => item.status !== 'ready' && item.status !== 'approved')
  if (!missing.length) return 'Ready to move'
  return `${missing.length} item${missing.length === 1 ? '' : 's'} need attention`
}

function formatLabel(value?: string | null) {
  if (!value) return 'Unknown'
  return value.replace(/_/g, ' ')
}

function summarizeJobSignals(job: SaaSJob) {
  const reviewState = job.review_thread?.current_status || ''
  const signals: Array<{ label: string; value?: string | null }> = [
    { label: 'status', value: job.status },
    { label: 'queue', value: job.queue_state },
  ]

  if (job.sla_state === 'overdue' || job.sla_state === 'at_risk' || job.overdue) {
    signals.push({ label: 'sla', value: job.sla_state || (job.overdue ? 'overdue' : '') })
  } else if (reviewState && reviewState !== 'approved' && reviewState !== 'n/a') {
    signals.push({ label: 'review', value: reviewState })
  }

  return signals.filter(signal => signal.value).slice(0, 3)
}

export default function JobsPanel() {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [brands, setBrands] = useState<BrandItem[]>([])
  const [jobs, setJobs] = useState<SaaSJob[]>([])
  const [savedViews, setSavedViews] = useState<SavedViewItem[]>([])
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [detail, setDetail] = useState<null | Awaited<ReturnType<typeof getJobDetail>>>(null)
  const [topic, setTopic] = useState('')
  const [keywords, setKeywords] = useState('')
  const [createBrandId, setCreateBrandId] = useState('')
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [createTemplateId, setCreateTemplateId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [queueFilter, setQueueFilter] = useState('')
  const [approvalFilter, setApprovalFilter] = useState('')
  const [slaFilter, setSlaFilter] = useState('')
  const [filterBrandId, setFilterBrandId] = useState('')
  const [search, setSearch] = useState('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [assignment, setAssignment] = useState({ owner_user_id: '', review_assignee_user_id: '', publish_assignee_user_id: '', waiting_on: '' })
  const [deadlines, setDeadlines] = useState({ review_due_at: '', publish_due_at: '', revision_due_at: '' })
  const [publishRetryMode, setPublishRetryMode] = useState<'safe' | 'transient_only' | 'force'>('safe')
  const [forceRecovery, setForceRecovery] = useState(false)
  const [allowRepublish, setAllowRepublish] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [contentPreview, setContentPreview] = useState<JobOutputPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  function hydrateDetail(nextDetail: Awaited<ReturnType<typeof getJobDetail>>) {
    setDetail(nextDetail)
    setAssignment({
      owner_user_id: nextDetail.job.owner_user_id || '',
      review_assignee_user_id: nextDetail.job.review_assignee_user_id || '',
      publish_assignee_user_id: nextDetail.job.publish_assignee_user_id || '',
      waiting_on: nextDetail.job.waiting_on || '',
    })
    setDeadlines({
      review_due_at: nextDetail.job.review_due_at ? String(nextDetail.job.review_due_at).slice(0, 16) : '',
      publish_due_at: nextDetail.job.publish_due_at ? String(nextDetail.job.publish_due_at).slice(0, 16) : '',
      revision_due_at: nextDetail.job.revision_due_at ? String(nextDetail.job.revision_due_at).slice(0, 16) : '',
    })
  }

  async function openJobWithWorkspace(workspaceId: string, jobId: string) {
    if (selectedJobId && selectedJobId !== jobId) {
      await releaseJobLock(workspaceId, selectedJobId).catch(() => null)
    }
    setSelectedJobId(jobId)
    await acquireJobLock(workspaceId, jobId, { reason: 'job_detail_editing' })
    const nextDetail = await getJobDetail(workspaceId, jobId)
    hydrateDetail(nextDetail)
  }

  async function load() {
    try {
      const current = await getWorkspaceSession()
      setSession(current)
      if (!current.active_workspace?.id) return
      const filters = {
        search: search || undefined,
        approval_state: approvalFilter || undefined,
        queue_state: queueFilter || undefined,
        sla_state: slaFilter || undefined,
      }
      const [brandData, jobData, viewData, templateData] = await Promise.all([
        getBrands(current.active_workspace.id),
        getJobsV2(current.active_workspace.id, 1, statusFilter || undefined, filterBrandId || undefined, filters),
        getSavedViews(current.active_workspace.id, 'jobs'),
        getTemplates(current.active_workspace.id, { visibility: 'workspace' }),
      ])
      setBrands(brandData.brands)
      setJobs(jobData.jobs)
      setSavedViews(viewData.items)
      setTemplates(templateData.items || [])
      if (!createBrandId && brandData.brands.length) {
        setCreateBrandId(brandData.brands[0].id)
      }
      if (selectedJobId) {
        const nextDetail = await getJobDetail(current.active_workspace.id, selectedJobId)
        hydrateDetail(nextDetail)
      } else if (jobData.jobs.length) {
        await openJobWithWorkspace(current.active_workspace.id, jobData.jobs[0].id)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load jobs')
    } finally {
      setLoading(false)
    }
  }

  useAutoRefresh(load, [statusFilter, filterBrandId, queueFilter, approvalFilter, slaFilter, search], { intervalMs: 10000 })

  useEffect(() => {
    const stored = window.localStorage.getItem('ap-navigation-target')
    if (!stored) return
    try {
      const target = JSON.parse(stored)
      if (target.tab === 'jobs' && target.job_id) {
        openJob(target.job_id)
      }
    } catch {
      // ignore malformed local storage
    }
  }, [session?.active_workspace?.id])

  useEffect(() => () => {
    if (session?.active_workspace?.id && selectedJobId) {
      releaseJobLock(session.active_workspace.id, selectedJobId).catch(() => null)
    }
  }, [session?.active_workspace?.id, selectedJobId])

  async function handleCreate() {
    if (!session?.active_workspace?.id || !topic.trim()) return
    try {
      const selectedTemplate = templates.find(template => template.id === createTemplateId) || null
      await createJob(session.active_workspace.id, {
        topic: topic.trim(),
        keywords: keywords.split(',').map(item => item.trim()).filter(Boolean),
        brand_id: createBrandId || null,
        input_payload: selectedTemplate ? {
          template_id: selectedTemplate.id,
          template_kind: selectedTemplate.template_kind,
          template_name: selectedTemplate.name,
          template_body: selectedTemplate.body_template,
        } : {},
      })
      setTopic('')
      setKeywords('')
      setCreateTemplateId('')
      setNotice('Job created.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create job')
    }
  }

  async function openJob(jobId: string) {
    if (!session?.active_workspace?.id) return
    try {
      setContentPreview(null)
      setShowPreview(false)
      await openJobWithWorkspace(session.active_workspace.id, jobId)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load job detail')
    }
  }

  async function loadContentPreview(topic: string) {
    setShowPreview(true)
    if (contentPreview) return
    setPreviewLoading(true)
    try {
      const data = await getJobOutputPreview(topic)
      setContentPreview(data)
    } catch {
      setContentPreview({ found: false, filename: '', content: '', image_url: '' })
    } finally {
      setPreviewLoading(false)
    }
  }

  async function runAction(action: () => Promise<unknown>, success: string) {
    try {
      await action()
      setNotice(success)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Action failed')
    }
  }

  async function saveAssignments() {
    if (!session?.active_workspace?.id || !selectedJobId) return
    await runAction(
      () => assignJob(session.active_workspace.id, selectedJobId, {
        owner_user_id: assignment.owner_user_id || null,
        review_assignee_user_id: assignment.review_assignee_user_id || null,
        publish_assignee_user_id: assignment.publish_assignee_user_id || null,
        waiting_on: assignment.waiting_on || null,
      }),
      'Assignments updated.',
    )
  }

  async function saveDeadlines() {
    if (!session?.active_workspace?.id || !selectedJobId) return
    await runAction(
      () => setJobDeadlines(session.active_workspace.id, selectedJobId, {
        review_due_at: deadlines.review_due_at || null,
        publish_due_at: deadlines.publish_due_at || null,
        revision_due_at: deadlines.revision_due_at || null,
      }),
      'Deadlines updated.',
    )
  }

  async function saveCurrentView() {
    if (!session?.active_workspace?.id || !newViewName.trim()) return
    await runAction(
      () => createSavedView(session.active_workspace.id, {
        view_type: 'jobs',
        name: newViewName.trim(),
        filters: {
          status: statusFilter,
          queue_state: queueFilter,
          approval_state: approvalFilter,
          sla_state: slaFilter,
          brand_id: filterBrandId,
          search,
        },
      }),
      'Saved view created.',
    )
    setNewViewName('')
  }

  async function handleBulk(action: 'assign' | 'approve' | 'retry' | 'schedule' | 'archive') {
    if (!session?.active_workspace?.id || !selectedJobIds.length) return
    await runAction(
      () => bulkUpdateJobs(session.active_workspace.id, {
        job_ids: selectedJobIds,
        action,
        owner_user_id: action === 'assign' ? (assignment.owner_user_id || null) : undefined,
        scheduled_at: action === 'schedule' ? (deadlines.publish_due_at || null) : undefined,
      }),
      `Bulk ${action} complete.`,
    )
    setSelectedJobIds([])
  }

  const selectedSnapshots: JobSnapshot[] = detail?.snapshots || []
  const diffs = snapshotDiff(selectedSnapshots[0], selectedSnapshots[1])
  const orderedJobs = [...jobs].sort((a, b) => {
    const score = (job: SaaSJob) => {
      if (job.sla_state === 'overdue') return 5
      if (job.queue_state === 'blocked') return 4
      if (job.sla_state === 'at_risk') return 3
      if (job.queue_state === 'awaiting_approval') return 2
      return 1
    }
    return score(b) - score(a)
  })
  const totalJobs = jobs.length
  const readyJobs = jobs.filter(job => job.queue_state === 'ready').length
  const blockedJobs = jobs.filter(job => job.queue_state === 'blocked' || !!job.blocked_reasons?.length).length
  const reviewJobs = jobs.filter(job => {
    const state = job.review_thread?.current_status || job.status
    return state === 'pending' || state === 'awaiting_review' || state === 'revision_requested'
  }).length
  const overdueJobs = jobs.filter(job => job.sla_state === 'overdue' || job.overdue).length
  const selectedJob = detail?.job
  const readinessItems = detail?.readiness_checklist || detail?.job.readiness_checklist || []
  const hasFilters = Boolean(search || statusFilter || filterBrandId || queueFilter || approvalFilter || slaFilter)

  if (loading) return <LoadingSpinner fullPanel />

  return (
    <div className="panel-shell panel-stack">
      <section className="card panel-stack">
        <div className="section-title">Jobs</div>
        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-label">All jobs</div>
            <div className="summary-value">{totalJobs}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Ready to move</div>
            <div className="summary-value">{readyJobs}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Need review</div>
            <div className="summary-value">{reviewJobs}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Blocked</div>
            <div className="summary-value">{blockedJobs}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Overdue</div>
            <div className="summary-value">{overdueJobs}</div>
          </div>
        </div>
      </section>

      <section className="card panel-stack">
        <div className="section-title">New job</div>
        <div className="muted-copy">Start with a topic, add keyword guidance only if needed, then assign a brand if this job belongs to one.</div>
        <div className="control-grid control-grid-wide">
          <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Topic" />
          <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Optional keywords" />
          <select value={createBrandId} onChange={e => setCreateBrandId(e.target.value)}>
            <option value="">No brand</option>
            {brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
          <select value={createTemplateId} onChange={e => setCreateTemplateId(e.target.value)}>
            <option value="">No template</option>
            {templates.filter(template => ['blog_post', 'content_preset', 'workflow_preset'].includes(template.template_kind)).map(template => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
          <button className="btn-primary" onClick={handleCreate}>Create job</button>
        </div>
      </section>

      <div className="panel-grid">
        <section className="card panel-stack">
          <div className="title-row">
            <div>
              <div className="section-title">Job queue</div>
              <div className="muted-copy">Find the next job to work, then open it on the right.</div>
            </div>
            <div className="inline-wrap">
              <button className="btn-ghost" onClick={() => setShowAdvancedFilters(current => !current)}>
                {showAdvancedFilters ? 'Hide advanced filters' : 'More filters'}
              </button>
              {hasFilters ? (
                <button className="btn-ghost" onClick={() => {
                  setSearch('')
                  setStatusFilter('')
                  setQueueFilter('')
                  setApprovalFilter('')
                  setSlaFilter('')
                  setFilterBrandId('')
                }}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>

          <div className="control-grid">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by topic" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="retrying">Retrying</option>
              <option value="canceled">Canceled</option>
              <option value="awaiting_review">Awaiting review</option>
              <option value="approved">Approved</option>
              <option value="revision_requested">Revision requested</option>
            </select>
            <select value={filterBrandId} onChange={e => setFilterBrandId(e.target.value)}>
              <option value="">All brands</option>
              {brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
          </div>

          {showAdvancedFilters ? (
            <>
              <div className="control-grid">
                <select value={queueFilter} onChange={e => setQueueFilter(e.target.value)}>
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
                <select value={approvalFilter} onChange={e => setApprovalFilter(e.target.value)}>
                  <option value="">All review states</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="revision_requested">Revision requested</option>
                </select>
                <select value={slaFilter} onChange={e => setSlaFilter(e.target.value)}>
                  <option value="">All SLA states</option>
                  <option value="on_track">On track</option>
                  <option value="at_risk">At risk</option>
                  <option value="overdue">Overdue</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>

              {savedViews.length ? (
                <div className="inline-wrap">
                  {savedViews.map(view => (
                    <button
                      key={view.id}
                      className="btn-ghost"
                      onClick={() => {
                        const filters = view.filters || {}
                        setStatusFilter(String(filters.status || ''))
                        setQueueFilter(String(filters.queue_state || ''))
                        setApprovalFilter(String(filters.approval_state || ''))
                        setSlaFilter(String(filters.sla_state || ''))
                        setFilterBrandId(String(filters.brand_id || ''))
                        setSearch(String(filters.search || ''))
                      }}
                    >
                      {view.name}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="control-grid">
                <input value={newViewName} onChange={e => setNewViewName(e.target.value)} placeholder="Save current filters as..." />
                <button className="btn-ghost" onClick={saveCurrentView}>Save view</button>
              </div>
            </>
          ) : null}

          {selectedJobIds.length ? (
            <div className="action-banner">
              <div>
                <strong>{selectedJobIds.length}</strong> selected
              </div>
              <div className="inline-wrap">
                <button className="btn-ghost" onClick={() => handleBulk('assign')}>Assign</button>
                <button className="btn-ghost" onClick={() => handleBulk('approve')}>Approve</button>
                <button className="btn-ghost" onClick={() => handleBulk('retry')}>Retry</button>
                <button className="btn-ghost" onClick={() => handleBulk('schedule')}>Schedule</button>
                <button className="btn-ghost" onClick={() => handleBulk('archive')}>Archive</button>
              </div>
            </div>
          ) : null}

          {!orderedJobs.length ? <div className="empty-state">No jobs match the current filters.</div> : null}
          {orderedJobs.map(job => {
            const selected = job.id === selectedJobId
            const signals = summarizeJobSignals(job)
            return (
              <div key={job.id} className={`list-card ${selected ? 'list-card-active' : ''}`}>
                <div className="title-row">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={selectedJobIds.includes(job.id)}
                      onChange={event => {
                        event.stopPropagation()
                        setSelectedJobIds(current => event.target.checked ? [...current, job.id] : current.filter(item => item !== job.id))
                      }}
                    />
                    <span />
                  </label>
                  <button className="list-card-button" onClick={() => openJob(job.id)}>
                    <div className="list-card-title">{job.topic}</div>
                    <div className="list-card-meta">
                      <span>{job.brands?.name || 'No brand'}</span>
                      <span>{describeReadiness(job)}</span>
                      <span>{job.due_at ? `Due ${formatWhen(job.due_at)}` : 'No due date'}</span>
                    </div>
                  </button>
                </div>
                <div className="inline-wrap">
                  {signals.map(signal => (
                    <span key={`${job.id}-${signal.label}-${signal.value}`} className={`badge ${badgeClass(signal.value || '')}`}>
                      {formatLabel(signal.value)}
                    </span>
                  ))}
                </div>
                <div className="muted-copy">
                  Owner {job.owner_user_id || 'unassigned'} | Waiting on {job.waiting_on || job.next_action || 'nothing'}
                </div>
              </div>
            )
          })}
        </section>

        <section className="card panel-stack">
          <div className="section-title">Job detail</div>
          {!detail || !selectedJob ? (
            <div className="empty-state">
              {orderedJobs.length
                ? 'Pick a job from the left to see ownership, readiness, publishing, history, and linked assets.'
                : 'Create your first job or adjust the filters to see job details here.'}
            </div>
          ) : (
            <>
              <div className="title-row">
                <div>
                  <div className="panel-title">{selectedJob.topic}</div>
                  <div className="list-card-meta">
                    <span>{selectedJob.brands?.name || 'No brand'}</span>
                    <span>Created {formatWhen(selectedJob.created_at)}</span>
                    <span>Updated {formatWhen(selectedJob.updated_at)}</span>
                  </div>
                </div>
                <div className="inline-wrap">
                  <span className={`badge ${badgeClass(selectedJob.status)}`}>{formatLabel(selectedJob.status)}</span>
                  <span className={`badge ${badgeClass(detail.queue?.queue_state)}`}>{formatLabel(detail.queue?.queue_state)}</span>
                  <span className={`badge ${badgeClass(selectedJob.sla_state)}`}>{formatLabel(selectedJob.sla_state)}</span>
                </div>
              </div>

              {(selectedJob.status === 'completed' || selectedJob.status === 'awaiting_review' || selectedJob.status === 'approved') && (
                <div>
                  <button
                    className="btn-ghost"
                    onClick={() => showPreview ? setShowPreview(false) : loadContentPreview(selectedJob.topic)}
                    style={{ fontSize: 12 }}
                  >
                    {showPreview ? 'Hide preview' : '👁 Preview content'}
                  </button>
                  {showPreview && (
                    <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {previewLoading && (
                        <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Loading preview...</div>
                      )}
                      {!previewLoading && contentPreview && !contentPreview.found && (
                        <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>No output found for this topic yet.</div>
                      )}
                      {!previewLoading && contentPreview?.found && (
                        <>
                          {contentPreview.image_url && (
                            <img src={contentPreview.image_url} alt="Featured" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
                          )}
                          <div
                            style={{ padding: '16px 20px', fontSize: 14, lineHeight: 1.75, color: 'var(--text)', maxHeight: 480, overflowY: 'auto' }}
                            dangerouslySetInnerHTML={{ __html: marked.parse(contentPreview.content) as string }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="summary-grid">
                <div className="summary-card">
                  <div className="summary-label">Owner</div>
                  <div className="summary-value summary-value-sm">{selectedJob.owner_user_id || 'Unassigned'}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Waiting on</div>
                  <div className="summary-value summary-value-sm">{selectedJob.waiting_on || detail.queue?.next_action || 'Nothing'}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Due</div>
                  <div className="summary-value summary-value-sm">{formatWhen(selectedJob.due_at)}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Validation</div>
                  <div className="summary-value summary-value-sm">
                    {(detail.validation_summary?.error_count || 0)} errors / {(detail.validation_summary?.warning_count || 0)} warnings
                  </div>
                </div>
              </div>

              {detail.lock ? <div className="notice-inline">Editing lock held by {detail.lock.locked_by} until {formatWhen(detail.lock.expires_at)}</div> : null}

              <details className="details-card" open>
                <summary>Who owns this job</summary>
                <div className="details-body">
                  <div className="control-grid">
                    <input value={assignment.owner_user_id} onChange={e => setAssignment(current => ({ ...current, owner_user_id: e.target.value }))} placeholder="Owner user id" />
                    <input value={assignment.review_assignee_user_id} onChange={e => setAssignment(current => ({ ...current, review_assignee_user_id: e.target.value }))} placeholder="Review assignee user id" />
                    <input value={assignment.publish_assignee_user_id} onChange={e => setAssignment(current => ({ ...current, publish_assignee_user_id: e.target.value }))} placeholder="Publish assignee user id" />
                    <input value={assignment.waiting_on} onChange={e => setAssignment(current => ({ ...current, waiting_on: e.target.value }))} placeholder="Waiting on" />
                  </div>
                  <button className="btn-ghost" onClick={saveAssignments}>Save assignment</button>
                </div>
              </details>

              <details className="details-card" open>
                <summary>Due dates and readiness</summary>
                <div className="details-body panel-stack">
                  <div className="control-grid">
                    <div className="panel-stack">
                      <label>Review due</label>
                      <input type="datetime-local" value={deadlines.review_due_at} onChange={e => setDeadlines(current => ({ ...current, review_due_at: e.target.value }))} />
                    </div>
                    <div className="panel-stack">
                      <label>Publish due</label>
                      <input type="datetime-local" value={deadlines.publish_due_at} onChange={e => setDeadlines(current => ({ ...current, publish_due_at: e.target.value }))} />
                    </div>
                    <div className="panel-stack">
                      <label>Revision due</label>
                      <input type="datetime-local" value={deadlines.revision_due_at} onChange={e => setDeadlines(current => ({ ...current, revision_due_at: e.target.value }))} />
                    </div>
                  </div>
                  <button className="btn-ghost" onClick={saveDeadlines}>Save due dates</button>
                  <div className="compact-list">
                    {readinessItems.length ? readinessItems.map(item => (
                      <div key={item.key} className="compact-list-row">
                        <span>{item.label}</span>
                        <span className={`badge ${badgeClass(item.status)}`}>{formatLabel(item.status)}</span>
                      </div>
                    )) : <div className="muted-copy">No readiness checks recorded yet.</div>}
                  </div>
                </div>
              </details>

              <details className="details-card" open>
                <summary>Publish and recovery</summary>
                <div className="details-body panel-stack">
                  <div className="inline-wrap">
                    <button className="btn-ghost" onClick={() => runAction(() => publishCheckJob(session!.active_workspace!.id, selectedJobId), 'Publish check complete.')}>Run publish check</button>
                    <button
                      className="btn-primary"
                      onClick={() => runAction(
                        () => publishJob(session!.active_workspace!.id, selectedJobId, {
                          retry_mode: publishRetryMode,
                          force_recovery: forceRecovery,
                          allow_republish: allowRepublish,
                        }),
                        'Publish submitted.',
                      )}
                    >
                      Publish
                    </button>
                    <button className="btn-ghost" onClick={() => runAction(() => retryJob(session!.active_workspace!.id, selectedJobId), 'Retry started.')}>Retry</button>
                    <button className="btn-ghost" onClick={() => runAction(() => cancelJob(session!.active_workspace!.id, selectedJobId), 'Job canceled.')}>Cancel</button>
                  </div>
                  <div className="control-grid">
                    <select value={publishRetryMode} onChange={e => setPublishRetryMode(e.target.value as 'safe' | 'transient_only' | 'force')}>
                      <option value="safe">Safe retry</option>
                      <option value="transient_only">Transient only</option>
                      <option value="force">Force recovery</option>
                    </select>
                    <label className="checkbox-inline">
                      <input type="checkbox" checked={forceRecovery} onChange={e => setForceRecovery(e.target.checked)} />
                      Force recovery
                    </label>
                    <label className="checkbox-inline">
                      <input type="checkbox" checked={allowRepublish} onChange={e => setAllowRepublish(e.target.checked)} />
                      Allow republish
                    </label>
                  </div>
                  <div className="compact-list">
                    {(detail.publish_targets || []).length ? (detail.publish_targets || []).map((target: Record<string, unknown>) => (
                      <div key={String(target.id)} className="compact-card">
                        <div className="title-row">
                          <strong>{String(target.platform || 'unknown')}</strong>
                          <span className={`badge ${badgeClass(String(target.publish_result_status || target.status || 'draft'))}`}>{String(target.publish_result_status || target.status || 'draft')}</span>
                        </div>
                        <div className="muted-copy">Offer {String(target.offer_name || target.offer_id || 'Not linked')}</div>
                        <div className="muted-copy">CTA {String(target.cta_label || target.cta_id || 'Not linked')}</div>
                        <div className="muted-copy">Landing page {String(target.landing_page_url || target.landing_page_id || 'Not linked')}</div>
                        <div className="muted-copy">Post URL {String(target.provider_post_url || 'Not available')}</div>
                        <div className="muted-copy">Last submitted {formatWhen(target.last_submitted_at as string | undefined)}</div>
                      </div>
                    )) : <div className="muted-copy">No publish targets recorded yet.</div>}
                  </div>
                </div>
              </details>

              <details className="details-card">
                <summary>Publish attempts</summary>
                <div className="details-body compact-list">
                  {!detail.publish_attempts?.length ? <div className="muted-copy">No publish attempts recorded yet.</div> : null}
                  {(detail.publish_attempts || []).map(attempt => (
                    <div key={attempt.id} className="compact-card">
                      <div className="title-row">
                        <strong>{attempt.platform}</strong>
                        <span className={`badge ${badgeClass(attempt.status)}`}>{attempt.status}</span>
                      </div>
                      <div className="muted-copy">Attempt {shortId(attempt.id)} | Target {shortId(attempt.publish_target_id || null)}</div>
                      <div className="muted-copy">Submitted {formatWhen(attempt.submitted_at)}</div>
                      <div className="muted-copy">Published {formatWhen(attempt.published_at || null)} | Failed {formatWhen(attempt.failed_at || null)}</div>
                      <div className="muted-copy">Provider {attempt.provider_response_id || 'pending'} | URL {attempt.provider_post_url || 'not available'}</div>
                      <div className="muted-copy">{attempt.message || 'No message'}</div>
                    </div>
                  ))}
                </div>
              </details>

              <details className="details-card">
                <summary>Versions and notes</summary>
                <div className="details-body panel-stack">
                  {!!diffs.length && (
                    <div className="compact-list">
                      {diffs.map(diff => (
                        <div key={diff.key} className="compact-card">
                          <strong>{diff.key}</strong>
                          <div className="muted-copy">Previous {JSON.stringify(diff.previous)}</div>
                          <div className="muted-copy">Current {JSON.stringify(diff.current)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="compact-list">
                    {!selectedSnapshots.length ? <div className="muted-copy">No snapshots recorded yet.</div> : null}
                    {selectedSnapshots.slice(0, 2).map(snapshot => (
                      <div key={snapshot.id} className="compact-card">
                        <div className="title-row">
                          <strong>{snapshot.snapshot_type}</strong>
                          <span className="muted-copy">{formatWhen(snapshot.created_at)}</span>
                        </div>
                        <pre className="code-block">{JSON.stringify(snapshot.job_payload, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              </details>

              <details className="details-card">
                <summary>Linked assets</summary>
                <div className="details-body compact-list">
                  {!detail.assets?.length ? <div className="muted-copy">No linked assets yet.</div> : null}
                  {(detail.assets || []).map(asset => (
                    <div key={asset.id} className="compact-list-row">
                      <span>{asset.type} | {asset.provider || 'system'}</span>
                      <span className="muted-copy">{String(asset.storage_url || asset.local_path || 'no path')}</span>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </section>
      </div>

      {notice ? <div className="card muted-copy">{notice}</div> : null}
    </div>
  )
}
