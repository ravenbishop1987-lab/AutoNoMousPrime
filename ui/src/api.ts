import axios from 'axios'
import { getAccessToken } from './lib/auth'

export const api = axios.create({ baseURL: '/api', timeout: 15000 })
const ACTIVE_WORKSPACE_STORAGE_KEY = 'autonomous-prime.active-workspace'
const WORKSPACE_BRANDING_STORAGE_PREFIX = 'autonomous-prime.workspace-branding.'

type ApiIssue = {
  service: 'python' | 'saas'
  status?: number
  message: string
}

export type ApiErrorDetails = {
  service: 'python' | 'saas'
  status?: number
  method?: string
  path?: string
  code?: string
  message: string
}

function emitApiIssue(issue: ApiIssue) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('ap:api-issue', { detail: issue }))
  } catch {
    // ignore
  }
}

function buildApiError(details: ApiErrorDetails) {
  const err = new Error(details.message || 'Request failed') as Error & { api?: ApiErrorDetails }
  err.api = details
  return err
}

function readStoredWorkspaceId() {
  if (typeof window === 'undefined') return ''
  return String(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || '').trim()
}

export function getActiveWorkspaceId() {
  return readStoredWorkspaceId()
}

export function setActiveWorkspaceId(workspaceId: string | null) {
  if (typeof window === 'undefined') return
  const value = String(workspaceId || '').trim()
  if (!value) {
    window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, value)
}

api.interceptors.request.use(config => {
  const token = getAccessToken()
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  response => response,
  error => {
    const status = error?.response?.status
    const message = error?.response?.data?.error || error?.response?.data?.message || error.message || 'Request failed'
    const method = String(error?.config?.method || '').toUpperCase() || undefined
    const url = String(error?.config?.url || '')
    const baseURL = String(error?.config?.baseURL || '')
    const path = url ? `${baseURL}${url}` : baseURL || undefined
    const code = error?.code ? String(error.code) : undefined
    // Broadcast notable failures so the app can surface a single health banner.
    emitApiIssue({ service: 'python', status, message: String(message || 'Request failed') })
    return Promise.reject(buildApiError({ service: 'python', status, method, path, code, message: String(message || 'Request failed') }))
  },
)

export interface AgentInfo {
  agent_id: string; name: string; capabilities: string[]
  tasks_run: number; tasks_ok: number; tasks_failed: number
  success_rate: number; avg_ms: number; current_load: number; last_run: string | null
}

export interface QueueStats {
  pending: number; running: number; completed: number; failed: number
  agent_load: Record<string, number>
}

export interface ActiveTask {
  task_id: string
  type: string
  agent: string
  topic: string
  aspect_ratio?: string
  pipeline_id?: string
  stage_name?: string
  started_at: string
  payload: {
    blog_task_id?: string | null
    image_task_id?: string | null
    audio_task_id?: string | null
    video_task_id?: string | null
  }
}

export interface PipelineStage {
  key: string
  task_type: string
  agent: string
  label: string
  status: string
  task_id?: string | null
  error?: string | null
  blocked_on?: string | null
  result?: Record<string, unknown> | null
}

export interface PipelineRun {
  pipeline_id: string
  topic: string
  aspect_ratio: string
  created_at: string
  status: string
  errors: string[]
  stages: PipelineStage[]
}

export interface SystemStatus {
  running: boolean
  queue: QueueStats
  agents: Record<string, { load: number; skill: AgentInfo }>
  router: Record<string, { success: number; fail: number; avg_ms: number; success_rate: number }>
  optimizer: Array<{ action: string; agent?: string; reason: string }>
  active_tasks: ActiveTask[]
  pipelines: PipelineRun[]
  timestamp: string
}

export interface RevenueData {
  total_usd: number; transaction_count: number
  monthly: Array<{ month: string; usd: number }>
  recent_posts: Array<{ title: string; url: string; platform: string; at: string; seo_score: number }>
  social_pending: number
}

export interface CommerceRevenueData {
  ok?: boolean
  totals?: {
    totalRevenueCents: number
    orderCount: number
    subscriptionCount: number
  }
  timeline?: Array<{
    month: string
    revenue_cents: number
    orders: number
  }>
  revenue_breakdown?: {
    offers: Array<{
      offer_id?: string
      offer_name: string
      revenue_cents: number
      order_count: number
    }>
    landing_pages: Array<{
      id?: string
      landing_page_name: string
      slug: string
      revenue_cents: number
      order_count: number
    }>
    ctas: Array<{
      id: string
      platform: string
      post_id?: string
      cta_text: string
      variant_label: string
      click_count: number
      checkout_count: number
      purchase_count: number
      revenue_cents: number
      landing_page_id?: string
      offer_id?: string
      variant?: Record<string, unknown>
    }>
    posts: Array<{
      post_id: string
      platform: string
      revenue_cents: number
      order_count: number
    }>
    platforms: Array<{
      platform: string
      revenue_cents: number
      order_count: number
    }>
  }
  analytics?: {
    totals: {
      page_views: number
      cta_clicks: number
      checkout_started: number
      purchases: number
    }
    cta_variants: Array<{
      id: string
      platform: string
      cta_text: string
      variant_label: string
      click_count: number
      checkout_count: number
      purchase_count: number
      revenue_cents: number
    }>
    pages: Array<{
      id: string
      name: string
      slug: string
      visits: number
      clicks: number
      checkout_started: number
      purchases: number
      revenue_cents: number
    }>
    landing_pages: Array<{
      id: string
      name: string
      slug: string
      visits: number
      clicks: number
      checkout_started: number
      purchases: number
      revenue_cents: number
    }>
  }
  subscriptions?: {
    states: Array<{
      status: string
      billing_status: string
      failed_payment_count: number
      total: number
    }>
    latest: Array<{
      stripe_subscription_id: string
      stripe_customer_id: string
      offer_id?: string
      landing_page_id?: string
      status: string
      billing_status: string
      failed_payment: boolean
      created_at: string
      updated_at: string
      metadata?: Record<string, unknown>
    }>
  }
  recent_events?: Array<{
    id: string
    post_id?: string
    platform?: string
    cta_id?: string
    landing_page_id?: string
    offer_id?: string
    amount_cents: number
    currency: string
    kind: string
    stripe_customer_id?: string
    stripe_subscription_id?: string
    created_at: string
    metadata?: Record<string, unknown>
  }>
  error?: string
}

export interface CtaPreviewResponse {
  ok?: boolean
  platform: string
  preview: {
    primary: string
    pinned_comment?: string
    bio_hint?: string
  }
  error?: string
}

export interface OfferItem {
  id: string
  name: string
  checkout_url?: string
  stripe_product_id?: string
  stripe_price_id?: string
  landing_page_id?: string
  created_at?: string
}

export interface LandingPageItem {
  id: string
  name: string
  slug: string
  url: string
  template?: string
  content_json?: Record<string, unknown>
  hero_title?: string
  hero_subtitle?: string
  cta_text?: string
  cta_link?: string
  offer_summary?: string
  benefits_json?: string[]
  includes_json?: string[]
  faq_json?: Array<{ question: string; answer: string }>
  proof_json?: string[]
  theme_json?: Record<string, string>
  created_at?: string
}

export interface PublicLandingPage {
  id: string
  name: string
  slug: string
  url: string
  template: string
  content: Record<string, unknown>
  hero_title: string
  hero_subtitle: string
  cta_text: string
  cta_link: string
  offer_summary: string
  benefits: string[]
  includes: string[]
  faq_items: Array<{ question: string; answer: string }>
  proof_points: string[]
  theme: Record<string, string>
  offer: {
    id: string
    name: string
    checkout_url?: string
    stripe_price_id: string
    stripe_product_id: string
  }
}

export interface ApprovalItem {
  id: number
  platform: string
  text?: string
  title?: string
  topic?: string
  video_path?: string
  status: string
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  preview_url?: string
  scheduled_at?: string | null
  posted_at?: string | null
  approved_at?: string | null
  published_at?: string | null
}

export interface SocialCalendarItem {
  id: string
  date: string
  platform: string
  title?: string
  text?: string
  status: string
  image_url?: string
  video_url?: string
}

export interface SocialCalendarResponse {
  items: SocialCalendarItem[]
  source: string
  message: string
}

export interface InternalCalendarEntry {
  id: number
  platform: string
  content_type: string
  title?: string
  text?: string
  scheduled_at: string
  posted_at?: string | null
  status: string
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  created_at?: string
}

export interface BlogPost {
  filename: string; size_kb: number; modified: string
}

export interface SeoRanking {
  id?: number
  keyword: string
  title?: string
  url: string
  position: number | null
  best?: number | null
  worst?: number | null
  checks?: number | null
  checked_at?: string | null
  rating?: number | null
  source?: string
  status?: string
  target_keyword?: string
  meta_description?: string
  keyword_source?: string
}

export interface SeoAuditPost {
  id?: number
  title: string
  url: string
  status?: string
  target_keyword?: string
  meta_description?: string
  keyword_source?: string
  score: number
  word_count: number
  title_length: number
  meta_length: number
  internal_links: number
  h2_count: number
  h3_count: number
  image_count: number
  images_missing_alt: number
  faq_present: boolean
  issues: string[]
  warnings: string[]
  passed_checks: string[]
}

export interface SeoAuditReport {
  generated_at: string
  summary: {
    total_posts: number
    average_score: number
    good_posts: number
    needs_work_posts: number
    critical_posts: number
    issue_total: number
    warning_total: number
    passed_total: number
  }
  posts: SeoAuditPost[]
}

export interface ChatAgent {
  agent_id: string
  name: string
  capabilities: string[]
  description: string
}

export interface ChatOutputFile {
  name: string
  type: 'image' | 'audio' | 'video' | 'blog'
  url: string
  size_kb: number
}

export interface ChatReply {
  agent_id: string
  agent_name: string
  reply: string
  timestamp: string
  executed?: boolean
  task_type?: string | null
  task_id?: string
  task_ids?: string[]
}

export const pollChatTaskResult = (taskId: string) =>
  api.get<{ ok: boolean; status: string; files: ChatOutputFile[] }>(`/chat/task-result/${taskId}`).then(r => r.data)

export const getStatus = (limit = 50) => api.get<SystemStatus>(`/status?limit=${limit}`).then(r => r.data)
export const getAgents = () => api.get<Record<string, AgentInfo>>('/agents').then(r => r.data)
export const getQueue = () => api.get('/queue').then(r => r.data)
export const getRevenue = () => api.get<RevenueData>('/revenue').then(r => r.data)
export const getCommerceRevenue = () => api.get<CommerceRevenueData>('/commerce/revenue').then(r => r.data)
export const getBlogPosts = () => api.get<BlogPost[]>('/outputs/blog').then(r => r.data)

export interface JobOutputPreview {
  found: boolean
  filename: string
  content: string
  image_url: string
}
export const getJobOutputPreview = (topic: string) =>
  api.get<JobOutputPreview>('/outputs/preview', { params: { topic } }).then(r => r.data)

export interface LatestOutput {
  found: boolean
  url?: string
  filename?: string
  content?: string
  image_url?: string
}
export const getLatestOutput = (type: string, topic?: string) =>
  api.get<LatestOutput>('/outputs/latest', { params: { type, topic } }).then(r => r.data)

export const getSeoRankings = () => api.get<SeoRanking[]>('/seo/rankings').then(r => r.data)
export const getSeoAudit = () => api.get<SeoAuditReport>('/seo/audit').then(r => r.data)
export const getSeoReportPdfUrl = () => '/api/seo/report.pdf'
export const downloadSeoReportPdf = async () => {
  const token = getAccessToken()
  const response = await fetch(getSeoReportPdfUrl(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Could not download SEO report (${response.status})`)
  }
  const blob = await response.blob()
  const href = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = 'seo-report.pdf'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(href)
}
export const getSocialQueue = () => api.get('/social/queue').then(r => r.data)
export const getSocialApprovals = () => api.get<ApprovalItem[]>('/social/approvals').then(r => r.data)
export const approveSocialItem = (id: number, approved = true) => api.post('/social/approve', { id, approved }).then(r => r.data)
export const deleteSocialItem = (id: number) => api.delete(`/social/approvals/${id}`).then(r => r.data)
export const getVideoApprovals = () => api.get<ApprovalItem[]>('/video/approvals').then(r => r.data)
export const approveVideoItem = (id: number, approved = true) => api.post('/video/approve', { id, approved }).then(r => r.data)
export const deleteVideoItem = (id: number) => api.delete(`/video/approvals/${id}`).then(r => r.data)

// Social queue approval workflow (require_approval mode)
export interface PendingQueueItem {
  id: number
  platform: string
  text: string
  image_path: string
  post_url: string
  topic: string
  scheduled_at: string | null
  status: string
  payload: Record<string, unknown>
}
export const getPendingSocialQueue  = () => api.get<PendingQueueItem[]>('/social-queue/pending').then(r => r.data)
export const approveQueueItem       = (id: number) => api.post(`/social-queue/${id}/approve`).then(r => r.data)
export const rejectQueueItem        = (id: number) => api.post(`/social-queue/${id}/reject`).then(r => r.data)
export const updateQueueItemText    = (id: number, text: string) => api.patch(`/social-queue/${id}`, { text }).then(r => r.data)

export interface UsageMetric {
  key: string
  label: string
  used: number
  limit: number
  unit: string
  description: string
  unlimited: boolean
  limit_display: string | number
  percent: number
  exhausted: boolean
}

export interface UsageSummary {
  ok: boolean
  plan: { tier: string; name: string }
  billing_window: { period_start: string; period_end: string | null }
  metrics: UsageMetric[]
}

export const getUsage = () => saas.get<UsageSummary>('/usage').then(r => r.data)
export const getEvents = (limit = 30) => api.get(`/events?limit=${limit}`).then(r => r.data)
export const getPerformance = () => api.get('/performance').then(r => r.data)
export const getChatAgents = async () => {
  try {
    const data = await api.get<ChatAgent[]>('/chat/agents').then(r => r.data)
    if (Array.isArray(data)) return data
  } catch {
    // Fall back to the older /agents endpoint if the backend has not been restarted yet.
  }

  const agents = await getAgents()
  return Object.entries(agents).map(([agent_id, info]) => ({
    agent_id,
    name: info.name || agent_id,
    capabilities: Array.isArray(info.capabilities) ? info.capabilities : [],
    description: '',
  }))
}
export const sendChatMessage = (agent_id: string, message: string, use_local = false) =>
  api.post<ChatReply>('/chat/message', { agent_id, message, use_local }).then(r => r.data)

export const sendUnifiedChat = (message: string, history: Array<{ role: string; text: string }> = []) =>
  api.post<ChatReply>('/chat', { message, history }).then(r => r.data)

export const submitPipeline = (
  topic: string,
  keywords: string[],
  aspect_ratio = '16:9',
  options?: { input_payload?: Record<string, unknown> },
) =>
  api.post('/pipeline', { topic, keywords, aspect_ratio, ...(options || {}) }).then(r => r.data)

export interface SlidePipelineItem {
  title: string
  image_prompt: string
  negative_prompt: string
  image_path: string
  voiceover_text: string
  audio_path: string
  caption: string
  pause_after_s: number
}

export const submitSlidePipeline = (topic: string, slides: SlidePipelineItem[], aspect_ratio = '16:9') =>
  api.post('/pipeline/slides', { topic, slides, aspect_ratio }).then(r => r.data)

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const base64 = result.includes(',') ? result.split(',', 2)[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })

export const uploadSlideMedia = async (file: File, slide_index: number, media_kind: 'image' | 'audio') => {
  const content_base64 = await fileToBase64(file)
  return api.post('/uploads/slide-media', {
    filename: file.name,
    slide_index,
    media_kind,
    content_base64,
  }).then(r => r.data as { path: string; filename: string })
}

export const submitTask = (type: string, payload: object, agent_hint?: string) =>
  api.post('/tasks', { type, payload, agent_hint }).then(r => r.data)
export const previewCta = (payload: {
  platform: string
  cta_text: string
  cta_link: string
  cta_type: string
  pinned_comment_enabled?: boolean
}) => api.post<CtaPreviewResponse>('/commerce/cta/preview', payload).then(r => r.data)
export const createCheckoutSession = (payload: {
  price_id: string
  post_id?: string
  platform?: string
  cta_id?: string
  landing_page_id?: string
  offer_id?: string
  success_url?: string
  cancel_url?: string
}) => api.post('/commerce/checkout-session', payload).then(r => r.data as { ok?: boolean; url?: string; error?: string })
export const trackCommerceClick = (payload: {
  post_id?: string
  platform?: string
  cta_id?: string
  landing_page_id?: string
  offer_id?: string
}) => api.post('/commerce/track/click', payload).then(r => r.data as { ok?: boolean; error?: string })
export const getOffers = () => api.get<{ ok?: boolean; items: OfferItem[] }>('/commerce/offers').then(r => r.data)
export const createOffer = (payload: {
  name: string
  checkout_url?: string
  stripe_product_id?: string
  stripe_price_id?: string
  landing_page_id?: string
}) => api.post('/commerce/offers', payload).then(r => r.data as { ok?: boolean; item?: OfferItem; error?: string })
export const getLandingPages = () => api.get<{ ok?: boolean; items: LandingPageItem[] }>('/commerce/landing-pages').then(r => r.data)
export const createLandingPage = (payload: {
  id?: string
  name: string
  slug: string
  url: string
  template?: string
  content?: Record<string, unknown>
  hero_title?: string
  hero_subtitle?: string
  cta_text?: string
  cta_link?: string
  offer_summary?: string
  benefits?: string[]
  includes?: string[]
  faq_items?: Array<{ question: string; answer: string }>
  proof_points?: string[]
  theme?: Record<string, string>
}) => api.post('/commerce/landing-pages', payload).then(r => r.data as { ok?: boolean; item?: LandingPageItem; error?: string })
export const updateLandingPage = (landingPageId: string, payload: {
  id?: string
  name: string
  slug: string
  url: string
  template?: string
  content?: Record<string, unknown>
  hero_title?: string
  hero_subtitle?: string
  cta_text?: string
  cta_link?: string
  offer_summary?: string
  benefits?: string[]
  includes?: string[]
  faq_items?: Array<{ question: string; answer: string }>
  proof_points?: string[]
  theme?: Record<string, string>
}) => api.patch(`/commerce/landing-pages/${landingPageId}`, payload).then(r => r.data as { ok?: boolean; item?: LandingPageItem; error?: string })
export const deleteLandingPage = (landingPageId: string) =>
  api.delete(`/commerce/landing-pages/${landingPageId}`).then(r => r.data as { ok?: boolean; error?: string })
export const getPublicLandingPage = (slug: string) =>
  api.get<{ ok?: boolean; item?: PublicLandingPage; error?: string }>(`/commerce/public/landing/${slug}`).then(r => r.data)
export const createPublicLandingCheckout = (slug: string, payload: {
  post_id?: string
  platform?: string
  cta_id?: string
  offer_id?: string
  success_url?: string
  cancel_url?: string
}) => api.post(`/commerce/public/landing/${slug}/checkout`, payload).then(r => r.data as { ok?: boolean; url?: string; error?: string })

export const recordRevenue = (source: string, amount_cents: number, description: string) =>
  api.post('/revenue', { source, amount_cents, description }).then(r => r.data)

export const checkSeoRankings = (keywords?: string[]) =>
  api.post('/seo/check', { keywords }).then(r => r.data)

export interface Settings {
  openclaw: { ollama_url: string; ollama_model: string; claude_api_key: string; claude_model: string; groq_api_url: string; groq_api_key: string; groq_model: string; mode: string; max_concurrent_tasks: string }
  wordpress: { url: string; username: string; app_password: string; default_category: string; category_map: string }
  tool_routing: { image_mode: string; voice_mode: string }
  comfyui: { url: string; positive_prompt_prefix: string; negative_prompt: string }
  elevenlabs: { enabled: string; api_url: string; api_key: string; voice_id: string; model_id: string; output_format: string }
  edge_tts: { voice: string; speed: string; lang_code: string }
  deepgram: { enabled: string; api_url: string; api_key: string; model: string; language: string; smart_format: string; burn_in: string }
  abacus: { enabled: string; api_url: string; api_key: string; llm_model: string; image_model: string }
  ffmpeg: { path: string; ffprobe_path: string }
  serpapi: { key: string }
  commerce: { api_url: string; site_url: string }
  social_calendar: { sheet_url: string }
  social_scheduler: {
    posting_times_est: string
    max_posts_per_day: string
    max_per_platform_per_day: string
    min_gap_minutes: string
  }
  prompts: {
    autonomous_prime_system: string
    content_blog_system: string
    content_seo_research_prompt: string
    image_prompt_system: string
    voice_narration_prompt: string
    video_storyboard_prompt: string
    distribution_social_prompt: string
    chat_planner_prompt: string
  }
  approvals: {
    require_social_approval: string
    require_video_approval: string
  }
  automation?: {
    require_social_approval: string
    require_video_approval: string
    auto_publish_blog: string
    dynamic_topics: string
    daily_topic_niche: string
    daily_topic_keywords: string
    daily_topic_count: string
    preset_topics: string
  }
  comment_reply?: {
    enabled: string
    platforms: string
    tone: string
    brand_name: string
    custom_instructions: string
    poll_interval_minutes: string
    max_replies_per_poll: string
    skip_keywords: string
    min_comment_length: string
  }
  video: {
    default_aspect_ratio: string
    landscape_width: string
    landscape_height: string
    portrait_width: string
    portrait_height: string
    publish_to_youtube: string
    publish_to_tiktok: string
    publish_to_instagram: string
  }
  x: { enabled: string; post_url: string; access_token: string; account_id: string }
  facebook: { enabled: string; post_url: string; access_token: string; page_id: string }
  facebook_groups: { enabled: string; post_url: string; access_token: string; group_id: string }
  linkedin: { enabled: string; post_url: string; access_token: string; author_id: string; author_urn: string }
  instagram_posts: { enabled: string; post_url: string; access_token: string; account_id: string; media_type: string }
  youtube: { enabled: string; upload_url: string; access_token: string; channel_id: string; privacy_status: string }
  tiktok: { enabled: string; upload_url: string; access_token: string; creator_id: string; privacy_status: string }
  instagram: { enabled: string; upload_url: string; access_token: string; account_id: string; media_type: string }
  reddit: { enabled: string; client_id: string; client_secret: string; username: string; password: string; subreddit: string; post_type: string }
  threads: { enabled: string; access_token: string; user_id: string }
}

export const getSettings = () =>
  api.get<Settings>('/settings', { timeout: 30000 }).then(r => r.data)

export const saveSettings = async (s: Partial<Settings>) => {
  const attempt = () => api.post('/settings', s, { timeout: 30000 }).then(r => r.data as { status: string; settings?: Settings; warning?: string })
  try {
    return await attempt()
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('502') || message.includes('503') || message.includes('504')) {
      await new Promise(resolve => setTimeout(resolve, 1200))
      return attempt()
    }
    throw error
  }
}

export const patchSettings = async (s: Partial<Settings>) => {
  const attempt = () => api.patch('/settings', s, { timeout: 30000 }).then(r => r.data as { status: string; settings?: Settings; warning?: string })
  try {
    return await attempt()
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('502') || message.includes('503') || message.includes('504')) {
      await new Promise(resolve => setTimeout(resolve, 1200))
      return attempt()
    }
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SaaS Billing + Account API  (Node.js service at /saas/*)
// ─────────────────────────────────────────────────────────────────────────────

export const saas = axios.create({ baseURL: '/saas', timeout: 15000 })

saas.interceptors.request.use(config => {
  const token = getAccessToken()
  const headers = config.headers || {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const storedWorkspaceId = readStoredWorkspaceId()
  if (storedWorkspaceId && !headers['x-workspace-id']) {
    headers['x-workspace-id'] = storedWorkspaceId
  }
  config.headers = headers
  return config
})

saas.interceptors.response.use(
  response => response,
  error => {
    const status = error?.response?.status
    const message = error?.response?.data?.error || error?.response?.data?.message || error.message || 'Request failed'
    const method = String(error?.config?.method || '').toUpperCase() || undefined
    const url = String(error?.config?.url || '')
    const baseURL = String(error?.config?.baseURL || '')
    const path = url ? `${baseURL}${url}` : baseURL || undefined
    const code = error?.code ? String(error.code) : undefined
    emitApiIssue({ service: 'saas', status, message: String(message || 'Request failed') })
    return Promise.reject(buildApiError({ service: 'saas', status, method, path, code, message: String(message || 'Request failed') }))
  },
)

export async function pingPythonApi() {
  await api.get('/settings', { timeout: 5000 })
  return true
}

export async function pingSaasApi() {
  await saas.get('/health', { timeout: 5000 })
  return true
}

export interface BillingPlan {
  tier: 'starter' | 'pro' | 'agency'
  name: string
  price: number
}

export interface BillingUsage {
  content_jobs_used: number
  content_jobs_limit: number
  voice_minutes_used: number
  voice_minutes_limit: number
  video_jobs_used: number
  video_jobs_limit: number
  brands_used: number
  brands_limit: number
  connected_sites_used: number
  connected_sites_limit: number
  team_members_used: number
  team_members_limit: number
  billing_window?: {
    period_start: string
    period_end: string | null
  }
}

export interface BillingSubscription {
  id: string
  status: string
  plan_tier?: string
  billing_status?: string
  current_period_start?: number | null
  current_period_end: number | null
  cancel_at_period_end: boolean
  canceled?: boolean
  failed_payment?: boolean
}

export interface BillingStatus {
  ok: boolean
  plan: BillingPlan
  features?: Record<string, boolean | string | number>
  usage: BillingUsage
  entitlements?: Record<string, number>
  subscription: BillingSubscription | null
  billing_state?: {
    status: string
    active: boolean
    canceled: boolean
    failed_payment: boolean
  }
  has_payment_method: boolean
}

export interface OrgMe {
  ok: boolean
  user: {
    id: string
    email: string
  }
  profile: {
    id: string
    email: string
    display_name: string
    org_name: string
    onboarded: boolean
    created_at?: string
    updated_at?: string
  }
  onboarding_required: boolean
}

export interface OrgMember {
  id: string
  clerk_user_id: string | null
  email: string
  role: string
  invite_status?: string
  invited_by?: string | null
  joined_at?: string | null
  created_at: string
}

export interface WorkspaceSession {
  ok: boolean
  user: { id: string }
  active_workspace: {
    id: string
    name: string
    plan_tier: string
    jobs_used_this_month?: number
    email?: string
  }
  membership: {
    id: string
    role: 'owner' | 'admin' | 'editor' | 'reviewer' | 'client'
    invite_status: 'pending' | 'accepted' | 'revoked'
  }
  workspaces: Array<{
    id: string
    name: string
    plan_tier: string
    role: string
    invite_status: string
  }>
  onboarding?: {
    workspace_id: string
    current_step: string
    completed_steps: string[]
    is_complete: boolean
    first_brand_id?: string | null
    first_job_id?: string | null
    first_scheduled_entry_id?: string | null
  } | null
  onboarding_required: boolean
}

export interface BrandItem {
  id: string
  name: string
  niche?: string
  tone?: string
  created_at?: string
}

export interface AnalyticsOverview {
  ok: boolean
  jobs: {
    total: number
    completed: number
    failed: number
    throughput_per_week: Array<{
      week: string
      jobs_created: number
      jobs_completed: number
      approvals: number
    }>
  }
  runs: {
    total: number
    completed: number
    failed: number
    success_rate: number
    average_completion_hours: number
  }
  approvals: {
    total: number
    approved: number
    pending: number
    average_turnaround_hours: number
    by_state: Array<{ state: string; count: number }>
  }
  posts: {
    total_targets: number
    published: number
    failed: number
    cta_coverage_rate: number
  }
  platform_activity: Array<{
    platform: string
    scheduled_count: number
    published_count: number
    failed_count: number
    cta_coverage_count: number
    activity_total: number
  }>
  publish_attempts: {
    total: number
    published: number
    failed: number
  }
  quality_signals: {
    open_suggestions: number
    critical_suggestions: number
    quality_improvement_suggestions: number
  }
}

export interface TemplateItem {
  id: string
  org_id?: string | null
  brand_id?: string | null
  template_kind: 'blog_post' | 'youtube_description' | 'tiktok_script' | 'cta_block' | 'landing_page' | 'workflow_preset' | 'content_preset'
  scope: 'system' | 'workspace' | 'brand'
  visibility: 'private' | 'workspace' | 'marketplace'
  name: string
  description?: string | null
  body_template: string
  config?: Record<string, unknown>
  tags?: string[]
  is_active?: boolean
  usage_count?: number
  created_at?: string
  updated_at?: string
}

export interface ClientPortalConfig {
  org_id: string
  portal_slug?: string | null
  is_enabled: boolean
  allow_approvals: boolean
  allow_calendar: boolean
  allow_reports: boolean
  allowed_report_keys: string[]
  welcome_message?: string | null
  theme?: Record<string, unknown>
}

export interface PublicClientPortal {
  ok: boolean
  config: ClientPortalConfig
  branding?: WorkspaceBranding | null
  workspace?: {
    id: string
    name: string
    email?: string | null
  } | null
  approvals: Array<Record<string, unknown>>
  calendar: Array<Record<string, unknown>>
  reports: AnalyticsOverview | null
}

export interface ClientPortalPermission {
  id: string
  org_id: string
  member_id: string
  brand_id?: string | null
  can_view_approvals: boolean
  can_view_calendar: boolean
  can_view_reports: boolean
  allowed_report_keys: string[]
  created_at: string
  updated_at?: string
}

export interface ClientPortalMember {
  id: string
  email: string
  role: 'client'
  invite_status: string
  created_at: string
  joined_at?: string | null
  permissions: ClientPortalPermission[]
}

export interface WorkspaceBranding {
  workspace_id: string
  brand_name?: string | null
  app_label?: string | null
  logo_url?: string | null
  favicon_url?: string | null
  marketing_site_url?: string | null
  custom_domain?: string | null
  domain_status: 'draft' | 'pending_verification' | 'verified' | 'failed'
  primary_color?: string | null
  accent_color?: string | null
  theme?: Record<string, unknown>
  css_variables?: Record<string, unknown>
  custom_css?: string | null
  support_email?: string | null
}

export function readStoredWorkspaceBranding(workspaceId: string) {
  if (typeof window === 'undefined') return null
  const key = `${WORKSPACE_BRANDING_STORAGE_PREFIX}${String(workspaceId || '').trim()}`
  if (!workspaceId) return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as WorkspaceBranding : null
  } catch {
    window.localStorage.removeItem(key)
    return null
  }
}

export function writeStoredWorkspaceBranding(workspaceId: string, branding: Partial<WorkspaceBranding> | null | undefined) {
  if (typeof window === 'undefined') return
  const id = String(workspaceId || '').trim()
  if (!id) return
  const key = `${WORKSPACE_BRANDING_STORAGE_PREFIX}${id}`
  if (!branding) {
    window.localStorage.removeItem(key)
    return
  }
  window.localStorage.setItem(key, JSON.stringify({
    workspace_id: id,
    domain_status: 'draft',
    ...branding,
  }))
}

export interface OptimizationSuggestion {
  id: string
  org_id: string
  brand_id?: string | null
  job_id?: string | null
  entity_type: 'workspace' | 'job' | 'review' | 'publish_target' | 'calendar'
  entity_id: string
  suggestion_type: 'missing_cta' | 'weak_title' | 'missing_assets' | 'schedule_gap' | 'quality_improvement' | 'approval_bottleneck' | 'throughput_risk'
  severity: 'info' | 'warning' | 'critical'
  title: string
  description?: string
  suggested_action?: string
  status: 'open' | 'dismissed' | 'applied'
  metadata?: Record<string, unknown>
  created_at: string
  updated_at?: string
}

export interface SaaSJobRun {
  id: string
  job_id: string
  run_number: number
  trigger_type: string
  status: string
  python_pipeline_id?: string | null
  error_message?: string | null
  retry_count?: number
  created_at: string
  started_at?: string | null
  completed_at?: string | null
  job_steps?: Array<{
    id: string
    step_key: string
    provider?: string | null
    status: string
    error_message?: string | null
  }>
}

export interface SaaSJob {
  id: string
  topic: string
  status: string
  job_type: string
  aspect_ratio?: string
  error_msg?: string | null
  created_at: string
  updated_at: string
  brand_id?: string | null
  brands?: { id: string; name: string } | null
  latest_run?: SaaSJobRun | null
  review_thread?: { current_status: string } | null
  queue_state?: string
  blocked_reasons?: string[]
  next_action?: string
  owner_user_id?: string | null
  review_assignee_user_id?: string | null
  publish_assignee_user_id?: string | null
  waiting_on?: string | null
  review_due_at?: string | null
  publish_due_at?: string | null
  revision_due_at?: string | null
  due_at?: string | null
  overdue?: boolean
  sla_state?: 'on_track' | 'at_risk' | 'overdue' | 'blocked'
  readiness_checklist?: Array<{ key: string; label: string; status: string }>
  validation_summary?: {
    ready: boolean
    error_count: number
    warning_count: number
    blocking_rules: string[]
    checklist?: Record<string, boolean>
  }
}

export interface ReviewThread {
  id: string
  job_id: string
  current_status: string
  created_at: string
  updated_at: string
  assignee_user_id?: string | null
  due_at?: string | null
  waiting_on?: string | null
  jobs?: {
    id: string
    topic: string
    status: string
    created_at: string
    brand_id?: string | null
  }
  review_actions?: Array<{
    id: string
    action: string
    note?: string | null
    created_by?: string | null
    created_at: string
  }>
  review_comments?: Array<{
    id: string
    body: string
    created_by?: string | null
    created_at: string
  }>
}

export interface IntegrationItem {
  id: string
  provider_key: string
  display_name: string
  category: string
  status: string
  brand_id?: string | null
  config?: Record<string, unknown>
  last_tested_at?: string | null
  last_success_at?: string | null
  last_error_at?: string | null
  last_error_message?: string | null
}

export interface AssetItem {
  id: string
  job_id: string
  job_run_id?: string | null
  brand_id?: string | null
  type: string
  provider?: string | null
  storage_url?: string | null
  local_path?: string | null
  metadata?: Record<string, unknown>
  links?: Array<{
    id: string
    entity_type: string
    entity_id: string
    role: string
    metadata?: Record<string, unknown>
  }>
  usage?: {
    draft_refs: number
    snapshot_refs: number
    published_refs: number
    link_refs: number
    total_refs: number
    has_published_output: boolean
    references: Array<{
      source: 'draft' | 'snapshot' | 'published' | 'link'
      entity_type: string
      entity_id: string
      label?: string
      status?: string
      role?: string
      url?: string | null
      created_at?: string
    }>
  } | null
  created_at: string
}

export interface ActivityItem {
  id: string
  entity_type: string
  entity_id: string
  action: string
  actor_type: string
  actor_id?: string | null
  summary: string
  metadata?: Record<string, unknown>
  created_at: string
}

export interface QueueItem extends SaaSJob {
  queue_state: string
  blocked_reasons: string[]
  next_action: string
  ready_for_publish?: boolean
}

export interface PublishAttempt {
  id: string
  job_id: string
  publish_target_id?: string | null
  platform: string
  status: string
  provider_response_id?: string | null
  provider_post_url?: string | null
  submitted_at: string
  accepted_at?: string | null
  published_at?: string | null
  failed_at?: string | null
  message?: string | null
  metadata?: Record<string, unknown>
  created_by?: string | null
}

export interface ProviderSettingItem extends IntegrationItem {
  access_level?: 'workspace' | 'admin_only'
  admin_only?: boolean
  secret_refs?: Record<string, unknown>
  last_rotated_at?: string | null
  last_used_at?: string | null
  last_test_status?: string | null
  last_test_message?: string | null
  set_by?: string | null
}

export interface JobSnapshot {
  id: string
  revision_number: number
  snapshot_type: string
  job_payload: Record<string, unknown>
  publish_payload: Array<Record<string, unknown>>
  validation_payload: Record<string, unknown>
  created_by?: string | null
  created_at: string
}

export interface EntityLock {
  id: string
  entity_type: string
  entity_id: string
  locked_by: string
  lock_reason?: string | null
  acquired_at: string
  expires_at: string
}

export interface NotificationItem {
  id: string
  entity_type: string
  entity_id: string
  notification_type: string
  title: string
  body?: string | null
  severity: string
  read_at?: string | null
  metadata?: Record<string, unknown>
  created_at: string
}

export interface SavedViewItem {
  id: string
  view_type: string
  name: string
  filters: Record<string, unknown>
  is_default?: boolean
}

export const getBillingStatus = () =>
  saas.get<BillingStatus>('/billing/status').then(r => r.data)

export const createBillingCheckout = (plan_tier: string) =>
  saas.post<{ ok: boolean; url: string; session_id: string }>('/billing/checkout', { plan_tier }).then(r => r.data)

export const createPortalSession = () =>
  saas.post<{ ok: boolean; url: string }>('/billing/portal').then(r => r.data)

export const changePlan = (plan_tier: string) =>
  saas.post<{ ok: boolean; subscription_id: string; plan_tier: string }>('/billing/change-plan', { plan_tier }).then(r => r.data)

export const cancelSubscription = () =>
  saas.post<{ ok: boolean; cancel_at: number }>('/billing/cancel').then(r => r.data)

export const getAnalyticsOverview = (workspaceId: string) =>
  saas.get<AnalyticsOverview>('/analytics/overview', {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getTemplates = (workspaceId: string, filters?: { template_kind?: string; visibility?: string }) => {
  const params = new URLSearchParams()
  if (filters?.template_kind) params.set('template_kind', filters.template_kind)
  if (filters?.visibility) params.set('visibility', filters.visibility)
  return saas.get<{ ok: boolean; items: TemplateItem[] }>(`/templates${params.toString() ? `?${params.toString()}` : ''}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)
}

export const getTemplateLibrary = (workspaceId: string, templateKind?: string) =>
  saas.get<{ ok: boolean; items: TemplateItem[] }>(`/templates/library${templateKind ? `?template_kind=${encodeURIComponent(templateKind)}` : ''}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const createTemplate = (workspaceId: string, payload: Partial<TemplateItem>) =>
  saas.post<{ ok: boolean; item: TemplateItem }>('/templates', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const updateTemplate = (workspaceId: string, templateId: string, payload: Partial<TemplateItem>) =>
  saas.patch<{ ok: boolean; item: TemplateItem }>(`/templates/${templateId}`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const duplicateTemplate = (workspaceId: string, templateId: string, payload?: { brand_id?: string | null }) =>
  saas.post<{ ok: boolean; item: TemplateItem }>(`/templates/${templateId}/duplicate`, payload || {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getClientPortalSettings = (workspaceId: string) =>
  saas.get<{ ok: boolean; config: ClientPortalConfig | null; permissions: ClientPortalPermission[] }>('/client-portal/settings', {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const saveClientPortalSettings = (workspaceId: string, payload: Partial<ClientPortalConfig>) =>
  saas.post<{ ok: boolean; config: ClientPortalConfig }>('/client-portal/settings', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getClientPortalMembers = (workspaceId: string) =>
  saas.get<{ ok: boolean; items: ClientPortalMember[] }>('/client-portal/clients', {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const createClientPortalMember = (workspaceId: string, payload: {
  email: string
  brand_id?: string | null
  can_view_approvals?: boolean
  can_view_calendar?: boolean
  can_view_reports?: boolean
  allowed_report_keys?: string[]
}) =>
  saas.post<{ ok: boolean; member: ClientPortalMember; permissions: ClientPortalPermission }>('/client-portal/clients', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const updateClientPortalMember = (workspaceId: string, memberId: string, payload: {
  email?: string
  invite_status?: string
  permissions?: Partial<ClientPortalPermission>
}) =>
  saas.patch<{ ok: boolean; permissions?: ClientPortalPermission }>(`/client-portal/clients/${memberId}`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getClientPortalOverview = (workspaceId: string) =>
  saas.get<{ ok: boolean; config: ClientPortalConfig | null; branding?: WorkspaceBranding | null; permissions: ClientPortalPermission[]; approvals: Array<Record<string, unknown>>; calendar: Array<Record<string, unknown>>; reports: AnalyticsOverview | null }>('/client-portal/overview', {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getPublicClientPortal = (slug: string) =>
  saas.get<PublicClientPortal>(`/client-portal/public/${encodeURIComponent(slug)}`).then(r => r.data)

export const getWhiteLabelSettings = (workspaceId: string) =>
  saas.get<{ ok: boolean; item: WorkspaceBranding | null }>('/white-label', {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const saveWhiteLabelSettings = (workspaceId: string, payload: Partial<WorkspaceBranding>) =>
  saas.post<{ ok: boolean; item: WorkspaceBranding }>('/white-label', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getOptimizationSuggestions = (workspaceId: string, status?: 'open' | 'dismissed' | 'applied') =>
  saas.get<{ ok: boolean; items: OptimizationSuggestion[] }>(`/suggestions${status ? `?status=${status}` : ''}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const runOptimizationSuggestionScan = (workspaceId: string) =>
  saas.post<{ ok: boolean; count: number; items: OptimizationSuggestion[] }>('/suggestions/run-scan', {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const updateOptimizationSuggestionStatus = (workspaceId: string, suggestionId: string, status: 'open' | 'dismissed' | 'applied') =>
  saas.post<{ ok: boolean; item: OptimizationSuggestion }>(`/suggestions/${suggestionId}/status`, { status }, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getOrgMe = () =>
  api.get<OrgMe>('/auth/me').then(r => r.data)

export const getOrgMembers = () =>
  saas.get<{ ok: boolean; members: OrgMember[] }>('/orgs/members').then(r => r.data)

export const inviteMember = (email: string, role: 'admin' | 'editor' | 'reviewer' | 'client') =>
  saas.post<{ ok: boolean; member: OrgMember }>('/orgs/members', { email, role }).then(r => r.data)

export const removeMember = (userId: string) =>
  saas.delete<{ ok: boolean }>(`/orgs/members/${userId}`).then(r => r.data)

export const submitSaasJob = (payload: { topic: string; keywords?: string[]; aspect_ratio?: string; brand_id?: string }) =>
  saas.post<{ ok: boolean; job: Record<string, unknown> }>('/jobs', payload).then(r => r.data)

export const getSaasJobs = (page = 1, status?: string) =>
  saas.get<{ ok: boolean; jobs: Record<string, unknown>[]; total: number }>(`/jobs?page=${page}${status ? `&status=${status}` : ''}`).then(r => r.data)

// Onboarding
export const onboardOrg = (org_name: string, email: string, display_name = '') =>
  api.post<OrgMe>('/auth/profile', { org_name, email, display_name }).then(r => r.data)

export const updateMemberProfile = (payload: { org_name?: string; email?: string; display_name?: string }) =>
  api.post<OrgMe>('/auth/profile', payload).then(r => r.data)

export interface BrandCreatePayload {
  name: string
  niche: string
  tone: string
  cta_default_url?: string
  wp_url?: string
  wp_user?: string
  wp_app_password?: string
  target_keywords?: string[]
}

export const createBrand = (payload: BrandCreatePayload, workspaceId?: string) =>
  saas.post<{ ok: boolean; brand: Record<string, unknown> }>('/brands', payload, {
    headers: workspaceId ? { 'x-workspace-id': workspaceId } : undefined,
  }).then(r => r.data)
export const getSocialCalendar = () => api.get<SocialCalendarResponse>('/social/calendar').then(r => r.data)
export const getCalendarEntries = (include_posted = false) =>
  api.get<InternalCalendarEntry[]>(`/calendar/entries?include_posted=${include_posted ? 'true' : 'false'}`).then(r => r.data)
export const createCalendarEntry = (payload: {
  platform: string
  content_type: string
  scheduled_at: string
  title?: string
  text?: string
  payload?: Record<string, unknown>
}) => api.post('/calendar/entries', payload).then(r => r.data)
const settingsTestTimeoutMs = (service: string) => {
  switch (service) {
    case 'coqui':
      return 90000
    case 'openclaw':
    case 'claude':
    case 'groq':
    case 'comfyui':
    case 'elevenlabs':
    case 'deepgram':
    case 'abacus':
    case 'commerce':
      return 30000
    default:
      return 15000
  }
}

export const testConnection = (service: string, payload: object) =>
  api.post(`/settings/test/${service}`, payload, {
    timeout: settingsTestTimeoutMs(service),
  }).then(r => r.data) as Promise<{ ok: boolean; message: string }>

export type ProviderVerificationState = 'connected' | 'needs_attention' | 'not_configured'
export type ProviderVerificationItem = {
  service: string
  state: ProviderVerificationState
  message: string
  checked_at: string
  workspace_id: string
}

export const getProviderVerifications = (workspaceId: string) =>
  api.get<{ ok: boolean; items: ProviderVerificationItem[] }>('/provider-verifications', {
    params: { workspace_id: workspaceId },
    timeout: 10000,
  }).then(r => r.data)

export const saveProviderVerification = (workspaceId: string, payload: {
  service: string
  state: ProviderVerificationState
  message?: string
  checked_at?: string
}) =>
  api.post<{ ok: boolean; item: ProviderVerificationItem }>('/provider-verifications', { workspace_id: workspaceId, ...payload }, { timeout: 10000 }).then(r => r.data)

export const getWorkspaceSession = (workspaceId?: string) =>
  saas.get<WorkspaceSession>('/workspaces/session', {
    headers: workspaceId ? { 'x-workspace-id': workspaceId } : undefined,
  }).then(r => r.data)

export const getWorkspaces = () =>
  saas.get<{ ok: boolean; workspaces: WorkspaceSession['workspaces'] }>('/workspaces').then(r => r.data)

export const createWorkspace = (payload: { name: string; email?: string }) =>
  saas.post<{ ok: boolean; workspace: { id: string; name: string } }>('/workspaces', payload).then(r => r.data)

export const getWorkspaceMembers = (workspaceId: string) =>
  saas.get<{ ok: boolean; members: OrgMember[] }>(`/workspaces/${workspaceId}/members`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const inviteWorkspaceMember = (workspaceId: string, payload: { email: string; role: 'admin' | 'editor' | 'reviewer' | 'client' }) =>
  saas.post<{ ok: boolean; member: OrgMember }>(`/workspaces/${workspaceId}/members`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const updateWorkspaceMember = (workspaceId: string, memberId: string, payload: { role?: 'owner' | 'admin' | 'editor' | 'reviewer' | 'client'; invite_status?: 'pending' | 'accepted' | 'revoked' }) =>
  saas.patch<{ ok: boolean; member: OrgMember }>(`/workspaces/${workspaceId}/members/${memberId}`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const removeWorkspaceMember = (workspaceId: string, memberId: string) =>
  saas.delete<{ ok: boolean }>(`/workspaces/${workspaceId}/members/${memberId}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getBrands = (workspaceId?: string) =>
  saas.get<{ ok: boolean; brands: BrandItem[] }>('/brands', {
    headers: workspaceId ? { 'x-workspace-id': workspaceId } : undefined,
  }).then(r => r.data)

export const getJobsV2 = (
  workspaceId: string,
  page = 1,
  status?: string,
  brandId?: string,
  extraFilters?: {
    search?: string
    approval_state?: string
    queue_state?: string
    date_from?: string
    date_to?: string
    platform?: string
    content_type?: string
    schedule_state?: string
    sla_state?: string
    assignee?: string
    overdue?: boolean
    limit?: number
    cursor?: string
  },
) => {
  const params = new URLSearchParams({ page: String(page) })
  if (extraFilters?.limit) params.set('limit', String(extraFilters.limit))
  if (extraFilters?.cursor) params.set('cursor', extraFilters.cursor)
  if (status) params.set('status', status)
  if (brandId) params.set('brand_id', brandId)
  if (extraFilters?.search) params.set('search', extraFilters.search)
  if (extraFilters?.approval_state) params.set('approval_state', extraFilters.approval_state)
  if (extraFilters?.queue_state) params.set('queue_state', extraFilters.queue_state)
  if (extraFilters?.date_from) params.set('date_from', extraFilters.date_from)
  if (extraFilters?.date_to) params.set('date_to', extraFilters.date_to)
  if (extraFilters?.platform) params.set('platform', extraFilters.platform)
  if (extraFilters?.content_type) params.set('content_type', extraFilters.content_type)
  if (extraFilters?.schedule_state) params.set('schedule_state', extraFilters.schedule_state)
  if (extraFilters?.sla_state) params.set('sla_state', extraFilters.sla_state)
  if (extraFilters?.assignee) params.set('assignee', extraFilters.assignee)
  if (extraFilters?.overdue) params.set('overdue', 'true')
  return saas.get<{ ok: boolean; jobs: SaaSJob[]; total: number; next_cursor: string | null }>(`/jobs?${params.toString()}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)
}

export const getJobDetail = (workspaceId: string, jobId: string) =>
  saas.get<{ ok: boolean; job: SaaSJob; runs: SaaSJobRun[]; events: Array<Record<string, unknown>>; assets: AssetItem[]; publish_targets?: Array<Record<string, unknown>>; publish_attempts?: PublishAttempt[]; validations?: Array<Record<string, unknown>>; validation_summary?: SaaSJob['validation_summary']; queue?: QueueItem; readiness_checklist?: SaaSJob['readiness_checklist']; snapshots?: JobSnapshot[]; lock?: EntityLock | null; review: { actions: Array<Record<string, unknown>>; comments: Array<Record<string, unknown>> } }>(`/jobs/${jobId}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const createJob = (workspaceId: string, payload: { topic: string; keywords?: string[]; aspect_ratio?: string; brand_id?: string | null; input_payload?: Record<string, unknown> }) =>
  saas.post<{ ok: boolean; job: SaaSJob; run: SaaSJobRun }>('/jobs', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const retryJob = (workspaceId: string, jobId: string) =>
  saas.post<{ ok: boolean; run: SaaSJobRun }>(`/jobs/${jobId}/retry`, {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const cancelJob = (workspaceId: string, jobId: string) =>
  saas.post<{ ok: boolean; status: string }>(`/jobs/${jobId}/cancel`, {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getJobValidations = (workspaceId: string, jobId: string) =>
  saas.get<{ ok: boolean; validations: Array<Record<string, unknown>>; summary: SaaSJob['validation_summary'] }>(`/jobs/${jobId}/validations`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const publishCheckJob = (workspaceId: string, jobId: string) =>
  saas.post<{ ok: boolean; ready: boolean; blocking_errors: Array<Record<string, unknown>>; warnings: Array<Record<string, unknown>>; queue: QueueItem }>(`/jobs/${jobId}/publish-check`, {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const publishJob = (workspaceId: string, jobId: string, payload?: {
  retry_mode?: 'safe' | 'transient_only' | 'force'
  force_recovery?: boolean
  allow_republish?: boolean
}) =>
  saas.post<{ ok: boolean; job: SaaSJob; message: string; recovery?: Record<string, unknown> }>(`/jobs/${jobId}/publish`, payload || {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const assignJob = (workspaceId: string, jobId: string, payload: {
  owner_user_id?: string | null
  review_assignee_user_id?: string | null
  publish_assignee_user_id?: string | null
  waiting_on?: string | null
}) =>
  saas.post<{ ok: boolean; job: SaaSJob }>(`/jobs/${jobId}/assign`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const setJobDeadlines = (workspaceId: string, jobId: string, payload: {
  review_due_at?: string | null
  publish_due_at?: string | null
  revision_due_at?: string | null
}) =>
  saas.post<{ ok: boolean; job: SaaSJob }>(`/jobs/${jobId}/deadlines`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getJobSnapshots = (workspaceId: string, jobId: string) =>
  saas.get<{ ok: boolean; items: JobSnapshot[] }>(`/jobs/${jobId}/snapshots`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const acquireJobLock = (workspaceId: string, jobId: string, payload?: { reason?: string; ttl_minutes?: number }) =>
  saas.post<{ ok: boolean; item: EntityLock }>(`/jobs/${jobId}/lock`, payload || {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const releaseJobLock = (workspaceId: string, jobId: string) =>
  saas.delete<{ ok: boolean }>(`/jobs/${jobId}/lock`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const bulkUpdateJobs = (workspaceId: string, payload: {
  job_ids: string[]
  action: 'assign' | 'approve' | 'retry' | 'schedule' | 'archive'
  owner_user_id?: string | null
  scheduled_at?: string | null
}) =>
  saas.post<{ ok: boolean; updated: number }>('/jobs/bulk', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getReviewThreads = (workspaceId: string) =>
  saas.get<{ ok: boolean; threads: ReviewThread[] }>('/reviews', {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const addReviewComment = (workspaceId: string, jobId: string, payload: { body: string }) =>
  saas.post<{ ok: boolean; comment: Record<string, unknown> }>(`/reviews/jobs/${jobId}/comment`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

const reviewDecision = (workspaceId: string, jobId: string, action: 'approve' | 'reject' | 'request-revision', note = '') =>
  saas.post<{ ok: boolean; status: string }>(`/reviews/jobs/${jobId}/${action}`, { note }, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const approveReview = (workspaceId: string, jobId: string, note?: string) => reviewDecision(workspaceId, jobId, 'approve', note)
export const rejectReview = (workspaceId: string, jobId: string, note?: string) => reviewDecision(workspaceId, jobId, 'reject', note)
export const requestRevision = (workspaceId: string, jobId: string, note?: string) => reviewDecision(workspaceId, jobId, 'request-revision', note)

export const bulkUpdateReviews = (workspaceId: string, payload: {
  job_ids: string[]
  action: 'assign' | 'approve'
  assignee_user_id?: string | null
  due_at?: string | null
  waiting_on?: string | null
}) =>
  saas.post<{ ok: boolean; updated: number }>('/reviews/bulk', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const assignReview = (workspaceId: string, jobId: string, payload: {
  assignee_user_id?: string | null
  due_at?: string | null
  waiting_on?: string | null
}) =>
  saas.post<{ ok: boolean; thread: ReviewThread }>(`/reviews/jobs/${jobId}/assign`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const acquireReviewLock = (workspaceId: string, jobId: string, payload?: { reason?: string; ttl_minutes?: number }) =>
  saas.post<{ ok: boolean; item: EntityLock }>(`/reviews/jobs/${jobId}/lock`, payload || {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getReviewLock = (workspaceId: string, jobId: string) =>
  saas.get<{ ok: boolean; item: EntityLock | null }>(`/reviews/jobs/${jobId}/lock`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const releaseReviewLock = (workspaceId: string, jobId: string) =>
  saas.delete<{ ok: boolean }>(`/reviews/jobs/${jobId}/lock`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getIntegrations = (workspaceId: string) =>
  saas.get<{ ok: boolean; integrations: IntegrationItem[] }>('/integrations', {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getIntegrationHealth = (workspaceId: string) =>
  saas.get<{ ok: boolean; summary: IntegrationItem[] }>('/integrations/health', {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const upsertIntegration = (workspaceId: string, payload: {
  provider_key: string
  display_name: string
  category: string
  brand_id?: string | null
  config?: Record<string, unknown>
  status?: string
}) =>
  saas.post<{ ok: boolean; integration: IntegrationItem }>('/integrations', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const testIntegration = (workspaceId: string, integrationId: string, payload: {
  status?: 'healthy' | 'degraded' | 'failed'
  latency_ms?: number | null
  response_code?: number | null
  message?: string
  details?: Record<string, unknown>
}) =>
  saas.post<{ ok: boolean; check: Record<string, unknown> }>(`/integrations/${integrationId}/test`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getAssets = (workspaceId: string, filters?: {
  brand_id?: string
  asset_kind?: string
  search?: string
  job_id?: string
}) => {
  const params = new URLSearchParams()
  if (filters?.brand_id) params.set('brand_id', filters.brand_id)
  if (filters?.asset_kind) params.set('asset_kind', filters.asset_kind)
  if (filters?.search) params.set('search', filters.search)
  if (filters?.job_id) params.set('job_id', filters.job_id)
  return saas.get<{ ok: boolean; assets: AssetItem[] }>(`/assets${params.toString() ? `?${params.toString()}` : ''}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)
}

export const deleteAsset = (workspaceId: string, assetId: string) =>
  saas.delete<{ ok: boolean; asset: AssetItem }>(`/assets/${assetId}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getLocalAssets = (filters?: { search?: string; type?: string }) => {
  const params = new URLSearchParams()
  if (filters?.search) params.set('search', filters.search)
  if (filters?.type) params.set('type', filters.type)
  return api.get<{ ok: boolean; assets: AssetItem[] }>(`/assets/local${params.toString() ? `?${params.toString()}` : ''}`).then(r => r.data)
}

export const attachAssetLink = (workspaceId: string, assetId: string, payload: {
  entity_type: string
  entity_id: string
  role?: string
  metadata?: Record<string, unknown>
}) =>
  saas.post<{ ok: boolean; link: Record<string, unknown> }>(`/assets/${assetId}/links`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const detachAssetLink = (workspaceId: string, assetId: string, linkId: string) =>
  saas.delete<{ ok: boolean }>(`/assets/${assetId}/links/${linkId}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getActivity = (workspaceId: string, filters?: { entity_type?: string; action?: string; search?: string; brand_id?: string }) => {
  const params = new URLSearchParams()
  if (filters?.entity_type) params.set('entity_type', filters.entity_type)
  if (filters?.action) params.set('action', filters.action)
  if (filters?.search) params.set('search', filters.search)
  if (filters?.brand_id) params.set('brand_id', filters.brand_id)
  return saas.get<{ ok: boolean; items: ActivityItem[] }>(`/activity${params.toString() ? `?${params.toString()}` : ''}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)
}

export const getQueueItems = (workspaceId: string, filters?: { queue_state?: string; brand_id?: string; search?: string }) => {
  const params = new URLSearchParams()
  if (filters?.queue_state) params.set('queue_state', filters.queue_state)
  if (filters?.brand_id) params.set('brand_id', filters.brand_id)
  if (filters?.search) params.set('search', filters.search)
  return saas.get<{ ok: boolean; items: QueueItem[] }>(`/queue${params.toString() ? `?${params.toString()}` : ''}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)
}

export const getQueueSummary = (workspaceId: string) =>
  saas.get<{ ok: boolean; summary: Record<string, number> }>('/queue/summary', {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const bulkUpdateQueue = (workspaceId: string, payload: {
  job_ids: string[]
  action: 'mark_blocked' | 'mark_ready' | 'assign_owner'
  waiting_on?: string | null
  owner_user_id?: string | null
}) =>
  saas.post<{ ok: boolean; updated: number }>('/queue/bulk', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getProviderSettings = (workspaceId: string) =>
  saas.get<{ ok: boolean; items: ProviderSettingItem[] }>('/provider-settings', {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const upsertProviderSetting = (workspaceId: string, payload: {
  provider_key: string
  display_name: string
  category: string
  brand_id?: string | null
  config?: Record<string, unknown>
  secret_ref?: string | null
  secret_refs?: Record<string, unknown>
  status?: string
  access_level?: 'workspace' | 'admin_only'
  admin_only?: boolean
  last_rotated_at?: string | null
}) =>
  saas.post<{ ok: boolean; item: ProviderSettingItem }>('/provider-settings', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const testProviderSetting = (workspaceId: string, providerSettingId: string, payload: { success?: boolean; message?: string }) =>
  saas.post<{ ok: boolean; item: ProviderSettingItem }>(`/provider-settings/${providerSettingId}/test`, payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getNotifications = (workspaceId: string, unreadOnly = false) =>
  saas.get<{ ok: boolean; items: NotificationItem[] }>(`/notifications${unreadOnly ? '?unread_only=true' : ''}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const markNotificationRead = (workspaceId: string, notificationId: string) =>
  saas.post<{ ok: boolean; item: NotificationItem }>(`/notifications/${notificationId}/read`, {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const runNotificationScan = (workspaceId: string) =>
  saas.post<{ ok: boolean; count: number }>('/notifications/run-scan', {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getSavedViews = (workspaceId: string, viewType: 'jobs' | 'queue' | 'reviews' | 'assets' | 'activity') =>
  saas.get<{ ok: boolean; items: SavedViewItem[] }>(`/saved-views?view_type=${viewType}`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const createSavedView = (workspaceId: string, payload: {
  view_type: 'jobs' | 'queue' | 'reviews' | 'assets' | 'activity'
  name: string
  filters: Record<string, unknown>
  is_default?: boolean
  shared?: boolean
}) =>
  saas.post<{ ok: boolean; item: SavedViewItem }>('/saved-views', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const getOnboardingState = (workspaceId: string) =>
  saas.get<{ ok: boolean; onboarding: WorkspaceSession['onboarding'] }>(`/onboarding`, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const saveOnboardingStep = (workspaceId: string, payload: {
  step: string
  completed?: boolean
  metadata?: {
    first_brand_id?: string | null
    first_job_id?: string | null
    first_scheduled_entry_id?: string | null
    is_complete?: boolean
  }
}) =>
  saas.post<{ ok: boolean; onboarding: WorkspaceSession['onboarding'] }>('/onboarding/step', payload, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

export const completeOnboarding = (workspaceId: string) =>
  saas.post<{ ok: boolean; onboarding: WorkspaceSession['onboarding'] }>('/onboarding/complete', {}, {
    headers: { 'x-workspace-id': workspaceId },
  }).then(r => r.data)

// ── Ebook ──────────────────────────────────────────────────────────────────

export interface EbookChapter {
  title: string
  description: string
  image_prompt: string
}

export interface EbookOutline {
  title: string
  subtitle: string
  cover_headline: string
  chapters: Array<{ title: string; description: string }>
}

export interface EbookMeta {
  topic: string
  title: string
  style: string
  theme: string
  chapter_count: number
  html_path: string
  pdf_path: string
  cover_image: string
  generated_at: string
  has_html: boolean
  has_pdf: boolean
}

export interface EbookSubmitPayload {
  topic: string
  style: string
  theme: string
  chapter_count: number
  words_per_chapter: number
  keywords: string[]
  cover_prompt: string
  author_name: string
  cta_text: string
  cta_url: string
  cta_button: string
  chapter_images: boolean
  chapters: EbookChapter[]
}

export interface NewsletterResult {
  ok: boolean
  subject: string
  preview_text: string
  body_html: string
  body_plain: string
  subject_lines: string[]
  ps_line: string
  stats: { readability: number; subject_grade: string; read_time: number; word_count: number }
}

export const generateNewsletter = (payload: {
  email_type: string
  niche: string
  audience: string
  topic: string
  tones: string[]
  options: string[]
  length?: string
  sender_name?: string
  cta_text?: string
  cta_url?: string
  ps_text?: string
}) => api.post<NewsletterResult>('/email-newsletter', payload).then(r => r.data)

export interface TranslationItem {
  language: string
  content: string
  char_count: number
  word_count: number
  error?: string | null
}

export const translateContent = (payload: {
  content: string
  content_type: 'text' | 'html'
  target_languages: string[]
  formality: string
  adapt_tone: boolean
  custom_instructions?: string
  source_language?: string
}) => api.post<{
  ok: boolean
  translations: TranslationItem[]
  source_language: string
  original_char_count: number
  original_word_count: number
}>('/translate', payload).then(r => r.data)

export const submitAudiobook = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<{ task_id: string; status: string; char_count: number; topic: string }>('/audiobook', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000,
  }).then(r => r.data)
}

export const generateEbookOutline = (payload: { topic: string; style: string; chapter_count: number; keywords: string[] }) =>
  api.post<{ ok: boolean; outline: EbookOutline }>('/ebook/outline', payload).then(r => r.data)

export const submitEbook = (payload: EbookSubmitPayload) =>
  api.post<{ task_id: string; status: string }>('/ebook', payload).then(r => r.data)

export const exportEbookPdf = (html_path: string) =>
  api.post<{ ok: boolean; pdf_url: string; pdf_path: string }>('/ebook/export-pdf', { html_path }).then(r => r.data)

export const listEbooks = () =>
  api.get<{ ebooks: EbookMeta[] }>('/ebook/list').then(r => r.data)

// ─────────────────────────────────────────────────────────────────────────────
// Email Autoresponder API  (/saas/email-*)
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailAnalyticsTotals {
  sent: number; opens: number; clicks: number; unsubs: number
  open_rate: number; click_rate: number; unsub_rate: number
  active_subscribers: number; total_enrollments: number
  completed_enrollments: number; completion_rate: number
}

export interface EmailSequenceAnalytics {
  id: string; name: string; trigger_type: string; status: string
  sent: number; opens: number; clicks: number; unsubs: number
  open_rate: number; click_rate: number; unsub_rate: number
  total_enrolled: number; completed: number; completion_rate: number
}

export const getEmailAnalytics = () =>
  saas.get<{ ok: boolean; totals: EmailAnalyticsTotals; sequences: { id: string; name: string }[] }>('/email-analytics').then(r => r.data)

export const getEmailSequenceAnalytics = () =>
  saas.get<{ ok: boolean; sequences: EmailSequenceAnalytics[] }>('/email-analytics/sequences').then(r => r.data)

export const getEmailStepDropoff = (sequenceId: string) =>
  saas.get<{ ok: boolean; steps: Array<{ step_number: number; subject: string; delay_days: number; sent: number; opens: number; clicks: number; open_rate: number; click_rate: number }> }>(`/email-analytics/step-dropoff/${sequenceId}`).then(r => r.data)

// ─────────────────────────────────────────────────────────────────────────────
// Email Capture Forms  (/saas/email-forms)
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailForm {
  id: string
  org_id: string
  name: string
  headline: string
  description: string
  button_text: string
  success_message: string
  collect_name: boolean
  sequence_id: string | null
  redirect_url: string
  primary_color: string
  bg_color: string
  text_color: string
  border_radius: number
  custom_css: string
  is_active: boolean
  submission_count: number
  created_at: string
  updated_at: string
  email_sequences?: { name: string } | null
}

export const getEmailForms = () =>
  saas.get<{ ok: boolean; forms: EmailForm[] }>('/email-forms').then(r => r.data)

export const createEmailForm = (data: Partial<EmailForm>) =>
  saas.post<{ ok: boolean; form: EmailForm }>('/email-forms', data).then(r => r.data)

export const updateEmailForm = (id: string, data: Partial<EmailForm>) =>
  saas.patch<{ ok: boolean; form: EmailForm }>(`/email-forms/${id}`, data).then(r => r.data)

export const deleteEmailForm = (id: string) =>
  saas.delete<{ ok: boolean }>(`/email-forms/${id}`).then(r => r.data)


// ── Sales Pages ───────────────────────────────────────────────────────────────

export interface SalesPage {
  slug: string
  folder: string
  title: string
  product_name: string
  price_point: string
  stripe_url: string
  created_at: string
  sales_url: string
  thankyou_url: string
  has_thankyou: boolean
}

export const getSalesPages = () =>
  api.get<{ pages: SalesPage[] }>('/sales-pages').then(r => r.data.pages)

export const deleteSalesPage = (folder: string) =>
  api.delete(`/sales-pages/${encodeURIComponent(folder)}`).then(r => r.data)
