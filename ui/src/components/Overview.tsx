import { useEffect, useState } from 'react'
import { getSeoAudit, getSeoRankings, type SystemStatus, type RevenueData, type ActiveTask, type PipelineRun, type CommerceRevenueData, type SeoAuditReport, type SeoRanking } from '../api'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { CheckCircle, Clock, Cpu, XCircle } from 'lucide-react'

interface Props {
  status: SystemStatus | null
  revenue: RevenueData | null
  commerceRevenue: CommerceRevenueData | null
}

const summaryGridStyle = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
} as const

const tableLinkStyle = {
  color: 'var(--accent)',
  textDecoration: 'none',
} as const

const badgeColorByStatus: Record<string, string> = {
  completed: 'badge-green',
  failed: 'badge-red',
  blocked: 'badge-yellow',
  running: 'badge-blue',
  retrying: 'badge-yellow',
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`
}

function formatPipelineStatus(status: string) {
  return badgeColorByStatus[status] ?? 'badge-gray'
}

function progressForTask(task: ActiveTask) {
  const stage: Record<string, number> = {
    blog_post: 20,
    seo_research: 15,
    image_gen: 40,
    tts: 60,
    video_caption: 85,
    video_assemble: 90,
    post_content: 100,
    video_publish: 100,
    social_post: 100,
    financial_report: 100,
  }
  return stage[task.type] ?? 25
}

function labelForTask(task: ActiveTask) {
  const label: Record<string, string> = {
    blog_post: 'Writing article',
    seo_research: 'Researching keywords',
    image_gen: 'Generating image',
    tts: 'Rendering narration',
    video_caption: 'Building slide video',
    video_assemble: 'Assembling video',
    post_content: 'Publishing to WordPress',
    video_publish: 'Uploading final video',
    social_post: 'Posting to social',
    financial_report: 'Generating report',
  }
  return label[task.type] ?? task.type
}

function summarizePipeline(pipeline: PipelineRun) {
  const completedStages = pipeline.stages.filter(stage => stage.status === 'completed').length
  const failedStages = pipeline.stages.filter(stage => stage.status === 'failed').length
  const runningStage = pipeline.stages.find(stage => stage.status === 'running' || stage.status === 'retrying')
  const failedStage = pipeline.stages.find(stage => stage.status === 'failed')

  return {
    completedStages,
    failedStages,
    runningStage,
    failedStage,
  }
}

export default function Overview({ status, revenue, commerceRevenue }: Props) {
  const [seoAudit, setSeoAudit] = useState<SeoAuditReport | null>(null)
  const [seoRankings, setSeoRankings] = useState<SeoRanking[]>([])

  useEffect(() => {
    let active = true
    Promise.all([getSeoAudit(), getSeoRankings()])
      .then(([audit, rankings]) => {
        if (!active) return
        setSeoAudit(audit)
        setSeoRankings(rankings)
      })
      .catch(() => {
        if (!active) return
        setSeoAudit(null)
        setSeoRankings([])
      })
    return () => {
      active = false
    }
  }, [])

  const q = status?.queue
  const hasCommerceSource = commerceRevenue !== null
  const monthly = hasCommerceSource
    ? (commerceRevenue?.timeline?.slice().reverse().map(item => ({
        month: item.month,
        usd: (item.revenue_cents || 0) / 100,
      })) ?? [])
    : (revenue?.monthly?.slice().reverse() ?? [])
  const activeTasks = status?.active_tasks ?? []
  const pipelines = (status?.pipelines ?? []).slice().reverse()
  const commerceTotals = commerceRevenue?.analytics?.totals
  const topPages = (commerceRevenue?.analytics?.pages ?? []).slice().sort((a, b) => {
    if ((b.revenue_cents || 0) !== (a.revenue_cents || 0)) {
      return (b.revenue_cents || 0) - (a.revenue_cents || 0)
    }
    return (b.clicks || 0) - (a.clicks || 0) || (b.visits || 0) - (a.visits || 0)
  })
  const totalTrackedUsd = commerceRevenue?.totals
    ? (commerceRevenue.totals.totalRevenueCents || 0) / 100
    : (revenue?.total_usd ?? 0)
  const transactionCount = commerceRevenue?.totals?.orderCount ?? revenue?.transaction_count ?? 0
  const auditSummary = seoAudit?.summary ?? {
    total_posts: 0,
    average_score: 0,
    good_posts: 0,
    needs_work_posts: 0,
    critical_posts: 0,
    issue_total: 0,
    warning_total: 0,
    passed_total: 0,
  }
  const rankedKeywords = seoRankings.filter(item => typeof item.position === 'number' && item.position !== null)
  const averageRank = rankedKeywords.length
    ? Math.round(rankedKeywords.reduce((sum, item) => sum + (item.position ?? 0), 0) / rankedKeywords.length)
    : 0
  const agentEntries = Object.entries(status?.agents ?? {})
  const activeAgentCount = Object.values(status?.agents ?? {}).filter(agent => agent.load > 0).length
  const conversionRate = commerceTotals?.page_views
    ? Math.round(((commerceTotals.purchases || 0) / commerceTotals.page_views) * 1000) / 10
    : 0
  const clickRate = commerceTotals?.page_views
    ? Math.round(((commerceTotals.cta_clicks || 0) / commerceTotals.page_views) * 1000) / 10
    : 0
  const activeTasksByAgent = activeTasks.reduce<Record<string, number>>((acc, task) => {
    if (task.agent) acc[task.agent] = (acc[task.agent] ?? 0) + 1
    return acc
  }, {})
  const maxAgentLoad = Math.max(
    1,
    ...agentEntries.map(([agentId, agent]) => Math.max(agent.load, activeTasksByAgent[agentId] ?? 0)),
  )

  const attentionItems = [
    q?.failed ? { tone: 'red', label: `${q.failed} failed jobs need attention` } : null,
    auditSummary.critical_posts ? { tone: 'yellow', label: `${auditSummary.critical_posts} posts have critical SEO issues` } : null,
    (revenue?.social_pending ?? 0) > 0 ? { tone: 'blue', label: `${revenue?.social_pending ?? 0} social posts are still pending` } : null,
    activeTasks.length === 0 && pipelines.length === 0 ? { tone: 'gray', label: 'No active automation is running right now' } : null,
    topPages[0] && (topPages[0].visits || 0) > 0 && (topPages[0].purchases || 0) === 0
      ? { tone: 'yellow', label: `${topPages[0].name || topPages[0].slug} has traffic but no purchases yet` }
      : null,
    ...(status?.optimizer ?? []).slice(0, 2).map(item => ({ tone: 'yellow', label: item.reason })),
  ].filter(Boolean) as Array<{ tone: string; label: string }>

  const visiblePipelines = pipelines.slice(0, 3)
  const recentPosts = revenue?.recent_posts?.slice(0, 5) ?? []
  const topLandingPages = topPages.slice(0, 5)

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      <div className="card">
        <div className="section-title">Revenue</div>
        <div className="metric">{formatUsd(totalTrackedUsd)}</div>
        <div className="metric-label">Tracked revenue</div>
        <div className="divider" />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
          <span style={{ color: 'var(--muted)' }}>Transactions</span>
          <strong>{transactionCount}</strong>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Operations</div>
        <div className="metric">{activeTasks.length}</div>
        <div className="metric-label">Tasks running now</div>
        <div className="divider" />
        <div style={summaryGridStyle}>
          {[
            { label: 'Pending', value: q?.pending ?? 0, icon: <Clock size={14} />, color: '#e3b341' },
            { label: 'Running', value: q?.running ?? 0, icon: <Cpu size={14} />, color: '#58a6ff' },
            { label: 'Done', value: q?.completed ?? 0, icon: <CheckCircle size={14} />, color: '#3fb950' },
            { label: 'Failed', value: q?.failed ?? 0, icon: <XCircle size={14} />, color: '#f85149' },
          ].map(item => (
            <div key={item.label} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: item.color }}>
                {item.icon}
                <span>{item.label}</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="section-title">Landing Pages</div>
        <div className="metric">{commerceTotals?.page_views ?? 0}</div>
        <div className="metric-label">Page visits</div>
        <div className="divider" />
        <div style={summaryGridStyle}>
          <div>
            <div className="metric-label">Click rate</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{clickRate}%</div>
          </div>
          <div>
            <div className="metric-label">Conversion rate</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{conversionRate}%</div>
          </div>
          <div>
            <div className="metric-label">Clicks</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{commerceTotals?.cta_clicks ?? 0}</div>
          </div>
          <div>
            <div className="metric-label">Purchases</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{commerceTotals?.purchases ?? 0}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">SEO Health</div>
        <div className="metric">{auditSummary.average_score}</div>
        <div className="metric-label">Average audit score</div>
        <div className="divider" />
        <div style={summaryGridStyle}>
          <div>
            <div className="metric-label">Avg rank</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{averageRank || '-'}</div>
          </div>
          <div>
            <div className="metric-label">Good posts</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{auditSummary.good_posts}</div>
          </div>
          <div>
            <div className="metric-label">Critical posts</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: auditSummary.critical_posts ? '#f85149' : 'var(--text)' }}>{auditSummary.critical_posts}</div>
          </div>
          <div>
            <div className="metric-label">Active agents</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{activeAgentCount}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Agent Status</div>
        {agentEntries.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>No agent status available yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {agentEntries.map(([agentId, agent]) => {
              const taskCount = activeTasksByAgent[agentId] ?? 0
              const effectiveLoad = Math.max(agent.load, taskCount)
              const barWidth = Math.max(8, Math.round((effectiveLoad / maxAgentLoad) * 100))
              const isWorking = effectiveLoad > 0

              return (
                <div key={agentId} style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{agentId.replace('_agent', '')}</div>
                    <span className={`badge ${isWorking ? 'badge-blue' : 'badge-gray'}`}>
                      {isWorking ? `${taskCount || agent.load} active` : 'idle'}
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${barWidth}%`,
                        background: isWorking ? 'linear-gradient(90deg, #58a6ff, #3fb950)' : 'rgba(255,255,255,0.12)',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {monthly.length > 0 && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div className="section-title">Revenue Trend</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Monthly revenue trend across tracked orders and subscriptions.</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Current total</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{formatUsd(totalTrackedUsd)}</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={monthly}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#58a6ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#58a6ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" stroke="var(--muted)" tick={{ fontSize: 11 }} />
              <YAxis stroke="var(--muted)" tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }} formatter={(v: any) => [formatUsd(Number(v ?? 0)), 'Revenue']} />
              <Area type="monotone" dataKey="usd" stroke="#58a6ff" fill="url(#revGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card">
        <div className="section-title">Needs Attention</div>
        {attentionItems.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Nothing urgent right now.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {attentionItems.slice(0, 5).map((item, index) => (
              <div
                key={`${item.label}-${index}`}
                style={{
                  fontSize: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface2)',
                  color: item.tone === 'red' ? '#ffb4b4' : item.tone === 'yellow' ? '#f2cc60' : item.tone === 'blue' ? '#8cb4ff' : 'var(--text)',
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Recent Activity</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {activeTasks.slice(0, 2).map(task => (
            <div key={task.task_id} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{labelForTask(task)}</div>
                <span className="badge badge-blue">{progressForTask(task)}%</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {[task.agent, task.topic || 'No topic', task.aspect_ratio].filter(Boolean).join(' - ')}
              </div>
            </div>
          ))}

          {visiblePipelines.map(pipeline => {
            const summary = summarizePipeline(pipeline)
            return (
              <div key={pipeline.pipeline_id} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6, alignItems: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{pipeline.topic}</div>
                  <span className={`badge ${formatPipelineStatus(pipeline.status)}`}>{pipeline.status}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  {[pipeline.aspect_ratio, pipeline.created_at?.replace('T', ' ').slice(0, 16), pipeline.pipeline_id.slice(0, 8)].filter(Boolean).join(' - ')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
                  <span className="badge badge-gray">{summary.completedStages}/{pipeline.stages.length} complete</span>
                  {summary.failedStages > 0 && <span className="badge badge-red">{summary.failedStages} failed</span>}
                  {summary.runningStage && <span className="badge badge-blue">{summary.runningStage.label}</span>}
                  {summary.failedStage && <span className="badge badge-yellow">{summary.failedStage.label}</span>}
                </div>
              </div>
            )
          })}

          {activeTasks.length === 0 && visiblePipelines.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>No recent activity tracked yet.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="section-title">Top Landing Pages</div>
        {topLandingPages.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>No landing-page analytics tracked yet.</div>
        ) : (
          <table>
            <thead><tr><th>Page</th><th>Visits</th><th>Clicks</th><th>Revenue</th></tr></thead>
            <tbody>
              {topLandingPages.map(page => (
                <tr key={page.id}>
                  <td>{page.name || page.slug}</td>
                  <td>{page.visits}</td>
                  <td>{page.clicks}</td>
                  <td>{formatUsd((page.revenue_cents || 0) / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div className="section-title">Recent Published Posts</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Latest content shipped across connected platforms.</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{recentPosts.length} shown</div>
        </div>
        {recentPosts.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>No recent published posts yet.</div>
        ) : (
          <table>
            <thead><tr><th>Title</th><th>Platform</th><th>SEO Score</th><th>Published</th></tr></thead>
            <tbody>
              {recentPosts.map((post, index) => (
                <tr key={`${post.title}-${index}`}>
                  <td>
                    {post.url ? (
                      <a href={post.url} target="_blank" rel="noreferrer" style={tableLinkStyle}>
                        {post.title || 'Post'}
                      </a>
                    ) : (
                      <span>{post.title || 'Post'}</span>
                    )}
                  </td>
                  <td><span className="badge badge-blue">{post.platform}</span></td>
                  <td><span className={`badge ${(post.seo_score ?? 0) >= 70 ? 'badge-green' : (post.seo_score ?? 0) >= 40 ? 'badge-yellow' : 'badge-red'}`}>{post.seo_score ?? 0}/100</span></td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{post.at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
