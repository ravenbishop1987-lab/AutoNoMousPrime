import { useEffect, useMemo, useState } from 'react'
import { getProviderSettings, getWorkspaceSession, testProviderSetting, upsertProviderSetting, type ProviderSettingItem, type WorkspaceSession } from '../api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

const PROVIDERS = [
  { key: 'wordpress', label: 'WordPress', category: 'cms', purpose: 'Credential reference for WordPress publishing access.' },
  { key: 'stripe', label: 'Stripe', category: 'commerce', purpose: 'Credential reference for billing, subscriptions, and revenue events.' },
  { key: 'claude', label: 'Claude', category: 'llm', purpose: 'Credential reference for text generation and reasoning workflows.' },
  { key: 'elevenlabs', label: 'ElevenLabs', category: 'voice', purpose: 'Credential reference for voice and narration output.' },
  { key: 'abacus', label: 'Abacus', category: 'automation', purpose: 'Credential reference for automation and external workflow orchestration.' },
] as const

function badgeClass(value?: string) {
  if (value === 'connected' || value === 'healthy' || value === 'configured') return 'badge-green'
  if (value === 'degraded' || value === 'warning') return 'badge-yellow'
  if (value === 'error' || value === 'failed' || value === 'invalid' || value === 'incomplete') return 'badge-red'
  return 'badge-gray'
}

function formatWhen(value?: string | null) {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

function summarizeProvider(item?: ProviderSettingItem | null) {
  if (!item) return 'No credential reference saved yet.'
  if (item.last_test_status === 'connected') return item.last_test_message || 'Credential reference is saved and looks ready.'
  if (item.last_test_status === 'failed') return item.last_test_message || 'Credential reference needs attention.'
  return item.last_test_message || 'Saved, but not verified recently.'
}

export default function ProviderSettingsPanel() {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [items, setItems] = useState<ProviderSettingItem[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [providerKey, setProviderKey] = useState('wordpress')
  const [displayName, setDisplayName] = useState('WordPress')
  const [secretRef, setSecretRef] = useState('')
  const [accessLevel, setAccessLevel] = useState<'workspace' | 'admin_only'>('workspace')
  const [adminOnly, setAdminOnly] = useState(false)
  const [view, setView] = useState<'all' | 'attention' | 'healthy'>('all')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      const current = await getWorkspaceSession()
      setSession(current)
      if (!current.active_workspace?.id) {
        setItems([])
        return
      }
      const data = await getProviderSettings(current.active_workspace.id)
      setItems(data.items)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load provider settings')
    }
  }

  useAutoRefresh(load, [], { intervalMs: 15000 })

  useEffect(() => {
    const stored = window.localStorage.getItem('ap-navigation-target')
    if (!stored) return
    try {
      const target = JSON.parse(stored)
      if (target.tab === 'providers' && target.provider_id) setSelectedProviderId(target.provider_id)
    } catch {
      // ignore malformed local storage
    }
  }, [])

  useEffect(() => {
    const selected = items.find(item => item.id === selectedProviderId)
    if (!selected) return
    setProviderKey(selected.provider_key)
    setDisplayName(selected.display_name || selected.provider_key)
    setSecretRef(String((selected.secret_refs || {}).primary || ''))
    setAccessLevel((selected.access_level as 'workspace' | 'admin_only') || 'workspace')
    setAdminOnly(Boolean(selected.admin_only))
  }, [items, selectedProviderId])

  async function handleSave() {
    if (!session?.active_workspace?.id) return
    try {
      const provider = PROVIDERS.find(item => item.key === providerKey)
      const result = await upsertProviderSetting(session.active_workspace.id, {
        provider_key: providerKey,
        display_name: displayName || provider?.label || providerKey,
        category: provider?.category || 'other',
        secret_ref: secretRef || null,
        secret_refs: secretRef ? { primary: secretRef } : {},
        status: secretRef ? 'configured' : 'incomplete',
        access_level: accessLevel,
        admin_only: adminOnly,
        last_rotated_at: new Date().toISOString(),
      })
      setNotice('Provider credential saved.')
      setSelectedProviderId(result.item.id)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save provider setting')
    }
  }

  async function handleTest(id: string) {
    if (!session?.active_workspace?.id) return
    try {
      const result = await testProviderSetting(session.active_workspace.id, id, {})
      setNotice(result.item.last_test_message || `Verification ran for ${result.item.display_name}.`)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not test provider setting')
    }
  }

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (view === 'attention') return item.last_test_status === 'failed' || item.status === 'incomplete' || item.status === 'invalid'
      if (view === 'healthy') return item.last_test_status === 'connected' || item.status === 'configured'
      return true
    })
  }, [items, view])

  const configuredCount = items.length
  const healthyCount = items.filter(item => item.last_test_status === 'connected' || item.status === 'configured').length
  const attentionCount = items.filter(item => item.last_test_status === 'failed' || item.status === 'incomplete' || item.status === 'invalid').length
  const nextProvider = PROVIDERS.find(provider => !items.some(item => item.provider_key === provider.key)) || PROVIDERS[0]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px', display: 'grid', gap: 18 }}>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Provider credential governance</div>
            <div className="panel-title">Secret references and access control</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              This page manages provider credential references inside the workspace. It does not publish or bill directly. It tells the system which secret reference belongs to each provider and who can manage it.
            </div>
          </div>
          <div className="inline-wrap">
            <button type="button" className={view === 'all' ? 'btn-primary' : 'btn-ghost'} onClick={() => setView('all')}>All</button>
            <button type="button" className={view === 'attention' ? 'btn-primary' : 'btn-ghost'} onClick={() => setView('attention')}>Needs attention</button>
            <button type="button" className={view === 'healthy' ? 'btn-primary' : 'btn-ghost'} onClick={() => setView('healthy')}>Healthy</button>
          </div>
        </div>

        <div className="summary-grid">
          <div className="summary-card"><div className="summary-label">Providers</div><div className="summary-value">{PROVIDERS.length}</div><div className="muted-copy">Supported services</div></div>
          <div className="summary-card"><div className="summary-label">Configured</div><div className="summary-value">{configuredCount}</div><div className="muted-copy">Saved credential references</div></div>
          <div className="summary-card"><div className="summary-label">Healthy</div><div className="summary-value">{healthyCount}</div><div className="muted-copy">Recently verified</div></div>
          <div className="summary-card"><div className="summary-label">Needs attention</div><div className="summary-value">{attentionCount}</div><div className="muted-copy">Missing or failed references</div></div>
        </div>
      </section>

      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="section-title">What to set up next</div>
        <div className="muted-copy">
          {nextProvider.label} is the next provider without a saved credential reference in this workspace.
        </div>
        <div className="inline-wrap">
          <button
            className="btn-primary"
            onClick={() => {
              setSelectedProviderId('')
              setProviderKey(nextProvider.key)
              setDisplayName(nextProvider.label)
              setSecretRef('')
              setAccessLevel('workspace')
              setAdminOnly(false)
            }}
          >
            Prepare {nextProvider.label}
          </button>
        </div>
      </section>

      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="section-title">{selectedProviderId ? 'Edit selected provider' : 'Add provider credential'}</div>
        <div className="muted-copy">
          Save the secret reference used by this provider. Verification checks whether a usable secret reference has been saved.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr .8fr auto', gap: 10 }}>
          <select value={providerKey} onChange={e => {
            const next = e.target.value
            setProviderKey(next)
            setDisplayName(PROVIDERS.find(item => item.key === next)?.label || next)
          }}>
            {PROVIDERS.map(provider => <option key={provider.key} value={provider.key}>{provider.label}</option>)}
          </select>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name" />
          <input value={secretRef} onChange={e => setSecretRef(e.target.value)} placeholder="Secret reference or key name" />
          <select value={accessLevel} onChange={e => setAccessLevel(e.target.value as 'workspace' | 'admin_only')}>
            <option value="workspace">Workspace scope</option>
            <option value="admin_only">Admin only</option>
          </select>
          <button className="btn-primary" onClick={handleSave}>Save</button>
        </div>
        <label style={{ color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={adminOnly} onChange={e => setAdminOnly(e.target.checked)} />
          Restrict editing to admins
        </label>
      </section>

      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="title-row">
          <div className="panel-stack" style={{ gap: 4 }}>
            <div className="section-title">Configured providers</div>
            <div className="muted-copy">{filteredItems.length} provider credential{filteredItems.length === 1 ? '' : 's'} shown</div>
          </div>
        </div>
        {!filteredItems.length ? (
          <div className="muted-copy">No provider credentials match the current view.</div>
        ) : (
          <div className="panel-stack">
            {filteredItems.map(item => (
              <div
                key={item.id}
                style={{
                  border: `1px solid ${selectedProviderId === item.id ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 12,
                  padding: 14,
                  display: 'grid',
                  gap: 8,
                  background: selectedProviderId === item.id ? 'rgba(88,166,255,.06)' : 'transparent',
                }}
              >
                <div className="title-row">
                  <div className="panel-stack" style={{ gap: 4 }}>
                    <strong style={{ color: '#e6edf3' }}>{item.display_name}</strong>
                    <div className="muted-copy" style={{ fontSize: 13 }}>
                      {item.provider_key} · {item.category} · {item.access_level || 'workspace'}{item.admin_only ? ' · admin only' : ''}
                    </div>
                  </div>
                  <div className="inline-wrap">
                    <span className={`badge ${badgeClass(item.last_test_status || item.status)}`}>{item.last_test_status || item.status}</span>
                  </div>
                </div>

                <div className="muted-copy">{summarizeProvider(item)}</div>

                <div className="compact-list">
                  <div className="compact-list-row">
                    <span>Secret reference</span>
                    <span className="muted-copy">{String((item.secret_refs || {}).primary || 'Not saved')}</span>
                  </div>
                  <div className="compact-list-row">
                    <span>Set by</span>
                    <span className="muted-copy">{item.set_by || 'unknown'}</span>
                  </div>
                  <div className="compact-list-row">
                    <span>Rotated</span>
                    <span className="muted-copy">{formatWhen(item.last_rotated_at)}</span>
                  </div>
                  <div className="compact-list-row">
                    <span>Last used</span>
                    <span className="muted-copy">{formatWhen(item.last_used_at)}</span>
                  </div>
                  <div className="compact-list-row">
                    <span>Last tested</span>
                    <span className="muted-copy">{formatWhen(item.last_tested_at)}</span>
                  </div>
                </div>

                <div className="inline-wrap">
                  <button className="btn-ghost" onClick={() => setSelectedProviderId(item.id)}>Edit</button>
                  <button className="btn-ghost" onClick={() => handleTest(item.id)}>Verify secret reference</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {notice && <div className="card" style={{ color: 'var(--muted)' }}>{notice}</div>}
    </div>
  )
}
