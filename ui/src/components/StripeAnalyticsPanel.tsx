import { useCallback, useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { RefreshCw, TrendingUp, DollarSign, ShoppingBag, Zap, ExternalLink, AlertTriangle } from 'lucide-react'

interface Summary {
  total_revenue: number
  month_revenue: number
  today_revenue: number
  total_fees: number
  charge_count: number
}

interface DayPoint { date: string; revenue: number }

interface Product {
  id: string
  name: string
  revenue: number
  revenue_usd: number
  count: number
}

interface Charge {
  id: string
  amount: number
  currency: string
  description: string
  customer_email: string
  created: string
  receipt_url: string
}

interface StripeData {
  ok: boolean
  error?: string
  summary: Summary
  daily_chart: DayPoint[]
  products: Product[]
  recent_charges: Charge[]
}

const fmt = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`

const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 24,
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string
  icon: React.ComponentType<{ size?: number; color?: string }>; color: string
}) {
  return (
    <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={18} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', fontSize: 13 }}>
      <div style={{ color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ color: '#3fb950', fontWeight: 700 }}>${payload[0].value.toFixed(2)}</div>
    </div>
  )
}

export default function StripeAnalyticsPanel() {
  const [data, setData]       = useState<StripeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [lastRefresh, setLastRefresh] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/stripe/analytics')
      const json = await r.json()
      if (!r.ok || json.error) { setError(json.error || 'Failed to load Stripe data'); return }
      setData(json)
      setLastRefresh(new Date().toLocaleTimeString())
    } catch (e: any) {
      setError(e.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const s = data?.summary
  const maxProd = data?.products[0]?.revenue_usd || 1

  return (
    <div style={{ padding: '28px 24px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>💳</span> Stripe Sales Analytics
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Live data from your Stripe account{lastRefresh && ` · Refreshed ${lastRefresh}`}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13 }}
        >
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-start', borderColor: 'rgba(248,81,73,.3)', background: 'rgba(248,81,73,.06)', marginBottom: 24 }}>
          <AlertTriangle size={18} color="#f85149" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 700, color: '#f85149', marginBottom: 4 }}>Could not connect to Stripe</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{error}</div>
            {error.includes('not configured') && (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
                Add <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 4 }}>STRIPE_SECRET_KEY</code> to your <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 4 }}>.env</code> file and restart.
              </div>
            )}
          </div>
        </div>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', padding: 80, color: 'var(--muted)' }}>Connecting to Stripe…</div>
      )}

      {data && (
        <>
          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
            <StatCard label="Total Revenue" value={fmt(s!.total_revenue)} sub="All time" icon={DollarSign} color="#3fb950" />
            <StatCard label="Last 30 Days" value={fmt(s!.month_revenue)} sub="Rolling 30-day window" icon={TrendingUp} color="#58a6ff" />
            <StatCard label="Today" value={fmt(s!.today_revenue)} sub="Last 24 hours" icon={Zap} color="#a371f7" />
            <StatCard label="Successful Charges" value={s!.charge_count.toString()} sub={`$${s!.total_fees.toFixed(2)} in Stripe fees`} icon={ShoppingBag} color="#f78166" />
          </div>

          {/* Revenue chart */}
          {data.daily_chart.length > 0 && (
            <div style={{ ...card, marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>Daily Revenue — Last 30 Days</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.daily_chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3fb950" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => `$${v}`} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="revenue" stroke="#3fb950" strokeWidth={2} fill="url(#revGrad)" dot={false} activeDot={{ r: 4, fill: '#3fb950' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

            {/* Products breakdown */}
            <div style={card}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 18 }}>Revenue by Product</div>
              {data.products.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No product data yet</div>
              ) : data.products.map(p => (
                <div key={p.id} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 12 }}>{p.name}</span>
                    <span style={{ fontSize: 13, color: '#3fb950', fontWeight: 700, flexShrink: 0 }}>${p.revenue_usd.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: 'var(--bg)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(4, (p.revenue_usd / maxProd) * 100)}%`, background: 'linear-gradient(90deg, #3fb950, #58a6ff)', borderRadius: 999, transition: 'width .4s' }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{p.count} sale{p.count !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Recent charges */}
            <div style={card}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 18 }}>Recent Transactions</div>
              {data.recent_charges.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No successful charges yet</div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {data.recent_charges.map(ch => (
                    <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ch.description}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {ch.customer_email} · {ch.created}
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#3fb950', flexShrink: 0 }}>
                        ${ch.amount.toFixed(2)}
                      </div>
                      {ch.receipt_url && (
                        <a href={ch.receipt_url} target="_blank" rel="noreferrer" style={{ color: 'var(--muted)', flexShrink: 0 }}>
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
