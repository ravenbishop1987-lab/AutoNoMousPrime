import { useEffect, useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts'
import { getEmailAnalytics, getEmailSequenceAnalytics, getEmailStepDropoff, type EmailAnalyticsTotals, type EmailSequenceAnalytics } from '../api'

// ── Shared ─────────────────────────────────────────────────────────────────────

const TT = {
  contentStyle: { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#8b949e' },
  itemStyle: { color: '#c9d1d9' },
}

function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: '20px 22px', ...style }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.08em', marginBottom: 12 }}>{children}</div>
}

function BigStat({
  label, value, sub, color, icon,
}: { label: string; value: string | number; sub?: string; color: string; icon?: string }) {
  return (
    <div style={{
      background: `${color}10`,
      border: `1px solid ${color}28`,
      borderRadius: 14,
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      {icon && <div style={{ fontSize: 20, marginBottom: 2 }}>{icon}</div>}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Gauge({ value, color, label }: { value: number; color: string; label: string }) {
  const pct = Math.min(Math.max(value, 0), 100)
  const r = 36
  const circ = 2 * Math.PI * r
  const dashLen = (pct / 100) * circ * 0.75 // 270° arc
  const gap = circ - dashLen
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 8px' }}>
        <svg viewBox="0 0 100 100" width={96} height={96}>
          {/* bg track */}
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="7"
            strokeDasharray={`${circ * .75} ${circ * .25}`}
            strokeDashoffset={circ * .375}
            strokeLinecap="round"
          />
          {/* value arc */}
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="7"
            strokeDasharray={`${dashLen} ${gap}`}
            strokeDashoffset={circ * .375}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray .6s ease' }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color }}>
          {pct}%
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{label}</div>
    </div>
  )
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,.07)', overflow: 'hidden', width: '100%' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width .4s ease' }} />
    </div>
  )
}

const MEDAL = ['🥇', '🥈', '🥉']

// ── Main ────────────────────────────────────────────────────────────────────────

export default function EmailAnalyticsPanel() {
  const [totals, setTotals] = useState<EmailAnalyticsTotals | null>(null)
  const [sequences, setSequences] = useState<EmailSequenceAnalytics[]>([])
  const [dropoff, setDropoff] = useState<{ step_number: number; subject: string; sent: number; opens: number; clicks: number; open_rate: number; click_rate: number }[]>([])
  const [selectedSeqId, setSelectedSeqId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [overview, seqData] = await Promise.all([getEmailAnalytics(), getEmailSequenceAnalytics()])
      setTotals(overview.totals ?? null)
      const seqs: EmailSequenceAnalytics[] = seqData.sequences || []
      setSequences(seqs)
      setLastRefresh(new Date().toLocaleTimeString())
      if (!selectedSeqId && seqs.length) setSelectedSeqId(seqs[0].id)
    } catch {
      // no DB configured yet
    }
    setLoading(false)
  }, [selectedSeqId])

  const loadDropoff = useCallback(async (seqId: string) => {
    try {
      const r = await getEmailStepDropoff(seqId)
      setDropoff(r.steps || [])
    } catch { setDropoff([]) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (selectedSeqId) loadDropoff(selectedSeqId) }, [selectedSeqId, loadDropoff])

  if (loading) {
    return (
      <div style={{ padding: 40, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted)', fontSize: 13 }}>
        <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        Loading email analytics…
      </div>
    )
  }

  const t = totals

  // Subscriber pie
  const activeSubs  = t?.active_subscribers ?? 0
  const totalEnroll = t?.total_enrollments ?? 0
  const completed   = t?.completed_enrollments ?? 0
  const unsubs      = t?.unsubs ?? 0
  const pieData = [
    { name: 'Active',       value: activeSubs,                                    fill: '#58a6ff' },
    { name: 'Completed',    value: completed,                                      fill: '#3fb950' },
    { name: 'Unsubscribed', value: unsubs,                                         fill: '#f85149' },
    { name: 'In Progress',  value: Math.max(0, totalEnroll - activeSubs - completed - unsubs), fill: '#e3b341' },
  ].filter(d => d.value > 0)

  // Sequence bar data
  const sorted = [...sequences].sort((a, b) => b.open_rate - a.open_rate)
  const seqBarData = sorted.slice(0, 8).map(s => ({
    name: s.name.length > 18 ? s.name.slice(0, 16) + '…' : s.name,
    'Open %':  s.open_rate,
    'Click %': s.click_rate,
    'Unsub %': s.unsub_rate,
  }))

  const enrollData = sorted.slice(0, 6).map(s => ({
    name:      s.name.length > 14 ? s.name.slice(0, 12) + '…' : s.name,
    Enrolled:  s.total_enrolled,
    Completed: s.completed,
  }))

  const selectedSeq = sequences.find(s => s.id === selectedSeqId)

  const noEmails = !t || t.sent === 0

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 1160 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Email Analytics</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            Full overview of subscribers, campaigns, and engagement
            {lastRefresh && ` · Updated ${lastRefresh}`}
          </div>
        </div>
        <button className="btn-ghost" onClick={load} style={{ padding: '7px 16px', fontSize: 12, flexShrink: 0 }}>↻ Refresh</button>
      </div>

      {/* ── Top KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <BigStat label="ACTIVE SUBSCRIBERS" value={(activeSubs).toLocaleString()}        color="#58a6ff" icon="👥" />
        <BigStat label="TOTAL ENROLLMENTS"  value={(totalEnroll).toLocaleString()}        color="#a371f7" icon="📋" />
        <BigStat label="EMAILS SENT"        value={(t?.sent ?? 0).toLocaleString()}       color="#58a6ff" icon="📤" sub="all time" />
        <BigStat label="OPEN RATE"          value={`${t?.open_rate ?? 0}%`}              color="#3fb950" icon="👁" sub={`${t?.opens ?? 0} opens`} />
        <BigStat label="CLICK-THROUGH"      value={`${t?.click_rate ?? 0}%`}             color="#e3b341" icon="🖱" sub={`${t?.clicks ?? 0} clicks`} />
        <BigStat label="UNSUBSCRIBES"       value={(t?.unsubs ?? 0).toLocaleString()}    color="#f85149" icon="🚫" sub={`${t?.unsub_rate ?? 0}% rate`} />
      </div>

      {/* ── Engagement gauges + subscriber pie ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <SectionLabel>ENGAGEMENT RATES</SectionLabel>
          {noEmails ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0' }}>No emails sent yet — rates will appear once campaigns are active.</div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-around', paddingTop: 8 }}>
              <Gauge value={t!.open_rate}   color="#3fb950" label="Open Rate"   />
              <Gauge value={t!.click_rate}  color="#e3b341" label="Click Rate"  />
              <Gauge value={t!.unsub_rate}  color="#f85149" label="Unsub Rate"  />
            </div>
          )}
        </Card>

        <Card>
          <SectionLabel>SUBSCRIBER BREAKDOWN</SectionLabel>
          {pieData.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0' }}>No subscribers yet.</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={64} dataKey="value" paddingAngle={3}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip {...TT} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'grid', gap: 10, flex: 1 }}>
                {pieData.map(d => (
                  <div key={d.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.fill, display: 'inline-block' }} />
                        {d.name}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{d.value.toLocaleString()}</span>
                    </div>
                    <MiniBar value={d.value} max={Math.max(...pieData.map(x => x.value))} color={d.fill} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Sequence performance table ── */}
      <Card>
        <SectionLabel>🏆 SEQUENCE PERFORMANCE</SectionLabel>
        {sequences.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0' }}>No sequences yet. Create one in the Sequences tab.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {sorted.map((seq, i) => (
              <div
                key={seq.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr auto auto',
                  alignItems: 'center',
                  gap: 14,
                  padding: '13px 16px',
                  background: selectedSeqId === seq.id ? 'rgba(88,166,255,.07)' : 'rgba(255,255,255,.02)',
                  border: `1px solid ${selectedSeqId === seq.id ? 'rgba(88,166,255,.25)' : 'rgba(255,255,255,.06)'}`,
                  borderRadius: 10,
                }}
              >
                {/* Rank badge */}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: i < 3 ? ['#e3b341', '#8b949e', '#cd7f32'][i] : 'rgba(255,255,255,.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: i < 3 ? 16 : 11, fontWeight: 800,
                  color: i < 3 ? '#000' : 'var(--muted)',
                }}>
                  {i < 3 ? MEDAL[i] : i + 1}
                </div>

                {/* Name + meta */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seq.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {seq.trigger_type?.replace(/_/g, ' ')} &middot; {seq.total_enrolled} enrolled &middot; {seq.sent} sent
                  </div>
                  {/* Inline rate bars */}
                  <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                    {[
                      { label: 'Open',  v: seq.open_rate,  c: '#3fb950' },
                      { label: 'Click', v: seq.click_rate, c: '#e3b341' },
                      { label: 'Unsub', v: seq.unsub_rate, c: '#f85149' },
                    ].map(m => (
                      <div key={m.label} style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{m.label}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: m.c }}>{m.v}%</span>
                        </div>
                        <div style={{ height: 3, borderRadius: 99, background: 'rgba(255,255,255,.07)' }}>
                          <div style={{ height: '100%', width: `${Math.min(m.v, 100)}%`, background: m.c, borderRadius: 99 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Completion */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#3fb950' }}>{seq.completion_rate ?? 0}%</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>completion</div>
                </div>

                {/* Drop-off button */}
                <button
                  onClick={() => setSelectedSeqId(prev => prev === seq.id ? null : seq.id)}
                  style={{
                    padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 8,
                    border: `1px solid ${selectedSeqId === seq.id ? 'var(--accent)' : 'var(--border)'}`,
                    background: selectedSeqId === seq.id ? 'rgba(88,166,255,.12)' : 'transparent',
                    color: selectedSeqId === seq.id ? 'var(--accent)' : 'var(--muted)',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {selectedSeqId === seq.id ? '▲ Hide' : 'Step view'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Step drop-off (inline) ── */}
      {selectedSeqId && dropoff.length > 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <SectionLabel>📉 STEP DROP-OFF — {selectedSeq?.name?.toUpperCase()}</SectionLabel>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -8 }}>How many subscribers reached and engaged each step</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dropoff.map(s => ({ name: `Step ${s.step_number}`, Sent: s.sent, Opens: s.opens, Clicks: s.clicks }))} barGap={3} barCategoryGap="30%">
              <XAxis dataKey="name" tick={{ fill: '#8b949e', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...TT} />
              <Bar dataKey="Sent"   fill="#58a6ff" radius={[4,4,0,0]} />
              <Bar dataKey="Opens"  fill="#3fb950" radius={[4,4,0,0]} />
              <Bar dataKey="Clicks" fill="#e3b341" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 16, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Step', 'Subject', 'Sent', 'Opens', 'Open %', 'Clicks', 'Click %'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dropoff.map(s => (
                  <tr key={s.step_number} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: 'var(--accent)' }}>#{s.step_number}</td>
                    <td style={{ padding: '8px 10px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.subject}</td>
                    <td style={{ padding: '8px 10px' }}>{s.sent}</td>
                    <td style={{ padding: '8px 10px' }}>{s.opens}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#3fb950' }}>{s.open_rate}%</td>
                    <td style={{ padding: '8px 10px' }}>{s.clicks}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#e3b341' }}>{s.click_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Sequence comparison charts (only if data) ── */}
      {seqBarData.length > 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Card>
            <SectionLabel>OPEN / CLICK / UNSUB BY SEQUENCE</SectionLabel>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={seqBarData} barGap={3} barCategoryGap="25%">
                <XAxis dataKey="name" tick={{ fill: '#8b949e', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} axisLine={false} tickLine={false} unit="%" domain={[0, 100]} />
                <Tooltip {...TT} formatter={(v: number) => `${v}%`} />
                <Bar dataKey="Open %"  fill="#3fb950" radius={[4,4,0,0]} />
                <Bar dataKey="Click %" fill="#e3b341" radius={[4,4,0,0]} />
                <Bar dataKey="Unsub %" fill="#f85149" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <SectionLabel>ENROLLMENT VS COMPLETION</SectionLabel>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={enrollData} barGap={3} barCategoryGap="30%">
                <XAxis dataKey="name" tick={{ fill: '#8b949e', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip {...TT} />
                <Bar dataKey="Enrolled"  fill="#58a6ff" radius={[4,4,0,0]} />
                <Bar dataKey="Completed" fill="#3fb950" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* ── No sequences yet ── */}
      {sequences.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No sequences running yet</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 380, margin: '0 auto' }}>
            Create a sequence in the Sequences tab, enroll subscribers, and your analytics will populate here automatically.
          </div>
        </div>
      )}
    </div>
  )
}
