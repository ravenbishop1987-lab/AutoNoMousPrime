import { useEffect, useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts'
import { getEmailAnalytics, getEmailSequenceAnalytics, type EmailAnalyticsTotals, type EmailSequenceAnalytics } from '../api'

interface LocalAnalytics {
  ok: boolean
  totals: {
    blogs: number
    images: number
    audios: number
    videos: number
    social_posted: number
    social_pending: number
    comment_replies: number
  }
  daily_chart: Array<{ date: string; blogs: number; images: number; videos: number }>
  social: {
    pending: number
    posted: number
    failed: number
    approved: number
    by_platform: Record<string, { posted: number; pending: number; failed: number }>
  }
  reply_by_platform: Record<string, number>
  seo: { avg_score: number; scored_posts: number }
}

const PLATFORM_COLOR: Record<string, string> = {
  twitter: '#1d9bf0', facebook: '#1877f2', instagram: '#e1306c',
  youtube: '#ff0000', wordpress: '#21759b', linkedin: '#0a66c2',
  tiktok: '#ff0050',
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 12, padding: '16px 18px',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color ?? '#e6edf3', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>{sub}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 14, padding: '20px 22px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  )
}

const TOOLTIP_STYLE = {
  contentStyle: { background: '#1a1d2e', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#e6edf3' },
}

export default function AnalyticsPanel() {
  const [data, setData] = useState<LocalAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState('')
  const [emailTotals, setEmailTotals] = useState<EmailAnalyticsTotals | null>(null)
  const [emailSequences, setEmailSequences] = useState<EmailSequenceAnalytics[]>([])

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/analytics/local')
      const json = await r.json()
      if (json.ok) {
        setData(json)
        setLastRefresh(new Date().toLocaleTimeString())
      }
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }, [])

  const loadEmailAnalytics = useCallback(async () => {
    try {
      const [overview, seqs] = await Promise.all([getEmailAnalytics(), getEmailSequenceAnalytics()])
      setEmailTotals(overview.totals)
      setEmailSequences(seqs.sequences || [])
    } catch { /* no DB configured yet */ }
  }, [])

  useEffect(() => {
    load()
    loadEmailAnalytics()
    const id = setInterval(() => { load(); loadEmailAnalytics() }, 60_000)
    return () => clearInterval(id)
  }, [load, loadEmailAnalytics])

  if (loading) {
    return <div style={{ padding: 40, color: 'var(--muted)', fontSize: 13 }}>Loading analytics…</div>
  }

  if (!data) {
    return <div style={{ padding: 40, color: '#f85149', fontSize: 13 }}>Could not load analytics.</div>
  }

  const { totals, daily_chart, social, reply_by_platform, seo } = data

  const platformRows = Object.entries(social.by_platform).sort((a, b) => {
    const ta = a[1].posted + a[1].pending + a[1].failed
    const tb = b[1].posted + b[1].pending + b[1].failed
    return tb - ta
  })

  const replyRows = Object.entries(reply_by_platform).sort((a, b) => b[1] - a[1])

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Analytics</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            All data is pulled live from your local outputs and database
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastRefresh && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Updated {lastRefresh}</span>}
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={load}>Refresh</button>
        </div>
      </div>

      {/* Totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Blog Posts" value={totals.blogs} sub="total generated" color="#58a6ff" />
        <StatCard label="Images" value={totals.images} sub="total generated" color="#a78bfa" />
        <StatCard label="Videos" value={totals.videos} sub="total generated" color="#f59e0b" />
        <StatCard label="Audio Files" value={totals.audios} sub="total generated" color="#34d399" />
        <StatCard label="Social Posted" value={totals.social_posted} sub={`${totals.social_pending} pending`} color="#3fb950" />
        <StatCard label="Auto Replies" value={totals.comment_replies} sub="comments answered" color="#e1306c" />
        {seo.scored_posts > 0 && (
          <StatCard label="Avg SEO Score" value={`${seo.avg_score}%`} sub={`across ${seo.scored_posts} posts`} color="#e3b341" />
        )}
      </div>

      {/* Content created per day */}
      <div style={{ marginBottom: 20 }}>
        <Section title="Content Created — Last 14 Days">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={daily_chart} margin={{ top: 4, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
              <XAxis dataKey="date" stroke="var(--muted)" tick={{ fontSize: 10 }}
                tickFormatter={v => v.slice(5)} />
              <YAxis stroke="var(--muted)" tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="blogs"  stroke="#58a6ff" strokeWidth={2} dot={false} name="Blogs" />
              <Line type="monotone" dataKey="images" stroke="#a78bfa" strokeWidth={2} dot={false} name="Images" />
              <Line type="monotone" dataKey="videos" stroke="#f59e0b" strokeWidth={2} dot={false} name="Videos" />
            </LineChart>
          </ResponsiveContainer>
        </Section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Social by platform */}
        <Section title="Social Posts by Platform">
          {!platformRows.length ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No social posts yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {platformRows.map(([platform, counts]) => {
                const total = counts.posted + counts.pending + counts.failed
                const color = PLATFORM_COLOR[platform] ?? '#888'
                return (
                  <div key={platform}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color }}>{platform.charAt(0).toUpperCase() + platform.slice(1)}</span>
                      <span style={{ color: 'var(--muted)' }}>{total} total</span>
                    </div>
                    <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', height: 8 }}>
                      {counts.posted > 0 && (
                        <div style={{ flex: counts.posted, background: '#3fb950' }} title={`${counts.posted} posted`} />
                      )}
                      {counts.pending > 0 && (
                        <div style={{ flex: counts.pending, background: '#e3b341' }} title={`${counts.pending} pending`} />
                      )}
                      {counts.failed > 0 && (
                        <div style={{ flex: counts.failed, background: '#f85149' }} title={`${counts.failed} failed`} />
                      )}
                      {total === 0 && <div style={{ flex: 1, background: 'rgba(255,255,255,.08)' }} />}
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 10, color: 'var(--muted)' }}>
                      <span style={{ color: '#3fb950' }}>{counts.posted} posted</span>
                      <span style={{ color: '#e3b341' }}>{counts.pending} pending</span>
                      {counts.failed > 0 && <span style={{ color: '#f85149' }}>{counts.failed} failed</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        {/* Comment replies by platform */}
        <Section title="Auto Replies by Platform">
          {!replyRows.length ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              No auto-replies yet. Enable Comment Auto-Reply in Settings → Automation.
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={replyRows.map(([p, v]) => ({ platform: p, replies: v }))} margin={{ top: 4, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="platform" stroke="var(--muted)" tick={{ fontSize: 10 }}
                    tickFormatter={v => v.charAt(0).toUpperCase() + v.slice(1)} />
                  <YAxis stroke="var(--muted)" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="replies" radius={[4, 4, 0, 0]}
                    fill="#e1306c"
                    label={false}
                  />
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                {replyRows.map(([p, v]) => (
                  <span key={p} style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 99,
                    background: `${PLATFORM_COLOR[p] ?? '#888'}22`,
                    border: `1px solid ${PLATFORM_COLOR[p] ?? '#888'}44`,
                    color: PLATFORM_COLOR[p] ?? '#888',
                  }}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}: {v}
                  </span>
                ))}
              </div>
            </>
          )}
        </Section>
      </div>

      {/* Social queue overview */}
      <Section title="Social Queue Overview">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
          {[
            { label: 'Posted',   value: social.posted,   color: '#3fb950' },
            { label: 'Pending',  value: social.pending,  color: '#e3b341' },
            { label: 'Approved', value: social.approved, color: '#58a6ff' },
            { label: 'Failed',   value: social.failed,   color: '#f85149' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              textAlign: 'center', padding: '14px 10px',
              background: `${color}11`, border: `1px solid ${color}33`,
              borderRadius: 10,
            }}>
              <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Email Autoresponder Analytics ── */}
      {emailTotals && (
        <>
          <Section title="📧 Email Sequences — Overview">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[
                { label: 'Emails Sent',    value: emailTotals.sent,                 color: '#58a6ff' },
                { label: 'Open Rate',      value: `${emailTotals.open_rate}%`,      color: '#3fb950' },
                { label: 'Click Rate',     value: `${emailTotals.click_rate}%`,     color: '#e3b341' },
                { label: 'Unsub Rate',     value: `${emailTotals.unsub_rate}%`,     color: '#f85149' },
                { label: 'Active Subs',    value: emailTotals.active_subscribers,   color: '#58a6ff' },
                { label: 'Completion',     value: `${emailTotals.completion_rate}%`,color: '#3fb950' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: 'center', padding: '14px 10px', background: `${color}11`, border: `1px solid ${color}33`, borderRadius: 10 }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>
          </Section>

          {emailSequences.length > 0 && (
            <Section title="📊 Per-Sequence Breakdown">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Sequence', 'Trigger', 'Sent', 'Opens', 'Clicks', 'Unsubs', 'Open %', 'Click %', 'Enrolled', 'Completed', 'Completion %'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {emailSequences.map(seq => (
                      <tr key={seq.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{seq.name}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 11 }}>{seq.trigger_type.replace('_', ' ')}</td>
                        <td style={{ padding: '8px 10px' }}>{seq.sent}</td>
                        <td style={{ padding: '8px 10px' }}>{seq.opens}</td>
                        <td style={{ padding: '8px 10px' }}>{seq.clicks}</td>
                        <td style={{ padding: '8px 10px', color: seq.unsubs > 0 ? '#f85149' : 'inherit' }}>{seq.unsubs}</td>
                        <td style={{ padding: '8px 10px', color: '#3fb950', fontWeight: 700 }}>{seq.open_rate}%</td>
                        <td style={{ padding: '8px 10px', color: '#e3b341', fontWeight: 700 }}>{seq.click_rate}%</td>
                        <td style={{ padding: '8px 10px' }}>{seq.total_enrolled}</td>
                        <td style={{ padding: '8px 10px' }}>{seq.completed}</td>
                        <td style={{ padding: '8px 10px', color: '#58a6ff', fontWeight: 700 }}>{seq.completion_rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
