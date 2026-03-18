import { useEffect, useState } from 'react'
import { saas, generateNewsletter } from '../api'
import { Megaphone, Plus, Send, Trash2, Edit3, Users, CheckCircle2, Loader, Eye, Wand2 } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Broadcast {
  id: string
  name: string
  subject: string
  body_html: string
  body_plain?: string
  status: 'draft' | 'sending' | 'sent' | 'failed'
  filter_status: string
  filter_tag?: string
  recipient_count: number
  sent_count: number
  failed_count: number
  sent_at?: string
  created_at: string
}

type View = 'list' | 'editor'

const STATUS_COLORS: Record<string, string> = {
  draft: '#8b949e', sending: '#58a6ff', sent: '#3fb950', failed: '#f78166',
}

const FILTER_OPTIONS = [
  { value: 'active',   label: 'Active subscribers only' },
  { value: 'all',      label: 'All subscribers (excl. unsub/bounced)' },
]

const AI_EMAIL_TYPES = [
  { id: 'newsletter',    label: 'Newsletter' },
  { id: 'promotional',  label: 'Promotional' },
  { id: 'announcement', label: 'Announcement' },
  { id: 'reengagement', label: 'Re-engagement' },
  { id: 'event_invite', label: 'Event Invite' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ── Editor ────────────────────────────────────────────────────────────────────

function BroadcastEditor({
  broadcast,
  onSave,
  onSend,
  onClose,
}: {
  broadcast: Broadcast
  onSave: (updates: Partial<Broadcast>) => Promise<void>
  onSend: () => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(broadcast.name)
  const [subject, setSubject] = useState(broadcast.subject)
  const [bodyHtml, setBodyHtml] = useState(broadcast.body_html)
  const [filterStatus, setFilterStatus] = useState(broadcast.filter_status || 'active')
  const [filterTag, setFilterTag] = useState(broadcast.filter_tag || '')
  const [recipientCount, setRecipientCount] = useState(broadcast.recipient_count)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [aiType, setAiType] = useState('newsletter')
  const [aiTopic, setAiTopic] = useState('')
  const [aiNiche, setAiNiche] = useState('')
  const [generating, setGenerating] = useState(false)

  const isDraft = broadcast.status === 'draft'
  const isSent = broadcast.status === 'sent'

  // Load recipient count on filter change
  useEffect(() => {
    if (!broadcast.id) return
    saas.get(`/email-broadcasts/${broadcast.id}/preview`)
      .then(r => setRecipientCount(r.data.recipient_count))
      .catch(() => {})
  }, [broadcast.id, filterStatus, filterTag])

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ name, subject, body_html: bodyHtml, filter_status: filterStatus, filter_tag: filterTag || null })
      setNotice({ tone: 'success', text: 'Saved.' })
    } catch (e: unknown) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const send = async () => {
    if (!subject.trim()) return setNotice({ tone: 'error', text: 'Add a subject before sending.' })
    if (!bodyHtml.trim()) return setNotice({ tone: 'error', text: 'Add email body before sending.' })
    if (!confirm(`Send to ${recipientCount} subscribers? This cannot be undone.`)) return
    setSending(true)
    try {
      await save()
      await onSend()
      setNotice({ tone: 'success', text: `Broadcast sent to ${recipientCount} subscribers.` })
    } catch (e: unknown) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Send failed' })
    } finally {
      setSending(false)
    }
  }

  const generateAi = async () => {
    if (!aiTopic.trim()) return setNotice({ tone: 'error', text: 'Enter a topic for AI generation.' })
    setGenerating(true)
    try {
      const r = await generateNewsletter({
        email_type: aiType,
        niche: aiNiche || aiTopic,
        audience: 'subscribers',
        topic: aiTopic,
        tones: ['conversational'],
        word_count: 300,
      })
      if (r.subject) setSubject(r.subject)
      if (r.body_html) setBodyHtml(r.body_html)
      setNotice({ tone: 'success', text: 'AI email generated.' })
    } catch (e: unknown) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Generation failed' })
    } finally {
      setGenerating(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '9px 12px', color: 'var(--text)',
    fontSize: 13, width: '100%', boxSizing: 'border-box',
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{name || 'Untitled Broadcast'}</h2>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em',
            color: STATUS_COLORS[broadcast.status], background: STATUS_COLORS[broadcast.status] + '22',
            border: `1px solid ${STATUS_COLORS[broadcast.status]}44`, borderRadius: 6, padding: '2px 8px',
          }}>{broadcast.status}</span>
        </div>
        {isDraft && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" onClick={save} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              {saving ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              Save Draft
            </button>
            <button
              onClick={send} disabled={sending}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                borderRadius: 8, border: 'none', background: sending ? 'var(--surface2)' : '#3fb950',
                color: sending ? 'var(--muted)' : '#fff', fontSize: 12, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer',
              }}>
              {sending ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={12} />}
              {sending ? 'Sending...' : `Send to ${recipientCount} subscribers`}
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 13,
          background: notice.tone === 'error' ? 'rgba(247,129,102,0.1)' : 'rgba(63,185,80,0.1)',
          border: `1px solid ${notice.tone === 'error' ? '#f7816644' : '#3fb95044'}`,
          color: notice.tone === 'error' ? '#f78166' : '#3fb950',
        }}>
          {notice.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        {/* Left — email editor */}
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ display: 'grid', gap: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.07em', textTransform: 'uppercase' }}>
              Broadcast Details
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>NAME</label>
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. March Newsletter" disabled={isSent} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>SUBJECT LINE</label>
              <input style={inputStyle} value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Big news this week 🎉" disabled={isSent} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>EMAIL BODY (HTML)</label>
                <button className="btn-ghost" onClick={() => setShowPreview(p => !p)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', fontSize: 11 }}>
                  <Eye size={11} /> {showPreview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {showPreview
                ? <div style={{
                    border: '1px solid var(--border)', borderRadius: 8, padding: 16, minHeight: 300,
                    background: '#fff', color: '#111',
                  }} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                : <textarea
                    style={{ ...inputStyle, minHeight: 300, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                    value={bodyHtml}
                    onChange={e => setBodyHtml(e.target.value)}
                    placeholder="<p>Hello {{first_name}},</p><p>Your email body here...</p>"
                    disabled={isSent}
                  />
              }
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                Tokens: <code style={{ color: 'var(--accent)' }}>{'{{first_name}}'}</code> <code style={{ color: 'var(--accent)' }}>{'{{last_name}}'}</code> <code style={{ color: 'var(--accent)' }}>{'{{email}}'}</code>
              </div>
            </div>
          </div>

          {/* AI Generator */}
          {isDraft && (
            <div className="card" style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Wand2 size={14} color="var(--accent)" />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>AI Generate Email</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>TYPE</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={aiType} onChange={e => setAiType(e.target.value)}>
                    {AI_EMAIL_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>NICHE</label>
                  <input style={inputStyle} value={aiNiche} onChange={e => setAiNiche(e.target.value)} placeholder="e.g. SaaS, fitness, finance" />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>TOPIC</label>
                <input style={inputStyle} value={aiTopic} onChange={e => setAiTopic(e.target.value)} placeholder="e.g. Announcing our new dashboard feature" />
              </div>
              <button
                onClick={generateAi} disabled={generating}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '9px', borderRadius: 8, border: '1px solid rgba(88,166,255,0.3)',
                  background: 'rgba(88,166,255,0.08)', color: 'var(--accent)',
                  fontSize: 12, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer',
                }}>
                {generating ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Wand2 size={12} />}
                {generating ? 'Generating...' : 'Generate with AI'}
              </button>
            </div>
          )}
        </div>

        {/* Right — audience */}
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Users size={14} color="var(--accent)" />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Audience</span>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>SEND TO</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)} disabled={isSent}>
                {FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>FILTER BY TAG (optional)</label>
              <input style={inputStyle} value={filterTag} onChange={e => setFilterTag(e.target.value)}
                placeholder="e.g. vip, trial, customer" disabled={isSent} />
            </div>
            <div style={{
              padding: '14px', borderRadius: 10, background: 'rgba(88,166,255,0.08)',
              border: '1px solid rgba(88,166,255,0.2)', textAlign: 'center',
            }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)' }}>{recipientCount.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>recipients</div>
            </div>
          </div>

          {isSent && (
            <div className="card" style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Results</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ background: 'rgba(63,185,80,0.1)', borderRadius: 8, padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#3fb950' }}>{broadcast.sent_count}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>sent</div>
                </div>
                <div style={{ background: 'rgba(247,129,102,0.1)', borderRadius: 8, padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#f78166' }}>{broadcast.failed_count}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>failed</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Sent {fmtDate(broadcast.sent_at)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export default function EmailBroadcastPanel() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<Broadcast | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const r = await saas.get('/email-broadcasts')
      setBroadcasts(r.data.broadcasts || [])
    } catch { setError('Could not load broadcasts') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    if (!newName.trim()) return
    try {
      const r = await saas.post('/email-broadcasts', { name: newName.trim() })
      setBroadcasts(prev => [r.data.broadcast, ...prev])
      setSelected(r.data.broadcast)
      setView('editor')
      setCreating(false)
      setNewName('')
    } catch (e: unknown) {
      const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'Create failed')
      setError(msg)
      console.error('[Broadcasts] create error:', (e as any)?.response?.data || e)
    }
  }

  const save = async (updates: Partial<Broadcast>) => {
    if (!selected) return
    const r = await saas.patch(`/email-broadcasts/${selected.id}`, updates)
    const updated = r.data.broadcast
    setSelected(updated)
    setBroadcasts(prev => prev.map(b => b.id === updated.id ? updated : b))
  }

  const send = async () => {
    if (!selected) return
    await saas.post(`/email-broadcasts/${selected.id}/send`)
    await load()
    const fresh = broadcasts.find(b => b.id === selected.id)
    if (fresh) setSelected({ ...fresh, status: 'sending' })
    setTimeout(async () => { await load() }, 3000)
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this broadcast?')) return
    await saas.delete(`/email-broadcasts/${id}`)
    setBroadcasts(prev => prev.filter(b => b.id !== id))
    if (selected?.id === id) { setSelected(null); setView('list') }
  }

  if (view === 'editor' && selected) {
    return (
      <BroadcastEditor
        broadcast={selected}
        onSave={save}
        onSend={send}
        onClose={() => { setView('list'); load() }}
      />
    )
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(88,166,255,0.15)', border: '1px solid rgba(88,166,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Megaphone size={18} color="#58a6ff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>Broadcast Emails</h2>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>One-time emails sent to your subscriber list</p>
          </div>
        </div>
        <button onClick={() => setCreating(true)} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px',
          borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #58a6ff, #a371f7)',
          color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>
          <Plus size={14} /> New Broadcast
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(247,129,102,0.1)', color: '#f78166', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Create form */}
      {creating && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, flex: 1 }}
            placeholder="Broadcast name, e.g. April Newsletter"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()}
            autoFocus
          />
          <button onClick={create} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> Create
          </button>
          <button onClick={() => { setCreating(false); setNewName('') }} className="btn-ghost">Cancel</button>
        </div>
      )}

      {/* List */}
      {loading
        ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading...</div>
        : broadcasts.length === 0
          ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <Megaphone size={32} color="var(--border)" style={{ margin: '0 auto 16px' }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>No broadcasts yet</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Create your first broadcast to send a one-time email to your list.</div>
            </div>
          )
          : (
            <div style={{ display: 'grid', gap: 10 }}>
              {broadcasts.map(b => (
                <div key={b.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    background: STATUS_COLORS[b.status] + '22',
                    border: `1px solid ${STATUS_COLORS[b.status]}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {b.status === 'sent'
                      ? <CheckCircle2 size={16} color={STATUS_COLORS[b.status]} />
                      : b.status === 'sending'
                        ? <Loader size={16} color={STATUS_COLORS[b.status]} style={{ animation: 'spin 1s linear infinite' }} />
                        : <Megaphone size={16} color={STATUS_COLORS[b.status]} />}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{b.name}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em',
                        color: STATUS_COLORS[b.status], background: STATUS_COLORS[b.status] + '22',
                        border: `1px solid ${STATUS_COLORS[b.status]}44`, borderRadius: 6, padding: '1px 7px',
                      }}>{b.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {b.subject || <em>No subject</em>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'flex', gap: 12 }}>
                      {b.status === 'sent'
                        ? <span>{b.sent_count.toLocaleString()} sent · {b.failed_count} failed · {fmtDate(b.sent_at)}</span>
                        : <span>Created {fmtDate(b.created_at)}</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      className="btn-ghost"
                      onClick={() => { setSelected(b); setView('editor') }}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', fontSize: 12 }}
                    >
                      <Edit3 size={12} /> {b.status === 'draft' ? 'Edit' : 'View'}
                    </button>
                    {b.status === 'draft' && (
                      <button
                        className="btn-ghost"
                        onClick={() => remove(b.id)}
                        style={{ padding: '6px 10px', color: '#f78166', borderColor: '#f7816633' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
      }
    </div>
  )
}
