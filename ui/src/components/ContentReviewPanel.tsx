import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { BarChart2, ChevronRight, Code, Eye, FileText, Layers3, Megaphone, RefreshCw, TrendingUp } from 'lucide-react'

interface OutputItem {
  type: 'blog' | 'funnel' | 'ads' | 'analytics'
  title: string
  folder: string
  created_at: string
  preview_url?: string
  files: string[]
}

const TYPE_ICON: Record<string, React.ElementType> = {
  blog: FileText,
  funnel: Layers3,
  ads: TrendingUp,
  analytics: BarChart2,
}

const TYPE_COLOR: Record<string, string> = {
  blog: '#58a6ff',
  funnel: '#3fb950',
  ads: '#f78166',
  analytics: '#d2a8ff',
}

const TYPE_LABEL: Record<string, string> = {
  blog: 'Blog Post',
  funnel: 'Funnel Page',
  ads: 'Ad Copy',
  analytics: 'Analytics',
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function stripFrontmatter(content: string): { body: string; meta: Record<string, string> } {
  const meta: Record<string, string> = {}
  if (!content.startsWith('---')) return { body: content, meta }
  const end = content.indexOf('\n---', 3)
  if (end === -1) return { body: content, meta }
  const block = content.slice(3, end).trim()
  block.split('\n').forEach(line => {
    const colon = line.indexOf(':')
    if (colon === -1) return
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
    meta[key] = val
  })
  return { body: content.slice(end + 4).trim(), meta }
}

function renderMarkdown(raw: string): string {
  const { body } = stripFrontmatter(raw)
  return marked.parse(body) as string
}

export default function ContentReviewPanel() {
  const [items, setItems] = useState<OutputItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<OutputItem | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [fileLoading, setFileLoading] = useState(false)
  const [activeFile, setActiveFile] = useState<string>('')
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview')
  const [frontmeta, setFrontmeta] = useState<Record<string, string>>({})
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/review/outputs')
      const data = await res.json()
      setItems(data.items || [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openItem = async (item: OutputItem) => {
    setSelected(item)
    setFileContent('')
    setActiveFile('')
    setFrontmeta({})
    setViewMode('preview')
    const viewable = item.files.find(f => f.endsWith('.html') || f.endsWith('.md') || f.endsWith('.json'))
    if (viewable) loadFile(item.folder, viewable)
  }

  const loadFile = async (folder: string, filename: string) => {
    const path = `${folder}/${filename}`
    setActiveFile(filename)

    if (filename.endsWith('.html')) {
      setFileContent('')
      return
    }

    setFileLoading(true)
    try {
      const res = await fetch(`/api/review/file?path=${encodeURIComponent(path)}`)
      const data = await res.json()
      const content = data.content || ''
      if (filename.endsWith('.md')) {
        const { meta } = stripFrontmatter(content)
        setFrontmeta(meta)
      } else {
        setFrontmeta({})
      }
      setFileContent(content)
    } catch {
      setFileContent('Failed to load file.')
    } finally {
      setFileLoading(false)
    }
  }

  const getPreviewUrl = (item: OutputItem, filename: string) => {
    if (item.type === 'funnel' && filename === 'landing_page.html') {
      const slug = item.folder.split('/').pop() || ''
      return `/p/${slug}`
    }
    if (item.type === 'funnel' && filename === 'thankyou_page.html') {
      const slug = item.folder.split('/').pop() || ''
      return `/p/${slug}/thankyou`
    }
    const rel = item.folder.replace(/\\/g, '/').split('outputs/')[1]
    if (rel) return `/outputs/${rel}/${filename}`
    return null
  }

  const isHtml = (f: string) => f.endsWith('.html')
  const isMd = (f: string) => f.endsWith('.md')

  const META_LABELS: Record<string, string> = {
    title: 'Title', slug: 'Slug', focus_keyword: 'Focus keyword',
    meta_description: 'Meta description', category: 'Category',
    estimated_read_time: 'Read time', word_count: 'Word count',
    tags: 'Tags', excerpt: 'Excerpt',
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '300px 1fr' : '1fr', gap: 16, height: 'calc(100vh - 120px)', minHeight: 0 }}>
      {/* LEFT: item list */}
      <div className="card" style={{ overflow: 'auto', padding: 0 }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Content Review</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>All generated outputs</div>
          </div>
          <button className="btn-ghost" onClick={load} style={{ padding: '6px 10px' }}>
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>
        </div>

        {loading && (
          <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Loading...</div>
        )}

        {!loading && items.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <Megaphone size={32} style={{ color: 'var(--muted)', marginBottom: 12 }} />
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No outputs yet. Run the Mega Pipeline to generate content.</div>
          </div>
        )}

        {items.map((item, i) => {
          const Icon = TYPE_ICON[item.type] || FileText
          const color = TYPE_COLOR[item.type] || 'var(--accent)'
          const isActive = selected?.folder === item.folder
          return (
            <button
              key={i}
              className="btn-ghost"
              onClick={() => openItem(item)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '12px 16px',
                borderRadius: 0,
                borderBottom: '1px solid var(--border)',
                background: isActive ? 'rgba(88,166,255,.08)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={14} style={{ color }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  <span style={{ color, fontWeight: 600 }}>{TYPE_LABEL[item.type]}</span>
                  {' · '}
                  {timeAgo(item.created_at)}
                </div>
              </div>
              <ChevronRight size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            </button>
          )
        })}
      </div>

      {/* RIGHT: preview pane */}
      {selected && (
        <div className="card" style={{ overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
          {/* header */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{frontmeta.title || selected.title}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {TYPE_LABEL[selected.type]} · {timeAgo(selected.created_at)}
                {frontmeta.estimated_read_time ? ` · ${frontmeta.estimated_read_time}` : ''}
                {frontmeta.focus_keyword ? ` · 🔑 ${frontmeta.focus_keyword}` : ''}
              </div>
            </div>
            {isMd(activeFile) && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="btn-ghost"
                  onClick={() => setViewMode('preview')}
                  style={{ padding: '4px 10px', fontSize: 11, background: viewMode === 'preview' ? 'rgba(88,166,255,.15)' : 'transparent', color: viewMode === 'preview' ? 'var(--accent)' : 'var(--muted)' }}
                >
                  <Eye size={11} style={{ display: 'inline', marginRight: 4 }} />Preview
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => setViewMode('raw')}
                  style={{ padding: '4px 10px', fontSize: 11, background: viewMode === 'raw' ? 'rgba(88,166,255,.15)' : 'transparent', color: viewMode === 'raw' ? 'var(--accent)' : 'var(--muted)' }}
                >
                  <Code size={11} style={{ display: 'inline', marginRight: 4 }} />Raw
                </button>
              </div>
            )}
            <button className="btn-ghost" onClick={() => setSelected(null)} style={{ padding: '6px 10px', fontSize: 12 }}>Close</button>
          </div>

          {/* file tabs */}
          <div style={{ display: 'flex', gap: 4, padding: '8px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }}>
            {selected.files.map(f => (
              <button
                key={f}
                className="btn-ghost"
                onClick={() => { setViewMode('preview'); loadFile(selected.folder, f) }}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: activeFile === f ? 700 : 400,
                  background: activeFile === f ? 'rgba(88,166,255,.15)' : 'transparent',
                  borderColor: activeFile === f ? 'rgba(88,166,255,.4)' : 'var(--border)',
                  color: activeFile === f ? 'var(--accent)' : 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                {isHtml(f) && <Eye size={10} />}
                {isMd(f) && <FileText size={10} />}
                {f}
              </button>
            ))}
          </div>

          {/* SEO meta strip for markdown files */}
          {isMd(activeFile) && Object.keys(frontmeta).length > 0 && viewMode === 'preview' && (
            <div style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)', background: 'rgba(88,166,255,.04)', flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
              {Object.entries(META_LABELS)
                .filter(([key]) => frontmeta[key])
                .map(([key, label]) => (
                  <div key={key} style={{ fontSize: 11 }}>
                    <span style={{ color: 'var(--muted)' }}>{label}: </span>
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{frontmeta[key]}</span>
                  </div>
                ))}
            </div>
          )}

          {/* content */}
          <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
            {isHtml(activeFile) ? (
              (() => {
                const url = getPreviewUrl(selected, activeFile)
                return url ? (
                  <iframe
                    ref={iframeRef}
                    src={url}
                    style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                    title={activeFile}
                  />
                ) : (
                  <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Preview not available</div>
                )
              })()
            ) : fileLoading ? (
              <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Loading...</div>
            ) : !fileContent ? (
              <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Select a file above to preview</div>
            ) : isMd(activeFile) && viewMode === 'preview' ? (
              <div
                style={{ padding: '24px 32px', maxWidth: 780, lineHeight: 1.75, fontSize: 15, color: 'var(--text)' }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(fileContent) }}
              />
            ) : activeFile.endsWith('.json') ? (
              <pre style={{ padding: 20, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text)', fontFamily: 'monospace', overflow: 'auto' }}>
                {(() => { try { return JSON.stringify(JSON.parse(fileContent), null, 2) } catch { return fileContent } })()}
              </pre>
            ) : (
              <pre style={{ padding: 20, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text)', fontFamily: 'monospace' }}>{fileContent}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
