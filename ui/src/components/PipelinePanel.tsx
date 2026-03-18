import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileText, Loader, Rocket, Sparkles, Wand2 } from 'lucide-react'
import { getTemplates, getWorkspaceSession, submitPipeline, type SystemStatus, type TemplateItem } from '../api'

type LaunchMode = 'single' | 'batch'

const ASPECT_OPTIONS = [
  { value: '16:9', label: '16:9', sub: 'YouTube / Landscape' },
  { value: '9:16', label: '9:16', sub: 'TikTok / Shorts' },
  { value: '1:1',  label: '1:1',  sub: 'Instagram Square' },
] as const

const DURATION_OPTIONS = [
  { value: 60,   label: '1 min',  slides: 4,  words: 800  },
  { value: 180,  label: '3 min',  slides: 8,  words: 1200 },
  { value: 300,  label: '5 min',  slides: 12, words: 1800 },
  { value: 600,  label: '10 min', slides: 20, words: 2500 },
  { value: 900,  label: '15 min', slides: 28, words: 3500 },
]

const WORD_COUNT_OPTIONS = [
  { value: 500,  label: '500',   desc: 'Short' },
  { value: 750,  label: '750',   desc: 'Brief' },
  { value: 1000, label: '1,000', desc: 'Standard' },
  { value: 1500, label: '1,500', desc: 'Long' },
  { value: 2000, label: '2,000', desc: 'Deep dive' },
  { value: 3000, label: '3,000', desc: 'Pillar' },
]

type LaunchNotice = {
  tone: 'success' | 'error'
  text: string
}

type LaunchHistoryItem = {
  id: string
  topic: string
  aspectRatio: string
  createdAt: string
  status: string
}

const pipelineSteps = [
  { label: 'Research and outline', detail: 'AI pulls the angle, structure, and search intent.' },
  { label: 'Write and package content', detail: 'The article and supporting content are generated for you.' },
  { label: 'Create assets', detail: 'Images, narration, and video assembly are handled automatically.' },
  { label: 'Publish and distribute', detail: 'The system packages the output for WordPress and distribution.' },
]

interface Props {
  status?: SystemStatus | null
}

export default function PipelinePanel({ status }: Props) {
  const [mode, setMode] = useState<LaunchMode>('single')
  const [topic, setTopic] = useState('')
  const [keywords, setKeywords] = useState('')
  const [secondaryKeywords, setSecondaryKeywords] = useState('')
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [duration, setDuration] = useState(300)
  const [wordCount, setWordCount] = useState(1500)
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [templateId, setTemplateId] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<LaunchNotice | null>(null)
  const [history, setHistory] = useState<LaunchHistoryItem[]>([])

  const [batchTopics, setBatchTopics] = useState('')
  const [batchLoading, setBatchLoading] = useState(false)

  useEffect(() => {
    let active = true
    getWorkspaceSession()
      .then(session => {
        if (!active || !session.active_workspace?.id) return null
        return getTemplates(session.active_workspace.id, { visibility: 'workspace' })
      })
      .then(result => {
        if (active) setTemplates(result?.items || [])
      })
      .catch(() => {
        if (active) setTemplates([])
      })
    return () => {
      active = false
    }
  }, [])

  const pushHistory = (topics: string[]) => {
    const createdAt = new Date().toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    const items = topics.map(item => ({
      id: `local-${item}-${Date.now()}`,
      topic: item,
      aspectRatio,
      createdAt,
      status: 'queued',
    }))
    setHistory(current => [...items, ...current].slice(0, 5))
  }

  const launch = async () => {
    if (!topic.trim()) return
    setLoading(true)
    setNotice(null)
    try {
      const keywordList = keywords.split(',').map(k => k.trim()).filter(Boolean)
      const secondaryList = secondaryKeywords.split(',').map(k => k.trim()).filter(Boolean)
      const selectedTemplate = templates.find(template => template.id === templateId) || null
      const dur = DURATION_OPTIONS.find(d => d.value === duration) ?? DURATION_OPTIONS[2]
      const result = await submitPipeline(topic.trim(), keywordList, aspectRatio, {
        input_payload: {
          generate_video: true,
          content_type: 'video',
          target_duration_seconds: dur.value,
          target_slide_count: dur.slides,
          target_words: dur.words,
          word_count: wordCount,
          secondary_keywords: secondaryList,
          ...(selectedTemplate ? {
            template_id: selectedTemplate.id,
            template_kind: selectedTemplate.template_kind,
            template_name: selectedTemplate.name,
            template_body: selectedTemplate.body_template,
          } : {}),
        },
      })
      setNotice({
        tone: 'success',
        text: `Pipeline launched. ${result.count} tasks were queued for ${topic.trim()}.`,
      })
      pushHistory([topic.trim()])
      setTopic('')
      setKeywords('')
      setTemplateId('')
    } catch (e: any) {
      setNotice({
        tone: 'error',
        text: `Launch failed: ${e.message}`,
      })
    } finally {
      setLoading(false)
    }
  }

  const launchBatch = async () => {
    const topics = batchTopics.split('\n').map(item => item.trim()).filter(Boolean)
    if (!topics.length) return
    setBatchLoading(true)
    setNotice(null)
    let ok = 0
    const selectedTemplate = templates.find(template => template.id === templateId) || null
    const dur = DURATION_OPTIONS.find(d => d.value === duration) ?? DURATION_OPTIONS[2]
    for (const item of topics) {
      try {
        await submitPipeline(item, [], aspectRatio, {
          input_payload: {
            generate_video: true,
            content_type: 'video',
            target_duration_seconds: dur.value,
            target_slide_count: dur.slides,
            target_words: dur.words,
            ...(selectedTemplate ? {
              template_id: selectedTemplate.id,
              template_kind: selectedTemplate.template_kind,
              template_name: selectedTemplate.name,
              template_body: selectedTemplate.body_template,
            } : {}),
          },
        })
        ok++
      } catch {
        // keep launching the rest
      }
    }
    setNotice({
      tone: ok === topics.length ? 'success' : 'error',
      text: `Batch finished. ${ok} of ${topics.length} pipelines launched.`,
    })
    if (ok > 0) pushHistory(topics.slice(0, ok))
    setBatchTopics('')
    setTemplateId('')
    setBatchLoading(false)
  }

  const openSeoReport = (slug?: string) => {
    const url = slug ? `/api/outputs/seo-report?slug=${encodeURIComponent(slug)}` : '/api/outputs/seo-report'
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const topicToSlug = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const batchCount = batchTopics.split('\n').map(item => item.trim()).filter(Boolean).length
  const recentLaunches = useMemo(() => {
    const backendHistory = (status?.pipelines ?? [])
      .slice()
      .reverse()
      .slice(0, 5)
      .map(item => ({
        id: item.pipeline_id,
        topic: item.topic,
        aspectRatio: item.aspect_ratio,
        createdAt: new Date(item.created_at).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
        status: item.status,
      }))

    if (backendHistory.length > 0) return backendHistory
    return history
  }, [history, status?.pipelines])

  return (
    <div className="pipeline-layout">
      <div className="card pipeline-main">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 640 }}>
            <div className="section-title">Launch Content Pipeline</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              Start with a topic and let AI handle the research, writing, asset generation, packaging, and publishing flow.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className={mode === 'single' ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setMode('single')}
              style={{ minWidth: 128 }}
            >
              Single Launch
            </button>
            <button
              className={mode === 'batch' ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setMode('batch')}
              style={{ minWidth: 128 }}
            >
              Batch Launch
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.07em', marginBottom: 8 }}>FORMAT</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {ASPECT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className="btn-ghost"
                    onClick={() => setAspectRatio(opt.value)}
                    style={{
                      flex: 1,
                      padding: '10px 6px',
                      display: 'grid',
                      gap: 2,
                      textAlign: 'center',
                      background: aspectRatio === opt.value ? 'rgba(88,166,255,.14)' : 'transparent',
                      borderColor: aspectRatio === opt.value ? 'rgba(88,166,255,.5)' : 'var(--border)',
                      color: aspectRatio === opt.value ? 'var(--accent)' : 'var(--text)',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{opt.label}</span>
                    <span style={{ fontSize: 10, color: aspectRatio === opt.value ? 'var(--accent)' : 'var(--muted)', fontWeight: 400 }}>{opt.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.07em', marginBottom: 8 }}>VIDEO LENGTH</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {DURATION_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className="btn-ghost"
                    onClick={() => setDuration(opt.value)}
                    style={{
                      padding: '8px 14px',
                      fontSize: 12,
                      fontWeight: 700,
                      background: duration === opt.value ? 'rgba(88,166,255,.14)' : 'transparent',
                      borderColor: duration === opt.value ? 'rgba(88,166,255,.5)' : 'var(--border)',
                      color: duration === opt.value ? 'var(--accent)' : 'var(--text)',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                ~{DURATION_OPTIONS.find(d => d.value === duration)?.slides ?? 12} slides · ~{DURATION_OPTIONS.find(d => d.value === duration)?.words.toLocaleString() ?? '1,800'} words
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.07em', marginBottom: 8 }}>BLOG WORD COUNT</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {WORD_COUNT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className="btn-ghost"
                  onClick={() => setWordCount(opt.value)}
                  style={{
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: 700,
                    background: wordCount === opt.value ? 'rgba(88,166,255,.14)' : 'transparent',
                    borderColor: wordCount === opt.value ? 'rgba(88,166,255,.5)' : 'var(--border)',
                    color: wordCount === opt.value ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  {opt.label} <span style={{ opacity: 0.6, fontSize: 11, fontWeight: 400 }}>{opt.desc}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              ~{Math.round(wordCount / 200)} min read
            </div>
          </div>


          {mode === 'single' ? (
            <>
              <div>
                <label>Topic</label>
                <input
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="e.g. AI tools for freelancers in 2026"
                  onKeyDown={e => e.key === 'Enter' && launch()}
                />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  Keep this simple. One strong topic is enough to start.
                </div>
              </div>

              <div>
                <label>Primary Keywords</label>
                <input
                  value={keywords}
                  onChange={e => setKeywords(e.target.value)}
                  placeholder="ai tools, freelance software, automation"
                />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  Leave blank to let AI choose the best angle on its own.
                </div>
              </div>

              <div>
                <label>Secondary Keywords <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>(optional)</span></label>
                <input
                  value={secondaryKeywords}
                  onChange={e => setSecondaryKeywords(e.target.value)}
                  placeholder="productivity tips, time management, remote work"
                />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  Supporting terms and LSI keywords to reinforce topical authority.
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  One click launches the full content and distribution pipeline.
                </div>
                <button className="btn-primary" onClick={launch} disabled={loading || !topic.trim()}>
                  {loading ? <Loader size={14} className="spin" /> : <Rocket size={14} />}
                  {loading ? 'Launching...' : 'Launch Pipeline'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label>Topics</label>
                <textarea
                  value={batchTopics}
                  onChange={e => setBatchTopics(e.target.value)}
                  rows={7}
                  placeholder={'AI productivity tools\nBest AI writing assistants\nHow to automate email marketing'}
                  style={{ resize: 'vertical' }}
                />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  Add one topic per line. Each line launches its own full pipeline.
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {batchCount} topic{batchCount === 1 ? '' : 's'} · {aspectRatio} · {DURATION_OPTIONS.find(d => d.value === duration)?.label ?? '5 min'}
                </div>
                <button className="btn-success" onClick={launchBatch} disabled={batchLoading || batchCount === 0}>
                  {batchLoading ? <Loader size={14} className="spin" /> : <Wand2 size={14} />}
                  {batchLoading ? 'Launching...' : `Launch ${batchCount} Pipelines`}
                </button>
              </div>
            </>
          )}
        </div>

        {notice && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: notice.tone === 'error' ? 'rgba(248,81,73,.08)' : 'rgba(63,185,80,.08)',
              color: notice.tone === 'error' ? '#ffb4b4' : '#9ee6a8',
              fontSize: 13,
            }}
          >
            {notice.text}
          </div>
        )}
      </div>

      <div className="pipeline-side">
        <div className="card">
          <div className="section-title">AI Handles This</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {pipelineSteps.map((step, index) => (
              <div key={step.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'rgba(88,166,255,.18)',
                    color: '#8cb4ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {index + 1}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{step.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{step.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Recent Launches</div>
            <Sparkles size={14} color="#8cb4ff" />
          </div>
          {recentLaunches.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Launch a pipeline and the latest runs will show here.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {recentLaunches.map((item, index) => (
                <div
                  key={`${item.id}-${index}`}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--surface2)',
                    display: 'grid',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{item.topic}</div>
                    <span className={`badge ${item.status === 'completed' ? 'badge-green' : item.status === 'failed' ? 'badge-red' : item.status === 'blocked' ? 'badge-yellow' : 'badge-blue'}`}>
                      <CheckCircle2 size={12} />
                      {item.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {item.aspectRatio} · {item.createdAt}
                    </div>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => openSeoReport(topicToSlug(item.topic))}
                      title="Open SEO report"
                      style={{ padding: '3px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <FileText size={11} />
                      SEO
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div className="section-title" style={{ marginBottom: 2 }}>SEO Reports</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Full keyword, meta, and link data from each pipeline run.</div>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => openSeoReport()}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <FileText size={14} />
            View Latest SEO Report
          </button>
        </div>
      </div>
    </div>
  )
}
