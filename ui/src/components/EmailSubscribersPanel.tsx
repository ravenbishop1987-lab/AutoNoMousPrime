import { useEffect, useState, useCallback } from 'react'
import { saas } from '../api'

interface Subscriber {
  id: string
  email: string
  first_name?: string
  last_name?: string
  tags: string[]
  status: string
  source: string
  created_at: string
  enrollments?: Array<{
    id: string
    sequence_id: string
    current_step: number
    status: string
    enrolled_at: string
    last_sent_at?: string
    sequence?: { name: string }
  }>
}

interface Sequence { id: string; name: string; steps?: { id: string }[] }

const STATUS_COLORS: Record<string, string> = {
  active: '#3fb950', paused: '#e3b341', unsubscribed: '#f85149', bounced: '#ff7b72',
}

export default function EmailSubscribersPanel() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showEnroll, setShowEnroll] = useState(false)
  const [enrollSeqId, setEnrollSeqId] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [enrollMsg, setEnrollMsg] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importCsv, setImportCsv] = useState('')
  const [importing, setImporting] = useState(false)

  // Add subscriber form
  const [addEmail, setAddEmail] = useState('')
  const [addFirst, setAddFirst] = useState('')
  const [addLast, setAddLast] = useState('')
  const [addTags, setAddTags] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' })
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      const r = await saas.get(`/email-subscribers?${params}`)
      setSubscribers(r.data.subscribers || [])
      setTotal(r.data.total || 0)
    } catch { setError('Failed to load subscribers') }
    finally { setLoading(false) }
  }, [page, search, statusFilter])

  const loadSequences = async () => {
    try {
      const r = await saas.get('/email-sequences')
      setSequences(r.data.sequences || [])
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); loadSequences() }, [load])

  const addSubscriber = async () => {
    if (!addEmail.trim()) return
    setAddSaving(true)
    try {
      await saas.post('/email-subscribers', {
        email: addEmail.trim(),
        first_name: addFirst.trim() || undefined,
        last_name: addLast.trim() || undefined,
        tags: addTags ? addTags.split(',').map(t => t.trim()).filter(Boolean) : [],
      })
      setAddEmail(''); setAddFirst(''); setAddLast(''); setAddTags('')
      setShowAdd(false)
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add subscriber')
    } finally { setAddSaving(false) }
  }

  const deleteSubscriber = async (id: string) => {
    if (!confirm('Delete this subscriber?')) return
    await saas.delete(`/email-subscribers/${id}`)
    load()
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === subscribers.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(subscribers.map(s => s.id)))
    }
  }

  const enrollSelected = async () => {
    if (!enrollSeqId || selected.size === 0) return
    setEnrolling(true)
    setEnrollMsg('')
    try {
      const r = await saas.post(`/email-sequences/${enrollSeqId}/enroll`, { subscriber_ids: Array.from(selected) })
      const ok = r.data.results.filter((x: { ok: boolean }) => x.ok).length
      const fail = r.data.results.filter((x: { ok: boolean }) => !x.ok).length
      setEnrollMsg(`✓ Enrolled ${ok}${fail > 0 ? `, ${fail} failed` : ''}`)
      setSelected(new Set())
      load()
    } catch { setEnrollMsg('✗ Enrollment failed') }
    finally { setEnrolling(false) }
  }

  const importCsvData = async () => {
    if (!importCsv.trim()) return
    setImporting(true)
    try {
      const lines = importCsv.trim().split('\n')
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
        const row: Record<string, string> = {}
        headers.forEach((h, i) => { row[h] = vals[i] || '' })
        return { email: row.email, first_name: row.first_name || row['first name'] || '', last_name: row.last_name || row['last name'] || '', tags: row.tags ? row.tags.split(';').filter(Boolean) : [] }
      }).filter(r => r.email)

      await saas.post('/email-subscribers/bulk', { subscribers: rows })
      setImportCsv('')
      setShowImport(false)
      load()
    } catch { setError('Import failed — check CSV format') }
    finally { setImporting(false) }
  }

  const updateStatus = async (id: string, status: string) => {
    await saas.patch(`/email-subscribers/${id}`, { status })
    load()
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>👥 Subscribers</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{total.toLocaleString()} contacts</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={() => setShowImport(!showImport)} style={{ padding: '7px 12px', fontSize: 12 }}>↑ Import CSV</button>
          <button className="btn-primary" onClick={() => setShowAdd(!showAdd)} style={{ padding: '7px 14px', fontSize: 13 }}>+ Add Contact</button>
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}

      {/* Add subscriber form */}
      {showAdd && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 12, padding: 20, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Add Subscriber</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>EMAIL *</label>
              <input className="input" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="email@example.com" style={{ fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>FIRST NAME</label>
              <input className="input" value={addFirst} onChange={e => setAddFirst(e.target.value)} placeholder="Jane" style={{ fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>LAST NAME</label>
              <input className="input" value={addLast} onChange={e => setAddLast(e.target.value)} placeholder="Smith" style={{ fontSize: 13 }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>TAGS (comma separated)</label>
            <input className="input" value={addTags} onChange={e => setAddTags(e.target.value)} placeholder="customer, lead, webinar" style={{ fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={addSubscriber} disabled={addSaving || !addEmail.trim()} style={{ padding: '8px 18px', fontSize: 13 }}>
              {addSaving ? 'Adding…' : 'Add Subscriber'}
            </button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)} style={{ padding: '8px 14px', fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* CSV Import */}
      {showImport && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Import CSV</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Format: email, first_name, last_name, tags (semicolon-separated). First row must be headers.</div>
          <textarea className="input" value={importCsv} onChange={e => setImportCsv(e.target.value)} rows={6} placeholder={`email,first_name,last_name,tags\njane@example.com,Jane,Smith,customer;lead\nbob@example.com,Bob,Jones,`} style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={importCsvData} disabled={importing || !importCsv.trim()} style={{ padding: '8px 18px', fontSize: 13 }}>{importing ? 'Importing…' : 'Import'}</button>
            <button className="btn-ghost" onClick={() => setShowImport(false)} style={{ padding: '8px 14px', fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Filters + bulk actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search name or email…" style={{ fontSize: 13, flex: 1, minWidth: 200 }} />
        <select className="input" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} style={{ width: 'auto', padding: '8px 12px', fontSize: 13 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="bounced">Bounced</option>
        </select>
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--accent)' }}>{selected.size} selected</span>
            <button className="btn-ghost" onClick={() => setShowEnroll(!showEnroll)} style={{ padding: '6px 12px', fontSize: 12 }}>Enroll in Sequence</button>
          </div>
        )}
      </div>

      {/* Enroll panel */}
      {showEnroll && selected.size > 0 && (
        <div style={{ background: 'rgba(88,166,255,.06)', border: '1px solid rgba(88,166,255,.2)', borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Enroll {selected.size} contacts in:</span>
          <select className="input" value={enrollSeqId} onChange={e => setEnrollSeqId(e.target.value)} style={{ width: 'auto', fontSize: 13, padding: '6px 10px' }}>
            <option value="">— choose sequence —</option>
            {sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn-primary" onClick={enrollSelected} disabled={enrolling || !enrollSeqId} style={{ padding: '7px 14px', fontSize: 12 }}>
            {enrolling ? 'Enrolling…' : 'Enroll Now'}
          </button>
          {enrollMsg && <span style={{ fontSize: 12, color: enrollMsg.startsWith('✓') ? '#3fb950' : '#f85149' }}>{enrollMsg}</span>}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      ) : subscribers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--muted)', fontSize: 13 }}>
          {search || statusFilter ? 'No subscribers match your filters.' : 'No subscribers yet. Add your first contact above.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', width: 32 }}>
                  <input type="checkbox" checked={selected.size === subscribers.length && subscribers.length > 0} onChange={toggleAll} />
                </th>
                {['Name', 'Email', 'Tags', 'Status', 'Enrolled In', 'Step', 'Last Emailed', ''].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subscribers.map(sub => {
                const activeEnrollment = sub.enrollments?.find(e => e.status === 'active')
                return (
                  <tr key={sub.id} style={{ borderBottom: '1px solid var(--border)', background: selected.has(sub.id) ? 'rgba(88,166,255,.05)' : 'transparent' }}>
                    <td style={{ padding: '10px 10px' }}>
                      <input type="checkbox" checked={selected.has(sub.id)} onChange={() => toggleSelect(sub.id)} />
                    </td>
                    <td style={{ padding: '10px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {sub.first_name || sub.last_name ? `${sub.first_name || ''} ${sub.last_name || ''}`.trim() : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 10px', color: 'var(--text)' }}>{sub.email}</td>
                    <td style={{ padding: '10px 10px' }}>
                      {sub.tags?.length ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {sub.tags.map(tag => (
                            <span key={tag} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: 'rgba(88,166,255,.12)', color: 'var(--accent)' }}>{tag}</span>
                          ))}
                        </div>
                      ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <select value={sub.status} onChange={e => updateStatus(sub.id, e.target.value)}
                        style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: 'none', background: `${STATUS_COLORS[sub.status] || '#8b949e'}22`, color: STATUS_COLORS[sub.status] || '#8b949e', cursor: 'pointer' }}>
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                        <option value="unsubscribed">Unsubscribed</option>
                      </select>
                    </td>
                    <td style={{ padding: '10px 10px', fontSize: 12, color: 'var(--muted)' }}>
                      {activeEnrollment?.sequence?.name || <span style={{ color: 'var(--border)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 10px', fontSize: 12, color: 'var(--muted)' }}>
                      {activeEnrollment ? `Step ${activeEnrollment.current_step}` : '—'}
                    </td>
                    <td style={{ padding: '10px 10px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {activeEnrollment?.last_sent_at ? new Date(activeEnrollment.last_sent_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <button onClick={() => deleteSubscriber(sub.id)} style={{ fontSize: 11, padding: '2px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: '#f85149', cursor: 'pointer' }}>Delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
          <button className="btn-ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '6px 14px', fontSize: 12 }}>← Prev</button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Page {page} of {Math.ceil(total / 50)}</span>
          <button className="btn-ghost" onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 50)} style={{ padding: '6px 14px', fontSize: 12 }}>Next →</button>
        </div>
      )}
    </div>
  )
}
