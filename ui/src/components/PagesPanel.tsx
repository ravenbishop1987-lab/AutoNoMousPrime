import { useEffect, useState } from 'react'
import { Copy, ExternalLink, FileText, Mail, RefreshCw, ThumbsUp, Trash2 } from 'lucide-react'

interface FunnelPage {
  slug: string
  folder: string
  title: string
  created_at: string
  landing_url: string
  thankyou_url: string
  has_thankyou: boolean
  email_count: number
}

function useServerBase() {
  return window.location.protocol + '//' + window.location.hostname + ':8000'
}

export default function PagesPanel() {
  const base = useServerBase()
  const [pages, setPages] = useState<FunnelPage[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const deletePage = async (folder: string) => {
    if (!window.confirm('Delete this page and all its files? This cannot be undone.')) return
    setDeleting(folder)
    try {
      await fetch(`/api/pages/${encodeURIComponent(folder)}`, { method: 'DELETE' })
      setPages(prev => prev.filter(p => p.folder !== folder))
    } catch {
      // ignore
    } finally {
      setDeleting(null)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/pages')
      const data = await r.json()
      setPages(data.pages ?? [])
    } catch {
      setPages([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const copyLink = (url: string, key: string) => {
    const full = base + url
    navigator.clipboard.writeText(full).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
    textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6, display: 'block',
  }

  return (
    <div style={{ padding: '28px 24px', maxWidth: 960, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>Pages</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Your live landing pages and thank-you pages — share the link, no tech required
          </p>
        </div>
        <button
          onClick={load}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 13,
          }}
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {/* Empty state */}
      {!loading && pages.length === 0 && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '64px 32px', textAlign: 'center',
        }}>
          <FileText size={40} color="var(--muted)" style={{ marginBottom: 16 }} />
          <h3 style={{ margin: '0 0 8px', fontSize: 16, color: 'var(--text)' }}>No pages yet</h3>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            Run the <strong>Funnel</strong> step in the Mega Pipeline to generate your first landing page.
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--muted)' }}>Loading pages...</div>
      )}

      {/* Pages list */}
      {!loading && pages.map(page => (
        <div
          key={page.folder}
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 24, marginBottom: 16,
          }}
        >
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
                {page.title}
              </h3>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Created {new Date(page.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              {page.email_count > 0 && (
                <span style={{
                  marginLeft: 10, fontSize: 11, fontWeight: 700,
                  background: 'rgba(88,166,255,0.12)', color: '#58a6ff',
                  border: '1px solid rgba(88,166,255,0.25)', borderRadius: 4, padding: '2px 8px',
                }}>
                  <Mail size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  {page.email_count} emails
                </span>
              )}
            </div>
            <button
              onClick={() => deletePage(page.folder)}
              disabled={deleting === page.folder}
              title="Delete page"
              style={{
                ...btnStyle,
                border: '1px solid rgba(248,81,73,0.3)',
                color: deleting === page.folder ? 'var(--muted)' : '#f85149',
                background: 'rgba(248,81,73,0.06)',
              }}
            >
              <Trash2 size={13} />
              {deleting === page.folder ? 'Deleting…' : 'Delete'}
            </button>
          </div>

          {/* Landing page row */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Landing Page</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{
                flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 14px', fontSize: 13,
                color: 'var(--muted)', fontFamily: 'monospace', overflow: 'hidden',
                whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {base}{page.landing_url}
              </div>
              <button
                onClick={() => window.open(base + page.landing_url, '_blank')}
                title="Preview"
                style={btnStyle}
              >
                <ExternalLink size={14} />
                Preview
              </button>
              <button
                onClick={() => copyLink(page.landing_url, page.slug + '-landing')}
                title="Copy link"
                style={{ ...btnStyle, background: copied === page.slug + '-landing' ? 'rgba(63,185,80,0.15)' : undefined, color: copied === page.slug + '-landing' ? '#3fb950' : undefined }}
              >
                {copied === page.slug + '-landing' ? <ThumbsUp size={14} /> : <Copy size={14} />}
                {copied === page.slug + '-landing' ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          </div>

          {/* Thank-you page row */}
          {page.has_thankyou && (
            <div>
              <label style={labelStyle}>Thank-You Page (with eBook download)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{
                  flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '10px 14px', fontSize: 13,
                  color: 'var(--muted)', fontFamily: 'monospace', overflow: 'hidden',
                  whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>
                  {base}{page.thankyou_url}
                </div>
                <button
                  onClick={() => window.open(base + page.thankyou_url, '_blank')}
                  title="Preview"
                  style={btnStyle}
                >
                  <ExternalLink size={14} />
                  Preview
                </button>
                <button
                  onClick={() => copyLink(page.thankyou_url, page.slug + '-ty')}
                  title="Copy link"
                  style={{ ...btnStyle, background: copied === page.slug + '-ty' ? 'rgba(63,185,80,0.15)' : undefined, color: copied === page.slug + '-ty' ? '#3fb950' : undefined }}
                >
                  {copied === page.slug + '-ty' ? <ThumbsUp size={14} /> : <Copy size={14} />}
                  {copied === page.slug + '-ty' ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '9px 14px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--surface2)',
  color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  whiteSpace: 'nowrap',
}
