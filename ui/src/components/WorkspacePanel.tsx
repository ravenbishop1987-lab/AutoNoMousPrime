import { useMemo, useState } from 'react'
import {
  createWorkspace,
  getWorkspaceMembers,
  getWorkspaceSession,
  setActiveWorkspaceId,
  inviteWorkspaceMember,
  updateWorkspaceMember,
  type OrgMember,
  type WorkspaceSession,
} from '../api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

export default function WorkspacePanel({
  activeWorkspaceId,
  onSwitchWorkspace,
}: {
  activeWorkspaceId?: string
  onSwitchWorkspace?: (workspaceId: string) => void
}) {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [workspaceName, setWorkspaceName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'reviewer' | 'client'>('editor')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)

  const memberCounts = useMemo(() => ({
    owners: members.filter(member => member.role === 'owner').length,
    admins: members.filter(member => member.role === 'admin').length,
    collaborators: members.filter(member => member.role === 'editor' || member.role === 'reviewer').length,
    clients: members.filter(member => member.role === 'client').length,
  }), [members])

  async function load() {
    setLoading(true)
    setNotice('')
    try {
      const current = await getWorkspaceSession()
      setSession(current)
      if (current.active_workspace?.id) {
        const memberData = await getWorkspaceMembers(current.active_workspace.id)
        setMembers(memberData.members)
      } else {
        setMembers([])
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load workspace')
    } finally {
      setLoading(false)
    }
  }

  useAutoRefresh(load, [], { intervalMs: 15000 })

  async function handleCreateWorkspace() {
    if (!workspaceName.trim()) return
    setNotice('')
    try {
      const result = await createWorkspace({ name: workspaceName.trim() })
      setActiveWorkspaceId(result.workspace.id)
      onSwitchWorkspace?.(result.workspace.id)
      setWorkspaceName('')
      await load()
      setNotice('Workspace created.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create workspace')
    }
  }

  async function handleInvite() {
    if (!session?.active_workspace?.id || !inviteEmail.trim()) return
    setNotice('')
    try {
      await inviteWorkspaceMember(session.active_workspace.id, { email: inviteEmail.trim(), role: inviteRole })
      setInviteEmail('')
      await load()
      setNotice('Invite created.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not invite member')
    }
  }

  async function handleRoleChange(memberId: string, role: 'owner' | 'admin' | 'editor' | 'reviewer' | 'client') {
    if (!session?.active_workspace?.id) return
    try {
      await updateWorkspaceMember(session.active_workspace.id, memberId, { role })
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update role')
    }
  }

  function selectWorkspace(workspaceId: string) {
    setActiveWorkspaceId(workspaceId)
    onSwitchWorkspace?.(workspaceId)
    setNotice('Active workspace updated.')
  }

  return (
    <div className="panel-shell panel-stack">
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Workspace</div>
            <div className="panel-title">Workspace admin</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              Manage the current workspace, review all workspaces attached to this account, and control team access from one place.
            </div>
          </div>
        </div>

        {session?.active_workspace ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="summary-grid">
              <div className="summary-card">
                <div className="summary-label">Active workspace</div>
                <div className="summary-value summary-value-sm">{session.active_workspace.name}</div>
                <div className="muted-copy">Current admin context</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Plan</div>
                <div className="summary-value summary-value-sm">{session.active_workspace.plan_tier}</div>
                <div className="muted-copy">Workspace tier</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Your role</div>
                <div className="summary-value summary-value-sm">{session.membership.role}</div>
                <div className="muted-copy">Current permissions</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Members</div>
                <div className="summary-value">{members.length}</div>
                <div className="muted-copy">Current team records</div>
              </div>
            </div>

            <div className="two-col-grid">
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#e6edf3' }}>{session.active_workspace.name}</div>
                <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
                  Plan: {session.active_workspace.plan_tier} · Role: {session.membership.role}
                </div>
                <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(88,166,255,.05)', color: 'var(--muted)', fontSize: 13 }}>
                  Workspace switching is live. Use the header picker or the buttons on the right to move between workspaces without leaving the app.
                </div>
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>Available workspaces</div>
                {(session.workspaces || []).map(workspace => (
                  <button
                    key={workspace.id}
                    type="button"
                    className={workspace.id === (activeWorkspaceId || session.active_workspace.id) ? 'btn-primary' : 'btn-ghost'}
                    onClick={() => selectWorkspace(workspace.id)}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}
                  >
                    <span>{workspace.name}</span>
                    <span className="badge badge-blue">{workspace.role}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
            <div style={{ color: 'var(--muted)' }}>No active workspace is set yet. Create one to get started.</div>
            <input value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="Create your first workspace" />
            <button className="btn-primary" onClick={handleCreateWorkspace}>Create Workspace</button>
          </div>
        )}
      </section>

      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack" style={{ gap: 4 }}>
            <div className="section-title">Members And Roles</div>
            <div className="muted-copy">{members.length} member{members.length === 1 ? '' : 's'} in the current workspace</div>
          </div>
        </div>

        <div className="summary-grid">
          <div className="summary-card"><div className="summary-label">Owners</div><div className="summary-value">{memberCounts.owners}</div></div>
          <div className="summary-card"><div className="summary-label">Admins</div><div className="summary-value">{memberCounts.admins}</div></div>
          <div className="summary-card"><div className="summary-label">Collaborators</div><div className="summary-value">{memberCounts.collaborators}</div></div>
          <div className="summary-card"><div className="summary-label">Clients</div><div className="summary-value">{memberCounts.clients}</div></div>
        </div>

        <div className="responsive-member-form">
          <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="teammate@company.com" />
          <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'editor' | 'reviewer' | 'client')}>
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="reviewer">Reviewer</option>
            <option value="client">Client</option>
          </select>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>Invite status is tracked server-side.</div>
          <button className="btn-primary" disabled={!session?.active_workspace?.id} onClick={handleInvite}>Invite</button>
        </div>

        {loading ? (
          <div style={{ color: 'var(--muted)' }}>Loading...</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {members.map(member => (
              <div key={member.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
                <div className="title-row">
                  <div className="panel-stack" style={{ gap: 4 }}>
                    <strong style={{ color: '#e6edf3' }}>{member.email}</strong>
                    <div className="muted-copy" style={{ fontSize: 12 }}>
                      Current role: {member.role} · Invite status: {member.invite_status || 'accepted'}
                    </div>
                  </div>
                  <span className={`badge ${member.invite_status === 'pending' ? 'badge-yellow' : 'badge-green'}`}>
                    {member.invite_status || 'accepted'}
                  </span>
                </div>
                <div style={{ maxWidth: 220 }}>
                  <label>Update role</label>
                  <select value={member.role} onChange={e => handleRoleChange(member.id, e.target.value as 'owner' | 'admin' | 'editor' | 'reviewer' | 'client')}>
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="client">Client</option>
                  </select>
                </div>
              </div>
            ))}
            {!members.length && (
              <div style={{ color: 'var(--muted)' }}>No workspace members yet.</div>
            )}
          </div>
        )}
      </section>

      <section className="card" style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
        <div className="section-title">Create Workspace</div>
        <div className="muted-copy">Create a separate workspace when you want a different operating environment for another brand, team, or client setup.</div>
        <input value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="New workspace name" />
        <button className="btn-primary" onClick={handleCreateWorkspace}>Create Workspace</button>
      </section>

      {notice && <div className="card" style={{ color: 'var(--muted)' }}>{notice}</div>}
    </div>
  )
}
