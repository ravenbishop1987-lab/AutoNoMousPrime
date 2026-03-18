import { useEffect, useState } from 'react'
import {
  approveQueueItem,
  getPendingSocialQueue,
  rejectQueueItem,
  updateQueueItemText,
  type PendingQueueItem,
} from '../api'
import {
  Check,
  Edit2,
  Loader,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react'

// ─── helpers ─────────────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  twitter:          '#1d9bf0',
  x:                '#1d9bf0',
  linkedin:         '#0a66c2',
  facebook:         '#1877f2',
  instagram:        '#e1306c',
  instagram_posts:  '#e1306c',
  tiktok:           '#ff0050',
  youtube:          '#ff0000',
  reddit:           '#ff4500',
  threads:          '#000000',
}

function platformColor(platform: string) {
  return PLATFORM_COLORS[platform?.toLowerCase()] ?? '#58a6ff'
}

function PlatformBadge({ platform }: { platform: string }) {
  const color = platformColor(platform)
  return (
    <span style={{
      background: `${color}22`,
      color,
      border: `1px solid ${color}44`,
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      {platform}
    </span>
  )
}

// ─── item card ────────────────────────────────────────────────────────────────

function QueueCard({
  item,
  onApprove,
  onReject,
  onSave,
}: {
  item: PendingQueueItem
  onApprove: (id: number) => Promise<void>
  onReject:  (id: number) => Promise<void>
  onSave:    (id: number, text: string) => Promise<void>
}) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(item.text)
  const [busy, setBusy]         = useState(false)

  async function handleApprove() {
    setBusy(true)
    try { await onApprove(item.id) } finally { setBusy(false) }
  }
  async function handleReject() {
    setBusy(true)
    try { await onReject(item.id) } finally { setBusy(false) }
  }
  async function handleSave() {
    setBusy(true)
    try {
      await onSave(item.id, draft)
      setEditing(false)
    } finally { setBusy(false) }
  }

  return (
    <div style={{
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: 10,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PlatformBadge platform={item.platform} />
        {item.topic && (
          <span style={{ color: '#8b949e', fontSize: 12, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.topic}
          </span>
        )}
        {item.scheduled_at && (
          <span style={{ marginLeft: 'auto', color: '#8b949e', fontSize: 11, whiteSpace: 'nowrap' }}>
            {new Date(item.scheduled_at).toLocaleString()}
          </span>
        )}
      </div>

      {/* text / editor */}
      {editing ? (
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={4}
          style={{
            width: '100%',
            background: '#0d1117',
            color: '#e6edf3',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 13,
            resize: 'vertical',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <p style={{ margin: 0, color: '#e6edf3', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {item.text}
        </p>
      )}

      {/* actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={busy || !draft.trim()}
              style={btnStyle('#3fb950', busy)}
            >
              <Save size={13} /> Save
            </button>
            <button
              onClick={() => { setDraft(item.text); setEditing(false) }}
              disabled={busy}
              style={btnStyle('#8b949e', busy)}
            >
              <X size={13} /> Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={handleApprove} disabled={busy} style={btnStyle('#3fb950', busy)}>
              {busy ? <Loader size={13} className="spin" /> : <Check size={13} />} Approve
            </button>
            <button onClick={() => setEditing(true)} disabled={busy} style={btnStyle('#58a6ff', busy)}>
              <Edit2 size={13} /> Edit
            </button>
            <button onClick={handleReject} disabled={busy} style={btnStyle('#f85149', busy)}>
              <Trash2 size={13} /> Reject
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function btnStyle(color: string, disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 12px',
    borderRadius: 6,
    border: `1px solid ${color}44`,
    background: `${color}18`,
    color,
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}

// ─── tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'awaiting' | 'all'

// ─── main panel ──────────────────────────────────────────────────────────────

export default function SocialQueuePanel() {
  const [tab, setTab]         = useState<Tab>('awaiting')
  const [items, setItems]     = useState<PendingQueueItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await getPendingSocialQueue()
      setItems(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load queue')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleApprove(id: number) {
    await approveQueueItem(id)
    setItems(prev => prev.filter(i => i.id !== id))
  }
  async function handleReject(id: number) {
    await rejectQueueItem(id)
    setItems(prev => prev.filter(i => i.id !== id))
  }
  async function handleSave(id: number, text: string) {
    await updateQueueItemText(id, text)
    setItems(prev => prev.map(i => i.id === id ? { ...i, text } : i))
  }

  const displayed = tab === 'awaiting'
    ? items.filter(i => i.status === 'pending')
    : items

  return (
    <div style={{ padding: '24px 28px', maxWidth: 820, margin: '0 auto' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, color: '#e6edf3', fontSize: 18, fontWeight: 700 }}>
          Social Queue
        </h2>
        <button
          onClick={load}
          disabled={loading}
          style={{ marginLeft: 'auto', ...btnStyle('#58a6ff', loading) }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #21262d', paddingBottom: 0 }}>
        {(['awaiting', 'all'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '7px 16px',
              borderRadius: '6px 6px 0 0',
              border: 'none',
              background: tab === t ? '#161b22' : 'transparent',
              color: tab === t ? '#e6edf3' : '#8b949e',
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #58a6ff' : '2px solid transparent',
            }}
          >
            {t === 'awaiting' ? `Awaiting Approval (${items.filter(i => i.status === 'pending').length})` : 'All Pending'}
          </button>
        ))}
      </div>

      {/* content */}
      {error && (
        <div style={{ background: '#f8514922', border: '1px solid #f8514944', color: '#f85149', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ color: '#8b949e', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          Loading…
        </div>
      )}

      {!loading && displayed.length === 0 && (
        <div style={{ color: '#8b949e', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          {tab === 'awaiting'
            ? 'No posts awaiting approval. Enable require_approval in Settings → Approvals to use this queue.'
            : 'Queue is empty.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {displayed.map(item => (
          <QueueCard
            key={item.id}
            item={item}
            onApprove={handleApprove}
            onReject={handleReject}
            onSave={handleSave}
          />
        ))}
      </div>
    </div>
  )
}
