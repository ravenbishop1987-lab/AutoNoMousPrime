import { useEffect, useRef, useState } from 'react'
import { BookOpen, CheckCircle, Download, ExternalLink, Loader, Package, Sparkles, Trash2, Zap } from 'lucide-react'
import { api } from '../api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: number
  name: string
  tagline: string
  product_type: string
  offer_type: string
  niche: string
  target_audience: string
  pain_point: string
  transformation: string
  price_point: string
  why_it_sells: string
  status: string
  ebook_url: string
  pdf_url: string
  sales_page_url: string
  funnel_url: string
  stripe_url: string
  chapters: string[]
  created_at: string
  revenue_total: number
  units_sold: number
}

interface IdeaForm {
  niche: string
  target_audience: string
  pain_point: string
  offer_type: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  ideated:  { color: '#e3b341', bg: 'rgba(227,179,65,0.12)',  label: 'Idea' },
  building: { color: '#58a6ff', bg: 'rgba(88,166,255,0.12)', label: 'Building' },
  complete: { color: '#3fb950', bg: 'rgba(63,185,80,0.12)',  label: 'Complete' },
  launched: { color: '#a371f7', bg: 'rgba(163,113,247,0.12)', label: 'Launched' },
}

const TYPE_ICONS: Record<string, string> = {
  ebook: '📘', mini_course: '🎓', template_pack: '📋',
  checklist: '✅', prompt_pack: '🤖', swipe_file: '📂',
}

const OFFER_COLORS: Record<string, string> = {
  lead_magnet: '#8b949e', low_ticket: '#3fb950',
  core_offer: '#58a6ff', high_ticket: '#a371f7',
}

const PAIN_POINTS = [
  { value: '',             label: '— Select Pain Point —' },
  { value: 'overwhelm',   label: 'Overwhelm / Too Much To Do' },
  { value: 'time',        label: 'Not Enough Time' },
  { value: 'money',       label: 'Not Enough Money / Revenue' },
  { value: 'focus',       label: 'Lack of Focus / Distraction' },
  { value: 'confidence',  label: 'Lack of Confidence' },
  { value: 'leads',       label: 'Not Enough Leads / Traffic' },
  { value: 'conversion',  label: 'Low Conversions / Sales' },
  { value: 'consistency', label: 'No System / Inconsistency' },
  { value: 'tech',        label: 'Tech Confusion' },
  { value: 'health',      label: 'Health / Energy / Sleep' },
  { value: 'clarity',     label: 'No Clarity / Don\'t Know Where To Start' },
]

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function ProductsPanel() {
  const [view, setView]         = useState<'built' | 'ideas' | 'generate'>('built')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading]   = useState(false)
  const [building, setBuilding] = useState<number | null>(null)
  const [ideating, setIdeating] = useState(false)
  const [error, setError]       = useState('')

  const [form, setForm] = useState<IdeaForm>({
    niche: '', target_audience: '', pain_point: '', offer_type: 'low_ticket',
  })

  useEffect(() => { loadProducts() }, [])

  // Auto-poll every 4s while any product is building
  useEffect(() => {
    const anyBuilding = products.some(p => p.status === 'building')
    if (!anyBuilding) return
    const iv = setInterval(async () => {
      const r = await api.get('/products').catch(() => null)
      if (!r) return
      const updated: Product[] = r.data.products || []
      setProducts(updated)
      // Stop polling when nothing is building anymore
      if (!updated.some(p => p.status === 'building')) clearInterval(iv)
    }, 4000)
    return () => clearInterval(iv)
  }, [products.map(p => p.status).join(',')])

  const loadProducts = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.get('/products')
      setProducts(r.data.products || [])
    } catch { setError('Failed to load products') }
    finally { setLoading(false) }
  }

  const ideate = async () => {
    if (!form.niche.trim()) return
    setIdeating(true)
    setError('')
    try {
      // Queue the task
      await api.post('/products/ideate', form)

      // Poll /api/products until new ideated products appear (up to 90s)
      const before = products.filter(p => p.status === 'ideated').length
      let elapsed = 0
      const interval = 3000
      const timeout = 90000
      await new Promise<void>((resolve) => {
        const poll = setInterval(async () => {
          elapsed += interval
          try {
            const r = await api.get('/products')
            const all: Product[] = r.data.products || []
            const newIdeated = all.filter(p => p.status === 'ideated')
            if (newIdeated.length > before) {
              setProducts(all)
              setView('ideas')
              clearInterval(poll)
              resolve()
            } else if (elapsed >= timeout) {
              setError('Ideation timed out — check Active Tasks on the Overview tab.')
              clearInterval(poll)
              resolve()
            }
          } catch { /* keep polling */ }
        }, interval)
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ideation failed')
    } finally { setIdeating(false) }
  }

  const buildProduct = async (id: number) => {
    setBuilding(id)
    try {
      await api.post(`/products/${id}/build`, {})
      setProducts(prev => prev.map(p => p.id === id ? { ...p, status: 'building' } : p))
    } catch { setError('Build failed to start') }
    finally { setBuilding(null) }
  }

  const deleteProduct = async (id: number) => {
    if (!confirm('Delete this product?')) return
    await api.delete(`/products/${id}`)
    setProducts(prev => prev.filter(p => p.id !== id))
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '9px 12px', color: 'var(--text)',
    fontSize: 13, width: '100%', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--muted)',
    letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 6, display: 'block',
  }

  const built   = products.filter(p => p.status === 'complete' || p.status === 'building' || p.status === 'launched')
  const ideas   = products.filter(p => p.status === 'ideated')

  const TABS = [
    { id: 'built' as const,    label: 'My Products', count: built.length,  color: '#a371f7' },
    { id: 'ideas' as const,    label: 'Ideas',       count: ideas.length,  color: '#e3b341' },
    { id: 'generate' as const, label: '+ Generate',  count: null,          color: '#58a6ff' },
  ]

  return (
    <div style={{ display: 'grid', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(163,113,247,0.15)', border: '1px solid rgba(163,113,247,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Package size={18} color="#a371f7" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Products</h2>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
              Autonomous Prime builds and sells digital products
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{
            padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 700,
            color: view === t.id ? t.color : 'var(--muted)',
            borderBottom: view === t.id ? `2px solid ${t.color}` : '2px solid transparent',
            marginBottom: -1, transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 7,
          }}>
            {t.label}
            {t.count !== null && (
              <span style={{
                fontSize: 11, fontWeight: 800, minWidth: 20, textAlign: 'center',
                padding: '1px 6px', borderRadius: 99,
                background: view === t.id ? `${t.color}22` : 'var(--surface2)',
                color: view === t.id ? t.color : 'var(--muted)',
              }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: 'rgba(247,129,102,0.1)', border: '1px solid rgba(247,129,102,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#f78166' }}>
          {error}
        </div>
      )}

      {/* ── Generate Form ───────────────────────────────────────────────── */}
      {view === 'generate' && (
        <div className="card" style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={15} color="#58a6ff" />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Generate Product Ideas</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
            Describe your niche and audience — Autonomous Prime will generate 5 ready-to-build product ideas with full outlines.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Niche *</label>
              <input style={inputStyle} placeholder="e.g. ADHD productivity, weight loss for moms, crypto trading"
                value={form.niche} onChange={e => setForm(f => ({ ...f, niche: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Target Audience</label>
              <input style={inputStyle} placeholder="e.g. burned-out entrepreneurs aged 30-45"
                value={form.target_audience} onChange={e => setForm(f => ({ ...f, target_audience: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Primary Pain Point</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }}
                value={form.pain_point} onChange={e => setForm(f => ({ ...f, pain_point: e.target.value }))}>
                {PAIN_POINTS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Offer Type</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }}
                value={form.offer_type} onChange={e => setForm(f => ({ ...f, offer_type: e.target.value }))}>
                <option value="lead_magnet">Lead Magnet (Free)</option>
                <option value="low_ticket">Low Ticket ($7–$47)</option>
                <option value="core_offer">Core Offer ($97–$497)</option>
                <option value="high_ticket">High Ticket ($997+)</option>
                <option value="subscription">Subscription / Membership</option>
              </select>
            </div>
          </div>

          <button onClick={ideate} disabled={ideating || !form.niche.trim()} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '11px 24px', borderRadius: 10, border: 'none',
            background: ideating || !form.niche.trim()
              ? 'var(--surface2)'
              : 'linear-gradient(135deg, #58a6ff, #a371f7)',
            color: ideating || !form.niche.trim() ? 'var(--muted)' : '#fff',
            fontSize: 13, fontWeight: 800, cursor: ideating || !form.niche.trim() ? 'not-allowed' : 'pointer',
          }}>
            {ideating ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={14} />}
            {ideating ? 'Working… (30-60s)' : 'Generate 5 Product Ideas'}
          </button>
        </div>
      )}

      {/* ── My Products (built) ──────────────────────────────────────────── */}
      {view === 'built' && (
        <>
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <Loader size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--muted)' }} />
            </div>
          )}
          {!loading && built.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '60px 24px' }}>
              <Package size={40} color="var(--muted)" style={{ margin: '0 auto 16px' }} />
              <p style={{ color: 'var(--muted)', marginBottom: 8 }}>No built products yet</p>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                Go to <strong>Ideas</strong> and click <strong>Build</strong> on any product to create it,
                or click <strong>+ Generate</strong> to have Autonomous Prime come up with new ideas.
              </p>
            </div>
          )}
          <div style={{ display: 'grid', gap: 14 }}>
            {built.map(p => <ProductCard key={p.id} product={p}
              onBuild={() => buildProduct(p.id)} onDelete={() => deleteProduct(p.id)}
              building={building === p.id} />)}
          </div>
        </>
      )}

      {/* ── Ideas ────────────────────────────────────────────────────────── */}
      {view === 'ideas' && (
        <>
          {!loading && ideas.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '60px 24px' }}>
              <Sparkles size={40} color="var(--muted)" style={{ margin: '0 auto 16px' }} />
              <p style={{ color: 'var(--muted)', marginBottom: 8 }}>No ideas yet</p>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                Click <strong>+ Generate</strong> to create product ideas for your niche.
              </p>
            </div>
          )}
          <div style={{ display: 'grid', gap: 14 }}>
            {ideas.map(p => <ProductCard key={p.id} product={p}
              onBuild={() => { buildProduct(p.id); setView('built') }}
              onDelete={() => deleteProduct(p.id)}
              building={building === p.id} />)}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Product Card ─────────────────────────────────────────────────────────────

function ProductCard({
  product: p, onBuild, onDelete, building,
}: {
  product: Product
  onBuild: () => void
  onDelete: () => void
  building: boolean
}) {
  const [expanded, setExpanded]       = useState(false)
  const prevStatus                    = useRef(p.status)
  const [justDone, setJustDone]       = useState(false)
  const [pdfUrl, setPdfUrl]           = useState(p.pdf_url || '')
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [pdfError, setPdfError]       = useState('')

  const generatePdf = async () => {
    setGeneratingPdf(true)
    setPdfError('')
    try {
      const r = await api.post(`/products/${p.id}/generate-pdf`, {})
      if (r.data?.pdf_url) setPdfUrl(r.data.pdf_url)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'PDF generation failed'
      setPdfError(msg)
      setTimeout(() => setPdfError(''), 6000)
    } finally {
      setGeneratingPdf(false)
    }
  }

  useEffect(() => {
    if (prevStatus.current === 'building' && p.status === 'complete') {
      setJustDone(true)
      setTimeout(() => setJustDone(false), 6000)
    }
    prevStatus.current = p.status
  }, [p.status])

  const status = STATUS_COLORS[p.status] || STATUS_COLORS.ideated
  const offerColor = OFFER_COLORS[p.offer_type] || '#8b949e'
  const typeIcon = TYPE_ICONS[p.product_type] || '📦'

  return (
    <div className="card" style={{ display: 'grid', gap: 14, outline: justDone ? '2px solid #3fb950' : 'none', outlineOffset: 2 }}>

      {/* Done flash */}
      {justDone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(63,185,80,0.12)', border: '1px solid rgba(63,185,80,0.35)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#3fb950', fontWeight: 700 }}>
          <CheckCircle size={15} /> Product built! View it below or find the file at <code style={{ fontSize: 11, opacity: 0.8 }}>outputs/products/</code>
        </div>
      )}

      {/* Building banner */}
      {p.status === 'building' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#58a6ff' }}>
          <Loader size={13} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          Autonomous Prime is writing this product… check back in 1-2 minutes.
        </div>
      )}

      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        {/* Icon */}
        <div style={{
          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>
          {typeIcon}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{p.name}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              background: status.bg, color: status.color, letterSpacing: '.05em',
              textTransform: 'uppercase',
            }}>
              {status.label}
            </span>
            {p.price_point && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                background: `${offerColor}20`, color: offerColor, border: `1px solid ${offerColor}40`,
              }}>
                {p.price_point}
              </span>
            )}
          </div>
          {p.tagline && (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>{p.tagline}</p>
          )}
        </div>

        {/* Revenue */}
        {p.units_sold > 0 && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#3fb950' }}>
              ${p.revenue_total.toFixed(0)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.units_sold} sold</div>
          </div>
        )}
      </div>

      {/* Transformation */}
      {p.transformation && (
        <div style={{
          background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.15)',
          borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--muted)',
        }}>
          <strong style={{ color: '#58a6ff' }}>→</strong> {p.transformation}
        </div>
      )}

      {/* Why it sells */}
      {p.why_it_sells && (
        <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
          💡 {p.why_it_sells}
        </div>
      )}

      {/* Chapter list (expandable) */}
      {p.chapters?.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(x => !x)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, padding: 0 }}
          >
            {expanded ? '▾' : '▸'} {p.chapters.length} chapters
          </button>
          {expanded && (
            <ol style={{ margin: '8px 0 0 16px', fontSize: 12, color: 'var(--muted)', display: 'grid', gap: 4 }}>
              {p.chapters.map((ch, i) => <li key={i}>{ch}</li>)}
            </ol>
          )}
        </div>
      )}

      {/* Action row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>

        {/* Build button (ideated only) */}
        {p.status === 'ideated' && (
          <button onClick={onBuild} disabled={building} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, border: 'none',
            background: building ? 'var(--surface2)' : 'linear-gradient(135deg, #58a6ff, #a371f7)',
            color: building ? 'var(--muted)' : '#fff',
            fontSize: 12, fontWeight: 800, cursor: building ? 'wait' : 'pointer',
          }}>
            {building
              ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
              : <Zap size={12} />}
            {building ? 'Building…' : 'Build Full Product'}
          </button>
        )}

        {/* Ebook link */}
        {p.ebook_url && (
          <a href={p.ebook_url} target="_blank" rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)',
            color: '#3fb950', textDecoration: 'none',
          }}>
            <BookOpen size={12} /> View Product
          </a>
        )}

        {/* PDF download — shows link if generated, else shows generate button for complete products */}
        {pdfUrl ? (
          <a href={pdfUrl} download rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: 'rgba(163,113,247,0.1)', border: '1px solid rgba(163,113,247,0.3)',
            color: '#a371f7', textDecoration: 'none',
          }}>
            <Download size={12} /> Download PDF
          </a>
        ) : p.ebook_url && (p.status === 'complete' || p.status === 'launched') ? (
          <button onClick={generatePdf} disabled={generatingPdf} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: generatingPdf ? 'var(--surface2)' : 'rgba(163,113,247,0.1)',
            border: '1px solid rgba(163,113,247,0.3)',
            color: generatingPdf ? 'var(--muted)' : '#a371f7', cursor: generatingPdf ? 'wait' : 'pointer',
          }}>
            {generatingPdf
              ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
              : <Download size={12} />}
            {generatingPdf ? 'Generating…' : 'Get PDF'}
          </button>
        ) : null}

        {pdfError && (
          <span style={{ fontSize: 11, color: '#f78166' }}>{pdfError}</span>
        )}

        {/* Sales page link */}
        {p.sales_page_url && (
          <a href={p.sales_page_url} target="_blank" rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.3)',
            color: '#58a6ff', textDecoration: 'none',
          }}>
            <ExternalLink size={12} /> Sales Page
          </a>
        )}

        {/* Funnel link */}
        {p.funnel_url && (
          <a href={p.funnel_url} target="_blank" rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: 'rgba(247,129,102,0.1)', border: '1px solid rgba(247,129,102,0.3)',
            color: '#f78166', textDecoration: 'none',
          }}>
            <ExternalLink size={12} /> Funnel
          </a>
        )}

        <div style={{ flex: 1 }} />

        <button onClick={onDelete} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
          background: 'transparent', color: 'var(--muted)', fontSize: 12, cursor: 'pointer',
        }}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}
