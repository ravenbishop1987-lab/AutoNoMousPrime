import { useEffect, useState } from 'react'
import type { SystemStatus } from '../api'
import JobsPanel from './JobsPanel'
import ReviewInboxPanel from './ReviewInboxPanel'
import QueuePanel from './QueuePanel'
import PipelinePanel from './PipelinePanel'

type View = 'overview' | 'jobs' | 'reviews' | 'queue' | 'pipeline'

interface Props {
  status?: SystemStatus | null
  initialView?: View
}

const VIEWS: Array<{ key: View; label: string; description: string }> = [
  { key: 'overview', label: 'Overview', description: 'Launch work, review work, unblock work, and ship work from one area.' },
  { key: 'jobs', label: 'Jobs', description: 'Create and manage the unit of work.' },
  { key: 'reviews', label: 'Reviews', description: 'Approve, reject, or request revisions.' },
  { key: 'queue', label: 'Queue', description: 'See what is blocked, waiting, or ready to move.' },
  { key: 'pipeline', label: 'Pipeline', description: 'Launch fully automated content runs.' },
]

export default function OperationsPanel({ status, initialView = 'overview' }: Props) {
  const [view, setView] = useState<View>(initialView)

  useEffect(() => {
    setView(initialView)
  }, [initialView])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Operations</div>
            <div className="panel-title">Production workflow</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              Manage jobs, reviews, queue triage, and pipeline launches from one operating area instead of bouncing between separate tools.
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
        <div className="two-col-grid">
          <section className="card" style={{ display: 'grid', gap: 10 }}>
            <div className="section-title">Work management</div>
            <div style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
              Create jobs, assign owners, and keep delivery moving without leaving the operations area.
            </div>
            <div className="inline-wrap">
              <button type="button" className="btn-ghost" onClick={() => setView('jobs')}>
                Open Jobs
              </button>
              <button type="button" className="btn-ghost" onClick={() => setView('reviews')}>
                Open Reviews
              </button>
            </div>
          </section>

          <section className="card" style={{ display: 'grid', gap: 10 }}>
            <div className="section-title">Flow control</div>
            <div style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
              Use queue and pipeline views to launch new work, spot blockers, and move content through the system.
            </div>
            <div className="inline-wrap">
              <button type="button" className="btn-ghost" onClick={() => setView('queue')}>
                Open Queue
              </button>
              <button type="button" className="btn-ghost" onClick={() => setView('pipeline')}>
                Open Pipeline
              </button>
            </div>
          </section>
        </div>
      )}

      {view === 'jobs' && <div className="operations-embedded"><JobsPanel /></div>}
      {view === 'reviews' && <div className="operations-embedded"><ReviewInboxPanel /></div>}
      {view === 'queue' && <div className="operations-embedded"><QueuePanel /></div>}
      {view === 'pipeline' && <div className="operations-embedded"><PipelinePanel status={status} /></div>}
    </div>
  )
}
