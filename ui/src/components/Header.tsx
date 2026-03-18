import { Zap, Activity, Menu } from 'lucide-react'

interface Props {
  wsConnected: boolean
  onToggleNav?: () => void
  appLabel?: string
  logoUrl?: string | null
  workspaceName?: string
  activeWorkspaceId?: string
  workspaces?: Array<{ id: string; name: string; role: string }>
  onSwitchWorkspace?: (workspaceId: string) => void
}

export default function Header({
  wsConnected,
  onToggleNav,
  appLabel = 'Autonomous Prime',
  logoUrl = null,
  workspaceName = '',
  activeWorkspaceId = '',
  workspaces = [],
  onSwitchWorkspace,
}: Props) {
  return (
    <header style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      <div className="app-header-bar">
        <button
          type="button"
          className="btn-ghost mobile-nav-toggle"
          onClick={onToggleNav}
          aria-label="Toggle navigation"
        >
          <Menu size={16} />
        </button>
        {logoUrl ? (
          <img src={logoUrl} alt={appLabel} style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover' }} />
        ) : (
          <Zap size={18} color="var(--accent)" />
        )}
        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{appLabel}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>v2.0</span>
        <span className="app-header-copy">
          {workspaceName ? `${workspaceName} - SaaS workspace, jobs, reviews, billing, and operations` : 'SaaS workspace, jobs, reviews, billing, and operations'}
        </span>
        {workspaces.length > 1 ? (
          <select
            value={activeWorkspaceId}
            onChange={event => onSwitchWorkspace?.(event.target.value)}
            style={{ minWidth: 180, maxWidth: 220 }}
            aria-label="Switch workspace"
          >
            {workspaces.map(workspace => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name} ({workspace.role})
              </option>
            ))}
          </select>
        ) : null}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={12} color={wsConnected ? '#3fb950' : '#f85149'} />
          <span className={`badge ${wsConnected ? 'badge-green' : 'badge-red'}`}>
            {wsConnected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>
    </header>
  )
}
