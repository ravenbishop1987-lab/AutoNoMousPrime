import { useEffect, useMemo, useState } from 'react'
import { getAgents, getEvents } from '../api'
import { Activity, CheckCircle, Clock, XCircle } from 'lucide-react'
import LoadingSpinner from './LoadingSpinner'

function formatDuration(value?: number) {
  if (!value) return '—'
  return `${(value / 1000).toFixed(1)}s`
}

function summarizeEventData(data: unknown) {
  if (!data) return 'No details'
  const text = JSON.stringify(data)
  return text.length > 140 ? `${text.slice(0, 137)}...` : text
}

export default function AgentsPanel() {
  const [agents, setAgents] = useState<Record<string, any>>({})
  const [events, setEvents] = useState<any[]>([])
  const [view, setView] = useState<'all' | 'active' | 'attention'>('all')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const [agentData, eventData] = await Promise.all([getAgents(), getEvents(40)])
      setAgents(agentData || {})
      setEvents(Array.isArray(eventData) ? eventData.reverse() : [])
    } catch {
      // Surface remains readable even if the feed is temporarily unavailable.
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 5000)
    return () => window.clearInterval(timer)
  }, [])

  const agentEntries = useMemo(() => Object.entries(agents) as Array<[string, any]>, [agents])
  const activeCount = agentEntries.filter(([, agent]) => (agent.current_load || 0) > 0).length
  const attentionCount = agentEntries.filter(([, agent]) => (agent.tasks_failed || 0) > 0 || (agent.success_rate ?? 1) < 0.8).length
  const avgSuccessRate = agentEntries.length
    ? Math.round((agentEntries.reduce((total, [, agent]) => total + Number(agent.success_rate ?? 1), 0) / agentEntries.length) * 100)
    : 0

  const filteredAgents = agentEntries.filter(([, agent]) => {
    if (view === 'active') return (agent.current_load || 0) > 0
    if (view === 'attention') return (agent.tasks_failed || 0) > 0 || (agent.success_rate ?? 1) < 0.8
    return true
  })

  if (loading) return <LoadingSpinner fullPanel />

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Agents</div>
            <div className="panel-title">Agent health and activity</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              Monitor agent health, see which agents are working right now, and review the latest system events without digging through raw logs.
            </div>
          </div>
          <div className="inline-wrap">
            <button type="button" className={view === 'all' ? 'btn-primary' : 'btn-ghost'} onClick={() => setView('all')}>All</button>
            <button type="button" className={view === 'active' ? 'btn-primary' : 'btn-ghost'} onClick={() => setView('active')}>Active</button>
            <button type="button" className={view === 'attention' ? 'btn-primary' : 'btn-ghost'} onClick={() => setView('attention')}>Needs attention</button>
          </div>
        </div>

        <div className="summary-grid">
          <div className="summary-card"><div className="summary-label">Agents</div><div className="summary-value">{agentEntries.length}</div><div className="muted-copy">Available workers</div></div>
          <div className="summary-card"><div className="summary-label">Active now</div><div className="summary-value">{activeCount}</div><div className="muted-copy">Currently processing</div></div>
          <div className="summary-card"><div className="summary-label">Needs attention</div><div className="summary-value">{attentionCount}</div><div className="muted-copy">Failed or degraded</div></div>
          <div className="summary-card"><div className="summary-label">Avg success rate</div><div className="summary-value">{avgSuccessRate}%</div><div className="muted-copy">Across all agents</div></div>
        </div>
      </section>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {filteredAgents.map(([id, agent]) => {
          const successRate = Math.round((agent.success_rate ?? 1) * 100)
          const isActive = (agent.current_load || 0) > 0
          const needsAttention = (agent.tasks_failed || 0) > 0 || (agent.success_rate ?? 1) < 0.8

          return (
            <section key={id} className="card" style={{ display: 'grid', gap: 12 }}>
              <div className="title-row">
                <div className="panel-stack" style={{ gap: 4 }}>
                  <div style={{ fontWeight: 700, color: '#e6edf3', fontSize: 16 }}>{agent.name || id}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{agent.description || 'Agent description unavailable.'}</div>
                </div>
                <div className="inline-wrap">
                  {needsAttention ? <span className="badge badge-yellow">attention</span> : null}
                  <span className={`badge ${isActive ? 'badge-blue' : 'badge-gray'}`}>{isActive ? `${agent.current_load} active` : 'idle'}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <Metric icon={<CheckCircle size={12} color="#3fb950" />} label="Success" value={String(agent.tasks_ok ?? 0)} valueColor="#3fb950" />
                <Metric icon={<XCircle size={12} color="#f85149" />} label="Failed" value={String(agent.tasks_failed ?? 0)} valueColor="#f85149" />
                <Metric icon={<Clock size={12} color="var(--muted)" />} label="Avg Time" value={formatDuration(agent.avg_ms)} valueColor="#58a6ff" />
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: 'var(--muted)' }}>
                  <span>Success rate</span>
                  <span>{successRate}%</span>
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 999 }}>
                  <div
                    style={{
                      width: `${successRate}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: successRate >= 80 ? '#3fb950' : successRate >= 50 ? '#e3b341' : '#f85149',
                    }}
                  />
                </div>
              </div>

              <div className="muted-copy" style={{ fontSize: 12 }}>
                Last run: {agent.last_run ? new Date(agent.last_run).toLocaleString() : 'No run recorded yet'}
              </div>

              <div className="inline-wrap">
                {(agent.capabilities ?? []).map((capability: string) => (
                  <span key={capability} className="badge badge-gray">{capability}</span>
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {!filteredAgents.length ? (
        <div className="card muted-copy">No agents match the current view.</div>
      ) : null}

      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={14} color="#58a6ff" />
          <div className="section-title" style={{ marginBottom: 0 }}>Recent system events</div>
        </div>
        <div className="muted-copy">Latest optimizer, task, and runtime events across the agent system.</div>
        <div style={{ maxHeight: 340, overflowY: 'auto', display: 'grid', gap: 8 }}>
          {events.length === 0 ? (
            <div style={{ color: 'var(--muted)', padding: '16px 0' }}>No events yet.</div>
          ) : (
            events.slice(0, 16).map((event, index) => (
              <div key={`${event.type || 'event'}-${event.timestamp || index}-${index}`} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'grid', gap: 6 }}>
                <div className="title-row">
                  <div className="inline-wrap">
                    <span className="badge badge-blue">{event.type || 'event'}</span>
                    <span className="badge badge-gray">{event.source || 'system'}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {event.timestamp ? String(event.timestamp).slice(11, 19) : 'Unknown time'}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#e6edf3' }}>{summarizeEventData(event.data)}</div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {icon}
        <span className="metric-label">{label}</span>
      </div>
      <div className="metric-sm" style={{ color: valueColor || 'var(--text)' }}>{value}</div>
    </div>
  )
}
