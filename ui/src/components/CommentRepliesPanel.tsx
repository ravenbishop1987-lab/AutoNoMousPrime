import { useEffect, useState, useCallback } from 'react'

interface ReplyEntry {
  id: string
  platform: string
  comment: string
  reply: string
  ts: string
}

const PLATFORM_COLOR: Record<string, string> = {
  twitter:   '#1d9bf0',
  facebook:  '#1877f2',
  instagram: '#e1306c',
  youtube:   '#ff0000',
  wordpress: '#21759b',
}

const PLATFORM_ICON: Record<string, string> = {
  twitter:   '𝕏',
  facebook:  'f',
  instagram: '⬡',
  youtube:   '▶',
  wordpress: 'W',
}

function PlatformBadge({ platform }: { platform: string }) {
  const color = PLATFORM_COLOR[platform] ?? '#888'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700,
      background: `${color}22`, border: `1px solid ${color}55`, color,
    }}>
      <span style={{ fontFamily: 'monospace' }}>{PLATFORM_ICON[platform] ?? platform[0].toUpperCase()}</span>
      {platform.charAt(0).toUpperCase() + platform.slice(1)}
    </span>
  )
}

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60)   return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function CommentRepliesPanel() {
  const [replies, setReplies]   = useState<ReplyEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [running, setRunning]   = useState(false)
  const [filter, setFilter]     = useState<string>('all')
  const [lastRun, setLastRun]   = useState<string | null>(null)

  const fetchReplies = useCallback(async () => {
    try {
      const r = await fetch('/api/comment-replies?limit=200')
      const data = await r.json()
      if (data.ok) setReplies(data.replies)
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReplies()
    const id = setInterval(fetchReplies, 30_000)
    return () => clearInterval(id)
  }, [fetchReplies])

  const runNow = async () => {
    setRunning(true)
    try {
      const r = await fetch('/api/comment-replies/run', { method: 'POST' })
      const data = await r.json()
      if (data.ok) {
        const total = data.result?.total_replied ?? 0
        setLastRun(`Ran — ${total} repl${total === 1 ? 'y' : 'ies'} posted`)
        await fetchReplies()
      }
    } catch { /* silent */ } finally {
      setRunning(false)
    }
  }

  const platforms = ['all', ...Array.from(new Set(replies.map(r => r.platform)))]
  const visible = filter === 'all' ? replies : replies.filter(r => r.platform === filter)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Comment Replies</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            AI-generated replies posted by the bot across all platforms
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastRun && (
            <span style={{ fontSize: 12, color: '#3fb950' }}>{lastRun}</span>
          )}
          <button
            className="btn-primary"
            onClick={runNow}
            disabled={running}
            style={{ fontSize: 13, padding: '7px 16px' }}
          >
            {running ? 'Running…' : '▶ Run Now'}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {(['all', 'twitter', 'facebook', 'instagram', 'youtube', 'wordpress'] as const).map(p => {
          const count = p === 'all' ? replies.length : replies.filter(r => r.platform === p).length
          const color = p === 'all' ? '#a5b4fc' : (PLATFORM_COLOR[p] ?? '#888')
          return (
            <button
              key={p}
              onClick={() => setFilter(p)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '10px 20px', borderRadius: 10, cursor: 'pointer', border: 'none',
                background: filter === p ? `${color}22` : 'rgba(255,255,255,.04)',
                outline: filter === p ? `1px solid ${color}66` : '1px solid rgba(255,255,255,.08)',
                color: filter === p ? color : 'var(--muted)',
                transition: 'all .15s',
              }}
            >
              <span style={{ fontSize: 20, fontWeight: 800 }}>{count}</span>
              <span style={{ fontSize: 11, fontWeight: 600, marginTop: 2 }}>
                {p === 'all' ? 'Total' : p.charAt(0).toUpperCase() + p.slice(1)}
              </span>
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading && (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: 20 }}>Loading…</div>
      )}

      {!loading && visible.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '60px 20px', color: 'var(--muted)',
          border: '1px dashed rgba(255,255,255,.1)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No replies yet</div>
          <div style={{ fontSize: 13 }}>
            Enable Auto Comment Reply in Settings → Automation, then hit Run Now or wait for the next scheduled cycle.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {visible.map(entry => (
          <div
            key={entry.id}
            style={{
              background: 'rgba(255,255,255,.03)',
              border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 12,
              padding: '14px 18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <PlatformBadge platform={entry.platform} />
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                {timeAgo(entry.ts)}
              </span>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {/* Original comment */}
              <div style={{
                background: 'rgba(255,255,255,.04)',
                borderLeft: '3px solid rgba(255,255,255,.15)',
                borderRadius: '0 8px 8px 0',
                padding: '8px 12px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: .5 }}>
                  Comment
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,.7)', lineHeight: 1.5 }}>{entry.comment}</div>
              </div>

              {/* Bot reply */}
              <div style={{
                background: 'rgba(99,102,241,.08)',
                borderLeft: `3px solid ${PLATFORM_COLOR[entry.platform] ?? '#6366f1'}`,
                borderRadius: '0 8px 8px 0',
                padding: '8px 12px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: .5 }}>
                  Bot Reply
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,.9)', lineHeight: 1.5 }}>{entry.reply}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
