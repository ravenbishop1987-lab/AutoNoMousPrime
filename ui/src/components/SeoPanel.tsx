import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, RefreshCw, Search, TrendingDown, TrendingUp } from 'lucide-react'

import {
  checkSeoRankings,
  downloadSeoReportPdf,
  getSeoAudit,
  getSeoRankings,
  submitTask,
  type SeoAuditReport,
  type SeoRanking,
} from '../api'
import LoadingSpinner from './LoadingSpinner'

type SeoView = 'audit' | 'rankings'

function scoreColor(score: number | null | undefined) {
  if (score === null || score === undefined) return 'var(--muted)'
  if (score >= 80) return '#3fb950'
  if (score >= 50) return '#e3b341'
  return '#f85149'
}

function positionColor(pos: number | null) {
  if (pos === null) return 'var(--muted)'
  if (pos <= 10) return '#3fb950'
  if (pos <= 30) return '#e3b341'
  return '#f85149'
}

function AuditCard({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'green' | 'yellow' | 'red' }) {
  const colorMap = {
    default: 'var(--accent)',
    green: '#3fb950',
    yellow: '#e3b341',
    red: '#f85149',
  }
  return (
    <div className="card" style={{ display: 'grid', gap: 6, padding: 18 }}>
      <div style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color: colorMap[tone] }}>{value}</div>
    </div>
  )
}

export default function SeoPanel() {
  const [view, setView] = useState<SeoView>('audit')
  const [rankings, setRankings] = useState<SeoRanking[]>([])
  const [audit, setAudit] = useState<SeoAuditReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [kwInput, setKwInput] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [msg, setMsg] = useState('')
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null)

  const load = async () => {
    try {
      const [rankingsData, auditData] = await Promise.all([getSeoRankings(), getSeoAudit()])
      setRankings(Array.isArray(rankingsData) ? rankingsData : [])
      setAudit(auditData ?? null)
      if ((auditData?.posts?.length ?? 0) > 0) {
        setSelectedPostId((current) => current ?? auditData.posts[0].id ?? null)
      }
    } catch {
      setRankings([])
      setAudit(null)
    } finally {
      setInitialLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const check = async () => {
    setLoading(true)
    setMsg('')
    try {
      await checkSeoRankings()
      await load()
      setMsg('SEO rankings and audit refreshed')
    } catch (e: any) {
      setMsg(`Refresh failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const track = async () => {
    if (!kwInput.trim() || !urlInput.trim()) return
    try {
      await submitTask('seo_track', { keyword: kwInput.trim(), url: urlInput.trim() })
      setMsg(`Now tracking: "${kwInput.trim()}"`)
      setKwInput('')
      setUrlInput('')
      await load()
    } catch (e: any) {
      setMsg(`Tracking failed: ${e.message}`)
    }
  }

  const downloadReport = async () => {
    try {
      setMsg('')
      await downloadSeoReportPdf()
    } catch (error) {
      setMsg(error instanceof Error ? error.message : 'Could not download PDF report')
    }
  }

  const selectedAuditPost = useMemo(() => {
    const posts = audit?.posts ?? []
    return posts.find((item) => item.id === selectedPostId) ?? posts[0] ?? null
  }, [audit, selectedPostId])

  const auditSummary = audit?.summary ?? {
    total_posts: 0,
    average_score: 0,
    good_posts: 0,
    needs_work_posts: 0,
    critical_posts: 0,
    issue_total: 0,
    warning_total: 0,
    passed_total: 0,
  }

  const topIssues = useMemo(() => {
    const counts = new Map<string, number>()
    for (const post of audit?.posts ?? []) {
      for (const issue of [...post.issues, ...post.warnings]) {
        counts.set(issue, (counts.get(issue) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [audit])

  const setupSteps = [
    'Connect WordPress so the audit can inspect live posts.',
    'Add tracked keywords when you want manual ranking checks.',
    'Refresh rankings and audit after publishing or updating content.',
  ]

  if (initialLoading) return <LoadingSpinner fullPanel />

  return (
    <div className="panel-stack" style={{ padding: '32px 24px' }}>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="section-title" style={{ marginBottom: 4 }}>SEO</div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Audit WordPress content, track search positions, and spot the posts that need work next.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={view === 'audit' ? 'btn-primary' : 'btn-ghost'} onClick={() => setView('audit')}>Audit</button>
            <button className={view === 'rankings' ? 'btn-primary' : 'btn-ghost'} onClick={() => setView('rankings')}>Rankings</button>
          </div>
        </div>
      </section>

      <div className="responsive-split">
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Setup And Refresh</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
            Add a keyword to track manually, then refresh rankings and audit data after updating or publishing content.
          </div>
          <label>Keyword</label>
          <input value={kwInput} onChange={e => setKwInput(e.target.value)} placeholder="adult adhd productivity tips" />
          <label>Target URL</label>
          <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://yoursite.com/post-slug" />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={track}><Search size={13} /> Start Tracking</button>
            <button className="btn-ghost" onClick={check} disabled={loading}>
              <RefreshCw size={13} /> {loading ? 'Refreshing...' : 'Refresh Rankings + Audit'}
            </button>
            <button className="btn-ghost" onClick={downloadReport} type="button">
              <Download size={13} /> Download PDF Report
            </button>
          </div>
        </div>

        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>How This Works</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {setupSteps.map(step => (
              <div key={step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span className="badge badge-blue">SEO</span>
                <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>{step}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {topIssues.length === 0 ? (
              <div className="muted">No issue clusters yet. Once posts are audited, repeated issues will show up here.</div>
            ) : topIssues.map(([issue, count]) => (
              <div key={issue} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
                <span style={{ fontSize: 13 }}>{issue}</span>
                <span className="badge badge-yellow">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="responsive-stats-6">
        <AuditCard label="Posts Audited" value={auditSummary.total_posts} />
        <AuditCard label="Average Score" value={`${auditSummary.average_score}/100`} tone={auditSummary.average_score >= 80 ? 'green' : auditSummary.average_score >= 50 ? 'yellow' : 'red'} />
        <AuditCard label="Good" value={auditSummary.good_posts} tone="green" />
        <AuditCard label="Needs Work" value={auditSummary.needs_work_posts} tone="yellow" />
        <AuditCard label="Critical" value={auditSummary.critical_posts} tone="red" />
        <AuditCard label="Issues" value={auditSummary.issue_total} tone="red" />
      </div>

      {view === 'audit' && (
      <div className="responsive-split-wide">
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Full SEO Audit</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Generated {audit?.generated_at ? new Date(audit.generated_at).toLocaleString() : '—'}
            </div>
          </div>
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Post</th>
                <th>Score</th>
                <th>Keyword</th>
                <th>Words</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {(audit?.posts ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
                    No authenticated WordPress posts found for audit.
                  </td>
                </tr>
              ) : (audit?.posts ?? []).map((post) => (
                <tr
                  key={post.id ?? post.url}
                  onClick={() => setSelectedPostId(post.id ?? null)}
                  style={{
                    cursor: 'pointer',
                    background: selectedAuditPost?.url === post.url ? 'rgba(88,166,255,.08)' : 'transparent',
                  }}
                >
                  <td>
                    <div style={{ fontWeight: 600 }}>{post.title}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>{post.status || 'unknown'} · {post.keyword_source || 'derived'}</div>
                  </td>
                  <td><span style={{ fontWeight: 800, color: scoreColor(post.score) }}>{post.score}/100</span></td>
                  <td style={{ fontSize: 12 }}>{post.target_keyword || '—'}</td>
                  <td>{post.word_count}</td>
                  <td>
                    <span className={`badge ${post.issues.length ? 'badge-red' : post.warnings.length ? 'badge-yellow' : 'badge-green'}`}>
                      {post.issues.length ? `${post.issues.length} issue${post.issues.length === 1 ? '' : 's'}` : post.warnings.length ? `${post.warnings.length} warning${post.warnings.length === 1 ? '' : 's'}` : 'clean'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="card" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Selected Post Audit</div>
          {selectedAuditPost ? (
            <>
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor(selectedAuditPost.score) }}>{selectedAuditPost.score}/100</div>
                <a href={selectedAuditPost.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                  {selectedAuditPost.title}
                </a>
                <div className="muted" style={{ fontSize: 12 }}>
                  Keyword: {selectedAuditPost.target_keyword || 'n/a'}
                </div>
              </div>

              <div className="responsive-mini-stats">
                <div className="card" style={{ padding: 12 }}>Title: {selectedAuditPost.title_length}</div>
                <div className="card" style={{ padding: 12 }}>Meta: {selectedAuditPost.meta_length}</div>
                <div className="card" style={{ padding: 12 }}>H2/H3: {selectedAuditPost.h2_count}/{selectedAuditPost.h3_count}</div>
                <div className="card" style={{ padding: 12 }}>Links: {selectedAuditPost.internal_links}</div>
                <div className="card" style={{ padding: 12 }}>Images: {selectedAuditPost.image_count}</div>
                <div className="card" style={{ padding: 12 }}>Missing Alt: {selectedAuditPost.images_missing_alt}</div>
              </div>

              <div>
                <div className="section-title" style={{ fontSize: 14 }}>Critical Issues</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {selectedAuditPost.issues.length === 0 ? (
                    <div className="muted">No critical issues detected.</div>
                  ) : selectedAuditPost.issues.map((issue) => (
                    <div key={issue} style={{ display: 'flex', gap: 10, alignItems: 'start' }}>
                      <AlertTriangle size={14} color="#f85149" style={{ marginTop: 2 }} />
                      <span style={{ fontSize: 13 }}>{issue}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="section-title" style={{ fontSize: 14 }}>Warnings</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {selectedAuditPost.warnings.length === 0 ? (
                    <div className="muted">No warnings detected.</div>
                  ) : selectedAuditPost.warnings.map((item) => (
                    <div key={item} style={{ fontSize: 13, color: 'var(--muted)' }}>{item}</div>
                  ))}
                </div>
              </div>

              <div>
                <div className="section-title" style={{ fontSize: 14 }}>Passed Checks</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {selectedAuditPost.passed_checks.map((item) => (
                    <div key={item} style={{ fontSize: 13, color: '#3fb950' }}>{item}</div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="muted">Select an audited post to see detailed findings.</div>
          )}
        </div>
      </div>
      )}

      {view === 'rankings' && (
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Ranking Tracker</div>
          <button className="btn-ghost" onClick={load} style={{ fontSize: 11, padding: '4px 10px' }}>Refresh</button>
        </div>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Post / Keyword</th>
              <th>URL</th>
              <th>SEO Rating</th>
              <th>Position</th>
              <th>Trend</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rankings.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
                  No tracked keywords or authenticated WordPress posts found.
                </td>
              </tr>
            ) : rankings.map((r, i) => (
              <tr key={`${r.source ?? 'tracker'}-${r.id ?? r.keyword}-${i}`}>
                <td style={{ color: 'var(--muted)' }}>{i + 1}</td>
                <td>
                  <div style={{ fontWeight: 500 }}>{r.title || r.keyword}</div>
                  {r.target_keyword && <div style={{ color: 'var(--muted)', fontSize: 11 }}>Target keyword: {r.target_keyword}</div>}
                  {r.meta_description && (
                    <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4, maxWidth: 320, whiteSpace: 'normal' }}>
                      {r.meta_description}
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                    {r.url}
                  </a>
                </td>
                <td><span style={{ fontWeight: 700, color: scoreColor(r.rating) }}>{r.rating !== null && r.rating !== undefined ? `${r.rating}/100` : 'N/A'}</span></td>
                <td><span style={{ fontWeight: 700, color: positionColor(r.position) }}>{r.position !== null ? `#${r.position}` : 'N/A'}</span></td>
                <td>
                  {r.best !== undefined && r.best !== null && r.worst !== undefined && r.worst !== null ? (
                    r.best < r.worst ? <TrendingUp size={14} color="#3fb950" /> : r.best > r.worst ? <TrendingDown size={14} color="#f85149" /> : '—'
                  ) : '—'}
                </td>
                <td style={{ color: 'var(--muted)' }}>
                  <span className={`badge ${r.source === 'wordpress' ? 'badge-blue' : 'badge-gray'}`}>
                    {r.source === 'wordpress' ? (r.keyword_source ? `WP ${r.keyword_source}` : (r.status ? `WP ${r.status}` : 'WordPress')) : `Tracked ${r.checks ?? 1}`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      )}

      {msg && (
        <div
          className="card"
          style={{
            background: msg.toLowerCase().includes('failed') ? 'rgba(248,81,73,.08)' : 'rgba(63,185,80,.08)',
          }}
        >
          {msg}
        </div>
      )}
    </div>
  )
}
