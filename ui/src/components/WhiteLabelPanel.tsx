import { useEffect, useMemo, useState } from 'react'
import { getWhiteLabelSettings, getWorkspaceSession, readStoredWorkspaceBranding, saveWhiteLabelSettings, type WorkspaceBranding, writeStoredWorkspaceBranding } from '../api'

const BRANDING_VIEWS = [
  { key: 'identity', label: 'Identity' },
  { key: 'domain', label: 'Domain' },
  { key: 'readiness', label: 'Readiness' },
] as const

export default function WhiteLabelPanel() {
  const [workspaceId, setWorkspaceId] = useState('')
  const [form, setForm] = useState<Partial<WorkspaceBranding>>({ domain_status: 'draft' })
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<(typeof BRANDING_VIEWS)[number]['key']>('identity')
  const theme = form.theme && typeof form.theme === 'object' ? form.theme as Record<string, unknown> : {}

  async function load() {
    try {
      const session = await getWorkspaceSession()
      const id = session.active_workspace?.id || ''
      setWorkspaceId(id)
      if (!id) return
      const result = await getWhiteLabelSettings(id)
      setForm(result.item || readStoredWorkspaceBranding(id) || { domain_status: 'draft' })
    } catch (error) {
      if (workspaceId) {
        setForm(readStoredWorkspaceBranding(workspaceId) || { domain_status: 'draft' })
      }
      setNotice(error instanceof Error ? error.message : 'Could not load branding settings')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function save() {
    if (!workspaceId) return
    writeStoredWorkspaceBranding(workspaceId, form)
    try {
      const result = await saveWhiteLabelSettings(workspaceId, form)
      const nextItem = result.item || readStoredWorkspaceBranding(workspaceId) || { domain_status: 'draft' }
      writeStoredWorkspaceBranding(workspaceId, nextItem)
      setForm(nextItem)
      window.dispatchEvent(new CustomEvent('ap:branding-updated', {
        detail: {
          workspaceId,
          item: nextItem,
        },
      }))
      setNotice('Branding updated.')
    } catch (error) {
      window.dispatchEvent(new CustomEvent('ap:branding-updated', {
        detail: {
          workspaceId,
          item: readStoredWorkspaceBranding(workspaceId) || form,
        },
      }))
      setNotice(error instanceof Error ? `${error.message}. Saved locally only.` : 'Could not save branding settings. Saved locally only.')
    }
  }

  const readiness = useMemo(() => [
    { label: 'Brand label', ready: !!String(form.brand_name || form.app_label || '').trim() },
    { label: 'Visual identity', ready: !!String(form.logo_url || '').trim() || !!String(form.primary_color || '').trim() },
    { label: 'Custom domain placeholder', ready: !!String(form.custom_domain || '').trim() },
    { label: 'Support contact', ready: !!String(form.support_email || '').trim() },
  ], [form])

  const readyCount = readiness.filter(item => item.ready).length
  const setThemeToken = (key: string, value: string) => {
    setForm(current => ({
      ...current,
      theme: {
        ...(current.theme && typeof current.theme === 'object' ? current.theme as Record<string, unknown> : {}),
        [key]: value,
      },
    }))
  }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 24px', display: 'grid', gap: 18 }}>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Branding</div>
            <div className="panel-title">Workspace brand and white-label readiness</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              Manage the brand identity, custom domain metadata, and theme tokens that now drive the signed-in app shell and the public client portal.
            </div>
          </div>
          <div className="inline-wrap">
            {BRANDING_VIEWS.map(item => (
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

        <div className="summary-grid">
          <div className="summary-card"><div className="summary-label">Brand name</div><div className="summary-value summary-value-sm">{String(form.brand_name || form.app_label || 'Not set')}</div><div className="muted-copy">Current identity label</div></div>
          <div className="summary-card"><div className="summary-label">Domain status</div><div className="summary-value summary-value-sm">{String(form.domain_status || 'draft')}</div><div className="muted-copy">Domain readiness state</div></div>
          <div className="summary-card"><div className="summary-label">Ready items</div><div className="summary-value">{readyCount}/{readiness.length}</div><div className="muted-copy">Checklist completed</div></div>
          <div className="summary-card"><div className="summary-label">Support email</div><div className="summary-value summary-value-sm">{String(form.support_email || 'Not set')}</div><div className="muted-copy">Client-facing contact</div></div>
        </div>
      </section>

      {view === 'identity' && (
      <div className="two-col-grid">
        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="section-title">Brand Identity</div>
          <div className="muted-copy">Set the labels and assets that define how this workspace should appear later in branded surfaces.</div>
          <label>Brand Name</label>
          <input value={String(form.brand_name || '')} onChange={e => setForm(current => ({ ...current, brand_name: e.target.value }))} />
          <label>App Label</label>
          <input value={String(form.app_label || '')} onChange={e => setForm(current => ({ ...current, app_label: e.target.value }))} />
          <label>Logo URL</label>
          <input value={String(form.logo_url || '')} onChange={e => setForm(current => ({ ...current, logo_url: e.target.value }))} />
          <label>Favicon URL</label>
          <input value={String(form.favicon_url || '')} onChange={e => setForm(current => ({ ...current, favicon_url: e.target.value }))} />
          <label>Support Email</label>
          <input value={String(form.support_email || '')} onChange={e => setForm(current => ({ ...current, support_email: e.target.value }))} />
        </section>

        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="section-title">Theme Tokens</div>
          <div className="muted-copy">These fields drive the live app shell theme for this workspace, not just the accent buttons.</div>
          <label>Primary Color</label>
          <input value={String(form.primary_color || '')} onChange={e => setForm(current => ({ ...current, primary_color: e.target.value }))} placeholder="#0f766e" />
          <label>Accent Color</label>
          <input value={String(form.accent_color || '')} onChange={e => setForm(current => ({ ...current, accent_color: e.target.value }))} placeholder="#f59e0b" />
          <label>App Background</label>
          <input value={String(theme.bg || '')} onChange={e => setThemeToken('bg', e.target.value)} placeholder="#0b1020" />
          <label>Card Surface</label>
          <input value={String(theme.surface || '')} onChange={e => setThemeToken('surface', e.target.value)} placeholder="#111827" />
          <label>Input Surface</label>
          <input value={String(theme.surface2 || '')} onChange={e => setThemeToken('surface2', e.target.value)} placeholder="#172033" />
          <label>Border Color</label>
          <input value={String(theme.border || '')} onChange={e => setThemeToken('border', e.target.value)} placeholder="#2a3550" />
          <label>Text Color</label>
          <input value={String(theme.text || '')} onChange={e => setThemeToken('text', e.target.value)} placeholder="#edf2f7" />
          <label>Muted Text</label>
          <input value={String(theme.muted || '')} onChange={e => setThemeToken('muted', e.target.value)} placeholder="#94a3b8" />
          <label>Custom CSS</label>
          <textarea value={String(form.custom_css || '')} onChange={e => setForm(current => ({ ...current, custom_css: e.target.value }))} rows={8} placeholder="Future white-label overrides go here." />
        </section>
      </div>
      )}

      {view === 'domain' && (
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="section-title">Domain And Routing Readiness</div>
        <div className="muted-copy">This stores the workspace custom-domain metadata and tracks its readiness state for branded delivery flows.</div>
        <label>Custom Domain</label>
        <input value={String(form.custom_domain || '')} onChange={e => setForm(current => ({ ...current, custom_domain: e.target.value }))} placeholder="client.example.com" />
        <label>Domain Status</label>
        <select value={String(form.domain_status || 'draft')} onChange={e => setForm(current => ({ ...current, domain_status: e.target.value as WorkspaceBranding['domain_status'] }))}>
          <option value="draft">draft</option>
          <option value="pending_verification">pending_verification</option>
          <option value="verified">verified</option>
          <option value="failed">failed</option>
        </select>
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(88,166,255,.05)', color: 'var(--muted)', fontSize: 13 }}>
          Save the domain value here when you want the workspace branding metadata ready ahead of future live domain support.
        </div>
      </section>
      )}

      {view === 'readiness' && (
      <>
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="section-title">Readiness Checklist</div>
        {readiness.map(item => (
          <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
            <span>{item.label}</span>
            <span className={`badge ${item.ready ? 'badge-green' : 'badge-yellow'}`}>{item.ready ? 'ready' : 'pending'}</span>
          </div>
        ))}
      </section>

      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="section-title">Future White-Label Scope</div>
        <div style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
          This pass activates app-shell and public-portal branding now. Full tenant-specific domain routing, asset hosting, and branded auth remain the next layer.
        </div>
      </section>
      </>
      )}

      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="inline-wrap">
          <button className="btn-primary" onClick={save}>Save Branding Settings</button>
        </div>
      </section>

      {notice && <div className="card" style={{ color: 'var(--muted)' }}>{notice}</div>}
    </div>
  )
}
