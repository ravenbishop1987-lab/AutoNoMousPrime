import { useEffect, useRef, useState } from 'react'
import {
  BarChart2,
  BookOpen,
  BookText,
  ChevronRight,
  FileText,
  Headphones,
  Loader,
  Megaphone,
  Mic,
  Play,
  Share2,
  ShoppingCart,
  Target,
  TrendingUp,
  Video,
  Zap,
} from 'lucide-react'
import { submitTask, submitPipeline, submitEbook, getStatus, getActiveWorkspaceId, getLatestOutput, type LatestOutput } from '../api'

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = 'idle' | 'running' | 'done' | 'error'
type VideoFormat = 'youtube' | 'tiktok' | 'instagram'
type VideoLength = '1m' | '3m' | '5m' | '10m' | '15m'

interface StepState {
  status: StepStatus
  message: string
}

interface PipelineConfig {
  title: string
  primaryKeyword: string
  secondaryKeyword: string
  wordCount: string
  videoFormats: VideoFormat[]
  videoLength: VideoLength
  makeBlog: boolean
  makeVideo: boolean
  makeEbook: boolean
  makeAudioBook: boolean
  makePodcast: boolean
  podcastDuration: number
  podcastSpeakers: Array<{ name: string; voice: string; role: string }>
  makeFunnel: boolean
  makeSalesPage: boolean
  makeAds: boolean
  makeAnalytics: boolean
  makeProject: boolean
  targetAudience: string
  desiredOutcome: string
  primaryPainPoint: string
  offerType: string
  trafficSource: string
  productOffer: string
  stripeUrl: string
  pricePoint: string
  tone: string
  brandName: string
  contentGoal: string
  accentColor: string
  buttonColor: string
  bgColor: string
}

interface PipelineStep {
  id: string
  label: string
  sublabel: string
  description: string
  icon: React.ComponentType<{ size?: number; color?: string }>
  color: string
  glowColor: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VIDEO_LENGTH_SECONDS: Record<VideoLength, number> = {
  '1m': 60, '3m': 180, '5m': 300, '10m': 600, '15m': 900,
}
const VIDEO_LENGTH_SLIDES: Record<VideoLength, number> = {
  '1m': 4, '3m': 8, '5m': 12, '10m': 20, '15m': 28,
}
const FORMAT_RATIO: Record<VideoFormat, string> = {
  youtube: '16:9', tiktok: '9:16', instagram: '1:1',
}

const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: 'blog', label: 'Blog Post', sublabel: 'Write + Publish',
    description: 'Generates a full SEO article then publishes it to WordPress via the pipeline chain.',
    icon: FileText, color: '#58a6ff', glowColor: 'rgba(88,166,255,0.18)',
  },
  {
    id: 'video', label: 'Video', sublabel: 'Script → Scenes → Export',
    description: 'Produces a fully scripted and assembled video in your chosen format and duration.',
    icon: Video, color: '#a371f7', glowColor: 'rgba(163,113,247,0.18)',
  },
  {
    id: 'ebook', label: 'eBook', sublabel: 'Long-Form Asset',
    description: 'Expands the topic into a downloadable eBook with chapters and cover design.',
    icon: BookOpen, color: '#3fb950', glowColor: 'rgba(63,185,80,0.18)',
  },
  {
    id: 'audiobook', label: 'Audio Book', sublabel: 'TTS Narration',
    description: 'Converts content into a narrated audio file using the configured voice engine.',
    icon: Headphones, color: '#f78166', glowColor: 'rgba(247,129,102,0.18)',
  },
  {
    id: 'podcast', label: 'Podcast', sublabel: 'Multi-Speaker AI',
    description: 'Generates a scripted multi-speaker podcast episode on the topic.',
    icon: Mic, color: '#79c0ff', glowColor: 'rgba(121,192,255,0.18)',
  },
  {
    id: 'social', label: 'Social Posts', sublabel: 'Multi-Platform Copy',
    description: 'Generates platform-tailored captions, hooks, and threads for every connected channel.',
    icon: Share2, color: '#ffa657', glowColor: 'rgba(255,166,87,0.18)',
  },
  {
    id: 'sales-page', label: 'Sales Page', sublabel: 'Direct Sales + Stripe',
    description: 'Generates a direct-sales page with Stripe buy button, testimonials, FAQ, guarantee, and post-purchase thank-you page.',
    icon: ShoppingCart, color: '#3fb950', glowColor: 'rgba(63,185,80,0.18)',
  },
  {
    id: 'funnel', label: 'Funnel', sublabel: 'Landing Page + Emails',
    description: 'Generates a complete lead-gen funnel: opt-in landing page, thank-you page, and 6-email sequence.',
    icon: Target, color: '#f78166', glowColor: 'rgba(247,129,102,0.18)',
  },
  {
    id: 'advertise', label: 'Advertise', sublabel: 'Publish & Distribute',
    description: 'Pushes all completed assets to every connected social media platform.',
    icon: Megaphone, color: '#e3b341', glowColor: 'rgba(227,179,65,0.18)',
  },
  {
    id: 'ads', label: 'Ad Copy', sublabel: 'Facebook · TikTok · Google',
    description: 'Writes ad copy for Facebook/Instagram, TikTok, Twitter/X, and Google Ads with multiple variations.',
    icon: TrendingUp, color: '#a371f7', glowColor: 'rgba(163,113,247,0.18)',
  },
  {
    id: 'analytics', label: 'Analytics', sublabel: 'GA4 + A/B Tests + KPIs',
    description: 'Generates GA4 tracking code, 5 A/B test plans, and a KPI dashboard guide.',
    icon: BarChart2, color: '#3fb950', glowColor: 'rgba(63,185,80,0.18)',
  },
  {
    id: 'project', label: 'Project Agent', sublabel: 'Offers · Roadmap · Tasks',
    description: 'Calls the product agent to ideate offers, break work into projects, and propose a high-level execution roadmap.',
    icon: BookText, color: '#58a6ff', glowColor: 'rgba(88,166,255,0.18)',
  },
]

// ─── Task tracker entry ───────────────────────────────────────────────────────
// Two-phase tracking for submitTask steps:
//   'wait_start' = task submitted, waiting for it to appear in active_tasks
//   'wait_end'   = task appeared in active_tasks, waiting for it to finish
// Pipeline steps use 'pipeline' phase and are resolved via ap:job-update topic match.
interface TrackerEntry {
  stepId: string
  phase: 'pipeline' | 'wait_start' | 'wait_end'
  // how many status polls we've been in wait_start without seeing it
  startMisses: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: StepStatus) {
  const map: Record<StepStatus, { label: string; color: string; bg: string }> = {
    idle:    { label: 'Ready',   color: '#8b949e', bg: 'rgba(139,148,158,0.1)' },
    running: { label: 'Running', color: '#58a6ff', bg: 'rgba(88,166,255,0.15)' },
    done:    { label: 'Done',    color: '#3fb950', bg: 'rgba(63,185,80,0.15)'  },
    error:   { label: 'Error',   color: '#f78166', bg: 'rgba(247,129,102,0.15)'},
  }
  const s = map[status]
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
      color: s.color, background: s.bg, border: `1px solid ${s.color}30`,
      borderRadius: 6, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      {status === 'running' && <Loader size={9} style={{ animation: 'spin 1s linear infinite' }} />}
      {s.label}
    </span>
  )
}

function ToggleChip({
  label, active, color, onClick,
}: { label: string; active: boolean; color?: string; onClick: () => void }) {
  const c = color || 'var(--accent)'
  return (
    <button type="button" onClick={onClick} style={{
      padding: '6px 14px', borderRadius: 8,
      border: `1px solid ${active ? c : 'var(--border)'}`,
      background: active ? `${c}22` : 'transparent',
      color: active ? c : 'var(--muted)',
      fontSize: 12, fontWeight: 700, cursor: 'pointer',
      transition: 'all .15s', letterSpacing: '.02em',
    }}>
      {label}
    </button>
  )
}

function StepCard({
  step, index, state, isLast, onRun, disabled,
}: {
  step: PipelineStep; index: number; state: StepState
  isLast: boolean; onRun: () => void; disabled: boolean
}) {
  const Icon = step.icon
  const isRunning = state.status === 'running'
  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <div style={{
        flex: 1,
        background: state.status === 'done' ? `linear-gradient(135deg, ${step.glowColor}, var(--surface))` : 'var(--surface)',
        border: `1px solid ${state.status !== 'idle' ? step.color + '55' : 'var(--border)'}`,
        borderRadius: 14, padding: '20px 22px',
        display: 'flex', flexDirection: 'column', gap: 12,
        transition: 'border-color .25s, background .25s',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, width: 3, height: '100%',
          background: state.status === 'idle' ? 'var(--border)' : step.color,
          borderRadius: '14px 0 0 14px', transition: 'background .25s',
        }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: step.glowColor, border: `1px solid ${step.color}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon size={18} color={step.color} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: step.color, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                  Step {index + 1}
                </span>
                {statusBadge(state.status)}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{step.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{step.sublabel}</div>
            </div>
          </div>
          <button onClick={onRun} disabled={isRunning || disabled} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
            borderRadius: 8, border: `1px solid ${isRunning || disabled ? 'var(--border)' : step.color + '55'}`,
            background: isRunning || disabled ? 'transparent' : step.glowColor,
            color: isRunning || disabled ? 'var(--muted)' : step.color,
            fontSize: 12, fontWeight: 700, cursor: isRunning || disabled ? 'not-allowed' : 'pointer',
            flexShrink: 0, transition: 'all .15s',
          }}>
            {isRunning ? <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={11} />}
            {isRunning ? 'Running...' : 'Run Step'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>{step.description}</p>
        {state.message && (
          <div style={{
            fontSize: 11,
            color: state.status === 'error' ? '#f78166' : state.status === 'done' ? '#3fb950' : '#58a6ff',
            background: state.status === 'done' ? 'rgba(63,185,80,0.08)' : state.status === 'error' ? 'rgba(247,129,102,0.08)' : 'rgba(88,166,255,0.08)',
            borderRadius: 6, padding: '6px 10px',
          }}>
            {state.message}
          </div>
        )}
      </div>
      {!isLast && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: 'var(--border)', flexShrink: 0 }}>
          <ChevronRight size={18} />
        </div>
      )}
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

const initSteps = (): Record<string, StepState> =>
  Object.fromEntries(PIPELINE_STEPS.map(s => [s.id, { status: 'idle' as StepStatus, message: '' }]))

export default function MegaPipelinePanel() {
  const [config, setConfig] = useState<PipelineConfig>({
    title: '', primaryKeyword: '', secondaryKeyword: '',
    wordCount: '1500', videoFormats: ['youtube'], videoLength: '5m',
    makeBlog: true, makeVideo: true, makeEbook: true, makeAudioBook: true,
    makePodcast: false,
    podcastDuration: 10,
    podcastSpeakers: [
      { name: 'Host', voice: 'nova', role: 'host' },
      { name: 'Guest', voice: 'echo', role: 'guest' },
    ],
    makeFunnel: false,
    makeSalesPage: false,
    makeAds: false,
    makeAnalytics: false,
    makeProject: true,
    targetAudience: '',
    desiredOutcome: '',
    primaryPainPoint: '',
    offerType: 'lead_magnet',
    trafficSource: 'organic_social',
    productOffer: '',
    stripeUrl: '',
    pricePoint: '',
    tone: 'professional',
    brandName: '',
    contentGoal: 'inform',
    accentColor: '#58a6ff',
    buttonColor: '#238636',
    bgColor: '#0d1117',
  })
  const [steps, setSteps] = useState<Record<string, StepState>>(initSteps)
  const [runningAll, setRunningAll] = useState(false)
  const [latest, setLatest] = useState<Record<string, LatestOutput>>({})
  const [latestLoading, setLatestLoading] = useState(false)
  const [latestError, setLatestError] = useState('')

  // Map of trackingKey → TrackerEntry
  // Keys: task_id for submitTask steps, `pipeline:{stepId}:{topic}` for submitPipeline steps
  const tracker = useRef<Map<string, TrackerEntry>>(new Map())

  const setStep = (id: string, partial: Partial<StepState>) =>
    setSteps(prev => ({ ...prev, [id]: { ...prev[id], ...partial } }))

  const setField = <K extends keyof PipelineConfig>(key: K, value: PipelineConfig[K]) =>
    setConfig(prev => ({ ...prev, [key]: value }))

  const toggleVideoFormat = (fmt: VideoFormat) =>
    setConfig(prev => ({
      ...prev,
      videoFormats: prev.videoFormats.includes(fmt)
        ? prev.videoFormats.filter(f => f !== fmt)
        : [...prev.videoFormats, fmt],
    }))

  async function refreshLatest() {
    if (!config.title.trim()) return
    setLatestLoading(true)
    setLatestError('')
    try {
      const topic = config.title.trim()
      const types = [
        'blog',
        'video',
        'ebook',
        'audio',
        'funnel',
        'sales_page',
        'ads',
      ]
      const results = await Promise.all(
        types.map(async t => {
          try {
            const data = await getLatestOutput(t, topic)
            return [t, data] as const
          } catch {
            return [t, { found: false } as LatestOutput] as const
          }
        }),
      )
      const map: Record<string, LatestOutput> = {}
      for (const [t, data] of results) map[t] = data
      setLatest(map)
    } catch (e) {
      setLatestError(e instanceof Error ? e.message : 'Could not load latest outputs')
    } finally {
      setLatestLoading(false)
    }
  }

  // ── Pipeline completion via WebSocket ─────────────────────────────────────

  useEffect(() => {
    // ap:job-update fires when a pipeline's status changes
    // { type, pipeline_id, topic, status }
    const onJobUpdate = (e: Event) => {
      const msg = (e as CustomEvent).detail as { topic?: string; status?: string }
      if (!msg?.status || !msg?.topic) return
      const done = msg.status === 'completed'
      const failed = msg.status === 'failed' || msg.status === 'error'
      if (!done && !failed) return

      for (const [key, entry] of tracker.current.entries()) {
        if (entry.phase !== 'pipeline') continue
        // key format: `pipeline:{stepId}:{topic}`
        if (key === `pipeline:${entry.stepId}:${msg.topic}`) {
          setStep(entry.stepId, {
            status: done ? 'done' : 'error',
            message: done ? 'Completed successfully.' : `Pipeline failed: ${msg.status}`,
          })
          tracker.current.delete(key)
        }
      }
    }

    // ap:status-update fires every 5 s with the full /api/status payload
    // { active_tasks: [{task_id, type, ...}], pipelines: [...], ... }
    const onStatusUpdate = (e: Event) => {
      const payload = (e as CustomEvent).detail as {
        active_tasks?: Array<{ task_id: string }>
        pipelines?: Array<{ topic: string; status: string }>
      }
      const activeIds = new Set((payload?.active_tasks ?? []).map(t => t.task_id))

      for (const [key, entry] of tracker.current.entries()) {
        if (entry.phase === 'pipeline') continue

        if (entry.phase === 'wait_start') {
          if (activeIds.has(key)) {
            // Task is now running — move to wait_end phase
            entry.phase = 'wait_end'
            entry.startMisses = 0
            setStep(entry.stepId, { message: 'Running...' })
          } else {
            entry.startMisses++
            // After 60 missed polls (~5 min) assume the task silently completed
            if (entry.startMisses >= 60) {
              setStep(entry.stepId, { status: 'done', message: 'Completed (queued).' })
              tracker.current.delete(key)
            }
          }
        } else if (entry.phase === 'wait_end') {
          if (!activeIds.has(key)) {
            // Task left active_tasks → finished
            setStep(entry.stepId, { status: 'done', message: 'Completed successfully.' })
            tracker.current.delete(key)
          }
        }
      }
    }

    window.addEventListener('ap:job-update', onJobUpdate)
    window.addEventListener('ap:status-update', onStatusUpdate)
    return () => {
      window.removeEventListener('ap:job-update', onJobUpdate)
      window.removeEventListener('ap:status-update', onStatusUpdate)
    }
  }, [])

  // ── Submit a single step ──────────────────────────────────────────────────

  const runStep = async (stepId: string) => {
    if (!config.title.trim()) return
    setStep(stepId, { status: 'running', message: 'Submitting...' })

    const topic = config.title.trim()
    const keywords = [config.primaryKeyword, config.secondaryKeyword].filter(Boolean)
    const wordCount = parseInt(config.wordCount, 10) || 1500
    const durSec = VIDEO_LENGTH_SECONDS[config.videoLength]
    const slides = VIDEO_LENGTH_SLIDES[config.videoLength]
    const aspectRatio = config.videoFormats.length > 0 ? FORMAT_RATIO[config.videoFormats[0]] : '16:9'
    const sharedContext = {
      target_audience:   config.targetAudience   || undefined,
      desired_outcome:   config.desiredOutcome   || undefined,
      primary_pain_point: config.primaryPainPoint || undefined,
      offer_type:        config.offerType,
      traffic_source:    config.trafficSource,
      product_offer:     config.productOffer     || undefined,
      stripe_url:        config.stripeUrl        || undefined,
      price_point:       config.pricePoint       || undefined,
      tone:              config.tone,
      brand_name:        config.brandName        || undefined,
      content_goal:      config.contentGoal,
      accent_color:      config.accentColor,
      button_color:      config.buttonColor,
      bg_color:          config.bgColor,
    }

    try {
      switch (stepId) {

        case 'blog': {
          // submitPipeline with blog mode: blog_post → image_gen → post_content (WordPress)
          const r = await submitPipeline(topic, keywords, aspectRatio, {
            input_payload: {
              generate_video: false,
              content_type: 'blog',
              word_count: wordCount,
              secondary_keywords: keywords.slice(1),
              ...sharedContext,
            },
          })
          const count = (r as { count?: number }).count ?? 0
          const pKey = `pipeline:blog:${topic}`
          tracker.current.set(pKey, { stepId: 'blog', phase: 'pipeline', startMisses: 0 })
          setStep('blog', { message: `${count} task${count === 1 ? '' : 's'} queued — writing & publishing...` })
          break
        }

        case 'video': {
          const formats = config.videoFormats.length > 0 ? config.videoFormats : ['youtube']
          let totalCount = 0
          for (const fmt of formats) {
            const ratio = FORMAT_RATIO[fmt as VideoFormat]
            const r = await submitPipeline(topic, keywords, ratio, {
              input_payload: {
                generate_video: true,
                publish_blog: fmt === formats[0], // only publish blog once
                content_type: 'video',
                target_duration_seconds: durSec,
                target_slide_count: slides,
                target_words: Math.round(durSec / 60 * 150),
                word_count: wordCount,
                aspect_ratio: ratio,
                video_format: fmt,
                video_length_minutes: Math.round(durSec / 60),
              },
            })
            totalCount += (r as { count?: number }).count ?? 0
          }
          const pKey = `pipeline:video:${topic}`
          tracker.current.set(pKey, { stepId: 'video', phase: 'pipeline', startMisses: 0 })
          setStep('video', { message: `${totalCount} tasks queued — assembling ${formats.length} video${formats.length > 1 ? 's' : ''}...` })
          break
        }

        case 'ebook': {
          const r = await submitEbook({
            topic, style: 'informative', theme: 'default',
            chapter_count: 5, words_per_chapter: Math.round(wordCount / 5),
            keywords,
            cover_prompt: topic,
            author_name: config.brandName || '',
            cta_text: config.productOffer ? `Get ${config.productOffer}` : 'Get the Full Program',
            cta_url: config.stripeUrl || '',
            cta_button: config.pricePoint ? `Yes! I Want This — ${config.pricePoint}` : 'Get Instant Access →',
            chapter_images: false,
            chapters: [],
          })
          const taskId = (r as { task_id?: string }).task_id
          if (taskId) {
            tracker.current.set(taskId, { stepId: 'ebook', phase: 'wait_start', startMisses: 0 })
            setStep('ebook', { message: `Queued (task ${taskId.slice(0, 8)}…) — waiting for agent...` })
          } else {
            setStep('ebook', { status: 'error', message: 'No task_id returned from server.' })
          }
          break
        }

        case 'audiobook': {
          const r = await submitTask('tts', {
            topic,
            keywords,
            // no text — voice agent will read the blog file from the pipeline
          })
          const taskId = (r as { task_id?: string }).task_id
          if (taskId) {
            tracker.current.set(taskId, { stepId: 'audiobook', phase: 'wait_start', startMisses: 0 })
            setStep('audiobook', { message: `Queued (task ${taskId.slice(0, 8)}…) — waiting for agent...` })
          } else {
            setStep('audiobook', { status: 'error', message: 'No task_id returned from server.' })
          }
          break
        }

        case 'social': {
          const r = await submitTask('social_post', { topic, keywords, aspect_ratio: aspectRatio })
          const taskId = (r as { task_id?: string }).task_id
          if (taskId) {
            tracker.current.set(taskId, { stepId: 'social', phase: 'wait_start', startMisses: 0 })
            setStep('social', { message: `Queued (task ${taskId.slice(0, 8)}…) — waiting for agent...` })
          } else {
            setStep('social', { status: 'error', message: 'No task_id returned from server.' })
          }
          break
        }

        case 'podcast': {
          const r = await submitTask('podcast_gen', {
            topic,
            description: keywords.join(', '),
            duration_minutes: config.podcastDuration,
            speakers: config.podcastSpeakers,
          })
          const taskId = (r as { task_id?: string }).task_id
          if (taskId) {
            tracker.current.set(taskId, { stepId: 'podcast', phase: 'wait_start', startMisses: 0 })
            setStep('podcast', { message: `Queued (task ${taskId.slice(0, 8)}…) — generating script & audio...` })
          } else {
            setStep('podcast', { status: 'error', message: 'No task_id returned from server.' })
          }
          break
        }

        case 'advertise': {
          const r = await submitTask('video_publish', {
            topic, keywords,
            publish_targets: ['youtube', 'tiktok', 'instagram', 'facebook', 'twitter'],
          })
          const taskId = (r as { task_id?: string }).task_id
          if (taskId) {
            tracker.current.set(taskId, { stepId: 'advertise', phase: 'wait_start', startMisses: 0 })
            setStep('advertise', { message: `Queued (task ${taskId.slice(0, 8)}…) — waiting for agent...` })
          } else {
            setStep('advertise', { status: 'error', message: 'No task_id returned from server.' })
          }
          break
        }

        case 'funnel': {
          const r = await submitTask('funnel_gen', { topic, keywords, workspace_id: getActiveWorkspaceId(), ...sharedContext })
          const taskId = (r as { task_id?: string }).task_id
          if (taskId) {
            tracker.current.set(taskId, { stepId: 'funnel', phase: 'wait_start', startMisses: 0 })
            setStep('funnel', { message: `Queued (task ${taskId.slice(0, 8)}…) — building landing page & emails...` })
          } else {
            setStep('funnel', { status: 'error', message: 'No task_id returned from server.' })
          }
          break
        }

        case 'sales-page': {
          const r = await submitTask('sales_page_gen', { topic, keywords, workspace_id: getActiveWorkspaceId(), ...sharedContext })
          const taskId = (r as { task_id?: string }).task_id
          if (taskId) {
            tracker.current.set(taskId, { stepId: 'sales-page', phase: 'wait_start', startMisses: 0 })
            setStep('sales-page', { message: `Queued (task ${taskId.slice(0, 8)}…) — building sales page...` })
          } else {
            setStep('sales-page', { status: 'error', message: 'No task_id returned from server.' })
          }
          break
        }

        case 'ads': {
          const r = await submitTask('ads_gen', { topic, keywords, ...sharedContext })
          const taskId = (r as { task_id?: string }).task_id
          if (taskId) {
            tracker.current.set(taskId, { stepId: 'ads', phase: 'wait_start', startMisses: 0 })
            setStep('ads', { message: `Queued (task ${taskId.slice(0, 8)}…) — writing ad copy for all platforms...` })
          } else {
            setStep('ads', { status: 'error', message: 'No task_id returned from server.' })
          }
          break
        }

        case 'analytics': {
          const r = await submitTask('analytics_gen', { topic, keywords, ...sharedContext })
          const taskId = (r as { task_id?: string }).task_id
          if (taskId) {
            tracker.current.set(taskId, { stepId: 'analytics', phase: 'wait_start', startMisses: 0 })
            setStep('analytics', { message: `Queued (task ${taskId.slice(0, 8)}…) — generating GA4 setup & A/B tests...` })
          } else {
            setStep('analytics', { status: 'error', message: 'No task_id returned from server.' })
          }
          break
        }

        case 'project': {
          const r = await submitTask('product_ideate', {
            topic,
            keywords,
            workspace_id: getActiveWorkspaceId(),
            ...sharedContext,
          })
          const taskId = (r as { task_id?: string }).task_id
          if (taskId) {
            tracker.current.set(taskId, { stepId: 'project', phase: 'wait_start', startMisses: 0 })
            setStep('project', { message: `Queued (task ${taskId.slice(0, 8)}…) — generating offers & project roadmap...` })
          } else {
            setStep('project', { status: 'error', message: 'No task_id returned from server.' })
          }
          break
        }
      }
    } catch (err: unknown) {
      setStep(stepId, { status: 'error', message: err instanceof Error ? err.message : 'Submission failed' })
    }
  }

  // ── Wait for a step to leave 'running' (used by Run All) ─────────────────

  const waitForStep = (stepId: string): Promise<void> =>
    new Promise(resolve => {
      const iv = setInterval(() => {
        setSteps(prev => {
          const s = prev[stepId]?.status
          if (s === 'done' || s === 'error') {
            clearInterval(iv)
            resolve()
          }
          return prev
        })
      }, 1500)
    })

  // ── Run All sequentially ──────────────────────────────────────────────────

  const runAll = async () => {
    if (runningAll || !config.title.trim()) return
    setRunningAll(true)
    setSteps(initSteps())
    tracker.current.clear()
    for (const step of PIPELINE_STEPS) {
      if (step.id === 'blog'      && !config.makeBlog)      continue
      if (step.id === 'video'     && !config.makeVideo)     continue
      if (step.id === 'ebook'     && !config.makeEbook)     continue
      if (step.id === 'audiobook' && !config.makeAudioBook) continue
      if (step.id === 'podcast'   && !config.makePodcast)   continue
      if (step.id === 'funnel'      && !config.makeFunnel)    continue
      if (step.id === 'sales-page'  && !config.makeSalesPage) continue
      if (step.id === 'ads'       && !config.makeAds)       continue
      if (step.id === 'analytics' && !config.makeAnalytics) continue
      if (step.id === 'project'   && !config.makeProject)   continue
      await runStep(step.id)
      await waitForStep(step.id)
    }
    setRunningAll(false)
  }

  // ─────────────────────────────────────────────────────────────────────────

  const allDone = PIPELINE_STEPS.every(s => steps[s.id]?.status === 'done')
  const anyRunning = PIPELINE_STEPS.some(s => steps[s.id]?.status === 'running') || runningAll
  const canRun = config.title.trim().length > 0

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '9px 12px',
    color: 'var(--text)', fontSize: 13, width: '100%', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--muted)',
    letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 6, display: 'block',
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(88,166,255,0.15)', border: '1px solid rgba(88,166,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Zap size={18} color="#58a6ff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>Mega Pipeline</h2>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
              Blog → Video → eBook → Audio → Podcast → Social → Funnel → Ads → Analytics
            </p>
          </div>
        </div>
        <button onClick={runAll} disabled={anyRunning || !canRun} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px',
          borderRadius: 10, border: 'none',
          background: anyRunning || !canRun ? 'var(--surface2)' : 'linear-gradient(135deg, #58a6ff, #a371f7)',
          color: anyRunning || !canRun ? 'var(--muted)' : '#fff',
          fontSize: 13, fontWeight: 800, cursor: anyRunning || !canRun ? 'not-allowed' : 'pointer',
          letterSpacing: '.03em', transition: 'all .2s',
        }}>
          {anyRunning
            ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
            : <Zap size={14} />}
          {anyRunning ? 'Running Pipeline...' : allDone ? 'Run Again' : 'Run Full Pipeline'}
        </button>
      </div>

      {/* Config */}
      <div className="card" style={{ display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookText size={15} color="var(--accent)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Content Configuration</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <div>
            <label style={labelStyle}>Content Title *</label>
            <input style={inputStyle} placeholder="e.g. How to Build a SaaS in 30 Days"
              value={config.title} onChange={e => setField('title', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Primary Keyword</label>
            <input style={inputStyle} placeholder="e.g. build saas"
              value={config.primaryKeyword} onChange={e => setField('primaryKeyword', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Secondary Keyword</label>
            <input style={inputStyle} placeholder="e.g. saas marketing"
              value={config.secondaryKeyword} onChange={e => setField('secondaryKeyword', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, alignItems: 'start' }}>
          <div>
            <label style={labelStyle}>Word Count</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }}
              value={config.wordCount} onChange={e => setField('wordCount', e.target.value)}>
              {['500', '800', '1000', '1500', '2000', '2500', '3000', '5000'].map(w => (
                <option key={w} value={w}>{w} words</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>What You're Making</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ToggleChip label="Blog Post" active={config.makeBlog} color="#58a6ff" onClick={() => setField('makeBlog', !config.makeBlog)} />
              <ToggleChip label="Video" active={config.makeVideo} color="#a371f7" onClick={() => setField('makeVideo', !config.makeVideo)} />
              <ToggleChip label="eBook" active={config.makeEbook} color="#3fb950" onClick={() => setField('makeEbook', !config.makeEbook)} />
              <ToggleChip label="Audio Book" active={config.makeAudioBook} color="#f78166" onClick={() => setField('makeAudioBook', !config.makeAudioBook)} />
              <ToggleChip label="Podcast" active={config.makePodcast} color="#79c0ff" onClick={() => setField('makePodcast', !config.makePodcast)} />
              <ToggleChip label="Funnel" active={config.makeFunnel} color="#f78166" onClick={() => setField('makeFunnel', !config.makeFunnel)} />
              <ToggleChip label="Sales Page" active={config.makeSalesPage} color="#3fb950" onClick={() => setField('makeSalesPage', !config.makeSalesPage)} />
              <ToggleChip label="Ad Copy" active={config.makeAds} color="#a371f7" onClick={() => setField('makeAds', !config.makeAds)} />
              <ToggleChip label="Analytics" active={config.makeAnalytics} color="#3fb950" onClick={() => setField('makeAnalytics', !config.makeAnalytics)} />
              <ToggleChip label="Project Agent" active={config.makeProject} color="#58a6ff" onClick={() => setField('makeProject', !config.makeProject)} />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div>
            <label style={labelStyle}>Video Format</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ToggleChip label="YouTube 16:9" active={config.videoFormats.includes('youtube')} color="#f44336" onClick={() => toggleVideoFormat('youtube')} />
              <ToggleChip label="TikTok 9:16" active={config.videoFormats.includes('tiktok')} color="#ee1d52" onClick={() => toggleVideoFormat('tiktok')} />
              <ToggleChip label="Instagram 1:1" active={config.videoFormats.includes('instagram')} color="#c13584" onClick={() => toggleVideoFormat('instagram')} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Video Length</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['1m', '3m', '5m', '10m', '15m'] as VideoLength[]).map(len => (
                <ToggleChip key={len} label={len} active={config.videoLength === len} color="#a371f7" onClick={() => setField('videoLength', len)} />
              ))}
            </div>
          </div>
        </div>

        {/* Audience + Strategy fields */}
        <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Target Audience</label>
              <input style={inputStyle} placeholder="e.g. busy entrepreneurs aged 30-45"
                value={config.targetAudience} onChange={e => setField('targetAudience', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Product / Offer</label>
              <input style={inputStyle} placeholder="e.g. Free focus guide / $97 course"
                value={config.productOffer} onChange={e => setField('productOffer', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Brand / Author Name</label>
              <input style={inputStyle} placeholder="e.g. Kevin at FocusHQ"
                value={config.brandName} onChange={e => setField('brandName', e.target.value)} />
            </div>
          </div>

          {/* Offer Intelligence row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Desired Outcome</label>
              <input style={inputStyle}
                placeholder="e.g. Wake up without anxiety, double revenue in 90 days"
                value={config.desiredOutcome}
                onChange={e => setField('desiredOutcome', e.target.value)} />
              <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                The transformation — makes the offer feel tangible
              </span>
            </div>
            <div>
              <label style={labelStyle}>Primary Pain Point</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }}
                value={config.primaryPainPoint}
                onChange={e => setField('primaryPainPoint', e.target.value)}>
                <option value="">— Select Pain Point —</option>
                <option value="overwhelm">Overwhelm / Too Much To Do</option>
                <option value="time">Not Enough Time</option>
                <option value="money">Not Enough Money / Revenue</option>
                <option value="focus">Lack of Focus / Distraction</option>
                <option value="confidence">Lack of Confidence / Imposter Syndrome</option>
                <option value="leads">Not Enough Leads / Traffic</option>
                <option value="conversion">Low Conversions / Sales</option>
                <option value="consistency">Inconsistency / No System</option>
                <option value="tech">Tech Confusion / Tools</option>
                <option value="health">Health / Energy / Sleep</option>
                <option value="relationships">Relationships / Communication</option>
                <option value="clarity">No Clarity / Don't Know Where To Start</option>
              </select>
              <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                Drives headlines, hooks, emails & ads
              </span>
            </div>
            <div>
              <label style={labelStyle}>Offer Type</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }}
                value={config.offerType}
                onChange={e => setField('offerType', e.target.value)}>
                <option value="lead_magnet">Lead Magnet (Free)</option>
                <option value="low_ticket">Low Ticket ($7–$49)</option>
                <option value="core_offer">Core Offer ($97–$497)</option>
                <option value="high_ticket">High Ticket ($997+)</option>
                <option value="subscription">Subscription / Membership</option>
              </select>
              <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                Sets funnel depth & email strategy
              </span>
            </div>
          </div>

          {/* Traffic Source row */}
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 14, alignItems: 'start' }}>
            <div>
              <label style={labelStyle}>Traffic Source</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }}
                value={config.trafficSource}
                onChange={e => setField('trafficSource', e.target.value)}>
                <option value="organic_social">Organic Social</option>
                <option value="paid_ads">Paid Ads</option>
                <option value="seo">SEO / Search</option>
                <option value="email">Email List</option>
                <option value="youtube">YouTube</option>
                <option value="podcast">Podcast</option>
                <option value="referral">Referral / Affiliates</option>
                <option value="mixed">Mixed / Multiple</option>
              </select>
              <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                Shapes CTAs, hooks & ad platform targeting
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Stripe Checkout URL</label>
              <input style={inputStyle} placeholder="https://buy.stripe.com/..."
                value={config.stripeUrl} onChange={e => setField('stripeUrl', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Price Point</label>
              <input style={inputStyle} placeholder="e.g. Free / $47 / $497"
                value={config.pricePoint} onChange={e => setField('pricePoint', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Tone</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }}
                value={config.tone} onChange={e => setField('tone', e.target.value)}>
                <option value="professional">Professional</option>
                <option value="casual">Casual & Friendly</option>
                <option value="aggressive">Aggressive / Direct</option>
                <option value="story">Story-Based</option>
                <option value="educational">Educational</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Content Goal</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }}
                value={config.contentGoal} onChange={e => setField('contentGoal', e.target.value)}>
                <option value="inform">Inform / Educate</option>
                <option value="sell">Sell / Convert</option>
                <option value="authority">Build Authority</option>
                <option value="traffic">Drive Traffic</option>
                <option value="leads">Generate Leads</option>
              </select>
            </div>
          </div>
          {/* Color pickers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, paddingTop: 4 }}>
            {([
              { key: 'bgColor',      label: 'Background Color',  field: 'bg_color' },
              { key: 'accentColor',  label: 'Accent / Heading Color', field: 'accent_color' },
              { key: 'buttonColor',  label: 'Button Color',       field: 'button_color' },
            ] as { key: keyof PipelineConfig; label: string; field: string }[]).map(({ key, label }) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={config[key] as string}
                    onChange={e => setField(key, e.target.value)}
                    style={{ width: 36, height: 36, padding: 2, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <input
                    type="text"
                    value={config[key] as string}
                    onChange={e => setField(key, e.target.value)}
                    style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
                    maxLength={7}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {config.makePodcast && (
          <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mic size={13} color="#79c0ff" />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#79c0ff', letterSpacing: '.05em', textTransform: 'uppercase' }}>Podcast Settings</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Duration</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }}
                  value={config.podcastDuration}
                  onChange={e => setField('podcastDuration', parseInt(e.target.value))}>
                  {[5, 10, 15, 20, 30].map(m => <option key={m} value={m}>{m} min</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Speakers</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {config.podcastSpeakers.map((sp, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px' }}>
                      <input
                        style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12, width: 70, outline: 'none' }}
                        value={sp.name}
                        onChange={e => {
                          const s = [...config.podcastSpeakers]; s[i] = { ...s[i], name: e.target.value }
                          setField('podcastSpeakers', s)
                        }}
                      />
                      <select
                        style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 11, cursor: 'pointer', outline: 'none' }}
                        value={sp.voice}
                        onChange={e => {
                          const s = [...config.podcastSpeakers]; s[i] = { ...s[i], voice: e.target.value }
                          setField('podcastSpeakers', s)
                        }}>
                        {['nova', 'echo', 'alloy', 'fable', 'onyx', 'shimmer'].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                      {config.podcastSpeakers.length > 2 && (
                        <button onClick={() => setField('podcastSpeakers', config.podcastSpeakers.filter((_, j) => j !== i))}
                          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                      )}
                    </div>
                  ))}
                  {config.podcastSpeakers.length < 4 && (
                    <button onClick={() => setField('podcastSpeakers', [...config.podcastSpeakers, { name: `Speaker ${config.podcastSpeakers.length + 1}`, voice: 'alloy', role: 'guest' }])}
                      style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--muted)', fontSize: 12, cursor: 'pointer', padding: '4px 12px' }}>
                      + Add
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pipeline Steps */}
      <div className="card" style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={14} color="var(--accent)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Pipeline Steps</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {PIPELINE_STEPS.filter(s => steps[s.id]?.status === 'done').length} / {PIPELINE_STEPS.length} complete
          </div>
        </div>

        <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${(PIPELINE_STEPS.filter(s => steps[s.id]?.status === 'done').length / PIPELINE_STEPS.length) * 100}%`,
            background: 'linear-gradient(90deg, #58a6ff, #a371f7, #3fb950)',
            borderRadius: 4, transition: 'width .4s ease',
          }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {PIPELINE_STEPS.map((step, i) => (
            <StepCard key={step.id} step={step} index={i} state={steps[step.id]}
              isLast={i === PIPELINE_STEPS.length - 1}
              onRun={() => runStep(step.id)}
              disabled={!canRun || runningAll} />
          ))}
        </div>

        {/* Flow legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', flexWrap: 'wrap', paddingTop: 4 }}>
          {PIPELINE_STEPS.map((step, i) => {
            const Icon = step.icon
            const isDone = steps[step.id]?.status === 'done'
            return (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6,
                  background: isDone ? `${step.color}22` : 'var(--bg)',
                  border: `1px solid ${isDone ? step.color + '55' : 'var(--border)'}`,
                  transition: 'all .25s',
                }}>
                  <Icon size={11} color={isDone ? step.color : 'var(--muted)'} />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.04em', color: isDone ? step.color : 'var(--muted)' }}>
                    {step.label}
                  </span>
                </div>
                {i < PIPELINE_STEPS.length - 1 && <ChevronRight size={10} color="var(--border)" />}
              </div>
            )
          })}
        </div>
      </div>

      {/* Latest MegaPipeline outputs */}
      <div className="card" style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={14} color="var(--accent)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Latest MegaPipeline run</span>
          </div>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 12, padding: '6px 14px' }}
            onClick={refreshLatest}
            disabled={!config.title.trim() || latestLoading}
          >
            {latestLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          Uses the current content title to pull the latest generated assets across blog, video, ebook, audio, funnel, sales page, and ads.
        </div>
        {latestError && (
          <div style={{ fontSize: 11, color: '#f78166' }}>{latestError}</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {[
            { key: 'blog', label: 'Blog Post' },
            { key: 'video', label: 'Video' },
            { key: 'ebook', label: 'eBook' },
            { key: 'audio', label: 'Audio / Podcast' },
            { key: 'funnel', label: 'Lead Capture' },
            { key: 'sales_page', label: 'Sales Page' },
            { key: 'ads', label: 'Ad Copy' },
          ].map(item => {
            const data = latest[item.key] || { found: false }
            const hasLink = Boolean(data.url)
            const hasFile = Boolean(data.filename)
            return (
              <div key={item.key} className="card" style={{ padding: '10px 12px', fontSize: 11 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{item.label}</div>
                {!data.found && (
                  <div style={{ color: 'var(--muted)' }}>No output found yet for this topic.</div>
                )}
                {data.found && (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {hasLink && (
                      <a
                        href={data.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--accent)', textDecoration: 'none' }}
                      >
                        Open asset ↗
                      </a>
                    )}
                    {hasFile && (
                      <div style={{ color: 'var(--muted)' }}>
                        {data.filename}
                      </div>
                    )}
                    {!hasLink && !hasFile && (
                      <div style={{ color: 'var(--muted)' }}>Output recorded without a direct file/URL.</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Complete banner */}
      {allDone && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(63,185,80,0.12), rgba(88,166,255,0.08))',
          border: '1px solid rgba(63,185,80,0.35)',
          borderRadius: 14, padding: '20px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#3fb950', marginBottom: 4 }}>Pipeline Complete</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              All 6 steps finished. Your content has been generated and distributed.
            </div>
          </div>
          <button onClick={runAll} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px',
            borderRadius: 8, border: '1px solid rgba(63,185,80,0.4)',
            background: 'rgba(63,185,80,0.12)', color: '#3fb950',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
            <Play size={12} /> Run Again
          </button>
        </div>
      )}

    </div>
  )
}
