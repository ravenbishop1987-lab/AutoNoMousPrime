import { useEffect, useMemo, useState } from 'react'
import { getActiveWorkspaceId, getProviderVerifications, getSettings, patchSettings, saveProviderVerification, saveSettings, testConnection } from '../api'
import type { Settings } from '../api'

const DEFAULTS: Settings = {
  // Defaults are chosen to be "safe + works out of the box" for most users.
  // You can override any of these at any time.
  openclaw: { ollama_url: 'http://localhost:11434', ollama_model: 'llama3', claude_api_key: '', claude_model: 'claude-sonnet-4-6', groq_api_url: 'https://api.groq.com/openai/v1', groq_api_key: '', groq_model: 'llama-3.1-8b-instant', mode: 'hybrid', max_concurrent_tasks: '2' },
  wordpress: { url: '', username: '', app_password: '', default_category: 'Uncategorized', category_map: '' },
  tool_routing: { image_mode: 'cloud', voice_mode: 'edge-tts' },
  comfyui: { url: '', positive_prompt_prefix: '', negative_prompt: '' },
  elevenlabs: { enabled: 'true', api_url: 'https://api.elevenlabs.io', api_key: '', voice_id: '', model_id: 'eleven_multilingual_v2', output_format: 'mp3_44100_128' },
  edge_tts: { voice: 'en-US-AriaNeural', speed: '1.0', lang_code: 'a' },
  deepgram: { enabled: 'false', api_url: 'https://api.deepgram.com', api_key: '', model: 'nova-3', language: 'en', smart_format: 'true', burn_in: 'false' },
  abacus: { enabled: 'false', api_url: 'https://apps.abacus.ai/v1', api_key: '', llm_model: 'gpt-4.1-mini', image_model: 'flux.1-schnell' },
  ffmpeg: { path: '', ffprobe_path: '' },
  serpapi: { key: '' },
  commerce: { api_url: '', site_url: '' },
  social_calendar: { sheet_url: '' },
  social_scheduler: {
    posting_times_est: '9:00 AM, 1:00 PM, 5:00 PM',
    max_posts_per_day: '3',
    max_per_platform_per_day: '2',
    min_gap_minutes: '60',
  },
  prompts: {
    autonomous_prime_system: '',
    content_blog_system: '',
    content_seo_research_prompt: '',
    image_prompt_system: '',
    voice_narration_prompt: '',
    video_storyboard_prompt: '',
    distribution_social_prompt: '',
    chat_planner_prompt: '',
  },
  approvals: {
    require_social_approval: 'true',
    require_video_approval: 'true',
  },
  automation: {
    require_social_approval: 'true',
    require_video_approval: 'true',
    auto_publish_blog: 'false',
    dynamic_topics: 'false',
    daily_topic_niche: '',
    daily_topic_keywords: '',
    daily_topic_count: '3',
    preset_topics: 'AI productivity tools for remote teams\nHow to automate your small business with AI\nBest free AI writing tools in 2026\nChatGPT alternatives for content creators\nHow to make money with AI-generated content\nSEO strategies for AI-generated blog posts\nBuilding a digital product business with AI',
  },
  comment_reply: {
    enabled: 'false',
    platforms: '',
    tone: 'friendly',
    brand_name: '',
    custom_instructions: '',
    poll_interval_minutes: '15',
    max_replies_per_poll: '10',
    skip_keywords: 'spam,promo,buy,click here',
    min_comment_length: '5',
  },
  video: {
    default_aspect_ratio: '16:9',
    landscape_width: '1280',
    landscape_height: '720',
    portrait_width: '1080',
    portrait_height: '1920',
    publish_to_youtube: 'true',
    publish_to_tiktok: 'false',
    publish_to_instagram: 'false',
  },
  x: { enabled: 'false', post_url: '', access_token: '', account_id: '' },
  facebook: { enabled: 'false', post_url: '', access_token: '', page_id: '' },
  facebook_groups: { enabled: 'false', post_url: '', access_token: '', group_id: '' },
  linkedin: { enabled: 'false', post_url: '', access_token: '', author_id: '', author_urn: '' },
  instagram_posts: { enabled: 'false', post_url: '', access_token: '', account_id: '', media_type: 'IMAGE' },
  youtube: { enabled: 'false', upload_url: '', access_token: '', channel_id: '', privacy_status: 'private' },
  tiktok: { enabled: 'false', upload_url: '', access_token: '', creator_id: '', privacy_status: 'PRIVATE' },
  instagram: { enabled: 'false', upload_url: '', access_token: '', account_id: '', media_type: 'REELS' },
  reddit: { enabled: 'false', client_id: '', client_secret: '', username: '', password: '', subreddit: '', post_type: 'link' },
  threads: { enabled: 'false', access_token: '', user_id: '' },
}

function normalizeVisibleSettings(settings: Settings): Settings {
  const next = merge(DEFAULTS, settings)
  next.tool_routing = {
    ...next.tool_routing,
    image_mode: 'cloud',
    // voice_mode is user-controlled: 'elevenlabs' (cloud) or 'edge-tts' (free)
  }
  // Always hardwire Ollama URL
  if (!next.openclaw.ollama_url) next.openclaw.ollama_url = 'http://localhost:11434'
  if (!next.openclaw.ollama_model) next.openclaw.ollama_model = 'llama3'
  return next
}

function merge<T>(base: T, patch?: Partial<T>): T {
  if (!patch) return base
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const current = out[k]
    if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      v &&
      typeof v === 'object' &&
      !Array.isArray(v)
    ) {
      out[k] = merge(current as Record<string, unknown>, v as Record<string, unknown>)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}

type StepKey = 'wordpress' | 'social' | 'video' | 'scheduling' | 'tools' | 'automation'

const STEPS: Array<{ key: StepKey; label: string; description: string }> = [
  { key: 'automation', label: 'Automation', description: 'Full-auto mode, approval gates, and daily pipeline topics.' },
  { key: 'wordpress', label: 'Publishing (WordPress)', description: 'Connect your WordPress site for blog publishing.' },
  { key: 'social', label: 'Publishing (Social)', description: 'Connect your social media accounts for auto-posting.' },
  { key: 'video', label: 'Video Publishing', description: 'Video format defaults and platform upload targets.' },
  { key: 'scheduling', label: 'Scheduling', description: 'Posting times, daily limits, and pacing rules.' },
  { key: 'tools', label: 'AI Providers', description: 'AI engine (Ollama / Claude), voice & audio TTS settings.' },
]

function SetupStepsHint() {
  return (
    <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.6 }}>
      Step 1: Add keys → Step 2: Test → Step 3: Save
    </div>
  )
}

type ConnState = 'connected' | 'needs_attention' | 'not_configured'

type Requirement = {
  missing: string[]
  next_action: string
  reason?: string
}

type StoredTestResult = {
  state: ConnState
  message: string
  ts: string
}

function safeWorkspaceKey() {
  try {
    const id = String(getActiveWorkspaceId() || '').trim()
    return id || 'default'
  } catch {
    return 'default'
  }
}

function testResultStorageKey(workspaceKey: string, service: string) {
  return `autonomous-prime.provider-test.${workspaceKey}.${String(service || '').toLowerCase()}`
}

function loadStoredTestResult(workspaceKey: string, service: string): StoredTestResult | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(testResultStorageKey(workspaceKey, service))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredTestResult>
    const state = parsed.state
    if (state !== 'connected' && state !== 'needs_attention' && state !== 'not_configured') return null
    return {
      state,
      message: String(parsed.message || ''),
      ts: String(parsed.ts || ''),
    }
  } catch {
    return null
  }
}

function persistTestResult(workspaceKey: string, service: string, result: StoredTestResult) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(testResultStorageKey(workspaceKey, service), JSON.stringify(result))
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

function StatusPill({ state }: { state: ConnState }) {
  const meta =
    state === 'connected'
      ? { label: 'Connected', fg: '#3fb950', bg: 'rgba(63,185,80,.14)', border: 'rgba(63,185,80,.35)' }
      : state === 'needs_attention'
        ? { label: 'Needs attention', fg: '#f0883e', bg: 'rgba(240,136,62,.14)', border: 'rgba(240,136,62,.35)' }
        : { label: 'Not configured', fg: 'var(--muted)', bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.12)' }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '6px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        color: meta.fg,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  )
}

function EnabledPill({ enabled }: { enabled: boolean }) {
  const meta = enabled
    ? { label: 'Enabled: Yes', fg: '#3fb950', bg: 'rgba(63,185,80,.14)', border: 'rgba(63,185,80,.35)' }
    : { label: 'Enabled: No', fg: 'var(--muted)', bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.12)' }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '6px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 900,
        color: meta.fg,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  )
}

function MissingHelp({ title, requirement }: { title: string; requirement: Requirement }) {
  if (!requirement.missing.length) return null
  return (
    <div
      style={{
        border: '1px solid rgba(240,136,62,.35)',
        background: 'rgba(240,136,62,.10)',
        padding: '10px 12px',
        borderRadius: 10,
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, color: '#f0883e' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text)' }}>
        <strong>Reason:</strong> {requirement.reason || 'This connection is not fully configured yet.'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text)' }}>
        <strong>Missing:</strong> {requirement.missing.join(', ')}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text)' }}>
        <strong>Next:</strong> {requirement.next_action}
      </div>
    </div>
  )
}

function isBlank(value?: string | null) {
  return !String(value || '').trim()
}

function CopyExample({
  value,
  label = 'Copy example',
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        type="button"
        className="btn-ghost"
        style={{ padding: '4px 10px', fontSize: 12 }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          } catch {
            try {
              const el = document.createElement('textarea')
              el.value = value
              el.style.position = 'fixed'
              el.style.left = '-9999px'
              document.body.appendChild(el)
              el.select()
              document.execCommand('copy')
              el.remove()
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1200)
            } catch {
              setCopied(false)
            }
          }
        }}
      >
        {copied ? 'Copied' : label}
      </button>
      <span className="muted" style={{ fontSize: 12 }}>{value}</span>
    </div>
  )
}

function CollapsibleCard({
  id,
  title,
  description,
  enabled,
  verified,
  expanded,
  onToggle,
  children,
}: {
  id: string
  title: string
  description: string
  enabled: boolean
  verified: ConnState
  expanded: boolean
  onToggle: (id: string) => void
  children: React.ReactNode
}) {
  return (
    <section className="card" style={{ display: 'grid', gap: 10, padding: 18 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="section-title" style={{ marginBottom: 0 }}>{title}</div>
            <EnabledPill enabled={enabled} />
            <StatusPill state={verified} />
          </div>
          <button
            type="button"
            className={expanded ? 'btn-primary' : 'btn-ghost'}
            onClick={() => onToggle(id)}
            style={{ padding: '6px 12px', fontSize: 12 }}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>{description}</div>
      </div>

      {expanded ? <div style={{ display: 'grid', gap: 12 }}>{children}</div> : null}
    </section>
  )
}

function requirementsFor(service: string, payload: any): Requirement {
  const missing: string[] = []
  const lower = String(service || '').toLowerCase()

  if (lower === 'wordpress') {
    if (isBlank(payload?.url)) missing.push('Site URL')
    if (isBlank(payload?.username)) missing.push('Username')
    if (isBlank(payload?.app_password)) missing.push('App Password')
    return {
      missing,
      reason: missing.length ? `${missing[0]} is blank.` : undefined,
      next_action: 'Create a WordPress Application Password (Users → Profile → Application Passwords) and paste it here.',
    }
  }

  if (lower === 'stripe') {
    if (isBlank(payload?.secret_key) && isBlank(payload?.api_key)) missing.push('Secret key')
    return {
      missing,
      reason: missing.length ? 'Stripe Secret Key is blank.' : undefined,
      next_action: 'Paste your Stripe Secret Key (starts with sk_...) or add it to your environment and paste env:STRIPE_SECRET_KEY.',
    }
  }

  if (lower === 'ollama') {
    if (isBlank(payload?.url)) missing.push('Ollama URL')
    if (isBlank(payload?.model)) missing.push('Ollama model')
    return {
      missing,
      reason: missing.length ? `${missing[0]} is blank.` : undefined,
      next_action: 'Install Ollama, start it, then set URL (usually http://localhost:11434) and a model name (e.g., llama3).',
    }
  }

  // Social + publish endpoints (common pattern)
  if (['x', 'facebook', 'facebook_groups', 'linkedin', 'instagram_posts', 'youtube', 'tiktok', 'instagram', 'reddit', 'threads'].includes(lower)) {
    const enabled = String(payload?.enabled ?? 'false') === 'true'
    if (!enabled) {
      return { missing: [], reason: 'Disabled.', next_action: 'Set Enabled to Yes, then add credentials and test again.' }
    }

    if (lower === 'x') {
      if (isBlank(payload?.post_url)) missing.push('Post URL')
      if (isBlank(payload?.access_token)) missing.push('Access Token')
      return { missing, reason: missing.length ? `${missing[0]} is blank.` : undefined, next_action: 'Add the Post URL and Access Token for X, then click Test X.' }
    }

    if (lower === 'facebook') {
      if (isBlank(payload?.access_token)) missing.push('Page Access Token')
      if (isBlank(payload?.page_id)) missing.push('Page ID')
      return { missing, reason: missing.length ? `${missing[0]} is blank.` : undefined, next_action: 'Generate a Page Access Token in Meta and paste it with your Page ID, then test.' }
    }

    if (lower === 'facebook_groups') {
      if (isBlank(payload?.access_token)) missing.push('User Access Token')
      if (isBlank(payload?.group_id)) missing.push('Group ID')
      return { missing, reason: missing.length ? `${missing[0]} is blank.` : undefined, next_action: 'Generate a User Access Token in Meta and paste it with the Group ID, then test.' }
    }

    if (lower === 'linkedin') {
      if (isBlank(payload?.access_token)) missing.push('Access Token')
      if (isBlank(payload?.author_urn)) missing.push('Author URN')
      return { missing, reason: missing.length ? `${missing[0]} is blank.` : undefined, next_action: 'Get a LinkedIn OAuth access token and an author URN (person or org), then test.' }
    }

    if (lower === 'instagram_posts') {
      if (isBlank(payload?.access_token)) missing.push('Page Access Token')
      if (isBlank(payload?.account_id)) missing.push('Instagram User ID')
      return { missing, reason: missing.length ? `${missing[0]} is blank.` : undefined, next_action: 'Paste a Meta Page Access Token and your Instagram Business/Creator User ID, then test.' }
    }

    if (lower === 'youtube') {
      if (isBlank(payload?.access_token)) missing.push('OAuth Access Token')
      if (isBlank(payload?.channel_id)) missing.push('Channel ID')
      return { missing, reason: missing.length ? `${missing[0]} is blank.` : undefined, next_action: 'Create a YouTube OAuth token with youtube.upload scope and paste it with your channel ID, then test.' }
    }

    if (lower === 'tiktok') {
      if (isBlank(payload?.access_token)) missing.push('OAuth Access Token')
      if (isBlank(payload?.creator_id)) missing.push('Creator ID (Open ID)')
      return { missing, reason: missing.length ? `${missing[0]} is blank.` : undefined, next_action: 'Create a TikTok OAuth token with video.publish scope and paste it with the creator Open ID, then test.' }
    }

    if (lower === 'instagram') {
      if (isBlank(payload?.access_token)) missing.push('Page Access Token')
      if (isBlank(payload?.account_id)) missing.push('Instagram User ID')
      return { missing, reason: missing.length ? `${missing[0]} is blank.` : undefined, next_action: 'Use the same Meta credentials as Instagram Posts (token + IG user ID), then test.' }
    }

    if (lower === 'reddit') {
      if (isBlank(payload?.client_id)) missing.push('Client ID')
      if (isBlank(payload?.client_secret)) missing.push('Client Secret')
      if (isBlank(payload?.username)) missing.push('Username')
      if (isBlank(payload?.password)) missing.push('Password')
      if (isBlank(payload?.subreddit)) missing.push('Subreddit')
      return { missing, reason: missing.length ? `${missing[0]} is blank.` : undefined, next_action: 'Create a Reddit script app, then paste client ID/secret and your account credentials and subreddit, then test.' }
    }

    if (lower === 'threads') {
      if (isBlank(payload?.access_token)) missing.push('User Access Token')
      if (isBlank(payload?.user_id)) missing.push('Threads User ID')
      return { missing, reason: missing.length ? `${missing[0]} is blank.` : undefined, next_action: 'Generate a Threads user token with publish scopes and paste it with your Threads user ID, then test.' }
    }
  }

  return {
    missing: [],
    next_action: 'Fill in the required fields, then click Test.',
  }
}

function Card({
  title,
  description,
  right,
  children,
}: {
  title: string
  description?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card" style={{ display: 'grid', gap: 16, padding: 18 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div className="section-title" style={{ marginBottom: 0 }}>{title}</div>
          {right ? <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{right}</div> : null}
        </div>
        {description ? <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>{description}</div> : null}
      </div>
      <div style={{ display: 'grid', gap: 12 }}>{children}</div>
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        alignItems: 'start',
      }}
    >
      {children}
    </div>
  )
}

function Inp(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 600 }}>{label}</span>
      <input {...rest} />
    </label>
  )
}

function Txt(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const { label, ...rest } = props
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 600 }}>{label}</span>
      <textarea {...rest} />
    </label>
  )
}

function Sel(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: Array<{ value: string; label: string }> }) {
  const { label, options, ...rest } = props
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 600 }}>{label}</span>
      <select {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function TestBtn({
  label,
  service,
  payload,
  configured = true,
}: {
  label: string
  service: string
  payload: object
  configured?: boolean
}) {
  const workspaceKey = useMemo(() => safeWorkspaceKey(), [])
  const stored = useMemo(() => loadStoredTestResult(workspaceKey, service), [workspaceKey, service])
  const [msg, setMsg] = useState(() => stored?.message || '')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<ConnState>(() => (configured ? stored?.state || 'needs_attention' : 'not_configured'))
  const [failure, setFailure] = useState<null | { reason: string; missing: string[]; next: string; details?: { method?: string; path?: string; status?: number; code?: string; message?: string } }>(null)
  const [showDetails, setShowDetails] = useState(false)
  const req = requirementsFor(service, payload)

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusPill state={configured ? state : 'not_configured'} />
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setFailure(null)
            setBusy(true)
            setMsg('')
            try {
              if (!configured || req.missing.length) {
                setState('not_configured')
                persistTestResult(workspaceKey, service, {
                  state: 'not_configured',
                  message: '',
                  ts: new Date().toISOString(),
                })
                try {
                  await saveProviderVerification(workspaceKey, {
                    service,
                    state: 'not_configured',
                    message: '',
                    checked_at: new Date().toISOString(),
                  })
                } catch { /* ignore */ }
                setFailure({
                  reason: req.reason || 'Required fields are missing.',
                  missing: req.missing.length ? req.missing : ['Required fields'],
                  next: req.next_action,
                })
                return
              }
              const res = await testConnection(service, payload)
              const nextMsg = String(res.message || (res.ok ? 'Connected' : 'Failed'))
              const nextState: ConnState = res.ok ? 'connected' : 'needs_attention'
              setMsg(nextMsg)
              setState(nextState)
              persistTestResult(workspaceKey, service, {
                state: nextState,
                message: nextMsg,
                ts: new Date().toISOString(),
              })
              try {
                await saveProviderVerification(workspaceKey, {
                  service,
                  state: nextState,
                  message: nextMsg,
                  checked_at: new Date().toISOString(),
                })
              } catch { /* ignore */ }
              if (!res.ok) {
                setFailure({
                  reason: 'We could not verify this connection with the provider.',
                  missing: [],
                  next: 'Double‑check the credentials, then test again.',
                })
              }
            } catch (err) {
              const api = (err as any)?.api as { status?: number; method?: string; path?: string; code?: string; message?: string; service?: string } | undefined
              const raw = api?.message || (err instanceof Error ? err.message : 'Connection failed')
              setMsg(raw)
              setState('needs_attention')
              persistTestResult(workspaceKey, service, {
                state: 'needs_attention',
                message: raw,
                ts: new Date().toISOString(),
              })
              try {
                await saveProviderVerification(workspaceKey, {
                  service,
                  state: 'needs_attention',
                  message: raw,
                  checked_at: new Date().toISOString(),
                })
              } catch { /* ignore */ }

              const status = api?.status
              const code = String(api?.code || '')
              const isTimeout = code === 'ECONNABORTED' || raw.toLowerCase().includes('timeout')
              const isNetwork = !status && (raw.toLowerCase().includes('network') || isTimeout)
              const isAuth = status === 401 || status === 403
              const isLimit = status === 402
              const isNotFound = status === 404

              let reason = 'The provider rejected the credentials or the endpoint was unreachable.'
              let next = req.next_action || 'Recheck your credentials and try again.'

              if (isNotFound) {
                reason = 'Backend route not found.'
                next = api?.service === 'saas'
                  ? 'Start the Node SaaS API on :3001 (`cd api && npm run dev`) and refresh the page.'
                  : 'Start the Python API on :8000 (`python main.py run`) and refresh the page.'
              } else if (isNetwork) {
                reason = 'Backend appears offline or unreachable.'
                next = 'Start your backend server(s) (Python :8000, Node :3001), then click Test again.'
              } else if (isAuth) {
                reason = 'Your session is missing or expired.'
                next = 'Sign out and sign back in, then retry the test.'
              } else if (isLimit) {
                reason = 'Your plan or a limit blocked this action.'
                next = 'Upgrade your plan or reduce usage, then retry.'
              }

              setFailure({
                reason,
                missing: req.missing,
                next,
                details: api ? { method: api.method, path: api.path, status: api.status, code: api.code, message: api.message } : { message: raw },
              })
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Testing...' : label}
        </button>
        {msg ? <span className="muted">{msg}</span> : null}
      </div>

      {failure ? (
        <div
          style={{
            border: '1px solid rgba(248,81,73,.35)',
            background: 'rgba(248,81,73,.08)',
            padding: '10px 12px',
            borderRadius: 10,
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: '#f85149' }}>Fix this to continue</div>
          <div style={{ fontSize: 12, color: 'var(--text)' }}>
            <strong>Reason:</strong> {failure.reason}
          </div>
          {failure.missing?.length ? (
            <div style={{ fontSize: 12, color: 'var(--text)' }}>
              <strong>Missing:</strong> {failure.missing.join(', ')}
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: 'var(--text)' }}>
            <strong>Next:</strong> {failure.next}
          </div>
          {failure.details ? (
            <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowDetails(v => !v)}
                style={{ justifySelf: 'start', padding: '6px 12px', fontSize: 12 }}
              >
                {showDetails ? 'Hide details' : 'Details'}
              </button>
              {showDetails ? (
                <div
                  style={{
                    border: '1px solid rgba(255,255,255,.10)',
                    background: 'rgba(0,0,0,.25)',
                    borderRadius: 10,
                    padding: 10,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: 'var(--text)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {[
                    failure.details.method ? `method: ${failure.details.method}` : null,
                    failure.details.path ? `path: ${failure.details.path}` : null,
                    typeof failure.details.status === 'number' ? `status: ${failure.details.status}` : null,
                    failure.details.code ? `code: ${failure.details.code}` : null,
                    failure.details.message ? `message: ${failure.details.message}` : null,
                  ].filter(Boolean).join('\n')}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [step, setStep] = useState<StepKey>('tools')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [socialShowEnabledOnly, setSocialShowEnabledOnly] = useState(false)
  const [socialExpandAll, setSocialExpandAll] = useState(false)
  const [socialExpandedOverrides, setSocialExpandedOverrides] = useState<Record<string, boolean>>({})
  const [socialSearch, setSocialSearch] = useState('')

  useEffect(() => {
    let mounted = true
    getSettings()
      .then((data) => {
        if (mounted) setSettings(normalizeVisibleSettings(data))
      })
      .catch(() => {
        if (mounted) setSettings(DEFAULTS)
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const workspaceKey = safeWorkspaceKey()
    getProviderVerifications(workspaceKey)
      .then(res => {
        if (!active) return
        for (const item of res.items || []) {
          const state = item.state === 'connected' || item.state === 'needs_attention' || item.state === 'not_configured'
            ? item.state
            : 'needs_attention'
          persistTestResult(workspaceKey, item.service, {
            state,
            message: String(item.message || ''),
            ts: String(item.checked_at || ''),
          })
        }
      })
      .catch(() => {
        // If server persistence isn't available, we fall back to localStorage.
      })
    return () => { active = false }
  }, [])

  const update = <K extends keyof Settings>(section: K, key: keyof Settings[K], value: string) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value,
      },
    }))
  }

  const save = async () => {
    setSaving(true)
    setNotice('')
    try {
      const persistedSettings = normalizeVisibleSettings(settings)
      const result = await saveSettings(persistedSettings)
      if (result.settings) {
        setSettings(normalizeVisibleSettings(result.settings))
      } else {
        setSettings(persistedSettings)
      }
      setNotice(result.warning ? `Settings saved with warning: ${result.warning}` : 'Settings saved.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  const saveCurrentSection = async (section: StepKey) => {
    setSaving(true)
    setNotice('')
    try {
      const subset: Partial<Settings> =
        section === 'wordpress'
          ? { wordpress: settings.wordpress }
          : section === 'social'
            ? {
                x: settings.x,
                facebook: settings.facebook,
                facebook_groups: settings.facebook_groups,
                linkedin: settings.linkedin,
                instagram_posts: settings.instagram_posts,
                youtube: settings.youtube,
                tiktok: settings.tiktok,
                instagram: settings.instagram,
                reddit: settings.reddit,
                threads: settings.threads,
              }
            : section === 'tools'
              ? {
                  openclaw: settings.openclaw,
                  tool_routing: settings.tool_routing,
                  comfyui: settings.comfyui,
                  elevenlabs: settings.elevenlabs,
                  edge_tts: settings.edge_tts,
                  deepgram: settings.deepgram,
                  abacus: settings.abacus,
                  ffmpeg: settings.ffmpeg,
                }
              : section === 'video'
                ? { video: settings.video, youtube: settings.youtube, tiktok: settings.tiktok, instagram: settings.instagram }
                : section === 'scheduling'
                  ? { social_scheduler: settings.social_scheduler, social_calendar: settings.social_calendar }
                  : section === 'automation'
                    ? { automation: settings.automation, approvals: settings.approvals, comment_reply: settings.comment_reply }
                    : settings

      const result = await patchSettings(subset)
      if (result.settings) {
        setSettings(normalizeVisibleSettings(result.settings))
      }
      setNotice(result.warning ? `Settings saved with warning: ${result.warning}` : 'Settings saved.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  const resetRecommended = (section: StepKey) => {
    const recommended = {
      wordpress: { url: '', username: '', app_password: '', default_category: 'Uncategorized', category_map: '' },
      social: {
        x: { ...settings.x, enabled: 'false', post_url: '', access_token: '', account_id: '' },
        facebook: { ...settings.facebook, enabled: 'false', post_url: '', access_token: '', page_id: '' },
        facebook_groups: { ...settings.facebook_groups, enabled: 'false', post_url: '', access_token: '', group_id: '' },
        linkedin: { ...settings.linkedin, enabled: 'false', post_url: '', access_token: '', author_id: '', author_urn: '' },
        instagram_posts: { ...settings.instagram_posts, enabled: 'false', post_url: '', access_token: '', account_id: '', media_type: 'IMAGE' },
        youtube: { ...settings.youtube, enabled: 'false', upload_url: '', access_token: '', channel_id: '', privacy_status: 'private' },
        tiktok: { ...settings.tiktok, enabled: 'false', upload_url: '', access_token: '', creator_id: '', privacy_status: 'PRIVATE' },
        instagram: { ...settings.instagram, enabled: 'false', upload_url: '', access_token: '', account_id: '', media_type: 'REELS' },
        reddit: { ...settings.reddit, enabled: 'false', client_id: '', client_secret: '', username: '', password: '', subreddit: '', post_type: 'link' },
        threads: { ...settings.threads, enabled: 'false', access_token: '', user_id: '' },
      },
      tools: {
        openclaw: { ...settings.openclaw, mode: 'hybrid', ollama_url: 'http://localhost:11434', ollama_model: 'llama3', openai_model: (settings.openclaw as any)?.openai_model ?? 'gpt-4o' },
        tool_routing: { ...settings.tool_routing, voice_mode: 'edge-tts', image_mode: 'cloud' },
        comfyui: { ...settings.comfyui, url: settings.comfyui?.url || 'http://localhost:8188' },
        elevenlabs: { ...settings.elevenlabs, enabled: 'false', api_url: 'https://api.elevenlabs.io', api_key: '', voice_id: '', model_id: 'eleven_multilingual_v2', output_format: 'mp3_44100_128' },
        edge_tts: { ...settings.edge_tts, voice: 'en-US-AriaNeural', speed: '1.0' },
      },
      video: {
        video: {
          ...settings.video,
          default_aspect_ratio: '16:9',
          landscape_width: '1280',
          landscape_height: '720',
          portrait_width: '1080',
          portrait_height: '1920',
          publish_to_youtube: 'true',
          publish_to_tiktok: 'false',
          publish_to_instagram: 'false',
        },
      },
      scheduling: {
        social_scheduler: {
          ...settings.social_scheduler,
          posting_times_est: '9:00 AM, 1:00 PM, 5:00 PM',
          max_posts_per_day: '3',
          max_per_platform_per_day: '2',
          min_gap_minutes: '60',
        },
      },
    } as const

    setSettings(prev => {
      if (section === 'wordpress') return { ...prev, wordpress: recommended.wordpress }
      if (section === 'social') {
        return {
          ...prev,
          x: recommended.social.x,
          facebook: recommended.social.facebook,
          facebook_groups: recommended.social.facebook_groups,
          linkedin: recommended.social.linkedin,
          instagram_posts: recommended.social.instagram_posts,
          youtube: recommended.social.youtube,
          tiktok: recommended.social.tiktok,
          instagram: recommended.social.instagram,
          reddit: recommended.social.reddit,
          threads: recommended.social.threads,
        }
      }
      if (section === 'tools') {
        return {
          ...prev,
          openclaw: recommended.tools.openclaw as any,
          tool_routing: recommended.tools.tool_routing,
          comfyui: recommended.tools.comfyui,
          elevenlabs: recommended.tools.elevenlabs,
          edge_tts: recommended.tools.edge_tts,
        }
      }
      if (section === 'video') return { ...prev, video: recommended.video.video }
      if (section === 'scheduling') return { ...prev, social_scheduler: recommended.scheduling.social_scheduler }
      return prev
    })

    const label =
      section === 'wordpress' ? 'Publishing (WordPress)'
        : section === 'social' ? 'Publishing (Social)'
          : section === 'tools' ? 'AI Providers'
            : section === 'video' ? 'Video Publishing'
              : section === 'scheduling' ? 'Scheduling'
                : section
    setNotice(`Reset ${label} to recommended defaults. Remember to save.`)
  }

  const currentStep = STEPS.find((item) => item.key === step) ?? STEPS[0]
  const currentStepIndex = Math.max(STEPS.findIndex((item) => item.key === currentStep.key), 0)

  const recommendedNext = (() => {
    const workspaceKey = safeWorkspaceKey()
    const didPass = (service: string) => loadStoredTestResult(workspaceKey, service)?.state === 'connected'

    // Chunk G: base recommendations on persisted test results.
    // 1) WordPress never successfully tested → recommend WordPress
    if (!didPass('wordpress')) {
      return {
        key: 'wordpress' as StepKey,
        label: 'Connect WordPress',
        detail: 'Run a successful WordPress test so publishing can work reliably.',
      }
    }

    // 2) No AI provider test passed → recommend AI Providers
    // (Ollama + Claude have test endpoints; OpenAI key presence is not a reliable "tested" signal.)
    const anyAiPassed = didPass('ollama') || didPass('claude')
    if (!anyAiPassed) {
      return {
        key: 'tools' as StepKey,
        label: 'Verify an AI provider',
        detail: 'Run a successful test for Ollama or Claude so content generation is ready.',
      }
    }

    // 3) No social provider test passed → recommend Social
    const anySocialPassed =
      didPass('x') ||
      didPass('facebook') ||
      didPass('facebook_groups') ||
      didPass('linkedin') ||
      didPass('instagram_posts') ||
      didPass('youtube') ||
      didPass('tiktok') ||
      didPass('instagram') ||
      didPass('reddit') ||
      didPass('threads')
    if (!anySocialPassed) {
      return {
        key: 'social' as StepKey,
        label: 'Verify a social provider',
        detail: 'Run a successful test for at least one social provider before relying on auto‑posting.',
      }
    }

    // 4) Otherwise recommend Scheduling
    return {
      key: 'scheduling' as StepKey,
      label: 'Review scheduling rules',
      detail: 'Confirm posting times and limits match your content cadence.',
    }
  })()

return (
    <div className="container">
      <div
        className="card"
        style={{
          marginBottom: 18,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Settings</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
            Organized by setup step so API keys, tools, commerce, and publishing controls stay grouped by purpose.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {notice ? <span style={{ color: 'var(--muted)', fontSize: 13 }}>{notice}</span> : null}
          <button className="btn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ display: 'grid', gap: 12 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Settings Tabs</div>
            <div className="inline-wrap">
              {STEPS.map((item) => (
                <button
                  key={item.key}
                  className={step === item.key ? 'btn-primary' : 'btn-ghost'}
                  onClick={() => setStep(item.key)}
                  style={{
                    textAlign: 'left',
                    minWidth: 180,
                    justifyContent: 'flex-start',
                  }}
                >
                  {item.label.replace(/^\d+\.\s*/, '')}
                </button>
              ))}
            </div>
            <div className="muted-copy">
              Switch between grouped settings by purpose instead of scrolling through one long admin form.
            </div>
          </div>

          <div className="summary-grid">
            <div className="summary-card">
              <div className="summary-label">Current tab</div>
              <div className="summary-value summary-value-sm">{currentStep.label.replace(/^\d+\.\s*/, '')}</div>
              <div className="muted-copy">{currentStep.description}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Step</div>
              <div className="summary-value">{currentStepIndex + 1}/{STEPS.length}</div>
              <div className="muted-copy">Grouped setup sections</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Save state</div>
              <div className="summary-value summary-value-sm">{saving ? 'Saving' : 'Ready'}</div>
              <div className="muted-copy">{notice || 'Changes stay local until you save.'}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Recommended next</div>
              <div className="summary-value summary-value-sm">{recommendedNext.label}</div>
              <div className="muted-copy">{recommendedNext.detail}</div>
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setStep(recommendedNext.key)}
                  style={{ padding: '7px 14px', fontSize: 12 }}
                >
                  Take me there
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ display: 'grid', gap: 6 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>{currentStep.label}</div>
            <div style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700 }}>
              {currentStep.label.replace(/^\d+\.\s*/, '')}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
              {currentStep.description}
            </div>
          </div>


      {step === 'wordpress' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SetupStepsHint />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn-ghost" disabled={saving} onClick={() => resetRecommended('wordpress')} style={{ padding: '6px 14px', fontSize: 12 }}>
                Reset to recommended
              </button>
              <button className="btn-ghost" disabled={saving} onClick={() => saveCurrentSection('wordpress')} style={{ padding: '6px 14px', fontSize: 12 }}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </div>
          <Card title="Publishing (WordPress)" description="Connect your WordPress site for automatic blog publishing and SEO sync.">
            <Row>
              <Inp label="Site URL" value={settings.wordpress.url} onChange={(e) => update('wordpress', 'url', e.target.value)} />
              <Inp label="Username" value={settings.wordpress.username} onChange={(e) => update('wordpress', 'username', e.target.value)} />
              <Inp label="App Password" type="password" value={settings.wordpress.app_password} onChange={(e) => update('wordpress', 'app_password', e.target.value)} />
              <Inp label="Default Category" value={settings.wordpress.default_category} onChange={(e) => update('wordpress', 'default_category', e.target.value)} />
            </Row>
            <div className="muted-copy">Example: store in env and reference it here.</div>
            <CopyExample value="env:WP_APP_PASSWORD" label="Copy app password reference" />
            <Txt
              label="Category Map"
              rows={5}
              placeholder={`Map generated categories to your site categories\nExample:\nGeneral=Blog\nProductivity Tips=Productivity`}
              value={settings.wordpress.category_map}
              onChange={(e) => update('wordpress', 'category_map', e.target.value)}
            />
            <TestBtn
              label="Test WordPress"
              service="wordpress"
              payload={settings.wordpress}
              configured={Boolean(settings.wordpress.url?.trim() && settings.wordpress.username?.trim() && settings.wordpress.app_password?.trim())}
            />
          </Card>

        </div>
      )}

      {step === 'automation' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Card title="Approval Gates" description="Control whether posts wait for manual review before publishing. Disable to run fully autonomously.">
            <Row>
              <Sel
                label="Require Social Approval"
                value={settings.automation?.require_social_approval ?? 'true'}
                onChange={(e) => update('automation', 'require_social_approval', e.target.value)}
                options={[
                  { value: 'true', label: 'Yes — hold for review' },
                  { value: 'false', label: 'No — post automatically' },
                ]}
              />
              <Sel
                label="Require Video Approval"
                value={settings.automation?.require_video_approval ?? 'true'}
                onChange={(e) => update('automation', 'require_video_approval', e.target.value)}
                options={[
                  { value: 'true', label: 'Yes — hold for review' },
                  { value: 'false', label: 'No — publish automatically' },
                ]}
              />
            </Row>
          </Card>

          <Card title="Blog Publishing" description="Automatically publish blog posts to WordPress when the pipeline finishes.">
            <Row>
              <Sel
                label="Auto-Publish to WordPress"
                value={settings.automation?.auto_publish_blog ?? 'false'}
                onChange={(e) => update('automation', 'auto_publish_blog', e.target.value)}
                options={[
                  { value: 'false', label: 'No — save as draft only' },
                  { value: 'true', label: 'Yes — publish immediately' },
                ]}
              />
            </Row>
          </Card>

          <Card title="Daily Pipeline Topics" description="The scheduler runs a content pipeline every day at 8 AM UTC. You can manage your own topic list or let AI generate fresh ones.">
            <Row>
              <Sel
                label="Topic Mode"
                value={settings.automation?.dynamic_topics ?? 'false'}
                onChange={(e) => update('automation', 'dynamic_topics', e.target.value)}
                options={[
                  { value: 'false', label: 'Preset rotation — my topic list' },
                  { value: 'true', label: 'AI-generated daily topics' },
                ]}
              />
              <Inp
                label="Daily Topic Count"
                value={settings.automation?.daily_topic_count ?? '3'}
                onChange={(e) => update('automation', 'daily_topic_count', e.target.value)}
                placeholder="3"
              />
            </Row>

            {(settings.automation?.dynamic_topics ?? 'false') === 'false' && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                  Preset Topics <span style={{ fontWeight: 400 }}>(one per line — runs in order, loops when finished)</span>
                </label>
                <textarea
                  rows={10}
                  style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
                  value={settings.automation?.preset_topics ?? ''}
                  onChange={(e) => update('automation', 'preset_topics', e.target.value)}
                  placeholder={[
                    'AI productivity tools for remote teams',
                    'How to automate your small business with AI',
                    'Best free AI writing tools in 2026',
                    'ChatGPT alternatives for content creators',
                    'How to make money with AI-generated content',
                    'SEO strategies for AI-generated blog posts',
                    'Building a digital product business with AI',
                  ].join('\n')}
                />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {(settings.automation?.preset_topics ?? '').split('\n').filter(t => t.trim()).length} topics saved
                </div>
              </div>
            )}

            {(settings.automation?.dynamic_topics ?? 'false') === 'true' && (
              <Row>
                <Inp
                  label="Niche / Industry"
                  value={settings.automation?.daily_topic_niche ?? ''}
                  onChange={(e) => update('automation', 'daily_topic_niche', e.target.value)}
                  placeholder="e.g. AI tools, digital marketing, personal finance"
                />
                <Inp
                  label="Target Keywords (comma-separated)"
                  value={settings.automation?.daily_topic_keywords ?? ''}
                  onChange={(e) => update('automation', 'daily_topic_keywords', e.target.value)}
                  placeholder="e.g. passive income, side hustle, automation"
                />
              </Row>
            )}
          </Card>

          <Card title="Auto Comment Reply" description="Automatically reply to comments and mentions using AI. Replies match your brand tone.">
            <Row>
              <Sel
                label="Enable Auto-Reply"
                value={settings.comment_reply?.enabled ?? 'false'}
                onChange={(e) => update('comment_reply', 'enabled', e.target.value)}
                options={[
                  { value: 'false', label: 'Off' },
                  { value: 'true', label: 'On — reply automatically' },
                ]}
              />
              <Sel
                label="Reply Tone"
                value={settings.comment_reply?.tone ?? 'friendly'}
                onChange={(e) => update('comment_reply', 'tone', e.target.value)}
                options={[
                  { value: 'friendly', label: 'Friendly' },
                  { value: 'professional', label: 'Professional' },
                  { value: 'casual', label: 'Casual' },
                  { value: 'witty', label: 'Witty' },
                  { value: 'empathetic', label: 'Empathetic' },
                ]}
              />
            </Row>
            <Row>
              <Inp
                label="Brand Name"
                value={settings.comment_reply?.brand_name ?? ''}
                onChange={(e) => update('comment_reply', 'brand_name', e.target.value)}
                placeholder="e.g. Autonomous Prime"
              />
              <Inp
                label="Poll Interval (minutes)"
                value={settings.comment_reply?.poll_interval_minutes ?? '15'}
                onChange={(e) => update('comment_reply', 'poll_interval_minutes', e.target.value)}
                placeholder="15"
              />
            </Row>
            <Row>
              <Inp
                label="Max Replies Per Cycle"
                value={settings.comment_reply?.max_replies_per_poll ?? '10'}
                onChange={(e) => update('comment_reply', 'max_replies_per_poll', e.target.value)}
                placeholder="10"
              />
              <Inp
                label="Skip Keywords (comma-separated)"
                value={settings.comment_reply?.skip_keywords ?? 'spam,promo,buy,click here'}
                onChange={(e) => update('comment_reply', 'skip_keywords', e.target.value)}
                placeholder="spam,promo,buy,click here"
              />
            </Row>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                Platforms (check all that apply)
              </label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {['twitter', 'facebook', 'instagram', 'youtube', 'wordpress', 'reddit', 'threads'].map(p => {
                  const active = (settings.comment_reply?.platforms ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(p)
                  return (
                    <button
                      key={p}
                      onClick={() => {
                        const current = (settings.comment_reply?.platforms ?? '').split(',').map(s => s.trim()).filter(Boolean)
                        const next = active ? current.filter(x => x !== p) : [...current, p]
                        update('comment_reply', 'platforms', next.join(','))
                      }}
                      style={{
                        padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: active ? 'rgba(99,102,241,.18)' : 'rgba(255,255,255,.04)',
                        border: active ? '1px solid rgba(99,102,241,.5)' : '1px solid rgba(255,255,255,.1)',
                        color: active ? '#a5b4fc' : 'var(--muted)',
                      }}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                Custom Reply Instructions <span style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                rows={3}
                style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
                value={settings.comment_reply?.custom_instructions ?? ''}
                onChange={(e) => update('comment_reply', 'custom_instructions', e.target.value)}
                placeholder="e.g. Always mention our free trial. Never discuss competitors. End with a question."
              />
            </div>
          </Card>
        </div>
      )}

      {step === 'scheduling' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SetupStepsHint />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn-ghost" disabled={saving} onClick={() => resetRecommended('scheduling')} style={{ padding: '6px 14px', fontSize: 12 }}>
                Reset to recommended
              </button>
              <button className="btn-ghost" disabled={saving} onClick={() => saveCurrentSection('scheduling')} style={{ padding: '6px 14px', fontSize: 12 }}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </div>
          <Card title="Scheduling Rules" description="Default posting times and posting limits used by the internal planner.">
            <Row>
              <Inp
                label="Posting Times EST"
                value={settings.social_scheduler.posting_times_est}
                onChange={(e) => update('social_scheduler', 'posting_times_est', e.target.value)}
                placeholder="9:00 AM, 1:00 PM, 5:00 PM"
              />
              <Inp
                label="Max Posts / Day"
                value={settings.social_scheduler.max_posts_per_day}
                onChange={(e) => update('social_scheduler', 'max_posts_per_day', e.target.value)}
              />
              <Inp
                label="Max / Platform / Day"
                value={settings.social_scheduler.max_per_platform_per_day}
                onChange={(e) => update('social_scheduler', 'max_per_platform_per_day', e.target.value)}
              />
              <Inp
                label="Min Gap Minutes"
                value={settings.social_scheduler.min_gap_minutes}
                onChange={(e) => update('social_scheduler', 'min_gap_minutes', e.target.value)}
              />
            </Row>
            <div className="muted-copy">
              Recommended defaults: 9:00 AM, 1:00 PM, 5:00 PM • max 3/day • max 2/platform/day • 60 min gap.
            </div>
          </Card>
        </div>
      )}

      {step === 'social' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SetupStepsHint />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={socialSearch}
                onChange={e => setSocialSearch(e.target.value)}
                placeholder="Search providers (insta, yt, threads, linkedin...)"
                style={{
                  width: 320,
                  maxWidth: '100%',
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,.10)',
                  background: 'rgba(0,0,0,.18)',
                  color: 'var(--text)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                className={socialShowEnabledOnly ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setSocialShowEnabledOnly(v => !v)}
                style={{ padding: '6px 12px', fontSize: 12 }}
              >
                Show enabled only
              </button>
              <button
                type="button"
                className={socialExpandAll ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setSocialExpandAll(v => !v)}
                style={{ padding: '6px 12px', fontSize: 12 }}
              >
                Expand all
              </button>
              <button type="button" className="btn-ghost" disabled={saving} onClick={() => resetRecommended('social')} style={{ padding: '6px 14px', fontSize: 12 }}>
                Reset to recommended
              </button>
              <button className="btn-ghost" disabled={saving} onClick={() => saveCurrentSection('social')} style={{ padding: '6px 14px', fontSize: 12 }}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </div>
          {(() => {
            const providers = [
              {
                id: 'x',
                title: 'X Post API',
                description: 'Credentials and endpoint for posting text and linked media to X.',
                enabled: String(settings.x.enabled) === 'true',
                keywords: ['twitter', 'x', 'tweet', 'tweets'],
                service: 'x',
                payload: settings.x,
                content: (
                  <>
                    <Row>
                      <Sel label="Enabled" value={settings.x.enabled} onChange={(e) => update('x', 'enabled', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                      <Inp label="Post URL" value={settings.x.post_url} onChange={(e) => update('x', 'post_url', e.target.value)} />
                      <Inp label="Access Token" type="password" value={settings.x.access_token} onChange={(e) => update('x', 'access_token', e.target.value)} />
                      <Inp label="Account ID" value={settings.x.account_id} onChange={(e) => update('x', 'account_id', e.target.value)} />
                    </Row>
                    <TestBtn label="Test X" service="x" payload={settings.x} configured={Boolean(settings.x.post_url?.trim() && settings.x.access_token?.trim())} />
                  </>
                ),
              },
              {
                id: 'facebook',
                title: 'Facebook Page',
                description: 'Post directly to your Facebook Page via the Graph API. Requires a Page Access Token and your Page ID.',
                enabled: String(settings.facebook.enabled) === 'true',
                keywords: ['fb', 'facebook', 'page', 'meta'],
                service: 'facebook',
                payload: settings.facebook,
                content: (
                  <>
                    <Row>
                      <Sel label="Enabled" value={settings.facebook.enabled} onChange={(e) => update('facebook', 'enabled', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                      <Inp label="Page Access Token" type="password" value={settings.facebook.access_token} onChange={(e) => update('facebook', 'access_token', e.target.value)} placeholder="EAAxxxxxxx..." />
                      <Inp label="Page ID" value={settings.facebook.page_id} onChange={(e) => update('facebook', 'page_id', e.target.value)} placeholder="Your Facebook Page numeric ID" />
                    </Row>
                    <TestBtn label="Test Facebook" service="facebook" payload={settings.facebook} configured={Boolean(settings.facebook.access_token?.trim() && settings.facebook.page_id?.trim())} />
                  </>
                ),
              },
              {
                id: 'facebook_groups',
                title: 'Facebook Groups',
                description: 'Post directly to a Facebook Group via the Graph API. Requires a User Access Token and your Group ID.',
                enabled: String(settings.facebook_groups.enabled) === 'true',
                keywords: ['fb', 'facebook', 'group', 'groups', 'meta'],
                service: 'facebook_groups',
                payload: settings.facebook_groups,
                content: (
                  <>
                    <Row>
                      <Sel label="Enabled" value={settings.facebook_groups.enabled} onChange={(e) => update('facebook_groups', 'enabled', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                      <Inp label="User Access Token" type="password" value={settings.facebook_groups.access_token} onChange={(e) => update('facebook_groups', 'access_token', e.target.value)} placeholder="EAAxxxxxxx..." />
                      <Inp label="Group ID" value={settings.facebook_groups.group_id} onChange={(e) => update('facebook_groups', 'group_id', e.target.value)} placeholder="Your Facebook Group numeric ID" />
                    </Row>
                    <TestBtn label="Test Facebook Groups" service="facebook_groups" payload={settings.facebook_groups} configured={Boolean(settings.facebook_groups.access_token?.trim() && settings.facebook_groups.group_id?.trim())} />
                  </>
                ),
              },
              {
                id: 'linkedin',
                title: 'LinkedIn',
                description: 'Post text and images directly to LinkedIn via the UGC Posts API v2. Requires an OAuth 2.0 access token and your author URN (urn:li:person:… or urn:li:organization:…).',
                enabled: String(settings.linkedin.enabled) === 'true',
                keywords: ['li', 'linkedin', 'urn', 'company', 'organization', 'person'],
                service: 'linkedin',
                payload: settings.linkedin,
                content: (
                  <>
                    <Row>
                      <Sel label="Enabled" value={settings.linkedin.enabled} onChange={(e) => update('linkedin', 'enabled', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                      <Inp label="Access Token (OAuth 2.0)" type="password" value={settings.linkedin.access_token} onChange={(e) => update('linkedin', 'access_token', e.target.value)} placeholder="Your LinkedIn OAuth 2.0 access token" />
                      <Inp label="Author URN" value={settings.linkedin.author_urn} onChange={(e) => update('linkedin', 'author_urn', e.target.value)} placeholder="urn:li:person:xxxxxxxx  or  urn:li:organization:xxxxxxxx" />
                    </Row>
                    <div className="muted-copy">Example formats (pick one):</div>
                    <CopyExample value="urn:li:person:123456789" label="Copy person URN example" />
                    <CopyExample value="urn:li:organization:123456789" label="Copy org URN example" />
                    <TestBtn label="Test LinkedIn" service="linkedin" payload={settings.linkedin} configured={Boolean(settings.linkedin.access_token?.trim() && settings.linkedin.author_urn?.trim())} />
                  </>
                ),
              },
              {
                id: 'instagram_posts',
                title: 'Instagram (Feed / Posts)',
                description: 'Post images directly to Instagram via the Facebook Graph API. Requires a Page Access Token and your Instagram User ID (not Page ID).',
                enabled: String(settings.instagram_posts.enabled) === 'true',
                keywords: ['ig', 'insta', 'instagram', 'feed', 'posts', 'meta'],
                service: 'instagram_posts',
                payload: settings.instagram_posts,
                content: (
                  <>
                    <Row>
                      <Sel label="Enabled" value={settings.instagram_posts.enabled} onChange={(e) => update('instagram_posts', 'enabled', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                      <Inp label="Page Access Token" type="password" value={settings.instagram_posts.access_token} onChange={(e) => update('instagram_posts', 'access_token', e.target.value)} placeholder="EAAxxxxxxx..." />
                      <Inp label="Instagram User ID" value={settings.instagram_posts.account_id} onChange={(e) => update('instagram_posts', 'account_id', e.target.value)} placeholder="Your Instagram Business/Creator User ID" />
                      <Sel label="Media Type" value={settings.instagram_posts.media_type} onChange={(e) => update('instagram_posts', 'media_type', e.target.value)} options={[{ value: 'IMAGE', label: 'Image' }, { value: 'CAROUSEL', label: 'Carousel' }]} />
                    </Row>
                    <TestBtn label="Test Instagram Posts" service="instagram_posts" payload={settings.instagram_posts} configured={Boolean(settings.instagram_posts.access_token?.trim() && settings.instagram_posts.account_id?.trim())} />
                  </>
                ),
              },
            ] as const

            const q = socialSearch.trim().toLowerCase()
            const matchesQuery = (p: (typeof providers)[number]) => {
              if (!q) return true
              const hay = [
                p.id,
                p.title,
                p.description,
                ...(Array.isArray((p as any).keywords) ? (p as any).keywords : []),
              ].join(' ').toLowerCase()
              return hay.includes(q)
            }

            const visible = (socialShowEnabledOnly ? providers.filter(p => p.enabled) : providers).filter(matchesQuery)
            if (!visible.length) {
              return (
                <div className="muted-copy">
                  No providers match this view.
                  {socialShowEnabledOnly ? ' Turn “Show enabled only” off to configure a new account.' : ''}
                </div>
              )
            }

            const workspaceKey = safeWorkspaceKey()
            const verifiedStateFor = (service: string, payload: any, enabled: boolean): ConnState => {
              if (!enabled) return 'not_configured'
              const req = requirementsFor(service, payload)
              if (req.missing.length) return 'not_configured'
              const stored = loadStoredTestResult(workspaceKey, service)
              return stored?.state || 'needs_attention'
            }

            const effectiveExpanded = (id: string, enabled: boolean) => {
              if (socialExpandAll) return true
              if (id in socialExpandedOverrides) return Boolean(socialExpandedOverrides[id])
              return enabled
            }

            const toggle = (id: string) => {
              const provider = visible.find(p => p.id === id) || providers.find(p => p.id === id)
              const enabled = Boolean(provider?.enabled)
              const next = !effectiveExpanded(id, enabled)
              setSocialExpandedOverrides(prev => ({ ...prev, [id]: next }))
            }

            return (
              <div style={{ display: 'grid', gap: 12 }}>
                {visible.map(provider => (
                  <CollapsibleCard
                    key={provider.id}
                    id={provider.id}
                    title={provider.title}
                    description={provider.description}
                    enabled={provider.enabled}
                    verified={verifiedStateFor(provider.service, provider.payload, provider.enabled)}
                    expanded={effectiveExpanded(provider.id, provider.enabled)}
                    onToggle={toggle}
                  >
                    {provider.content}
                  </CollapsibleCard>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      {step === 'video' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SetupStepsHint />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn-ghost" disabled={saving} onClick={() => resetRecommended('video')} style={{ padding: '6px 14px', fontSize: 12 }}>
                Reset to recommended
              </button>
              <button className="btn-ghost" disabled={saving} onClick={() => saveCurrentSection('video')} style={{ padding: '6px 14px', fontSize: 12 }}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </div>
          <Card title="Video Publishing Defaults" description="Global defaults for generated video size, aspect ratio, and auto-publish behavior.">
            <Row>
              <Sel
                label="Default Aspect Ratio"
                value={settings.video.default_aspect_ratio}
                onChange={(e) => update('video', 'default_aspect_ratio', e.target.value)}
                options={[
                  { value: '16:9', label: '16:9 Landscape — Recommended' },
                  { value: '9:16', label: '9:16 Portrait' },
                  { value: '1:1', label: '1:1 Square' },
                ]}
              />
              <Inp label="Landscape Width" value={settings.video.landscape_width} onChange={(e) => update('video', 'landscape_width', e.target.value)} />
              <Inp label="Landscape Height" value={settings.video.landscape_height} onChange={(e) => update('video', 'landscape_height', e.target.value)} />
              <Inp label="Portrait Width" value={settings.video.portrait_width} onChange={(e) => update('video', 'portrait_width', e.target.value)} />
              <Inp label="Portrait Height" value={settings.video.portrait_height} onChange={(e) => update('video', 'portrait_height', e.target.value)} />
              <Sel label="Publish To YouTube" value={settings.video.publish_to_youtube} onChange={(e) => update('video', 'publish_to_youtube', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
              <Sel label="Publish To TikTok" value={settings.video.publish_to_tiktok} onChange={(e) => update('video', 'publish_to_tiktok', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
              <Sel label="Publish To Instagram" value={settings.video.publish_to_instagram} onChange={(e) => update('video', 'publish_to_instagram', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
            </Row>
            <div className="muted-copy">Recommended default is 16:9 unless your main channel is Shorts/Reels/TikTok.</div>
          </Card>

          <Card title="YouTube" description="Upload videos directly to YouTube via the Data API v3. Requires an OAuth 2.0 access token with youtube.upload scope.">
            <Row>
              <Sel label="Enabled" value={settings.youtube.enabled} onChange={(e) => update('youtube', 'enabled', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
              <Inp label="OAuth Access Token" type="password" value={settings.youtube.access_token} onChange={(e) => update('youtube', 'access_token', e.target.value)} placeholder="ya29.xxxxxxx..." />
              <Inp label="Channel ID" value={settings.youtube.channel_id} onChange={(e) => update('youtube', 'channel_id', e.target.value)} placeholder="UCxxxxxxx..." />
              <Inp label="API Key (for comment polling)" type="password" value={(settings.youtube as Record<string,string>).api_key ?? ''} onChange={(e) => update('youtube', 'api_key', e.target.value)} placeholder="AIzaSy..." />
              <Sel
                label="Privacy Status"
                value={settings.youtube.privacy_status}
                onChange={(e) => update('youtube', 'privacy_status', e.target.value)}
                options={[
                  { value: 'private', label: 'Private' },
                  { value: 'unlisted', label: 'Unlisted' },
                  { value: 'public', label: 'Public' },
                ]}
              />
            </Row>
            <div className="muted-copy">Channel IDs usually start with UC.</div>
            <CopyExample value="UCxxxxxxxxxxxxxxxxxx" label="Copy channel ID example" />
            <TestBtn
              label="Test YouTube"
              service="youtube"
              payload={settings.youtube}
              configured={Boolean(settings.youtube.access_token?.trim() && settings.youtube.channel_id?.trim())}
            />
          </Card>

          <Card title="TikTok" description="Post videos directly to TikTok via the Content Posting API v2. Requires an OAuth 2.0 access token with video.publish scope and your Open ID (creator_id).">
            <Row>
              <Sel label="Enabled" value={settings.tiktok.enabled} onChange={(e) => update('tiktok', 'enabled', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
              <Inp label="OAuth Access Token" type="password" value={settings.tiktok.access_token} onChange={(e) => update('tiktok', 'access_token', e.target.value)} placeholder="act.xxxxxxx..." />
              <Inp label="Creator ID (Open ID)" value={settings.tiktok.creator_id} onChange={(e) => update('tiktok', 'creator_id', e.target.value)} placeholder="Your TikTok Open ID" />
              <Sel
                label="Privacy Status"
                value={settings.tiktok.privacy_status}
                onChange={(e) => update('tiktok', 'privacy_status', e.target.value)}
                options={[
                  { value: 'PRIVATE', label: 'Private' },
                  { value: 'FOLLOWERS', label: 'Followers' },
                  { value: 'PUBLIC', label: 'Public' },
                ]}
              />
            </Row>
            <div className="muted-copy">Creator ID is the TikTok Open ID returned during OAuth.</div>
            <CopyExample value="open_id_example_123456789" label="Copy Open ID example" />
            <TestBtn
              label="Test TikTok"
              service="tiktok"
              payload={settings.tiktok}
              configured={Boolean(settings.tiktok.access_token?.trim() && settings.tiktok.creator_id?.trim())}
            />
          </Card>

          <Card title="Instagram (Reels / Video)" description="Post Reels to Instagram via the Facebook Graph API. Uses the same credentials as Instagram Posts — Page Access Token and Instagram User ID.">
            <Row>
              <Sel label="Enabled" value={settings.instagram.enabled} onChange={(e) => update('instagram', 'enabled', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
              <Inp label="Page Access Token" type="password" value={settings.instagram.access_token} onChange={(e) => update('instagram', 'access_token', e.target.value)} placeholder="EAAxxxxxxx..." />
              <Inp label="Instagram User ID" value={settings.instagram.account_id} onChange={(e) => update('instagram', 'account_id', e.target.value)} placeholder="Your Instagram Business/Creator User ID" />
              <Sel
                label="Media Type"
                value={settings.instagram.media_type}
                onChange={(e) => update('instagram', 'media_type', e.target.value)}
                options={[
                  { value: 'REELS', label: 'Reels' },
                  { value: 'STORIES', label: 'Stories' },
                  { value: 'FEED', label: 'Feed' },
                ]}
              />
            </Row>
            <TestBtn
              label="Test Instagram Upload"
              service="instagram"
              payload={settings.instagram}
              configured={Boolean(settings.instagram.access_token?.trim() && settings.instagram.account_id?.trim())}
            />
          </Card>

          <Card title="Reddit" description="Post link posts or text posts to Reddit communities via the OAuth2 Script API. Create a Script-type app at reddit.com/prefs/apps to get your Client ID and Secret.">
            <Row>
              <Sel label="Enabled" value={settings.reddit.enabled} onChange={(e) => update('reddit', 'enabled', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
              <Inp label="Client ID" value={settings.reddit.client_id} onChange={(e) => update('reddit', 'client_id', e.target.value)} placeholder="Your Reddit app Client ID" />
              <Inp label="Client Secret" type="password" value={settings.reddit.client_secret} onChange={(e) => update('reddit', 'client_secret', e.target.value)} placeholder="Your Reddit app Client Secret" />
              <Inp label="Reddit Username" value={settings.reddit.username} onChange={(e) => update('reddit', 'username', e.target.value)} placeholder="your_reddit_username" />
              <Inp label="Reddit Password" type="password" value={settings.reddit.password} onChange={(e) => update('reddit', 'password', e.target.value)} placeholder="Your Reddit account password" />
              <Inp label="Subreddit(s)" value={settings.reddit.subreddit} onChange={(e) => update('reddit', 'subreddit', e.target.value)} placeholder="programming,webdev (comma-separated)" />
              <Sel label="Post Type" value={settings.reddit.post_type} onChange={(e) => update('reddit', 'post_type', e.target.value)} options={[{ value: 'link', label: 'Link Post (shares URL)' }, { value: 'self', label: 'Self Post (text body)' }]} />
            </Row>
            <TestBtn
              label="Test Reddit"
              service="reddit"
              payload={settings.reddit}
              configured={Boolean(settings.reddit.client_id?.trim() && settings.reddit.client_secret?.trim() && settings.reddit.username?.trim() && settings.reddit.password?.trim() && settings.reddit.subreddit?.trim())}
            />
          </Card>

          <Card title="Threads" description="Post to Threads via the Meta Threads Graph API. Generate a user access token with threads_basic and threads_content_publish scopes from the Meta Developer Portal.">
            <Row>
              <Sel label="Enabled" value={settings.threads.enabled} onChange={(e) => update('threads', 'enabled', e.target.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
              <Inp label="User Access Token" type="password" value={settings.threads.access_token} onChange={(e) => update('threads', 'access_token', e.target.value)} placeholder="THAAxxxx..." />
              <Inp label="Threads User ID" value={settings.threads.user_id} onChange={(e) => update('threads', 'user_id', e.target.value)} placeholder="Your numeric Threads User ID" />
            </Row>
            <TestBtn
              label="Test Threads"
              service="threads"
              payload={settings.threads}
              configured={Boolean(settings.threads.access_token?.trim() && settings.threads.user_id?.trim())}
            />
          </Card>
        </div>
      )}


      {step === 'tools' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SetupStepsHint />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn-ghost" disabled={saving} onClick={() => resetRecommended('tools')} style={{ padding: '6px 14px', fontSize: 12 }}>
                Reset to recommended
              </button>
              <button className="btn-ghost" disabled={saving} onClick={() => saveCurrentSection('tools')} style={{ padding: '6px 14px', fontSize: 12 }}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </div>

          <div className="card" style={{ display: 'grid', gap: 6, padding: 18 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>LLM (Text)</div>
            <div className="muted-copy">Choose how Autonomous Prime generates written content (blog posts, scripts, emails, ads).</div>
          </div>

          <Card title="AI Engine" description="Select the LLM for content generation.">
            <Row>
              <Sel
                label="Mode"
                value={settings.openclaw.mode}
                onChange={(e) => update('openclaw', 'mode', e.target.value)}
                options={[
                  { value: 'hybrid', label: 'Auto (OpenAI → Ollama fallback) — Recommended' },
                  { value: 'remote', label: 'Cloud only (OpenAI)' },
                  { value: 'local', label: 'Local only (Ollama, free)' },
                ]}
              />
            </Row>
            <div className="muted-copy">Recommended: start with Auto mode so your system keeps working even if a provider is down.</div>
          </Card>

          <Card title="OpenAI" description="GPT-4o for content generation and DALL-E 3 for image generation.">
            <Row>
              <Inp
                label="API Key"
                type="password"
                value={settings.openclaw.openai_api_key ?? ''}
                onChange={(e) => update('openclaw', 'openai_api_key', e.target.value)}
                placeholder="sk-..."
              />
              <Sel
                label="Model"
                value={settings.openclaw.openai_model ?? 'gpt-4o'}
                onChange={(e) => update('openclaw', 'openai_model', e.target.value)}
                options={[
                  { value: 'gpt-4o', label: 'GPT-4o' },
                  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (cheaper)' },
                  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
                ]}
              />
            </Row>
          </Card>

          <Card title="Ollama" description="Local LLM via Ollama for free content generation — blog posts, social copy, narration scripts.">
            <Row>
              <Inp
                label="Ollama URL"
                value={settings.openclaw.ollama_url}
                onChange={(e) => update('openclaw', 'ollama_url', e.target.value)}
                placeholder="http://localhost:11434"
              />
              <Inp
                label="Ollama Model"
                value={settings.openclaw.ollama_model}
                onChange={(e) => update('openclaw', 'ollama_model', e.target.value)}
                placeholder="llama3"
              />
            </Row>
            <TestBtn
              label="Test Ollama"
              service="ollama"
              payload={{ url: settings.openclaw.ollama_url, model: settings.openclaw.ollama_model }}
              configured={Boolean(settings.openclaw.ollama_url?.trim() && settings.openclaw.ollama_model?.trim())}
            />
          </Card>

          <div
            className="card"
            style={{
              display: 'grid',
              gap: 6,
              padding: 18,
              borderStyle: 'dashed',
              background: 'rgba(255,255,255,.02)',
            }}
          >
            <div className="section-title" style={{ marginBottom: 0 }}>Media</div>
            <div className="muted-copy">Voice, images, and video generation settings (separate from posting schedules).</div>
          </div>

          <Card title="Voice Engine" description="Select which TTS backend to use when generating audio narration.">
            <Row>
              <Sel
                label="Voice Mode"
                value={settings.tool_routing.voice_mode}
                onChange={(e) => update('tool_routing', 'voice_mode', e.target.value)}
                options={[
                  { value: 'elevenlabs', label: 'ElevenLabs (cloud)' },
                  { value: 'edge-tts', label: 'Edge TTS (free)' },
                ]}
              />
            </Row>
          </Card>

          <Card
            title="ElevenLabs"
            description="Cloud TTS via ElevenLabs API. High-quality voices, usage-based billing. Required when Voice Mode is set to ElevenLabs."
          >
            <Row>
              <Sel
                label="Enabled"
                value={settings.elevenlabs.enabled}
                onChange={(e) => update('elevenlabs', 'enabled', e.target.value)}
                options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
              />
              <Inp
                label="API Key"
                type="password"
                value={settings.elevenlabs.api_key}
                onChange={(e) => update('elevenlabs', 'api_key', e.target.value)}
                placeholder="Your ElevenLabs API key"
              />
              <Inp
                label="Voice ID"
                value={settings.elevenlabs.voice_id}
                onChange={(e) => update('elevenlabs', 'voice_id', e.target.value)}
                placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
              />
              <Sel
                label="Model"
                value={settings.elevenlabs.model_id}
                onChange={(e) => update('elevenlabs', 'model_id', e.target.value)}
                options={[
                  { value: 'eleven_multilingual_v2', label: 'Multilingual v2' },
                  { value: 'eleven_monolingual_v1', label: 'Monolingual v1' },
                  { value: 'eleven_turbo_v2', label: 'Turbo v2 (fast)' },
                ]}
              />
              <Sel
                label="Output Format"
                value={settings.elevenlabs.output_format}
                onChange={(e) => update('elevenlabs', 'output_format', e.target.value)}
                options={[
                  { value: 'mp3_44100_128', label: 'MP3 128kbps 44.1kHz' },
                  { value: 'mp3_44100_192', label: 'MP3 192kbps 44.1kHz' },
                  { value: 'pcm_44100', label: 'PCM 44.1kHz' },
                ]}
              />
            </Row>
          </Card>

          <Card
            title="Edge TTS (Free)"
            description="Microsoft Edge neural TTS — free, no API key required, high quality voices. Requires internet connection."
          >
            <Row>
              <Sel
                label="Voice"
                value={settings.edge_tts.voice}
                onChange={(e) => update('edge_tts', 'voice', e.target.value)}
                options={[
                  { value: 'en-US-AriaNeural', label: 'Aria (US Female)' },
                  { value: 'en-US-JennyNeural', label: 'Jenny (US Female)' },
                  { value: 'en-US-GuyNeural', label: 'Guy (US Male)' },
                  { value: 'en-US-EricNeural', label: 'Eric (US Male)' },
                  { value: 'en-GB-SoniaNeural', label: 'Sonia (UK Female)' },
                  { value: 'en-GB-RyanNeural', label: 'Ryan (UK Male)' },
                  { value: 'en-AU-NatashaNeural', label: 'Natasha (AU Female)' },
                  { value: 'en-AU-WilliamNeural', label: 'William (AU Male)' },
                ]}
              />
              <Inp
                label="Speed (e.g. 1.0, 1.25)"
                value={settings.edge_tts.speed}
                onChange={(e) => update('edge_tts', 'speed', e.target.value)}
                placeholder="1.0"
              />
            </Row>
          </Card>

          <Card
            title="ComfyUI (Images)"
            description="Optional local image generation endpoint. If left blank, cloud image generation is used when available."
          >
            <Row>
              <Inp
                label="ComfyUI URL"
                value={settings.comfyui?.url ?? ''}
                onChange={(e) => update('comfyui', 'url', e.target.value)}
                placeholder="http://localhost:8188"
              />
              <Inp
                label="Positive Prompt Prefix"
                value={settings.comfyui?.positive_prompt_prefix ?? ''}
                onChange={(e) => update('comfyui', 'positive_prompt_prefix', e.target.value)}
                placeholder="e.g. clean studio lighting, high detail,"
              />
            </Row>
            <Txt
              label="Default Negative Prompt"
              rows={3}
              value={settings.comfyui?.negative_prompt ?? ''}
              onChange={(e) => update('comfyui', 'negative_prompt', e.target.value)}
              placeholder="e.g. low quality, blurry, watermark"
            />
          </Card>

          <Card
            title="Video settings"
            description="Video format defaults and platform upload targets live under Video Publishing."
            right={<button type="button" className="btn-primary" onClick={() => setStep('video')} style={{ padding: '7px 12px', fontSize: 12 }}>Open Video Publishing</button>}
          >
            <div className="muted-copy">Keep video configuration separate from AI model selection so setup stays predictable.</div>
          </Card>
        </div>
      )}

      </div>
    </div>
  )
}
