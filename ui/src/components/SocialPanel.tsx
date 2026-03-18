import { useEffect, useMemo, useRef, useState } from 'react'
import {
  approveSocialItem,
  approveVideoItem,
  createCalendarEntry,
  deleteSocialItem,
  deleteVideoItem,
  getCalendarEntries,
  getSocialApprovals,
  getVideoApprovals,
  submitTask,
  type ApprovalItem,
  type InternalCalendarEntry,
} from '../api'
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Facebook,
  Instagram,
  Linkedin,
  MessageSquare,
  MoreHorizontal,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Star,
  X,
  Youtube,
  Zap,
  Zap as ZapIcon,
} from 'lucide-react'

// ─── types ────────────────────────────────────────────────────────────────────

type Status   = 'needs_review' | 'approved' | 'disapproved' | 'scheduled' | 'posted' | 'failed'
type Kind     = 'social' | 'video' | 'calendar'
type Bucket   = 'ready' | 'needs_edit' | 'duplicate_risk' | 'off_brand' | 'weak_hook' | 'high_potential'

interface AITag   { label: string; color: string; bg: string }
interface ScoreDimensions {
  hookStrength: number       // 0–100
  brandMatch: number
  platformFit: number
  ctaStrength: number
  clarity: number
  duplicateRisk: number
  predictedEngagement: number
}

interface QueueItem {
  id: string
  rawId: number
  kind: Kind
  platform: string
  brand: string
  title: string
  caption: string
  thumb: string
  status: Status
  scheduledAt?: string
  approvedAt?: string
  raw: ApprovalItem | InternalCalendarEntry
}

interface ScoredItem extends QueueItem {
  score: number
  buckets: Bucket[]
  aiTags: AITag[]
  scoreDetail: ScoreDimensions
  analysisNotes: string[]
}

// ─── status config ────────────────────────────────────────────────────────────

const STATUS_META: Record<Status, { label: string; color: string; bg: string }> = {
  needs_review: { label: 'Needs Review', color: '#f0883e', bg: 'rgba(240,136,62,.14)' },
  approved:     { label: 'Approved',     color: '#3fb950', bg: 'rgba(63,185,80,.14)'  },
  disapproved:  { label: 'Disapproved',  color: '#f85149', bg: 'rgba(248,81,73,.14)'  },
  scheduled:    { label: 'Scheduled',    color: '#58a6ff', bg: 'rgba(88,166,255,.14)' },
  posted:       { label: 'Posted',       color: '#8b949e', bg: 'rgba(139,148,158,.14)'},
  failed:       { label: 'Failed',       color: '#f85149', bg: 'rgba(248,81,73,.14)'  },
}

// ─── bucket config ────────────────────────────────────────────────────────────

const BUCKET_META: Record<Bucket, { label: string; color: string; bg: string; border: string; icon: React.ReactNode; description: string }> = {
  ready:          { label: 'Ready to Approve', color: '#3fb950', bg: 'rgba(63,185,80,.1)',    border: 'rgba(63,185,80,.3)',    icon: <CheckCircle size={14}/>,    description: 'Strong posts ready to publish' },
  needs_edit:     { label: 'Needs Edit',       color: '#f0883e', bg: 'rgba(240,136,62,.1)',   border: 'rgba(240,136,62,.3)',   icon: <Pencil size={14}/>,         description: 'Good content, minor improvements needed' },
  duplicate_risk: { label: 'Duplicate Risk',   color: '#f85149', bg: 'rgba(248,81,73,.1)',    border: 'rgba(248,81,73,.3)',    icon: <Copy size={14}/>,           description: 'High similarity to queued posts' },
  off_brand:      { label: 'Off Brand',        color: '#ff7b72', bg: 'rgba(255,123,114,.1)',  border: 'rgba(255,123,114,.3)',  icon: <AlertTriangle size={14}/>,  description: 'Tone or format mismatch detected' },
  weak_hook:      { label: 'Weak Hook',        color: '#e3b341', bg: 'rgba(227,179,65,.1)',   border: 'rgba(227,179,65,.3)',   icon: <Zap size={14}/>,            description: 'Opening line needs strengthening' },
  high_potential: { label: 'High Potential',   color: '#d2a8ff', bg: 'rgba(210,168,255,.1)',  border: 'rgba(210,168,255,.3)', icon: <Star size={14}/>,           description: 'Predicted to outperform average' },
}

// ─── scoring engine ───────────────────────────────────────────────────────────

function scoreItem(item: QueueItem, allItems: QueueItem[]): ScoredItem {
  const combined = `${item.title} ${item.caption}`.trim()
  const words    = combined.split(/\s+/).filter(Boolean)
  const charLen  = combined.length
  const first    = combined.split(/[.!?\n]/)[0] || ''

  // Hook strength
  const hookTriggers = ['how', 'why', 'what if', 'discover', 'unlock', 'stop', 'start',
    'never', 'always', 'secret', 'proven', 'truth', 'mistake', 'warning', 'best', 'worst',
    'transform', 'reveal', 'finally', 'imagine', 'tired of']
  let hookStrength = 35
  if (first.length > 30) hookStrength += 18
  if (first.endsWith('?')) hookStrength += 15
  if (hookTriggers.some(t => first.toLowerCase().includes(t))) hookStrength += 22
  if (first.split(' ').length <= 10) hookStrength += 10
  hookStrength = Math.min(100, hookStrength)

  // CTA strength
  const ctaTerms = ['click', 'link in bio', 'download', 'get started', 'learn more',
    'sign up', 'try', 'check out', 'comment below', 'dm me', 'reply', 'follow', 'visit', 'grab']
  const ctaStrength = ctaTerms.some(t => combined.toLowerCase().includes(t)) ? 78 : 22

  // Platform fit
  const platformRanges: Record<string, [number, number]> = {
    linkedin: [100, 700], x: [20, 280], twitter: [20, 280],
    instagram: [80, 400], instagram_posts: [80, 400],
    facebook: [60, 500], youtube: [120, 900], tiktok: [30, 220],
    reddit: [20, 300],
    threads: [20, 500],
  }
  const [minC, maxC] = platformRanges[item.platform] || [60, 500]
  const platformFit = charLen >= minC && charLen <= maxC ? 88 : charLen < minC ? 52 : 44

  // Duplicate risk — only flag when a single other post shares >65% of rare words
  // Common filler words are excluded so topic similarity doesn't over-trigger
  const COMMON = new Set(['about', 'after', 'again', 'also', 'because', 'before', 'being', 'could',
    'every', 'first', 'going', 'great', 'have', 'here', 'just', 'know', 'life', 'like',
    'make', 'more', 'most', 'much', 'need', 'next', 'only', 'other', 'over', 'people',
    'really', 'right', 'should', 'some', 'still', 'that', 'their', 'them', 'then', 'there',
    'these', 'they', 'thing', 'think', 'this', 'time', 'very', 'want', 'well', 'what',
    'when', 'will', 'with', 'work', 'world', 'would', 'your'])
  const sigWords = words.filter(w => w.length > 5 && !COMMON.has(w.toLowerCase()))
  const duplicateRisk = (() => {
    if (sigWords.length < 4) return 0
    const others = allItems.filter(o => o.id !== item.id && o.caption)
    if (!others.length) return 0
    const maxOverlap = Math.max(...others.map(o => {
      const oSig = `${o.title} ${o.caption}`.split(/\s+/).filter(w => w.length > 5 && !COMMON.has(w.toLowerCase()))
      if (!oSig.length) return 0
      const common = sigWords.filter(w => oSig.includes(w)).length
      return common / sigWords.length
    }))
    return Math.round(maxOverlap * 100)
  })()

  // Brand match (proxy via content quality signals)
  const avgWordLen = words.reduce((s, w) => s + w.length, 0) / (words.length || 1)
  const brandMatch = words.length >= 8 && words.length <= 100 && avgWordLen < 9 ? 76 : words.length < 5 ? 40 : 58

  // Clarity
  const clarity = avgWordLen < 8 && words.length >= 6 ? 82 : 52

  // Predicted engagement (weighted composite)
  const predictedEngagement = Math.round(
    hookStrength  * 0.32 +
    ctaStrength   * 0.20 +
    platformFit   * 0.20 +
    brandMatch    * 0.15 +
    clarity       * 0.13,
  )

  // Bucket assignment (only for actionable states)
  const buckets: Bucket[] = []
  if (item.status === 'needs_review' || item.status === 'failed') {
    const isHighDup  = duplicateRisk >= 65   // only near-identical posts (was 42)
    const isOffBrand = brandMatch < 40       // more tolerant (was 48)
    const isWeakHook = hookStrength < 45     // more tolerant (was 50)
    const isHighPot  = predictedEngagement >= 68 && hookStrength >= 58 && !isHighDup
    const isReady    = hookStrength >= 52 && brandMatch >= 50 && platformFit >= 58 && !isOffBrand  // removed dup blocker

    if (isHighDup)                buckets.push('duplicate_risk')
    if (isOffBrand)               buckets.push('off_brand')
    if (isHighPot)                buckets.push('high_potential')
    if (isWeakHook && !isHighDup) buckets.push('weak_hook')
    if (isReady)                  buckets.push('ready')
    if (!buckets.includes('ready') && !isOffBrand) buckets.push('needs_edit')
    if (!buckets.length)          buckets.push('needs_edit')
  }

  // AI tags (max 3, most significant first)
  const tagPool: AITag[] = []
  if (hookStrength >= 68) tagPool.push({ label: 'Strong Hook',     color: '#3fb950', bg: 'rgba(63,185,80,.12)'  })
  else if (hookStrength < 50) tagPool.push({ label: 'Weak Hook',   color: '#f0883e', bg: 'rgba(240,136,62,.12)' })
  if (ctaStrength   >= 70) tagPool.push({ label: 'Strong CTA',     color: '#3fb950', bg: 'rgba(63,185,80,.12)'  })
  else if (ctaStrength < 35) tagPool.push({ label: 'Weak CTA',     color: '#f0883e', bg: 'rgba(240,136,62,.12)' })
  if (duplicateRisk >= 42) tagPool.push({ label: 'Duplicate Risk', color: '#f85149', bg: 'rgba(248,81,73,.12)'  })
  if (platformFit   >= 80) tagPool.push({ label: 'Platform Fit',   color: '#58a6ff', bg: 'rgba(88,166,255,.12)' })
  if (brandMatch    >= 72) tagPool.push({ label: 'Brand Match',    color: '#3fb950', bg: 'rgba(63,185,80,.12)'  })
  if (predictedEngagement >= 70) tagPool.push({ label: 'High Potential', color: '#d2a8ff', bg: 'rgba(210,168,255,.12)' })
  if (charLen > maxC * 1.25) tagPool.push({ label: 'Too Long',     color: '#f0883e', bg: 'rgba(240,136,62,.12)' })
  else if (words.length < 6) tagPool.push({ label: 'Too Short',    color: '#f0883e', bg: 'rgba(240,136,62,.12)' })

  // Analysis notes
  const analysisNotes: string[] = []
  if (hookStrength >= 68)
    analysisNotes.push('Opening line demonstrates high engagement potential.')
  else if (hookStrength < 50)
    analysisNotes.push('Opening line is weak. Lead with a bold claim, question, or power word.')
  if (ctaStrength >= 70)
    analysisNotes.push('Clear call to action detected.')
  else
    analysisNotes.push('No strong CTA found. Adding one typically improves engagement 15–30%.')
  if (duplicateRisk >= 42)
    analysisNotes.push('High similarity to another post in queue. Risk of audience fatigue if published close together.')
  else
    analysisNotes.push('No significant overlap with other queued posts.')
  if (platformFit >= 80)
    analysisNotes.push(`Caption length is well matched to ${item.platform || 'this platform'}.`)
  else if (charLen > maxC)
    analysisNotes.push(`Caption exceeds recommended length for ${item.platform || 'this platform'}. Consider trimming.`)
  else
    analysisNotes.push(`Caption is shorter than ideal for ${item.platform || 'this platform'}. Adding context may help.`)
  if (brandMatch >= 72)
    analysisNotes.push('Tone and format align with your brand voice profile.')
  else
    analysisNotes.push('Tone may be slightly misaligned with your brand voice. Review before publishing.')

  return {
    ...item,
    score: predictedEngagement,
    buckets,
    aiTags: tagPool.slice(0, 3),
    scoreDetail: { hookStrength, brandMatch, platformFit, ctaStrength, clarity, duplicateRisk, predictedEngagement },
    analysisNotes,
  }
}

// ─── normalize ────────────────────────────────────────────────────────────────

function mapStatus(s: string): Status {
  if (s === 'pending' || s === 'pending_approval') return 'needs_review'
  if (s === 'approved') return 'approved'
  if (s === 'rejected') return 'disapproved'
  if (s === 'scheduled') return 'scheduled'
  if (s === 'posted' || s === 'uploaded') return 'posted'
  if (s === 'error' || s === 'blocked_config') return 'failed'
  return 'needs_review'
}

const toUrl = (v?: string) => {
  const r = String(v || '').trim()
  if (!r) return ''
  if (r.startsWith('http')) return r
  const n = r.replace(/\\/g, '/')
  const i = n.toLowerCase().lastIndexOf('/outputs/')
  if (i >= 0) return `/${n.slice(i + 1).split('/').filter(Boolean).join('/')}`
  if (n.toLowerCase().startsWith('outputs/')) return `/${n.split('/').filter(Boolean).join('/')}`
  // Fallback: return the normalized path as-is so any valid relative or
  // absolute URL from the backend still has a chance to render.
  if (n.startsWith('/')) return n
  return n
}

const isToday = (v?: string) => {
  if (!v) return false
  const d = new Date(v), n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

const fmtDate = (v?: string) => {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function normalizeApproval(item: ApprovalItem, kind: Kind): QueueItem {
  const p = (item.payload || {}) as Record<string, unknown>
  return {
    id: `${kind}-${item.id}`, rawId: item.id, kind,
    platform: item.platform || '',
    brand: String(p.brand_name || p.brand_id || ''),
    title: item.title || item.topic || String(p.title || p.topic || '') || 'Untitled',
    caption: item.text || String(p.caption || p.description || ''),
    thumb: toUrl(String(p.image_preview_url || p.image_path || p.hero_image_path || item.preview_url || p.video_path || '')),
    status: mapStatus(item.status),
    scheduledAt: item.scheduled_at ?? undefined,
    approvedAt:  item.approved_at  ?? undefined,
    raw: item,
  }
}

function normalizeCalendar(item: InternalCalendarEntry): QueueItem {
  const p = (item.payload || {}) as Record<string, unknown>
  return {
    id: `calendar-${item.id}`, rawId: item.id, kind: 'calendar',
    platform: item.platform || '',
    brand: String(p.brand_name || ''),
    title: item.title || String(p.title || p.topic || '') || 'Untitled',
    caption: item.text || String(p.caption || p.description || ''),
    thumb: toUrl(String(p.image_preview_url || p.image_path || '')),
    status: mapStatus(item.status),
    scheduledAt: item.scheduled_at,
    raw: item,
  }
}

// ─── small components ─────────────────────────────────────────────────────────

function RedditIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="10" fill="#ff4500"/>
      <path d="M16.67 10a1.46 1.46 0 0 0-2.47-1 7.12 7.12 0 0 0-3.85-1.23l.65-3.07 2.13.45a1 1 0 1 0 .08-.67l-2.38-.5a.2.2 0 0 0-.24.15l-.73 3.44a7.14 7.14 0 0 0-3.89 1.23 1.46 1.46 0 1 0-1.61 2.39 2.87 2.87 0 0 0 0 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a2.87 2.87 0 0 0 0-.44 1.46 1.46 0 0 0 .65-1.19zm-9.33 1.08a1 1 0 1 1 1 1 1 1 0 0 1-1-1zm5.58 2.7a3.58 3.58 0 0 1-2.92.66 3.58 3.58 0 0 1-2.92-.66.19.19 0 0 1 .27-.27 3.21 3.21 0 0 0 2.65.54 3.21 3.21 0 0 0 2.65-.54.19.19 0 0 1 .27.27zm-.17-1.7a1 1 0 1 1 1-1 1 1 0 0 1-1 1z" fill="white"/>
    </svg>
  )
}

function ThreadsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 192 192" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M141.537 88.988a66.667 66.667 0 0 0-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1h-.34c-14.986 0-27.449 6.396-35.12 18.036l13.779 9.452c5.73-8.695 14.724-10.548 21.348-10.548h.229c8.249.053 14.474 2.452 18.503 7.129 2.932 3.405 4.893 8.11 5.864 14.05-7.314-1.243-15.224-1.626-23.68-1.14-23.82 1.371-39.134 15.264-38.105 34.568.522 9.792 5.4 18.216 13.735 23.719 7.047 4.652 16.124 6.927 25.557 6.412 12.458-.683 22.231-5.436 29.049-14.127 5.178-6.6 8.452-15.153 9.899-25.93 5.937 3.583 10.337 8.298 12.767 13.966 4.132 9.635 4.373 25.468-8.546 38.376-11.319 11.308-24.925 16.2-45.488 16.35-22.809-.169-40.053-7.484-51.242-21.741C35.236 139.966 29.808 120.682 29.605 96c.203-24.682 5.63-43.966 16.133-57.317C57.039 24.434 74.266 17.107 97.055 16.938c22.976.17 40.526 7.52 52.171 21.847 5.71 7.026 10.015 15.86 12.853 26.162l16.147-4.308c-3.44-12.68-8.853-23.606-16.219-32.668C147.036 9.607 125.202.195 97.27 0h-.37C69.019.195 47.428 9.643 32.934 28.044 20.006 44.467 13.312 67.317 13.098 96c.214 28.683 6.908 51.533 19.836 67.956 14.494 18.401 36.085 27.849 64.202 28.044h.37c24.982-.17 42.6-6.713 57.047-21.15 19.009-19.001 18.428-42.967 12.16-57.602-4.412-10.283-12.745-18.624-25.176-24.26Zm-43.897 41.564c-10.426.583-21.24-4.098-21.783-14.16-.397-7.47 5.325-15.786 22.567-16.803 1.972-.114 3.905-.168 5.8-.168 6.233 0 12.054.605 17.283 1.797-1.963 24.186-13.035 28.74-23.867 29.334Z"/>
    </svg>
  )
}

// ─── platform brand config ────────────────────────────────────────────────────

const PLATFORM_META: Record<string, { label: string; color: string; bg: string }> = {
  linkedin:         { label: 'LinkedIn',   color: '#0a66c2', bg: 'rgba(10,102,194,.18)'  },
  instagram:        { label: 'Instagram',  color: '#e1306c', bg: 'rgba(225,48,108,.18)'  },
  instagram_posts:  { label: 'Instagram',  color: '#e1306c', bg: 'rgba(225,48,108,.18)'  },
  facebook:         { label: 'Facebook',   color: '#1877f2', bg: 'rgba(24,119,242,.18)'  },
  facebook_groups:  { label: 'Facebook',   color: '#1877f2', bg: 'rgba(24,119,242,.18)'  },
  youtube:          { label: 'YouTube',    color: '#ff0000', bg: 'rgba(255,0,0,.15)'      },
  tiktok:           { label: 'TikTok',     color: '#69c9d0', bg: 'rgba(105,201,208,.18)' },
  reddit:           { label: 'Reddit',     color: '#ff4500', bg: 'rgba(255,69,0,.18)'    },
  threads:          { label: 'Threads',    color: '#e6edf3', bg: 'rgba(230,237,243,.12)' },
  x:                { label: 'X',          color: '#e6edf3', bg: 'rgba(230,237,243,.12)' },
  twitter:          { label: 'X / Twitter',color: '#e6edf3', bg: 'rgba(230,237,243,.12)' },
}

function getPlatformMeta(platform: string) {
  return PLATFORM_META[platform] ?? { label: platform || 'Social', color: '#8b949e', bg: 'rgba(139,148,158,.15)' }
}

function PlatformIcon({ platform, size = 14 }: { platform: string; size?: number }) {
  if (platform === 'linkedin')                                  return <Linkedin size={size} />
  if (platform === 'instagram' || platform === 'instagram_posts') return <Instagram size={size} />
  if (platform === 'facebook'  || platform === 'facebook_groups') return <Facebook size={size} />
  if (platform === 'youtube')                                   return <Youtube size={size} />
  if (platform === 'tiktok')                                    return <Music2 size={size} />
  if (platform === 'reddit')                                    return <RedditIcon size={size} />
  if (platform === 'threads')                                   return <ThreadsIcon size={size} />
  return <MessageSquare size={size} />
}

/** Colored pill showing icon + platform name — used in the row grid */
function PlatformBadge({ platform }: { platform: string }) {
  const meta = getPlatformMeta(platform)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 999,
      background: meta.bg, color: meta.color,
      fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      border: `1px solid ${meta.color}33`,
    }}>
      <PlatformIcon platform={platform} size={12} />
      {meta.label}
    </span>
  )
}

/** Thumbnail fallback: branded colored square with larger icon */
function PlatformThumb({ platform }: { platform: string }) {
  const meta = getPlatformMeta(platform)
  return (
    <div style={{
      width: '100%', height: '100%',
      background: meta.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: meta.color,
    }}>
      <PlatformIcon platform={platform} size={20} />
    </div>
  )
}

/** 36×36 thumbnail — shows image if available, falls back to branded platform color */
function ThumbCell({ thumb, platform }: { thumb: string; platform: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div style={{ width: 36, height: 36, borderRadius: 6, overflow: 'hidden', background: 'var(--surface2)', flexShrink: 0 }}>
      {thumb && !failed
        ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setFailed(true)} />
        : <PlatformThumb platform={platform} />}
    </div>
  )
}

function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status]
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: m.color, background: m.bg, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  )
}

function Tag({ tag }: { tag: AITag }) {
  return (
    <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 600, color: tag.color, background: tag.bg, whiteSpace: 'nowrap' }}>
      {tag.label}
    </span>
  )
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 4, borderRadius: 999, background: 'var(--surface2)' }}>
        <div style={{ height: '100%', borderRadius: 999, background: color, width: `${value}%`, transition: 'width .4s ease' }} />
      </div>
    </div>
  )
}

// ─── Smart Review Bar ─────────────────────────────────────────────────────────

function SmartReviewBar({
  bucketCounts, activeBucket, onSelect,
}: {
  bucketCounts: Record<string, number>
  activeBucket: Bucket | null
  onSelect: (b: Bucket | null) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', overflowX: 'auto' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', alignSelf: 'center', whiteSpace: 'nowrap', marginRight: 4 }}>
        Smart Review
      </div>
      {(Object.keys(BUCKET_META) as Bucket[]).map(b => {
        const m       = BUCKET_META[b]
        const count   = bucketCounts[b] || 0
        const isActive = activeBucket === b
        return (
          <button
            key={b}
            onClick={() => onSelect(isActive ? null : b)}
            title={m.description}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '6px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1px solid ${isActive ? m.border : 'var(--border)'}`,
              background: isActive ? m.bg : 'transparent',
              color: isActive ? m.color : count > 0 ? 'var(--text)' : 'var(--muted)',
              transition: 'all .15s',
              opacity: count === 0 ? .45 : 1,
            }}
          >
            <span style={{ color: isActive ? m.color : 'var(--muted)' }}>{m.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{m.label}</span>
            <span style={{
              fontSize: 11, fontWeight: 700,
              padding: '1px 6px', borderRadius: 999,
              background: isActive ? m.border : 'var(--surface2)',
              color: isActive ? m.color : 'var(--muted)',
            }}>
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── More Menu ────────────────────────────────────────────────────────────────

function MoreMenu({
  itemId, openId, setOpenId, isDisapproved, onRestore, onDelete,
  onViewDetails, onEdit, onSchedule, onRewriteWithAI,
}: {
  itemId: string; openId: string | null; setOpenId: (id: string | null) => void
  isDisapproved: boolean; onRestore: () => void; onDelete: () => void
  onViewDetails: () => void; onEdit: () => void; onSchedule: () => void; onRewriteWithAI: () => void
}) {
  const open = openId === itemId
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenId(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, setOpenId])

  const menuItem = (label: string, onClick: () => void, danger = false) => (
    <button key={label} onClick={() => { onClick(); setOpenId(null) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 14px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: danger ? '#f85149' : 'var(--text)' }}>
      {label}
    </button>
  )

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn-ghost" onClick={e => { e.stopPropagation(); setOpenId(open ? null : itemId) }} style={{ padding: '4px 6px' }}>
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 300, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 0', minWidth: 164, boxShadow: '0 8px 28px rgba(0,0,0,.55)' }}>
          {isDisapproved ? menuItem('Restore', onRestore) : null}
          {menuItem('View Details',    onViewDetails)}
          {menuItem('Edit',            onEdit)}
          {menuItem('Rewrite with AI', onRewriteWithAI)}
          {menuItem('Schedule',        onSchedule)}
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          {menuItem('Delete', onDelete, true)}
        </div>
      )}
    </div>
  )
}

// ─── Queue Row ────────────────────────────────────────────────────────────────

function QueueRow({
  item, checked, isDrawerOpen, onCheck, onClick,
  onApprove, onDisapprove, onRestore, onPostNow, onSchedule, onRewriteWithAI,
  openMenuId, setOpenMenuId, openDropdownId, setOpenDropdownId, onDelete,
}: {
  item: ScoredItem; checked: boolean; isDrawerOpen: boolean
  onCheck: () => void; onClick: () => void
  onApprove: () => void; onDisapprove: () => void; onRestore: () => void; onDelete: () => void
  onPostNow: () => void; onSchedule: () => void; onRewriteWithAI: () => void
  openMenuId: string | null; setOpenMenuId: (id: string | null) => void
  openDropdownId: string | null; setOpenDropdownId: (id: string | null) => void
}) {
  const canAct = item.status === 'needs_review' || item.status === 'failed'
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 40px 110px 1fr 100px 96px 128px',
        alignItems: 'center',
        gap: 10,
        padding: '0 14px',
        height: 56,
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        background: isDrawerOpen ? 'rgba(88,166,255,.06)' : checked ? 'rgba(88,166,255,.04)' : 'transparent',
        borderLeft: isDrawerOpen ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'background .1s',
      }}
    >
      {/* checkbox */}
      <div onClick={e => { e.stopPropagation(); onCheck() }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        {checked ? <CheckSquare size={15} color="var(--accent)" /> : <Square size={15} color="var(--muted)" />}
      </div>

      {/* thumbnail */}
      <ThumbCell thumb={item.thumb} platform={item.platform} />

      {/* platform badge */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <PlatformBadge platform={item.platform} />
      </div>

      {/* title + tags */}
      <div style={{ overflow: 'hidden', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.title}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'nowrap', overflow: 'hidden' }}>
          {item.aiTags.map(t => <Tag key={t.label} tag={t} />)}
        </div>
      </div>

      {/* status */}
      <StatusBadge status={item.status} />

      {/* scheduled date */}
      <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {fmtDate(item.scheduledAt)}
      </div>

      {/* actions */}
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
        {item.status === 'disapproved' ? (
          <button className="btn-ghost" onClick={onRestore} style={{ fontSize: 11, padding: '3px 8px', color: '#3fb950', display: 'flex', alignItems: 'center', gap: 4 }}>
            <RotateCcw size={11} /> Restore
          </button>
        ) : canAct ? (
          <>
            <ApproveDropdown
              itemId={item.id}
              openId={openDropdownId}
              setOpenId={setOpenDropdownId}
              onApprove={onApprove}
              onPostNow={onPostNow}
              onSchedule={onSchedule}
            />
            <button className="btn-ghost" onClick={onDisapprove} title="Disapprove" style={{ fontSize: 12, padding: '4px 7px', color: '#f85149', lineHeight: 1 }}>✕</button>
          </>
        ) : item.status === 'scheduled' ? (
          <button className="btn-ghost" onClick={onSchedule} style={{ fontSize: 11, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4, color: '#58a6ff' }}>
            <Calendar size={11} /> Reschedule
          </button>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--muted)', paddingRight: 4 }}>
            {item.status === 'posted' ? 'Published' : item.status === 'approved' ? 'Approved' : '—'}
          </span>
        )}
        <MoreMenu
          itemId={item.id}
          openId={openMenuId}
          setOpenId={setOpenMenuId}
          isDisapproved={item.status === 'disapproved'}
          onRestore={onRestore}
          onDelete={onDelete}
          onViewDetails={onClick}
          onEdit={onClick}
          onSchedule={onSchedule}
          onRewriteWithAI={onRewriteWithAI}
        />
        <ChevronRight size={13} color="var(--muted)" />
      </div>
    </div>
  )
}

// ─── Platform Preview ─────────────────────────────────────────────────────────

function PlatformPreview({ item }: { item: ScoredItem }) {
  const handle = item.platform === 'linkedin' ? 'Your Name · 1st' : item.platform === 'x' || item.platform === 'twitter' ? '@yourhandle' : item.platform === 'reddit' ? 'u/yourhandle' : item.platform === 'threads' ? '@yourhandle' : 'youraccount'
  return (
    <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden', background: item.platform === 'instagram' || item.platform === 'instagram_posts' ? '#000' : 'var(--surface2)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
          <PlatformIcon platform={item.platform} size={14} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>Your Brand</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{handle}</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>Just now</div>
      </div>
      {/* image */}
      {item.thumb && (
        <img src={item.thumb} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }} />
      )}
      {/* caption */}
      <div style={{ padding: '10px 12px', fontSize: 12, lineHeight: 1.55, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {(item.caption || item.title).slice(0, 280)}
        {(item.caption || item.title).length > 280 ? '…' : ''}
      </div>
      {/* engagement bar */}
      <div style={{ display: 'flex', gap: 16, padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)' }}>
        <span>👍 Like</span><span>💬 Comment</span><span>🔄 Share</span>
      </div>
    </div>
  )
}

// ─── Review Drawer ────────────────────────────────────────────────────────────

function ReviewDrawer({
  item, onClose, onApprove, onDisapprove, onRestore, onAdvance, onPostNow, onSchedule,
}: {
  item: ScoredItem; onClose: () => void
  onApprove: () => void; onDisapprove: () => void; onRestore: () => void
  onAdvance: () => void; onPostNow: () => void; onSchedule: () => void
}) {
  const [caption, setCaption] = useState(item.caption)
  const [editing, setEditing] = useState(false)
  const [drawerDropdownId, setDrawerDropdownId] = useState<string | null>(null)
  const canAct = item.status === 'needs_review' || item.status === 'failed'

  useEffect(() => { setCaption(item.caption); setEditing(false) }, [item.id, item.caption])

  const d = item.scoreDetail
  const scoreItems: Array<{ label: string; value: number; color: string }> = [
    { label: 'Hook Strength',        value: d.hookStrength,        color: d.hookStrength > 65        ? '#3fb950' : '#f0883e' },
    { label: 'Brand Match',          value: d.brandMatch,          color: d.brandMatch > 65          ? '#3fb950' : '#f0883e' },
    { label: 'Platform Fit',         value: d.platformFit,         color: d.platformFit > 65         ? '#58a6ff' : '#f0883e' },
    { label: 'CTA Strength',         value: d.ctaStrength,         color: d.ctaStrength > 65         ? '#3fb950' : '#f0883e' },
    { label: 'Duplicate Risk',       value: d.duplicateRisk,       color: d.duplicateRisk < 30       ? '#3fb950' : '#f85149' },
    { label: 'Predicted Engagement', value: d.predictedEngagement, color: d.predictedEngagement > 60 ? '#d2a8ff' : '#f0883e' },
  ]

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )

  return (
    <div style={{ width: 400, flexShrink: 0, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)', overflow: 'hidden' }}>

      {/* drawer header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
          <PlatformIcon platform={item.platform} size={14} />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
          <StatusBadge status={item.status} />
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button className="btn-ghost" onClick={onAdvance} title="Next post" style={{ padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            Next <ChevronRight size={12} />
          </button>
          <button className="btn-ghost" onClick={onClose} style={{ padding: '4px 7px' }}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* score pill */}
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 12 }}>
            <Sparkles size={12} color="#d2a8ff" />
            <span style={{ color: 'var(--muted)' }}>AI Score</span>
            <span style={{ fontWeight: 700, color: item.score >= 65 ? '#3fb950' : item.score >= 45 ? '#f0883e' : '#f85149', fontSize: 13 }}>
              {item.score}/100
            </span>
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
            {item.aiTags.map(t => <Tag key={t.label} tag={t} />)}
          </div>
        </div>

        {/* platform preview */}
        <Section title="Post Preview">
          <PlatformPreview item={{ ...item, caption }} />
        </Section>

        {/* caption editor */}
        <Section title="Caption">
          {editing ? (
            <>
              <textarea
                value={caption}
                onChange={e => setCaption(e.target.value)}
                rows={5}
                style={{ width: '100%', fontSize: 12, resize: 'vertical', marginBottom: 8 }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-primary" style={{ fontSize: 11 }} onClick={() => setEditing(false)}>Save Draft</button>
                <button className="btn-ghost"   style={{ fontSize: 11 }} onClick={() => { setCaption(item.caption); setEditing(false) }}>Cancel</button>
              </div>
            </>
          ) : (
            <div style={{ position: 'relative' }}>
              <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 28 }}>
                {caption || <span style={{ color: 'var(--muted)' }}>No caption</span>}
              </div>
              <button className="btn-ghost" onClick={() => setEditing(true)} style={{ position: 'absolute', top: 0, right: 0, padding: '2px 5px' }}>
                <Pencil size={11} />
              </button>
            </div>
          )}
        </Section>

        {/* AI analysis */}
        <Section title="AI Analysis">
          <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
            {scoreItems.map(s => <ScoreBar key={s.label} {...s} />)}
          </div>
          <div style={{ display: 'grid', gap: 7 }}>
            {item.analysisNotes.map((note, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }}>·</span>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* brand alignment */}
        <Section title="Brand Alignment">
          {[
            { label: 'Brand voice match', value: d.brandMatch },
            { label: 'Audience fit',      value: Math.round((d.platformFit + d.brandMatch) / 2) },
            { label: 'Content objective', value: Math.round((d.ctaStrength + d.hookStrength) / 2) },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text)' }}>{r.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 80, height: 4, borderRadius: 999, background: 'var(--surface2)' }}>
                  <div style={{ height: '100%', borderRadius: 999, background: r.value > 65 ? '#3fb950' : r.value > 45 ? '#f0883e' : '#f85149', width: `${r.value}%` }} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted)', width: 24, textAlign: 'right' }}>{r.value}%</span>
              </div>
            </div>
          ))}
        </Section>

      </div>

      {/* drawer footer actions */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0, background: 'var(--surface)' }}>
        {item.status === 'disapproved' ? (
          <button className="btn-primary" onClick={onRestore} style={{ flex: 1, fontSize: 12 }}>Restore</button>
        ) : canAct ? (
          <>
            <div style={{ flex: 2 }}>
              <ApproveDropdown
                itemId={`drawer-${item.id}`}
                openId={drawerDropdownId}
                setOpenId={setDrawerDropdownId}
                onApprove={onApprove}
                onPostNow={onPostNow}
                onSchedule={onSchedule}
              />
            </div>
            <button className="btn-ghost"     onClick={onDisapprove} style={{ flex: 1, fontSize: 12, color: '#f85149' }}>Disapprove</button>
            <button className="btn-ghost"     style={{ fontSize: 12, padding: '6px 10px' }} title="Rewrite with AI">
              <Sparkles size={13} />
            </button>
          </>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            {item.status === 'posted' ? 'This post has been published.' : item.status === 'approved' ? 'Post is approved.' : 'No actions available.'}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Bulk Action Bar ──────────────────────────────────────────────────────────

function BulkActionBar({
  count, onApprove, onPostNow, onSchedule, onDisapprove, onClear,
}: {
  count: number; onApprove: () => void; onPostNow: () => void; onSchedule: () => void; onDisapprove: () => void; onClear: () => void
}) {
  return (
    <div style={{ padding: '9px 20px', background: 'var(--surface)', borderTop: '1px solid rgba(88,166,255,.2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, boxShadow: '0 2px 12px rgba(0,0,0,.2)' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginRight: 4 }}>
        {count} post{count !== 1 ? 's' : ''} selected
      </span>
      <button className="btn-primary" onClick={onApprove} style={{ fontSize: 12 }}>Approve Selected</button>
      <button className="btn-ghost"   onClick={onPostNow} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
        <ZapIcon size={12} /> Post Now
      </button>
      <button className="btn-ghost"   onClick={onSchedule} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Calendar size={12} /> Schedule Selected
      </button>
      <button className="btn-ghost"   onClick={onDisapprove} style={{ fontSize: 12, color: '#f85149', borderColor: 'rgba(248,81,73,.3)' }}>Disapprove Selected</button>
      <button className="btn-ghost"   style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Sparkles size={12} /> Rewrite Selected
      </button>
      <button className="btn-ghost"   onClick={onClear} style={{ fontSize: 12, marginLeft: 'auto', color: 'var(--muted)' }}>Clear</button>
    </div>
  )
}

// ─── main panel ───────────────────────────────────────────────────────────────

// ─── scheduling helpers ───────────────────────────────────────────────────────

const SUGGESTED_TIMES: Record<string, { day: string; time: string; display: string }> = {
  linkedin:        { day: 'Tuesday',   time: '09:00', display: 'Tuesday · 9:00 AM'   },
  instagram:       { day: 'Wednesday', time: '19:30', display: 'Wednesday · 7:30 PM' },
  instagram_posts: { day: 'Wednesday', time: '19:30', display: 'Wednesday · 7:30 PM' },
  facebook:        { day: 'Wednesday', time: '15:00', display: 'Wednesday · 3:00 PM' },
  facebook_groups: { day: 'Wednesday', time: '15:00', display: 'Wednesday · 3:00 PM' },
  x:               { day: 'Monday',    time: '08:00', display: 'Monday · 8:00 AM'    },
  twitter:         { day: 'Monday',    time: '08:00', display: 'Monday · 8:00 AM'    },
  youtube:         { day: 'Saturday',  time: '11:00', display: 'Saturday · 11:00 AM' },
  tiktok:          { day: 'Friday',    time: '19:00', display: 'Friday · 7:00 PM'    },
  reddit:          { day: 'Sunday',    time: '10:00', display: 'Sunday · 10:00 AM'   },
  threads:         { day: 'Tuesday',   time: '12:00', display: 'Tuesday · 12:00 PM'  },
}

function getNextOccurrence(dayName: string, timeStr: string): { date: string; time: string } {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const target = DAYS.indexOf(dayName)
  const now    = new Date()
  let diff     = (target - now.getDay() + 7) % 7
  if (diff === 0) diff = 7
  const next = new Date(now)
  next.setDate(now.getDate() + diff)
  return { date: next.toISOString().split('T')[0], time: timeStr }
}

// ─── ScheduleModal ────────────────────────────────────────────────────────────

interface ScheduleTarget {
  mode: 'single'
  item: ScoredItem
}
interface ScheduleBulkTarget {
  mode: 'bulk'
  count: number
  platform: string
}
type ScheduleModalTarget = ScheduleTarget | ScheduleBulkTarget

function ScheduleModal({
  target, onSchedule, onCancel,
}: {
  target: ScheduleModalTarget
  onSchedule: (isoDate: string) => void
  onCancel: () => void
}) {
  const platform = target.mode === 'single' ? target.item.platform : target.platform
  const suggested = SUGGESTED_TIMES[platform]
  const suggestedNext = suggested ? getNextOccurrence(suggested.day, suggested.time) : null

  const [date, setDate] = useState(suggestedNext?.date ?? '')
  const [time, setTime] = useState(suggestedNext?.time ?? '09:00')
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  const useSuggested = () => {
    if (!suggestedNext) return
    setDate(suggestedNext.date)
    setTime(suggestedNext.time)
  }

  const submit = () => {
    if (!date || !time) return
    onSchedule(new Date(`${date}T${time}:00`).toISOString())
  }

  const platformLabel = platform
    ? platform.charAt(0).toUpperCase() + platform.slice(1).replace('_', ' ')
    : 'this platform'

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 420, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, display: 'grid', gap: 0, boxShadow: '0 20px 60px rgba(0,0,0,.6)', overflow: 'hidden' }}
      >
        {/* header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={15} color="var(--accent)" /> Schedule Post
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              {target.mode === 'single'
                ? target.item.title.slice(0, 55) + (target.item.title.length > 55 ? '…' : '')
                : `Scheduling ${target.count} post${target.count !== 1 ? 's' : ''} at the same time`}
            </div>
          </div>
          <button className="btn-ghost" onClick={onCancel} style={{ padding: '4px 6px', marginTop: -2 }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
          {/* AI suggested time */}
          {suggested && (
            <div style={{ background: 'rgba(88,166,255,.08)', border: '1px solid rgba(88,166,255,.2)', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Sparkles size={10} /> Recommended for {platformLabel}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginTop: 3 }}>
                  {suggested.display}
                </div>
              </div>
              <button className="btn-ghost" onClick={useSuggested} style={{ fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>
                Use This Time
              </button>
            </div>
          )}

          {/* date + time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11 }}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 11 }}>Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ marginTop: 4 }} />
            </div>
          </div>

          {/* timezone */}
          <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ opacity: .6 }}>🕐</span> {tz}
          </div>
        </div>

        {/* footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end', background: 'var(--surface2)' }}>
          <button className="btn-ghost" onClick={onCancel} style={{ fontSize: 12 }}>Cancel</button>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={!date || !time}
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Calendar size={12} /> Schedule
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ApproveDropdown ──────────────────────────────────────────────────────────

function ApproveDropdown({
  itemId, openId, setOpenId, onApprove, onPostNow, onSchedule,
}: {
  itemId: string; openId: string | null; setOpenId: (id: string | null) => void
  onApprove: () => void; onPostNow: () => void; onSchedule: () => void
}) {
  const open = openId === itemId
  const ref  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenId(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, setOpenId])

  const menuBtn = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      key={label}
      onClick={() => { onClick(); setOpenId(null) }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', whiteSpace: 'nowrap' }}
    >
      <span style={{ color: 'var(--muted)' }}>{icon}</span> {label}
    </button>
  )

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
      {/* split: left = approve, right = chevron */}
      <button
        className="btn-primary"
        onClick={e => { e.stopPropagation(); onApprove() }}
        style={{ fontSize: 11, padding: '4px 9px', borderRadius: '6px 0 0 6px', borderRight: '1px solid rgba(255,255,255,.18)' }}
      >
        Approve
      </button>
      <button
        className="btn-primary"
        onClick={e => { e.stopPropagation(); setOpenId(open ? null : itemId) }}
        style={{ fontSize: 11, padding: '4px 6px', borderRadius: '0 6px 6px 0', display: 'flex', alignItems: 'center' }}
        aria-label="More approve options"
      >
        <ChevronDown size={12} />
      </button>

      {open && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 300, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 0', minWidth: 186, boxShadow: '0 8px 28px rgba(0,0,0,.5)' }}>
          {menuBtn('Approve', <CheckCircle size={13} />, onApprove)}
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '3px 0' }} />
          {menuBtn('Approve and Post Now', <ZapIcon size={13} />, onPostNow)}
          {menuBtn('Approve and Schedule', <Calendar size={13} />, onSchedule)}
        </div>
      )}
    </div>
  )
}

const STATUS_FILTERS = [
  { key: 'all',          label: 'All' },
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'approved',     label: 'Approved' },
  { key: 'disapproved',  label: 'Disapproved' },
  { key: 'scheduled',    label: 'Scheduled' },
  { key: 'posted',       label: 'Posted' },
  { key: 'failed',       label: 'Failed' },
]

export default function SocialPanel() {
  const [rawSocial,   setRawSocial]   = useState<ApprovalItem[]>([])
  const [rawVideo,    setRawVideo]    = useState<ApprovalItem[]>([])
  const [rawCalendar, setRawCalendar] = useState<InternalCalendarEntry[]>([])
  const [optimistic,  setOptimistic]  = useState<Record<string, Status>>({})

  const [statusFilter,   setStatusFilter]   = useState('needs_review')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [bucketFilter,   setBucketFilter]   = useState<Bucket | null>(null)
  const [search,         setSearch]         = useState('')

  const [selected,       setSelected]       = useState<Set<string>>(new Set())
  const [drawerItemId,   setDrawerItemId]   = useState<string | null>(null)
  const [openMenuId,     setOpenMenuId]     = useState<string | null>(null)
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const [scheduleModal,  setScheduleModal]  = useState<ScheduleModalTarget | null>(null)
  const [loading,        setLoading]        = useState(false)
  const [toast,          setToast]          = useState('')
  const [showNewPost,    setShowNewPost]    = useState(false)
  const [newText,        setNewText]        = useState('')
  const [newPlatform,    setNewPlatform]    = useState('x')
  const mounted = useRef(false)

  // ── load ─────────────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true)
    try {
      const [social, video, calendar] = await Promise.all([
        getSocialApprovals().catch(() => [] as ApprovalItem[]),
        getVideoApprovals().catch(()   => [] as ApprovalItem[]),
        getCalendarEntries(false).catch(() => [] as InternalCalendarEntry[]),
      ])
      if (Array.isArray(social))   setRawSocial(social)
      if (Array.isArray(video))    setRawVideo(video)
      if (Array.isArray(calendar)) setRawCalendar(calendar)
      setOptimistic({})
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    load()
  }, [])

  // ── computed ──────────────────────────────────────────────────────────────────

  const baseItems = useMemo<QueueItem[]>(() => [
    ...rawSocial.map(i   => normalizeApproval(i, 'social')),
    ...rawVideo.map(i    => normalizeApproval(i, 'video')),
    ...rawCalendar.map(i => normalizeCalendar(i)),
  ], [rawSocial, rawVideo, rawCalendar])

  const allItems = useMemo<QueueItem[]>(
    () => baseItems.map(i => optimistic[i.id] ? { ...i, status: optimistic[i.id] } : i),
    [baseItems, optimistic],
  )

  const scoredItems = useMemo<ScoredItem[]>(
    () => allItems.map(i => scoreItem(i, allItems)),
    [allItems],
  )

  const bucketCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const item of scoredItems) {
      for (const b of item.buckets) c[b] = (c[b] || 0) + 1
    }
    return c
  }, [scoredItems])

  const stats = useMemo(() => ({
    pendingReview:    scoredItems.filter(i => i.status === 'needs_review').length,
    approvedToday:    scoredItems.filter(i => i.status === 'approved'    && isToday(i.approvedAt)).length,
    disapprovedToday: scoredItems.filter(i => i.status === 'disapproved').length,
    scheduledToday:   scoredItems.filter(i => i.status === 'scheduled'   && isToday(i.scheduledAt)).length,
    failed:           scoredItems.filter(i => i.status === 'failed').length,
  }), [scoredItems])

  const filtered = useMemo<ScoredItem[]>(() => scoredItems.filter(item => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false
    if (platformFilter !== 'all') {
      const matchInst = platformFilter === 'instagram' && (item.platform === 'instagram' || item.platform === 'instagram_posts')
      if (!matchInst && item.platform !== platformFilter) return false
    }
    if (bucketFilter && !item.buckets.includes(bucketFilter)) return false
    if (search) {
      if (!`${item.title} ${item.caption} ${item.platform}`.toLowerCase().includes(search.toLowerCase())) return false
    }
    return true
  }), [scoredItems, statusFilter, platformFilter, bucketFilter, search])

  const drawerItem = drawerItemId ? (filtered.find(i => i.id === drawerItemId) ?? scoredItems.find(i => i.id === drawerItemId) ?? null) : null

  // ── actions ───────────────────────────────────────────────────────────────────

  const setStatus = (id: string, status: Status) => setOptimistic(o => ({ ...o, [id]: status }))
  const revertStatus = (id: string, prev: Status) => setOptimistic(o => ({ ...o, [id]: prev }))

  const runAction = async (item: QueueItem, next: Status, apiFn: () => Promise<unknown>) => {
    const prev = item.status
    setStatus(item.id, next)
    setSelected(s => { const n = new Set(s); n.delete(item.id); return n })
    try { await apiFn() }
    catch { revertStatus(item.id, prev); showToast('Action failed — please try again') }
  }

  const dispatchToAgent = (item: QueueItem, extra?: Record<string, unknown>) =>
    submitTask('distribute_post', {
      approval_id:  item.rawId,
      kind:         item.kind,
      platform:     item.platform,
      text:         item.caption || item.title,
      scheduled_at: item.scheduledAt ?? null,
      ...extra,
    }, 'distribution_agent').catch(() => null)  // non-fatal — backend handles re-queue

  const approve = (item: QueueItem) =>
    runAction(item, 'approved', async () => {
      await (item.kind === 'social' ? approveSocialItem(item.rawId, true) : approveVideoItem(item.rawId, true))
      await dispatchToAgent(item)
    })

  const disapprove = (item: QueueItem) => runAction(item, 'disapproved', () => item.kind === 'social' ? approveSocialItem(item.rawId, false) : approveVideoItem(item.rawId, false))

  const deleteItem = async (item: QueueItem) => {
    // Optimistically remove from raw state immediately
    if (item.kind === 'social') {
      setRawSocial(prev => prev.filter(i => i.id !== item.rawId))
    } else if (item.kind === 'video') {
      setRawVideo(prev => prev.filter(i => i.id !== item.rawId))
    } else {
      setRawCalendar(prev => prev.filter(i => i.id !== item.rawId))
    }
    setSelected(s => { const n = new Set(s); n.delete(item.id); return n })
    if (drawerItemId === item.id) setDrawerItemId(null)
    try {
      await (item.kind === 'social' ? deleteSocialItem(item.rawId) : deleteVideoItem(item.rawId))
    } catch {
      // Restore item on failure
      if (item.kind === 'social') {
        setRawSocial(prev => [item.raw as ApprovalItem, ...prev])
      } else if (item.kind === 'video') {
        setRawVideo(prev => [item.raw as ApprovalItem, ...prev])
      } else {
        setRawCalendar(prev => [item.raw as InternalCalendarEntry, ...prev])
      }
      showToast('Delete failed — please try again')
    }
  }

  const restore    = (item: QueueItem) =>
    runAction(item, 'approved', async () => {
      await (item.kind === 'social' ? approveSocialItem(item.rawId, true) : approveVideoItem(item.rawId, true))
      await dispatchToAgent(item)
    })

  const approveAndAdvance = async (item: ScoredItem) => {
    await approve(item)
    const idx  = filtered.findIndex(i => i.id === item.id)
    const next = filtered[idx + 1]
    setDrawerItemId(next ? next.id : null)
  }

  const disapproveAndAdvance = async (item: ScoredItem) => {
    await disapprove(item)
    const idx  = filtered.findIndex(i => i.id === item.id)
    const next = filtered[idx + 1]
    setDrawerItemId(next ? next.id : null)
  }

  const bulkApprove = async () => {
    const targets = filtered.filter(i => selected.has(i.id) && (i.status === 'needs_review' || i.status === 'failed'))
    if (!targets.length) return
    targets.forEach(i => setStatus(i.id, 'approved'))
    setSelected(new Set())
    await Promise.all(targets.map(async i => {
      await (i.kind === 'social' ? approveSocialItem(i.rawId, true) : approveVideoItem(i.rawId, true)).catch(() => null)
      await dispatchToAgent(i)
    }))
    showToast(`Approved ${targets.length} post${targets.length !== 1 ? 's' : ''} — distribution agent queued`)
  }

  const bulkDisapprove = async () => {
    const targets = filtered.filter(i => selected.has(i.id) && (i.status === 'needs_review' || i.status === 'failed'))
    if (!targets.length) return
    targets.forEach(i => setStatus(i.id, 'disapproved'))
    setSelected(new Set())
    await Promise.all(targets.map(i =>
      (i.kind === 'social' ? approveSocialItem(i.rawId, false) : approveVideoItem(i.rawId, false)).catch(() => null)
    ))
    showToast(`Disapproved ${targets.length} post${targets.length !== 1 ? 's' : ''}`)
  }

  const approveAndPostNow = async (item: QueueItem) => {
    const needsApproval = item.status === 'needs_review' || item.status === 'failed'
    if (needsApproval) {
      await (item.kind === 'social' ? approveSocialItem(item.rawId, true) : approveVideoItem(item.rawId, true)).catch(() => null)
      setStatus(item.id, 'approved')
    }
    try {
      await submitTask('distribute_post', {
        approval_id: item.rawId,
        kind:        item.kind,
        platform:    item.platform,
        text:        item.caption || item.title,
        dispatch:    'immediate',
        post_now:    true,
      }, 'distribution_agent')
      setStatus(item.id, 'posted')
      showToast(`Sent to ${item.platform} — distribution agent is posting now`)
    } catch {
      showToast('Approved — post now failed, please retry from integrations')
    }
  }

  const approveAndSchedule = async (item: QueueItem, isoDate: string) => {
    const needsApproval = item.status === 'needs_review' || item.status === 'failed'
    if (needsApproval) {
      await (item.kind === 'social' ? approveSocialItem(item.rawId, true) : approveVideoItem(item.rawId, true)).catch(() => null)
      setStatus(item.id, 'approved')
    }
    try {
      await createCalendarEntry({
        platform:     item.platform,
        content_type: 'social_post',
        scheduled_at: isoDate,
        title:        item.title,
        payload:      { approval_id: item.rawId, kind: item.kind },
      })
      // Tell the distribution agent: approved, post at this scheduled time only
      await submitTask('distribute_post', {
        approval_id:  item.rawId,
        kind:         item.kind,
        platform:     item.platform,
        text:         item.caption || item.title,
        dispatch:     'scheduled',
        scheduled_at: isoDate,
      }, 'distribution_agent').catch(() => null)
      setStatus(item.id, 'scheduled')
      showToast(`Scheduled for ${new Date(isoDate).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
    } catch {
      showToast('Approved — scheduling failed, please retry from calendar')
    }
  }

  const bulkPostNow = () => {
    const targets = filtered.filter(i => selected.has(i.id) && (i.status === 'needs_review' || i.status === 'failed'))
    if (!targets.length) return
    targets.forEach(i => approveAndPostNow(i))
    showToast(`Posting ${targets.length} post${targets.length !== 1 ? 's' : ''} now…`)
    setSelected(new Set())
  }

  const bulkSchedule = (isoDate: string) => {
    const targets = filtered.filter(i => selected.has(i.id) && (i.status === 'needs_review' || i.status === 'failed'))
    if (!targets.length) return
    targets.forEach(i => approveAndSchedule(i, isoDate))
    showToast(`Scheduled ${targets.length} post${targets.length !== 1 ? 's' : ''}`)
    setSelected(new Set())
    setScheduleModal(null)
  }

  const submitNew = async () => {
    if (!newText.trim()) return
    try {
      await submitTask('social_post', { platform: newPlatform, text: newText.trim() }, 'distribution_agent')
      setNewText(''); setShowNewPost(false)
      showToast(`Post queued for ${newPlatform}`)
    } catch (e: unknown) {
      showToast(`Error: ${e instanceof Error ? e.message : 'Failed'}`)
    }
  }

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3200) }

  // ── selection ─────────────────────────────────────────────────────────────────

  const allChecked  = filtered.length > 0 && filtered.every(i => selected.has(i.id))
  const someChecked = selected.size > 0
  const toggleAll   = () => allChecked ? setSelected(new Set()) : setSelected(new Set(filtered.map(i => i.id)))
  const toggleOne   = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const changeStatusFilter = (v: string) => { setStatusFilter(v); setSelected(new Set()); setBucketFilter(null) }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--bg)' }}>

      {/* ── page header ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#e6edf3' }}>Publishing Queue</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>Review, approve, refine, and publish AI generated content faster.</div>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          {[
            { label: 'Pending Review',   v: stats.pendingReview,    c: stats.pendingReview > 0 ? '#f0883e' : 'var(--muted)' },
            { label: 'Approved Today',   v: stats.approvedToday,    c: stats.approvedToday > 0 ? '#3fb950' : 'var(--muted)' },
            { label: 'Disapproved',      v: stats.disapprovedToday, c: stats.disapprovedToday > 0 ? '#f85149' : 'var(--muted)' },
            { label: 'Scheduled Today',  v: stats.scheduledToday,   c: stats.scheduledToday > 0 ? '#58a6ff' : 'var(--muted)' },
            { label: 'Failed',           v: stats.failed,           c: stats.failed > 0 ? '#f85149' : 'var(--muted)' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center', minWidth: 56 }}>
              <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1, color: s.c }}>{s.v}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap' }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={load} disabled={loading} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={12} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button className="btn-primary" onClick={() => setShowNewPost(v => !v)} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={12} /> New Post
          </button>
        </div>
      </div>

      {/* ── smart review bar — only shown when viewing review-eligible items ── */}
      {(statusFilter === 'needs_review' || statusFilter === 'all') && (
        <SmartReviewBar
          bucketCounts={bucketCounts}
          activeBucket={bucketFilter}
          onSelect={b => { setBucketFilter(b); setStatusFilter('needs_review'); setSelected(new Set()) }}
        />
      )}

      {/* ── new post composer ────────────────────────────────────────────────── */}
      {showNewPost && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Platform</div>
            <select value={newPlatform} onChange={e => setNewPlatform(e.target.value)} style={{ height: 34 }}>
              <option value="x">Twitter / X</option>
              <option value="linkedin">LinkedIn</option>
              <option value="facebook">Facebook</option>
              <option value="instagram_posts">Instagram</option>
              <option value="youtube">YouTube</option>
              <option value="tiktok">TikTok</option>
              <option value="reddit">Reddit</option>
              <option value="threads">Threads</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Post text {newPlatform === 'x' && `· ${newText.length}/280`}</div>
            <textarea value={newText} onChange={e => setNewText(e.target.value)} rows={2} maxLength={newPlatform === 'x' ? 280 : 3000} placeholder="Write your post…" style={{ width: '100%', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={submitNew} disabled={!newText.trim()} style={{ fontSize: 12 }}>Queue Post</button>
            <button className="btn-ghost"   onClick={() => setShowNewPost(false)} style={{ fontSize: 12 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── filter row ──────────────────────────────────────────────────────── */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {/* row 1: status pills + platform + search — all on one line, no wrap */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', overflowX: 'auto' }}>
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => changeStatusFilter(f.key)}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 999,
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                border: `1px solid ${statusFilter === f.key ? 'var(--accent)' : 'var(--border)'}`,
                background: statusFilter === f.key ? 'rgba(88,166,255,.12)' : 'transparent',
                color: statusFilter === f.key ? 'var(--accent)' : 'var(--muted)',
              }}
            >
              {f.label}
            </button>
          ))}

          <div style={{ width: 1, height: 18, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} />

          {/* platform — explicit width so global CSS width:100% is overridden */}
          <select
            value={platformFilter}
            onChange={e => { setPlatformFilter(e.target.value); setSelected(new Set()) }}
            style={{ fontSize: 11, padding: '3px 7px', height: 26, width: 'auto', flexShrink: 0, minWidth: 110, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
          >
            <option value="all">All Platforms</option>
            <option value="linkedin">LinkedIn</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="tiktok">TikTok</option>
            <option value="x">Twitter / X</option>
            <option value="youtube">YouTube</option>
            <option value="reddit">Reddit</option>
            <option value="threads">Threads</option>
          </select>

          {/* active bucket chip */}
          {bucketFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: BUCKET_META[bucketFilter].bg, border: `1px solid ${BUCKET_META[bucketFilter].border}`, fontSize: 11, color: BUCKET_META[bucketFilter].color, fontWeight: 600, flexShrink: 0 }}>
              {BUCKET_META[bucketFilter].icon}
              <span>{BUCKET_META[bucketFilter].label}</span>
              <button onClick={() => setBucketFilter(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', marginLeft: 1, lineHeight: 1, padding: 0 }}>×</button>
            </div>
          )}

          {/* search pushed to right */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search posts…"
            style={{ width: 160, fontSize: 11, padding: '3px 9px', height: 26, marginLeft: 'auto', flexShrink: 0 }}
          />
        </div>
      </div>

      {/* ── bulk action bar ──────────────────────────────────────────────────── */}
      {someChecked && (
        <BulkActionBar
          count={selected.size}
          onApprove={bulkApprove}
          onPostNow={bulkPostNow}
          onSchedule={() => {
            const firstSelected = filtered.find(i => selected.has(i.id))
            setScheduleModal({ mode: 'bulk', count: selected.size, platform: firstSelected?.platform ?? '' })
          }}
          onDisapprove={bulkDisapprove}
          onClear={() => setSelected(new Set())}
        />
      )}

      {/* ── body: list + drawer ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* list */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* column header */}
          <div style={{ display: 'grid', gridTemplateColumns: '32px 40px 110px 1fr 100px 96px 128px', gap: 10, padding: '0 14px', height: 34, background: 'var(--surface2)', borderBottom: '1px solid var(--border)', flexShrink: 0, alignItems: 'center' }}>
            <div onClick={toggleAll} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              {allChecked ? <CheckSquare size={14} color="var(--accent)" /> : <Square size={14} color="var(--muted)" />}
            </div>
            <div />
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Via</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Post · AI Tags &nbsp;
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                {filtered.length} result{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>
            {['Status', 'Scheduled', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</div>
            ))}
          </div>

          {/* rows */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                {scoredItems.length === 0
                  ? 'No posts yet. Run the pipeline to generate content.'
                  : 'No posts match the current filters.'}
              </div>
            ) : filtered.map(item => (
              <QueueRow
                key={item.id}
                item={item}
                checked={selected.has(item.id)}
                isDrawerOpen={drawerItemId === item.id}
                onCheck={() => toggleOne(item.id)}
                onClick={() => setDrawerItemId(drawerItemId === item.id ? null : item.id)}
                onApprove={() => approve(item)}
                onDisapprove={() => disapprove(item)}
                onRestore={() => restore(item)}
                onPostNow={() => approveAndPostNow(item)}
                onSchedule={() => setScheduleModal({ mode: 'single', item })}
                onRewriteWithAI={() => {
                  setDrawerItemId(item.id)
                  submitTask('rewrite_post', { platform: item.platform, text: item.caption || item.title }, 'content_agent')
                    .then(() => showToast('Rewrite queued — check back shortly'))
                    .catch(() => showToast('Rewrite failed — please try again'))
                }}
                onDelete={() => deleteItem(item)}
                openMenuId={openMenuId}
                setOpenMenuId={setOpenMenuId}
                openDropdownId={openDropdownId}
                setOpenDropdownId={setOpenDropdownId}
              />
            ))}
          </div>
        </div>

        {/* review drawer */}
        {drawerItem && (
          <ReviewDrawer
            item={drawerItem}
            onClose={() => setDrawerItemId(null)}
            onApprove={() => approveAndAdvance(drawerItem)}
            onDisapprove={() => disapproveAndAdvance(drawerItem)}
            onRestore={() => restore(drawerItem)}
            onPostNow={() => { approveAndPostNow(drawerItem); setDrawerItemId(null) }}
            onSchedule={() => setScheduleModal({ mode: 'single', item: drawerItem })}
            onAdvance={() => {
              const idx  = filtered.findIndex(i => i.id === drawerItem.id)
              const next = filtered[idx + 1]
              setDrawerItemId(next ? next.id : null)
            }}
          />
        )}
      </div>

      {/* ── schedule modal ───────────────────────────────────────────────────── */}
      {scheduleModal && (
        <ScheduleModal
          target={scheduleModal}
          onSchedule={isoDate => {
            if (scheduleModal.mode === 'single') {
              approveAndSchedule(scheduleModal.item, isoDate)
            } else {
              bulkSchedule(isoDate)
            }
            setScheduleModal(null)
          }}
          onCancel={() => setScheduleModal(null)}
        />
      )}

      {/* ── toast ────────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, padding: '10px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: '#e6edf3', boxShadow: '0 4px 20px rgba(0,0,0,.5)', zIndex: 400, pointerEvents: 'none' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
