import { useEffect, useMemo, useState } from 'react'
import {
  createTemplate,
  duplicateTemplate,
  getTemplateLibrary,
  getTemplates,
  getWorkspaceSession,
  type TemplateItem,
} from '../api'

const TEMPLATE_KINDS = ['blog_post', 'youtube_description', 'tiktok_script', 'cta_block', 'landing_page', 'workflow_preset', 'content_preset'] as const
const TEMPLATE_VIEWS = [
  { key: 'create', label: 'Create' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'library', label: 'Library' },
] as const

function templateKindLabel(value: string) {
  return value.replace(/_/g, ' ')
}

export default function TemplatesPanel() {
  const [workspaceId, setWorkspaceId] = useState('')
  const [items, setItems] = useState<TemplateItem[]>([])
  const [library, setLibrary] = useState<TemplateItem[]>([])
  const [templateKind, setTemplateKind] = useState<typeof TEMPLATE_KINDS[number]>('blog_post')
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<(typeof TEMPLATE_VIEWS)[number]['key']>('workspace')
  const [workspaceSearch, setWorkspaceSearch] = useState('')
  const [workspaceFilter, setWorkspaceFilter] = useState('')
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryFilter, setLibraryFilter] = useState('')

  async function load() {
    try {
      const session = await getWorkspaceSession()
      const id = session.active_workspace?.id || ''
      setWorkspaceId(id)
      if (!id) return
      const [templatesResp, libraryResp] = await Promise.all([
        getTemplates(id),
        getTemplateLibrary(id),
      ])
      setItems(templatesResp.items || [])
      setLibrary(libraryResp.items || [])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load templates')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function createNewTemplate() {
    if (!workspaceId || !name.trim()) return
    try {
      await createTemplate(workspaceId, {
        template_kind: templateKind,
        name: name.trim(),
        body_template: body.trim(),
        visibility: 'workspace',
        scope: 'workspace',
      })
      setName('')
      setBody('')
      setNotice('Template created.')
      setView('workspace')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create template')
    }
  }

  async function duplicateFromLibrary(templateId: string) {
    if (!workspaceId) return
    try {
      await duplicateTemplate(workspaceId, templateId)
      setNotice('Template copied into the workspace library.')
      setView('workspace')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not copy template')
    }
  }

  const filteredWorkspaceItems = useMemo(() => {
    const search = workspaceSearch.trim().toLowerCase()
    return items.filter(item => {
      const matchesKind = !workspaceFilter || item.template_kind === workspaceFilter
      if (!matchesKind) return false
      if (!search) return true
      return `${item.name} ${item.description || ''} ${item.body_template || ''}`.toLowerCase().includes(search)
    })
  }, [items, workspaceFilter, workspaceSearch])

  const filteredLibraryItems = useMemo(() => {
    const search = librarySearch.trim().toLowerCase()
    return library.filter(item => {
      const matchesKind = !libraryFilter || item.template_kind === libraryFilter
      if (!matchesKind) return false
      if (!search) return true
      return `${item.name} ${item.description || ''} ${item.body_template || ''}`.toLowerCase().includes(search)
    })
  }, [library, libraryFilter, librarySearch])

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '32px 24px', display: 'grid', gap: 18 }}>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Templates</div>
            <div className="panel-title">Reusable content and workflow building blocks</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              Create your own templates, manage the workspace library, or copy proven starters into the workspace when you need them.
            </div>
          </div>
          <div className="inline-wrap">
            {TEMPLATE_VIEWS.map(item => (
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
          <div className="summary-card"><div className="summary-label">Workspace templates</div><div className="summary-value">{items.length}</div></div>
          <div className="summary-card"><div className="summary-label">Library templates</div><div className="summary-value">{library.length}</div></div>
          <div className="summary-card"><div className="summary-label">Coverage types</div><div className="summary-value">{TEMPLATE_KINDS.filter(kind => items.some(item => item.template_kind === kind)).length}</div></div>
          <div className="summary-card"><div className="summary-label">Current type</div><div className="summary-value summary-value-sm">{templateKindLabel(templateKind)}</div></div>
        </div>
      </section>

      {view === 'create' && (
      <div className="two-col-grid">
        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="section-title">Create Template</div>
          <div className="muted-copy">Start with the template type, give it a clear name, and add placeholders the team can reuse.</div>
          <label>Template Type</label>
          <select value={templateKind} onChange={event => setTemplateKind(event.target.value as typeof TEMPLATE_KINDS[number])}>
            {TEMPLATE_KINDS.map(item => <option key={item} value={item}>{templateKindLabel(item)}</option>)}
          </select>
          <label>Name</label>
          <input value={name} onChange={event => setName(event.target.value)} placeholder="Authority blog template" />
          <label>Template Body</label>
          <textarea value={body} onChange={event => setBody(event.target.value)} rows={8} placeholder="Use placeholders like {{title}} and {{cta_label}}" />
          <button className="btn-primary" onClick={createNewTemplate}>Save Template</button>
        </section>

        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="section-title">Template Coverage</div>
          <div className="muted-copy">See which template types already exist in the workspace library.</div>
          {TEMPLATE_KINDS.map(kind => (
            <div key={kind} style={coverageRow}>
              <span>{templateKindLabel(kind)}</span>
              <strong>{items.filter(item => item.template_kind === kind).length}</strong>
            </div>
          ))}
        </section>
      </div>
      )}

      {view === 'workspace' && (
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="title-row">
          <div className="panel-stack" style={{ gap: 4 }}>
            <div className="section-title">Workspace Template Library</div>
            <div className="muted-copy">{filteredWorkspaceItems.length} template{filteredWorkspaceItems.length === 1 ? '' : 's'} shown</div>
          </div>
        </div>
        <div className="control-grid">
          <input value={workspaceSearch} onChange={event => setWorkspaceSearch(event.target.value)} placeholder="Search workspace templates" />
          <select value={workspaceFilter} onChange={event => setWorkspaceFilter(event.target.value)}>
            <option value="">All template types</option>
            {TEMPLATE_KINDS.map(item => <option key={item} value={item}>{templateKindLabel(item)}</option>)}
          </select>
        </div>
        {!items.length ? (
          <div style={{ color: 'var(--muted)' }}>No workspace templates yet.</div>
        ) : !filteredWorkspaceItems.length ? (
          <div style={{ color: 'var(--muted)' }}>No workspace templates match the current search or filter.</div>
        ) : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {filteredWorkspaceItems.map(item => (
              <div key={item.id} style={templateCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <strong style={{ color: '#e6edf3' }}>{item.name}</strong>
                  <span className="badge badge-blue">{templateKindLabel(item.template_kind)}</span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>{item.description || 'Reusable workspace template.'}</div>
                <pre style={preStyle}>{item.body_template}</pre>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {view === 'library' && (
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="title-row">
          <div className="panel-stack" style={{ gap: 4 }}>
            <div className="section-title">Marketplace / Internal Library</div>
            <div className="muted-copy">{filteredLibraryItems.length} template{filteredLibraryItems.length === 1 ? '' : 's'} shown</div>
          </div>
        </div>
        <div className="control-grid">
          <input value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder="Search starter templates" />
          <select value={libraryFilter} onChange={event => setLibraryFilter(event.target.value)}>
            <option value="">All template types</option>
            {TEMPLATE_KINDS.map(item => <option key={item} value={item}>{templateKindLabel(item)}</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {filteredLibraryItems.map(item => (
            <div key={item.id} style={templateCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong style={{ color: '#e6edf3' }}>{item.name}</strong>
                <span className="badge badge-gray">{templateKindLabel(item.template_kind)}</span>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{item.description || 'Reusable system template.'}</div>
              <button className="btn-ghost" onClick={() => duplicateFromLibrary(item.id)}>Copy To Workspace</button>
            </div>
          ))}
        </div>
      </section>
      )}

      {notice && <div className="card" style={{ color: 'var(--muted)' }}>{notice}</div>}
    </div>
  )
}

const coverageRow = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  paddingBottom: 10,
  borderBottom: '1px solid var(--border)',
} as const

const templateCard = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 14,
  display: 'grid',
  gap: 10,
} as const

const preStyle = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  color: 'var(--muted)',
  fontSize: 12,
  maxHeight: 160,
  overflow: 'auto',
} as const
