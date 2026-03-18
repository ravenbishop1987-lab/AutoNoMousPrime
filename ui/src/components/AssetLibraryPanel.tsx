import { memo, startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { deleteAsset, getAssets, getLocalAssets, getWorkspaceSession, type AssetItem } from '../api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import LoadingSpinner from './LoadingSpinner'

// ── helpers ───────────────────────────────────────────────────────────────────

function assetUrl(asset: AssetItem): string | null {
  if (asset.storage_url) return asset.storage_url
  if ((asset as any).url) return (asset as any).url
  if (asset.local_path) {
    const match = asset.local_path.replace(/\\/g, '/').match(/outputs\/(.+)$/)
    if (match) return `/outputs/${match[1]}`
  }
  return null
}

function assetFilename(asset: AssetItem): string {
  const url = asset.storage_url || asset.local_path || ''
  return url.replace(/\\/g, '/').split('/').pop() || asset.id.slice(0, 12)
}

function dedupeKey(asset: AssetItem): string {
  const t = String(asset.type || '').toLowerCase()
  const path = String(asset.storage_url || asset.local_path || (asset as any).url || '').trim()
  const base = path ? path.replace(/\\/g, '/').split('/').pop() || '' : ''
  // Prefer stable, human-meaningful keys so local + SaaS duplicates collapse.
  if (base) return `${t}:${base}`
  const fallbackName = String((asset as any).filename || '').trim()
  if (fallbackName) return `${t}:${fallbackName}`
  return `${t}:${String(asset.id || '')}`
}

function projectName(assets: AssetItem[]): string {
  for (const a of assets) {
    const m = a.metadata as Record<string, unknown> | undefined
    const name = m?.topic || m?.title || m?.name
    if (name && typeof name === 'string') return name
  }
  return `Project ${assets[0].job_id.slice(0, 8)}`
}

function projectType(assets: AssetItem[]): string {
  const types = assets.map(a => a.type)
  if (types.includes('video')) return 'Video'
  if (types.includes('blog') || types.includes('text') || types.includes('article')) return 'Blog Post'
  if (types.includes('audio') || types.includes('tts') || types.includes('voice')) return 'Audio'
  if (types.some(t => t.startsWith('image'))) return 'Image'
  return 'Content'
}

function projectIcon(assets: AssetItem[]): string {
  const t = projectType(assets)
  if (t === 'Video') return '🎬'
  if (t === 'Blog Post') return '✍️'
  if (t === 'Audio') return '🎙️'
  if (t === 'Image') return '🖼️'
  return '📦'
}

function typeIcon(type: string): string {
  if (type === 'image' || type === 'thumbnail') return '🖼️'
  if (type === 'audio' || type === 'tts' || type === 'voice') return '🎙️'
  if (type === 'video') return '🎬'
  if (type === 'blog' || type === 'text' || type === 'article') return '📄'
  return '📎'
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    image: 'Image', thumbnail: 'Thumbnail', audio: 'Audio', tts: 'Audio',
    voice: 'Audio', video: 'Video', blog: 'Blog Post', text: 'Text',
    article: 'Article',
  }
  return map[type] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

function formatDate(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function downloadFile(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ── preview component ─────────────────────────────────────────────────────────

function AssetPreview({ asset }: { asset: AssetItem }) {
  const url = assetUrl(asset)
  const t = asset.type

  if (!url) {
    return <div style={{ fontSize: 12, color: 'var(--muted)', padding: '12px 0' }}>No file URL available.</div>
  }

  if (t === 'image' || t === 'thumbnail') {
    return (
      <img
        src={url}
        alt={assetFilename(asset)}
        style={{ width: '100%', maxHeight: 340, objectFit: 'contain', borderRadius: 8, background: '#0d1117' }}
      />
    )
  }

  if (t === 'audio' || t === 'tts' || t === 'voice') {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <audio controls style={{ width: '100%' }} src={url} />
    )
  }

  if (t === 'video') {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video controls style={{ width: '100%', maxHeight: 340, borderRadius: 8 }} src={url} />
    )
  }

  if (t === 'blog' || t === 'text' || t === 'article') {
    const text = String((asset.metadata as Record<string, unknown>)?.content ?? '(no text preview available)')
    return (
      <div style={{
        background: 'rgba(88,166,255,.04)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 14, maxHeight: 260, overflowY: 'auto',
        fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text)',
      }}>
        {text}
      </div>
    )
  }

  return <div style={{ fontSize: 12, color: 'var(--muted)', padding: '12px 0' }}>Preview not available for type "{t}".</div>
}

// ── asset card (grid view) ────────────────────────────────────────────────────

interface AssetCardProps {
  asset: AssetItem
  workspaceId: string | null
  onDeleted?: (assetId: string) => void
}

function AssetCard({ asset, workspaceId, onDeleted }: AssetCardProps) {
  const [showPreview, setShowPreview] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const url = assetUrl(asset)
  const filename = assetFilename(asset)
  const meta = asset.metadata as Record<string, unknown> | undefined
  const canSaasDelete = Boolean(
    workspaceId
    && typeof asset.id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(asset.id),
  )

  const openPreview = useCallback(() => {
    startTransition(() => setShowPreview(true))
  }, [])

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!canSaasDelete) {
      // eslint-disable-next-line no-alert
      alert('This is a local-only asset. Delete it from your outputs folder (or re-run the job to regenerate).')
      return
    }
    if (!window.confirm('Archive this asset? It will be hidden from the Assets panel but kept for history.')) return
    try {
      setDeleting(true)
      await deleteAsset(workspaceId as string, asset.id)
      onDeleted?.(asset.id)
    } catch (err) {
      // eslint-disable-next-line no-alert
      const msg = err instanceof Error ? err.message : 'Could not delete asset'
      alert(msg.includes('not found') ? 'Asset not found (it may have already been archived). Refresh and try again.' : msg)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={openPreview}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openPreview()
          }
        }}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          background: 'var(--surface)',
          padding: 8,
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            paddingBottom: '62%',
            borderRadius: 8,
            overflow: 'hidden',
            background: '#020617',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 32,
          }}
        >
          {url && (asset.type === 'image' || asset.type === 'thumbnail') ? (
            <img
              src={url}
              alt={filename}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span>{typeIcon(asset.type)}</span>
          )}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {typeLabel(asset.type)}
          {meta?.width && meta?.height ? (
            <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 4, fontSize: 10 }}>
              {String(meta.width)}×{String(meta.height)}
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filename}{formatDate(asset.created_at) ? ` · ${formatDate(asset.created_at)}` : ''}
        </div>
        {/* Inline audio preview directly on the card */}
        {url && (asset.type === 'audio' || asset.type === 'tts' || asset.type === 'voice') && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio
            controls
            style={{ width: '100%', marginTop: 4 }}
            src={url}
            onClick={e => e.stopPropagation()}
          />
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          {url && (
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: 10, padding: '3px 8px' }}
              onClick={e => {
                e.stopPropagation()
                downloadFile(url, filename)
              }}
            >
              Download
            </button>
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
              style={{ fontSize: 10, padding: '3px 8px', textDecoration: 'none' }}
              onClick={e => e.stopPropagation()}
            >
              Open ↗
            </a>
          )}
          {canSaasDelete && (
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: 10, padding: '3px 8px', color: '#f85149', borderColor: 'rgba(248,81,73,.4)' }}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </div>

      {showPreview && (
        <div
          role="presentation"
          onClick={() => setShowPreview(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,.82)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(960px, 96vw)',
              maxHeight: '90vh',
              background: '#020617',
              borderRadius: 12,
              border: '1px solid var(--border)',
              padding: 14,
              boxShadow: '0 22px 60px rgba(0,0,0,.7)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {filename}
              </div>
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: 11, padding: '3px 10px' }}
                onClick={() => setShowPreview(false)}
              >
                Close
              </button>
            </div>
            <AssetPreview asset={asset} />
          </div>
        </div>
      )}
    </>
  )
}

// ── project group card (grid of assets) ───────────────────────────────────────

interface ProjectGroupProps {
  jobId: string
  assets: AssetItem[]
  workspaceId: string | null
  onDeleted?: (assetId: string) => void
}

const ProjectGroup = memo(function ProjectGroup({ jobId, assets, workspaceId, onDeleted }: ProjectGroupProps) {
  const [open, setOpen] = useState(true)
  const name = projectName(assets)
  const icon = projectIcon(assets)
  const type = projectType(assets)
  const date = assets.reduce((latest, a) => {
    const t = a.created_at || ''
    return t > latest ? t : latest
  }, '')

  const typeCounts = assets.reduce<Record<string, number>>((acc, a) => {
    const label = typeLabel(a.type)
    acc[label] = (acc[label] ?? 0) + 1
    return acc
  }, {})

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 14,
          padding: '16px 20px', background: 'var(--surface)',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          transition: 'background .15s',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(88,166,255,.04)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface)'}
      >
        <span style={{ fontSize: 26 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span>{type}</span>
            <span>·</span>
            <span>{assets.length} asset{assets.length !== 1 ? 's' : ''}</span>
            {Object.entries(typeCounts).map(([t, n]) => (
              <span key={t} style={{ color: 'var(--muted)' }}>{n} {t}{n !== 1 ? 's' : ''}</span>
            ))}
            {formatDate(date) && <><span>·</span><span>{formatDate(date)}</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
            {jobId.slice(0, 8)}
          </span>
          <span style={{ fontSize: 14, color: 'var(--muted)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            ▾
          </span>
        </div>
      </button>

      {/* Asset list */}
      {open && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '12px 16px',
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          background: 'rgba(0,0,0,.12)',
        }}
        >
          {assets.map(asset => (
            <AssetCard key={asset.id} asset={asset} workspaceId={workspaceId} onDeleted={onDeleted} />
          ))}
        </div>
      )}
    </div>
  )
})

// ── main panel ────────────────────────────────────────────────────────────────

const TYPE_FILTERS = [
  { key: '',          label: 'All' },
  { key: 'image',     label: 'Images' },
  { key: 'audio',     label: 'Audio' },
  { key: 'video',     label: 'Video' },
  { key: 'blog',      label: 'Blog' },
] as const

export default function AssetLibraryPanel() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [hideMissingFiles, setHideMissingFiles] = useState(true)
  const [missingIds, setMissingIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    try {
      // Always load local outputs first
      const localData = await getLocalAssets({ search: search || undefined })
      const localAssets = localData.assets || []

      // Also try SaaS assets if workspace is available
      let saasAssets: AssetItem[] = []
      try {
        const session = await getWorkspaceSession()
        const wid = session.active_workspace?.id
        if (wid) {
          setWorkspaceId(wid)
          const data = await getAssets(wid, { search: search || undefined })
          saasAssets = data.assets || []
        }
      } catch { /* SaaS not configured, that's fine */ }

      // Merge — local first, dedupe by filename
      const seen = new Set<string>()
      const merged: AssetItem[] = []
      for (const a of [...localAssets, ...saasAssets]) {
        const key = dedupeKey(a)
        if (!seen.has(key)) { seen.add(key); merged.push(a) }
      }
      setAssets(merged)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load assets')
    } finally {
      setLoading(false)
    }
  }

  useAutoRefresh(load, [search], { intervalMs: 15000 })

  // Best-effort stale-file detection for local output URLs. This prevents the library
  // from showing items whose underlying file has been deleted/moved.
  useEffect(() => {
    if (!assets.length) return
    const controller = new AbortController()

    const check = async () => {
      const nextMissing = new Set<string>()
      // Limit checks per run to keep UI responsive.
      const toCheck = assets.slice(0, 160)
      await Promise.all(toCheck.map(async (asset) => {
        const url = assetUrl(asset)
        if (!url || !url.startsWith('/outputs/')) return
        try {
          const resp = await fetch(url, { method: 'HEAD', signal: controller.signal, cache: 'no-store' })
          if (!resp.ok) nextMissing.add(asset.id)
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return
          // Network error counts as missing for local files.
          nextMissing.add(asset.id)
        }
      }))
      setMissingIds(nextMissing)
    }

    void check()
    return () => controller.abort()
  }, [assets])

  useEffect(() => {
    const stored = window.localStorage.getItem('ap-navigation-target')
    if (!stored) return
    try {
      const target = JSON.parse(stored)
      if (target.tab === 'assets' && target.asset_id) {
        setSearch(String(target.asset_id).slice(0, 8))
      }
    } catch { /* ignore */ }
  }, [])

  const sortedGroups = useMemo(() => {
    const filteredBase = typeFilter
      ? assets.filter(a => {
          const t = String(a.type || '').toLowerCase()
          if (typeFilter === 'audio') return t === 'audio' || t === 'tts' || t === 'voice'
          if (typeFilter === 'blog') return t === 'blog' || t === 'text' || t === 'article'
          if (typeFilter === 'image') return t === 'image' || t === 'thumbnail'
          return t === typeFilter
        })
      : assets
    const filtered = hideMissingFiles
      ? filteredBase.filter(a => !missingIds.has(a.id))
      : filteredBase

    const groups = new Map<string, { jobId: string; newestTs: number; items: AssetItem[] }>()
    for (const a of filtered) {
      const jobId = a.job_id || 'unlinked'
      const createdTs = a.created_at ? new Date(a.created_at).getTime() : 0
      const existing = groups.get(jobId)
      if (!existing) {
        groups.set(jobId, { jobId, newestTs: createdTs, items: [a] })
      } else {
        existing.items.push(a)
        if (createdTs > existing.newestTs) existing.newestTs = createdTs
      }
    }

    return Array.from(groups.values())
      .sort((a, b) => b.newestTs - a.newestTs)
      .map(g => [g.jobId, g.items] as const)
  }, [assets, typeFilter, hideMissingFiles, missingIds])

  const totalProjects = sortedGroups.length

  const stats = useMemo(() => {
    let images = 0
    let audio = 0
    let video = 0
    let blog = 0
    for (const a of assets) {
      const t = String(a.type || '').toLowerCase()
      if (t === 'image' || t === 'thumbnail') images += 1
      else if (t === 'audio' || t === 'tts' || t === 'voice') audio += 1
      else if (t === 'video') video += 1
      else if (t === 'blog' || t === 'text' || t === 'article') blog += 1
    }
    return { projects: totalProjects, images, audio, video, blog }
  }, [assets, totalProjects])

  const handleDeleted = useCallback((assetId: string) => {
    setAssets(prev => prev.filter(a => a.id !== assetId))
  }, [])

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Assets</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {assets.length} asset{assets.length !== 1 ? 's' : ''} across {totalProjects} project{totalProjects !== 1 ? 's' : ''}
            {missingIds.size ? (
              <span style={{ marginLeft: 10, color: 'var(--muted)' }}>
                · {missingIds.size} missing file{missingIds.size !== 1 ? 's' : ''}{hideMissingFiles ? ' hidden' : ''}
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {missingIds.size ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setHideMissingFiles(v => !v)}
              style={{ fontSize: 12, padding: '6px 12px' }}
              title="Hide/show items whose local /outputs file is missing"
            >
              {hideMissingFiles ? 'Show missing files' : 'Hide missing files'}
            </button>
          ) : null}
          <input
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search assets…"
            style={{ fontSize: 13, width: 220 }}
          />
        </div>
      </div>

      {/* Type filter tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        {TYPE_FILTERS.map(f => (
          <button
            key={f.key}
            className="btn-ghost"
            onClick={() => setTypeFilter(f.key)}
            style={{
              fontSize: 12, padding: '6px 16px',
              background: typeFilter === f.key ? 'rgba(88,166,255,.15)' : 'transparent',
              borderColor: typeFilter === f.key ? 'rgba(88,166,255,.5)' : 'var(--border)',
              color: typeFilter === f.key ? 'var(--accent)' : 'var(--text)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
        {[
          { label: 'Projects', value: stats.projects },
          { label: 'Images', value: stats.images },
          { label: 'Audio', value: stats.audio },
          { label: 'Video', value: stats.video },
          { label: 'Blog', value: stats.blog },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '10px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Loading / error */}
      {loading && <LoadingSpinner fullPanel />}
      {error && <div style={{ color: '#f85149', fontSize: 13 }}>{error}</div>}
      {/* Project groups */}
      {!loading && sortedGroups.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          No assets found{typeFilter ? ` for type "${typeFilter}"` : ''}{search ? ` matching "${search}"` : ''}.
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {sortedGroups.map(([jobId, jobAssets]) => (
          <ProjectGroup
            key={jobId}
            jobId={jobId}
            assets={jobAssets}
            workspaceId={workspaceId}
            onDeleted={handleDeleted}
          />
        ))}
      </div>
    </div>
  )
}
