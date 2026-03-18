import { useEffect, useState, type ReactNode } from 'react'

import { getAgents } from '../api'

type Props = {
  agentId: string
  title: string
  description: string
  children: ReactNode
}

export default function AgentWorkbench({ agentId, title, description, children }: Props) {
  const [agent, setAgent] = useState<any>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const data = await getAgents()
        if (alive) setAgent(data?.[agentId] ?? null)
      } catch {
        if (alive) setAgent(null)
      }
    }
    load()
    const timer = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [agentId])

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="section-title" style={{ marginBottom: 6 }}>{title}</div>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>{description}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {(agent?.capabilities ?? []).length > 0 ? `Capabilities: ${agent.capabilities.join(', ')}` : 'Capabilities unavailable'}
            </div>
          </div>
          <span className={`badge ${agent?.current_load > 0 ? 'badge-blue' : 'badge-gray'}`}>
            {agent ? (agent.current_load > 0 ? `${agent.current_load} active` : 'idle') : 'offline'}
          </span>
        </div>
      </div>

      {agent && (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          {[
            { label: 'Success', value: agent.tasks_ok ?? 0, color: '#3fb950' },
            { label: 'Failed', value: agent.tasks_failed ?? 0, color: '#f85149' },
            { label: 'Avg Time', value: agent.avg_ms ? `${(agent.avg_ms / 1000).toFixed(1)}s` : '—', color: 'var(--text)' },
            { label: 'Success Rate', value: `${((agent.success_rate ?? 1) * 100).toFixed(0)}%`, color: '#58a6ff' },
          ].map(item => (
            <div key={item.label} className="card" style={{ padding: 16 }}>
              <div className="metric-label">{item.label}</div>
              <div className="metric-sm" style={{ color: item.color, marginTop: 8 }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {children}
    </div>
  )
}
