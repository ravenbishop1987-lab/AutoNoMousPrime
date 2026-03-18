import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CommerceRevenueData, RevenueData } from '../api'
import { getCommerceRevenue, getRevenue, recordRevenue, submitTask } from '../api'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { DollarSign, MousePointerClick, ShoppingCart, Repeat2 } from 'lucide-react'

interface Props {
  revenue: RevenueData | null
  commerceRevenue: CommerceRevenueData | null
  onRefresh: () => void
}

const colors = ['#58a6ff', '#3fb950', '#e3b341', '#f78166', '#d2a8ff', '#79c0ff']
const REVENUE_VIEWS = [
  { key: 'overview', label: 'Overview' },
  { key: 'attribution', label: 'Attribution' },
  { key: 'events', label: 'Events' },
] as const

const formatUsd = (cents = 0) => `$${(Number(cents || 0) / 100).toFixed(2)}`

const shortLabel = (value: string, fallback = 'Unassigned') => {
  const text = String(value || '').trim()
  if (!text) return fallback
  return text.length > 44 ? `${text.slice(0, 41)}...` : text
}

export default function RevenuePanel({ revenue, commerceRevenue, onRefresh }: Props) {
  const [source, setSource] = useState('stripe')
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const [msg, setMsg] = useState('')
  const [view, setView] = useState<(typeof REVENUE_VIEWS)[number]['key']>('overview')
  const [liveRevenue, setLiveRevenue] = useState<RevenueData | null>(revenue)
  const [liveCommerceRevenue, setLiveCommerceRevenue] = useState<CommerceRevenueData | null>(commerceRevenue)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLiveRevenue(revenue)
  }, [revenue])

  useEffect(() => {
    setLiveCommerceRevenue(commerceRevenue)
  }, [commerceRevenue])

  const refreshRevenue = async () => {
    setLoading(true)
    setMsg('')
    try {
      const [revenueResult, commerceResult] = await Promise.allSettled([
        getRevenue(),
        getCommerceRevenue(),
      ])

      if (revenueResult.status === 'fulfilled') {
        setLiveRevenue(revenueResult.value)
      }
      if (commerceResult.status === 'fulfilled') {
        setLiveCommerceRevenue(commerceResult.value)
      }

      if (revenueResult.status === 'rejected' && commerceResult.status === 'rejected') {
        throw new Error('Could not refresh revenue data')
      }

      onRefresh()
    } catch (error) {
      setMsg(error instanceof Error ? error.message : 'Could not refresh revenue data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshRevenue()
  }, [])

  const addRevenue = async () => {
    const cents = Math.round(parseFloat(amount) * 100)
    if (isNaN(cents) || cents <= 0) return
    try {
      await recordRevenue(source, cents, desc)
      setMsg(`Recorded $${(cents / 100).toFixed(2)} from ${source}`)
      setAmount('')
      setDesc('')
      await refreshRevenue()
    } catch (error) {
      setMsg(error instanceof Error ? error.message : 'Could not record revenue')
    }
  }

  const genReport = async () => {
    await submitTask('financial_report', {}, 'distribution_agent')
    setMsg('Financial report task queued')
  }

  const monthly = useMemo(() => (
    liveCommerceRevenue?.timeline?.slice().reverse().map(item => ({
      month: item.month,
      usd: (item.revenue_cents || 0) / 100,
    })) ?? liveRevenue?.monthly?.slice().reverse() ?? []
  ), [liveCommerceRevenue?.timeline, liveRevenue?.monthly])

  const totalRevenueCents = Number(liveCommerceRevenue?.totals?.totalRevenueCents || 0)
  const orderCount = Number(liveCommerceRevenue?.totals?.orderCount || liveRevenue?.transaction_count || 0)
  const subscriptionCount = Number(liveCommerceRevenue?.totals?.subscriptionCount || 0)
  const analyticsTotals = liveCommerceRevenue?.analytics?.totals
  const conversionRate = analyticsTotals?.page_views
    ? ((analyticsTotals.purchases / analyticsTotals.page_views) * 100)
    : 0

  const offerRows = liveCommerceRevenue?.revenue_breakdown?.offers || []
  const ctaRows = liveCommerceRevenue?.analytics?.cta_variants || liveCommerceRevenue?.revenue_breakdown?.ctas || []
  const landingPageRows = liveCommerceRevenue?.analytics?.landing_pages || []
  const platformRows = liveCommerceRevenue?.revenue_breakdown?.platforms || []
  const subscriptionStates = liveCommerceRevenue?.subscriptions?.states || []
  const recentEvents = liveCommerceRevenue?.recent_events || []
  const topOffer = offerRows[0]
  const topPlatform = platformRows[0]
  const topSubscriptionState = subscriptionStates[0]
  const topLandingPage = landingPageRows[0]
  const attentionItems = [
    (analyticsTotals?.page_views || 0) > 0 && (analyticsTotals?.purchases || 0) === 0
      ? `Traffic is reaching landing pages, but there are no purchases yet.`
      : '',
    (analyticsTotals?.cta_clicks || 0) > 0 && (analyticsTotals?.checkout_started || 0) === 0
      ? `CTA clicks are happening, but no checkout starts are being recorded.`
      : '',
    subscriptionStates.some(item => item.failed_payment_count > 0)
      ? `At least one subscription state includes failed payments.`
      : '',
  ].filter(Boolean)

  return (
    <div className="panel-shell panel-stack">
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="title-row">
          <div className="panel-stack">
            <div className="section-title">Revenue</div>
            <div className="panel-title">Monetization reporting</div>
            <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
              Use this screen to check monetization health, attribution, and subscription state without digging through raw commerce records.
            </div>
          </div>
          <div className="inline-wrap">
            {REVENUE_VIEWS.map(item => (
              <button
                key={item.key}
                type="button"
                className={view === item.key ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setView(item.key)}
              >
                {item.label}
              </button>
            ))}
            <button type="button" className="btn-ghost" onClick={refreshRevenue} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </section>

      <div className="responsive-card-grid-220">
        <MetricCard
          icon={<DollarSign size={18} color="#3fb950" />}
          title="Revenue"
          value={liveCommerceRevenue ? formatUsd(totalRevenueCents) : `$${(liveRevenue?.total_usd || 0).toFixed(2)}`}
          note={`${orderCount} monetization events`}
        />
        <MetricCard
          icon={<ShoppingCart size={18} color="#58a6ff" />}
          title="Orders"
          value={String(orderCount)}
          note={`${subscriptionCount} subscriptions`}
        />
        <MetricCard
          icon={<MousePointerClick size={18} color="#e3b341" />}
          title="CTA Clicks"
          value={String(analyticsTotals?.cta_clicks || 0)}
          note={`${analyticsTotals?.checkout_started || 0} checkout starts`}
        />
        <MetricCard
          icon={<Repeat2 size={18} color="#d2a8ff" />}
          title="Visit To Sale"
          value={`${conversionRate.toFixed(1)}%`}
          note={`${analyticsTotals?.purchases || 0} purchases from ${analyticsTotals?.page_views || 0} visits`}
        />
      </div>

      {view === 'overview' && (
      <>
      <div className="responsive-split">
        <section className="card" style={{ display: 'grid', gap: 14 }}>
          <div className="section-title">Revenue Timeline</div>
          {monthly.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthly}>
                <XAxis dataKey="month" stroke="var(--muted)" tick={{ fontSize: 11 }} />
                <YAxis stroke="var(--muted)" tick={{ fontSize: 11 }} tickFormatter={value => `$${value}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}
                  formatter={value => [`$${Number(value || 0).toFixed(2)}`, 'Revenue']}
                />
                <Bar dataKey="usd" radius={[4, 4, 0, 0]}>
                  {monthly.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: 'var(--muted)' }}>No revenue has been recorded yet.</div>
          )}
        </section>

        <section className="card" style={{ display: 'grid', gap: 14 }}>
          <div className="section-title">Actions</div>
          <label>Source</label>
          <select value={source} onChange={event => setSource(event.target.value)}>
            <option value="stripe">Stripe</option>
            <option value="paypal">PayPal</option>
            <option value="affiliate">Affiliate</option>
            <option value="adsense">AdSense</option>
            <option value="sponsored">Sponsored Post</option>
            <option value="manual">Manual</option>
          </select>
          <label>Amount (USD)</label>
          <input value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" type="number" min="0" step="0.01" />
          <label>Description</label>
          <input value={desc} onChange={event => setDesc(event.target.value)} placeholder="Optional notes" />
          <button className="btn-success" onClick={addRevenue} disabled={!amount}>Record Revenue</button>
          <button className="btn-ghost" onClick={genReport}>Generate Financial Report</button>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            This panel is optimized for monetization reporting, not bookkeeping.
          </div>
        </section>
      </div>

      <div className="responsive-card-grid-320">
        <DataCard title="Needs Attention" emptyText="No urgent monetization issues right now.">
          {attentionItems.map(item => (
            <MetricRow
              key={item}
              label={item}
              value=""
              detail="Review the linked commerce or billing path."
            />
          ))}
        </DataCard>

        <DataCard title="Top Signals" emptyText="No attributed monetization signals yet.">
          {topOffer ? (
            <MetricRow
              label={`Top offer: ${shortLabel(topOffer.offer_name, 'Unassigned offer')}`}
              value={formatUsd(topOffer.revenue_cents)}
              detail={`${topOffer.order_count} orders`}
            />
          ) : null}
          {topPlatform ? (
            <MetricRow
              label={`Top platform: ${shortLabel(topPlatform.platform, 'unknown')}`}
              value={formatUsd(topPlatform.revenue_cents)}
              detail={`${topPlatform.order_count} orders`}
            />
          ) : null}
          {topLandingPage ? (
            <MetricRow
              label={`Top page: ${shortLabel(topLandingPage.name, topLandingPage.slug || 'page')}`}
              value={`${topLandingPage.visits} visits`}
              detail={`${topLandingPage.purchases} purchases`}
            />
          ) : null}
          {topSubscriptionState ? (
            <MetricRow
              label={`Subscription state: ${topSubscriptionState.status} / ${topSubscriptionState.billing_status}`}
              value={String(topSubscriptionState.total)}
              detail={`${topSubscriptionState.failed_payment_count} failed payments`}
            />
          ) : null}
        </DataCard>
      </div>
      </>
      )}

      {view === 'attribution' && (
      <>
      <div className="responsive-card-grid-320">
        <DataCard title="Revenue By Offer" emptyText="No offer-linked revenue yet.">
          {offerRows.slice(0, 6).map(item => (
            <MetricRow
              key={`${item.offer_id || item.offer_name}`}
              label={shortLabel(item.offer_name, 'Unassigned offer')}
              value={formatUsd(item.revenue_cents)}
              detail={`${item.order_count} orders`}
            />
          ))}
        </DataCard>

        <DataCard title="Revenue By Platform" emptyText="No platform attribution yet.">
          {platformRows.slice(0, 6).map(item => (
            <MetricRow
              key={`${item.platform}`}
              label={shortLabel(item.platform, 'unknown')}
              value={formatUsd(item.revenue_cents)}
              detail={`${item.order_count} orders`}
            />
          ))}
        </DataCard>

        <DataCard title="Subscription State" emptyText="No subscription events yet.">
          {subscriptionStates.slice(0, 6).map(item => (
            <MetricRow
              key={`${item.status}-${item.billing_status}`}
              label={`${item.status} / ${item.billing_status}`}
              value={String(item.total)}
              detail={`${item.failed_payment_count} failed payments`}
            />
          ))}
        </DataCard>
      </div>

      <div className="responsive-card-grid-420">
        <TableCard
          title="CTA Variant Performance"
          headers={['Variant', 'Clicks', 'Sales', 'Revenue']}
          rows={ctaRows.slice(0, 8).map(item => [
            `${shortLabel(item.variant_label)} (${item.platform})`,
            String(item.click_count),
            String(item.purchase_count),
            formatUsd(item.revenue_cents),
          ])}
          emptyText="No CTA variants have recorded clicks yet."
        />

        <TableCard
          title="Landing Page Conversion"
          headers={['Page', 'Visits', 'Sales', 'Revenue']}
          rows={landingPageRows.slice(0, 8).map(item => [
            shortLabel(item.name, item.slug || 'Unassigned page'),
            String(item.visits),
            String(item.purchases),
            formatUsd(item.revenue_cents),
          ])}
          emptyText="No landing page traffic has been recorded yet."
        />
      </div>
      </>
      )}

      {view === 'events' && (
      <div className="responsive-card-grid-420">
        <TableCard
          title="Recent Revenue Events"
          headers={['When', 'Kind', 'Platform', 'Amount']}
          rows={recentEvents.slice(0, 8).map(item => [
            new Date(item.created_at).toLocaleString(),
            item.kind,
            item.platform || 'unknown',
            formatUsd(item.amount_cents),
          ])}
          emptyText="No recent revenue events."
        />

        <TableCard
          title="Top Posts"
          headers={['Post', 'Platform', 'Orders', 'Revenue']}
          rows={(liveCommerceRevenue?.revenue_breakdown?.posts || []).slice(0, 8).map(item => [
            shortLabel(item.post_id, 'unattributed'),
            item.platform,
            String(item.order_count),
            formatUsd(item.revenue_cents),
          ])}
          emptyText="No attributed posts yet."
        />
      </div>
      )}

      {msg && (
        <div className="card" style={{ color: msg.toLowerCase().includes('could not') || msg.toLowerCase().includes('error') ? '#f85149' : 'var(--muted)' }}>
          {msg}
        </div>
      )}
    </div>
  )
}

function MetricCard({ icon, title, value, note }: { icon: ReactNode; title: string; value: string; note: string }) {
  return (
    <section className="card" style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <div className="section-title" style={{ marginBottom: 0 }}>{title}</div>
      </div>
      <div className="metric" style={{ fontSize: 32 }}>{value}</div>
      <div className="metric-label">{note}</div>
    </section>
  )
}

function DataCard({ title, emptyText, children }: { title: string; emptyText: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items
  return (
    <section className="card" style={{ display: 'grid', gap: 10 }}>
      <div className="section-title">{title}</div>
      {isEmpty ? <div style={{ color: 'var(--muted)' }}>{emptyText}</div> : items}
    </section>
  )
}

function MetricRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'grid', gap: 3 }}>
        <strong style={{ color: '#e6edf3', fontSize: 13 }}>{label}</strong>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{detail}</span>
      </div>
      {value ? <strong style={{ color: '#e6edf3' }}>{value}</strong> : null}
    </div>
  )
}

function TableCard({ title, headers, rows, emptyText }: {
  title: string
  headers: string[]
  rows: string[][]
  emptyText: string
}) {
  return (
    <section className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="section-title">{title}</div>
      {!rows.length ? (
        <div style={{ color: 'var(--muted)' }}>{emptyText}</div>
      ) : (
        <div className="table-scroll">
        <table>
          <thead>
            <tr>{headers.map(header => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${title}-${index}`}>
                {row.map((cell, cellIndex) => <td key={`${title}-${index}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  )
}
