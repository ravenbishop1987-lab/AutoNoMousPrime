import { useEffect, useRef, useState } from 'react'
import './index.css'
import { getActiveWorkspaceId, getCommerceRevenue, getRevenue, getStatus, getWhiteLabelSettings, getWorkspaceSession, pingPythonApi, pingSaasApi, readStoredWorkspaceBranding, setActiveWorkspaceId } from './api'
import type { CommerceRevenueData, RevenueData, SystemStatus, WorkspaceSession, WorkspaceBranding } from './api'
import Header from './components/Header'
import Overview from './components/Overview'
import CommercePanel from './components/CommercePanel'
import SeoPanel from './components/SeoPanel'
import SocialPanel from './components/SocialPanel'
import SocialQueuePanel from './components/SocialQueuePanel'
import CommentRepliesPanel from './components/CommentRepliesPanel'
import SettingsPanel from './components/SettingsPanel'
import LandingPage from './components/LandingPage'
import AccountPanel from './components/AccountPanel'
import AuthScreen from './components/AuthScreen'
import AppSidebar from './components/AppSidebar'
import AssetLibraryPanel from './components/AssetLibraryPanel'
import AnalyticsPanel from './components/AnalyticsPanel'
import MonetizationPanel from './components/MonetizationPanel'
import PipelinePanel from './components/PipelinePanel'
import MegaPipelinePanel from './components/MegaPipelinePanel'
import CreatePanel from './components/CreatePanel'
import ChatPanel from './components/ChatPanel'
import PanelErrorBoundary from './components/PanelErrorBoundary'
import EmailSequencesPanel from './components/EmailSequencesPanel'
import EmailSubscribersPanel from './components/EmailSubscribersPanel'
import EmailAnalyticsPanel from './components/EmailAnalyticsPanel'
import EmailFormsPanel from './components/EmailFormsPanel'
import EmailBroadcastPanel from './components/EmailBroadcastPanel'
import SalesPage from './components/SalesPage'
import PagesPanel from './components/PagesPanel'
import SalesPagesPanel from './components/SalesPagesPanel'
import ProductsPanel from './components/ProductsPanel'
import StripeAnalyticsPanel from './components/StripeAnalyticsPanel'
import { getAccessToken, getAuthConfig, getSession, restoreSession, subscribeAuth, type AuthSession } from './lib/auth'

const DEFAULT_THEME_VARS: Record<string, string> = {
  '--accent': '#58a6ff',
  '--accent2': '#3fb950',
  '--bg': '#0d1117',
  '--surface': '#161b22',
  '--surface2': '#1c2333',
  '--border': '#30363d',
  '--text': '#c9d1d9',
  '--muted': '#8b949e',
}
const BRANDING_STYLE_ID = 'ap-workspace-branding-style'
const DEFAULT_APP_TITLE = 'Autonomous Prime'
const HEALTH_BANNER_HIDE_KEY = 'autonomous-prime.health-banner.hidden'

export default function App() {
  const pathname = window.location.pathname
  const landingSlug = pathname.startsWith('/lp/') ? pathname.slice(4).split('/')[0] : ''
  const portalSlug = pathname.startsWith('/portal/') ? pathname.slice(8).split('/')[0] : ''
  const [tab, setTab] = useState('overview')
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [revenue, setRevenue] = useState<RevenueData | null>(null)
  const [commerceRevenue, setCommerceRevenue] = useState<CommerceRevenueData | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const [session, setSession] = useState<AuthSession | null>(() => getSession())
  const [authReady, setAuthReady] = useState(() => !getAuthConfig().configured || Boolean(getSession()?.access_token))
  const [showSales, setShowSales] = useState(() => !getSession()?.access_token)
  const [workspaceSession, setWorkspaceSession] = useState<WorkspaceSession | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState(() => getActiveWorkspaceId())
  const [branding, setBranding] = useState<WorkspaceBranding | null>(null)
  const [health, setHealth] = useState<{ python: 'unknown' | 'up' | 'down'; saas: 'unknown' | 'up' | 'down'; message?: string }>({
    python: 'unknown',
    saas: 'unknown',
  })
  const [healthHidden, setHealthHidden] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(HEALTH_BANNER_HIDE_KEY) === '1'
  })

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail || {}
      if (detail.tab) {
        const nextTab =
          detail.tab === 'chat' ? 'chat'
            : detail.tab === 'generate' ? 'agents'
              : detail.tab === 'providers' ? 'settings'
                : detail.tab
        setTab(nextTab)
        setMobileNavOpen(false)
      }
    }
    window.addEventListener('ap:navigate', handler as EventListener)
    return () => window.removeEventListener('ap:navigate', handler as EventListener)
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ service?: 'python' | 'saas'; status?: number; message?: string }>).detail || {}
      if (!detail.service) return
      setHealth(prev => ({
        ...prev,
        [detail.service]: 'down',
        message: String(detail.message || prev.message || ''),
      }))
    }
    window.addEventListener('ap:api-issue', handler as EventListener)
    return () => window.removeEventListener('ap:api-issue', handler as EventListener)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    const check = async () => {
      // Python API: use a lightweight endpoint.
      try {
        await fetch('/api/settings', { signal: controller.signal, cache: 'no-store' })
        setHealth(prev => ({ ...prev, python: 'up' }))
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setHealth(prev => ({ ...prev, python: 'down', message: err instanceof Error ? err.message : prev.message }))
      }

      // SaaS API
      try {
        await fetch('/saas/health', { signal: controller.signal, cache: 'no-store' })
        setHealth(prev => ({ ...prev, saas: 'up' }))
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setHealth(prev => ({ ...prev, saas: 'down', message: err instanceof Error ? err.message : prev.message }))
      }
    }

    // Ping on app load.
    check()

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (tab === 'generate') setTab('agents')
    if (tab === 'providers') setTab('settings')
    if (tab === 'integrations') setTab('settings')
    setMobileNavOpen(false)
  }, [tab])

  useEffect(() => subscribeAuth(setSession), [])

  useEffect(() => {
    let cancelled = false

    restoreSession()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setAuthReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!session?.access_token) {
      setWorkspaceSession(null)
      setBranding(null)
      return
    }
    getWorkspaceSession(activeWorkspaceId || undefined)
      .then(result => {
        setWorkspaceSession(result)
        const resolvedWorkspaceId = result.active_workspace?.id || ''
        if (resolvedWorkspaceId && resolvedWorkspaceId !== activeWorkspaceId) {
          setActiveWorkspaceId(resolvedWorkspaceId)
          setActiveWorkspaceIdState(resolvedWorkspaceId)
        }
      })
      .catch(() => {
        if (activeWorkspaceId) {
          setActiveWorkspaceId(null)
          setActiveWorkspaceIdState('')
        }
        setWorkspaceSession(null)
      })
  }, [session, activeWorkspaceId])

  useEffect(() => {
    if (!session?.access_token || !workspaceSession?.active_workspace?.id || landingSlug || portalSlug) {
      setBranding(null)
      return
    }
    let active = true
    getWhiteLabelSettings(workspaceSession.active_workspace.id)
      .then(result => {
        if (!active) return
        setBranding(result.item || readStoredWorkspaceBranding(workspaceSession.active_workspace.id) || null)
      })
      .catch(() => {
        if (active) setBranding(readStoredWorkspaceBranding(workspaceSession.active_workspace.id) || null)
      })
    return () => {
      active = false
    }
  }, [session, workspaceSession?.active_workspace?.id, landingSlug, portalSlug])

  useEffect(() => {
    const handleBrandingUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string; item?: WorkspaceBranding | null }>).detail || {}
      if (!detail.workspaceId || detail.workspaceId !== (workspaceSession?.active_workspace?.id || activeWorkspaceId)) return
      setBranding(detail.item || null)
    }
    window.addEventListener('ap:branding-updated', handleBrandingUpdate as EventListener)
    return () => window.removeEventListener('ap:branding-updated', handleBrandingUpdate as EventListener)
  }, [workspaceSession?.active_workspace?.id, activeWorkspaceId])

  useEffect(() => {
    const root = document.documentElement
    const theme = branding?.theme && typeof branding.theme === 'object' ? branding.theme as Record<string, unknown> : {}
    const cssVars = branding?.css_variables && typeof branding.css_variables === 'object' ? branding.css_variables as Record<string, unknown> : {}
    const nextVars: Record<string, string> = {
      '--accent': String(branding?.primary_color || theme.accent || DEFAULT_THEME_VARS['--accent']),
      '--accent2': String(branding?.accent_color || theme.accent2 || DEFAULT_THEME_VARS['--accent2']),
      '--bg': String(theme.bg || DEFAULT_THEME_VARS['--bg']),
      '--surface': String(theme.surface || DEFAULT_THEME_VARS['--surface']),
      '--surface2': String(theme.surface2 || DEFAULT_THEME_VARS['--surface2']),
      '--border': String(theme.border || DEFAULT_THEME_VARS['--border']),
      '--text': String(theme.text || DEFAULT_THEME_VARS['--text']),
      '--muted': String(theme.muted || DEFAULT_THEME_VARS['--muted']),
    }

    for (const [key, value] of Object.entries(nextVars)) {
      root.style.setProperty(key, value)
    }
    for (const [key, value] of Object.entries(cssVars)) {
      if (typeof value === 'string') {
        root.style.setProperty(key.startsWith('--') ? key : `--${key}`, value)
      }
    }

    let styleEl = document.getElementById(BRANDING_STYLE_ID) as HTMLStyleElement | null
    const customCss = String(branding?.custom_css || '').trim()
    if (customCss) {
      if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = BRANDING_STYLE_ID
        document.head.appendChild(styleEl)
      }
      styleEl.textContent = customCss
    } else if (styleEl) {
      styleEl.remove()
    }

    document.title = branding?.app_label || branding?.brand_name || DEFAULT_APP_TITLE
    const faviconHref = String(branding?.favicon_url || '').trim()
    let favicon = document.querySelector("link[rel='icon']") as HTMLLinkElement | null
    if (faviconHref) {
      if (!favicon) {
        favicon = document.createElement('link')
        favicon.rel = 'icon'
        document.head.appendChild(favicon)
      }
      favicon.href = faviconHref
    } else if (favicon) {
      favicon.remove()
    }
  }, [branding])


  const fetchRevenue = async () => {
    try { setRevenue(await getRevenue()) } catch { /* ignore */ }
    try { setCommerceRevenue(await getCommerceRevenue()) } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!session?.access_token || landingSlug || portalSlug) return
    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${protocol}://${location.host}/ws`)
      wsRef.current = ws
      ws.onopen = () => {
        const token = getAccessToken()
        if (token) ws.send(JSON.stringify({ type: 'auth', token }))
        setWsConnected(true)
      }
      ws.onclose = () => { setWsConnected(false); setTimeout(connect, 3000) }
      ws.onerror = () => ws.close()
      ws.onmessage = event => {
        try {
          const msg = JSON.parse(event.data)
          // job_update events — broadcast for panels to react
          if (msg?.type === 'job_update') {
            window.dispatchEvent(new CustomEvent('ap:job-update', { detail: msg }))
            return
          }
          setStatus(msg)
          // Let panels know status changed so they can refresh
          window.dispatchEvent(new CustomEvent('ap:status-update', { detail: msg }))
        } catch { /* ignore */ }
      }
    }
    connect()
    return () => wsRef.current?.close()
  }, [session, landingSlug, portalSlug])

  useEffect(() => {
    if (!session?.access_token || landingSlug || portalSlug) return
    fetchRevenue()
    const timer = setInterval(fetchRevenue, 30_000)
    return () => clearInterval(timer)
  }, [session, landingSlug, portalSlug])

  useEffect(() => {
    if (!session?.access_token || landingSlug || portalSlug || wsConnected) return
    const timer = setInterval(async () => {
      try { setStatus(await getStatus()) } catch { /* ignore */ }
    }, 5000)
    return () => clearInterval(timer)
  }, [session, landingSlug, portalSlug, wsConnected])

  if (landingSlug) {
    return <LandingPage slug={landingSlug} />
  }

  if (!authReady) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Restoring session...</div>
      </div>
    )
  }

  if (!session?.access_token && getAuthConfig().configured) {
    if (showSales) {
      return <SalesPage onGetStarted={() => setShowSales(false)} />
    }
    return <AuthScreen onSignedIn={() => { setShowSales(false); setSession(getSession()) }} />
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {!healthHidden && (health.python === 'down' || health.saas === 'down') ? (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 50,
            background: 'rgba(13,17,23,.92)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid rgba(248,81,73,.25)',
            padding: '10px 14px',
          }}
        >
          <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#f85149' }}>
                {health.python === 'down' && health.saas === 'down'
                  ? 'Backends offline (Python API + Node SaaS API)'
                  : health.python === 'down'
                    ? 'Python API offline'
                    : 'Node SaaS API offline'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
                {health.python === 'down'
                  ? 'Python API expected on :8000. Start it with: `python main.py run`'
                  : null}
                {health.python === 'down' && health.saas === 'down' ? '  |  ' : null}
                {health.saas === 'down'
                  ? 'Node SaaS API expected on :3001. Start it with: `cd api && npm run dev`'
                  : null}
                {health.message ? `  —  Last error: ${health.message}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={async () => {
                  setHealth(prev => ({ ...prev, python: 'unknown', saas: 'unknown', message: '' }))
                  try { await pingPythonApi(); setHealth(prev => ({ ...prev, python: 'up' })) } catch (err) { setHealth(prev => ({ ...prev, python: 'down', message: err instanceof Error ? err.message : prev.message })) }
                  try { await pingSaasApi(); setHealth(prev => ({ ...prev, saas: 'up' })) } catch (err) { setHealth(prev => ({ ...prev, saas: 'down', message: err instanceof Error ? err.message : prev.message })) }
                }}
                style={{ padding: '7px 12px', fontSize: 12 }}
              >
                Retry
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setHealthHidden(true)
                  try { window.sessionStorage.setItem(HEALTH_BANNER_HIDE_KEY, '1') } catch { /* ignore */ }
                }}
                style={{ padding: '7px 12px', fontSize: 12 }}
              >
                Hide
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <Header
        wsConnected={wsConnected}
        onToggleNav={() => setMobileNavOpen(open => !open)}
        appLabel={branding?.app_label || branding?.brand_name || 'Autonomous Prime'}
        logoUrl={branding?.logo_url || null}
        workspaceName={workspaceSession?.active_workspace?.name || ''}
        activeWorkspaceId={workspaceSession?.active_workspace?.id || activeWorkspaceId}
        workspaces={(workspaceSession?.workspaces || []).map(workspace => ({
          id: workspace.id,
          name: workspace.name,
          role: workspace.role,
        }))}
        onSwitchWorkspace={(workspaceId: string) => {
          setActiveWorkspaceId(workspaceId)
          setActiveWorkspaceIdState(workspaceId)
          setMobileNavOpen(false)
        }}
      />
      <div className="app-shell">
        <AppSidebar
          tab={tab}
          setTab={setTab}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />
        {mobileNavOpen ? <button type="button" className="app-sidebar-overlay" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" /> : null}
        <main key={workspaceSession?.active_workspace?.id || activeWorkspaceId || 'default'} className="app-main">
          {tab === 'overview' && <PanelErrorBoundary name="Overview"><Overview status={status} revenue={revenue} commerceRevenue={commerceRevenue} /></PanelErrorBoundary>}
          {tab === 'chat' && <PanelErrorBoundary name="AI Chat"><ChatPanel /></PanelErrorBoundary>}
          {tab === 'create' && <PanelErrorBoundary name="Create"><CreatePanel /></PanelErrorBoundary>}
          {tab === 'pages' && <PanelErrorBoundary name="Pages"><PagesPanel /></PanelErrorBoundary>}
          {tab === 'products'    && <PanelErrorBoundary name="Products"><ProductsPanel /></PanelErrorBoundary>}
          {tab === 'sales-pages' && <PanelErrorBoundary name="Sales Pages"><SalesPagesPanel /></PanelErrorBoundary>}
          {tab === 'pipeline' && <PanelErrorBoundary name="Pipeline"><PipelinePanel status={status} /></PanelErrorBoundary>}
          {tab === 'mega-pipeline' && <PanelErrorBoundary name="Mega Pipeline"><MegaPipelinePanel /></PanelErrorBoundary>}
{tab === 'assets' && <PanelErrorBoundary name="Asset Library"><AssetLibraryPanel /></PanelErrorBoundary>}
          {tab === 'analytics' && <PanelErrorBoundary name="Analytics"><AnalyticsPanel /></PanelErrorBoundary>}
          {tab === 'social' && <PanelErrorBoundary name="Social"><SocialPanel /></PanelErrorBoundary>}
          {tab === 'social-queue' && <PanelErrorBoundary name="Social Queue"><SocialQueuePanel /></PanelErrorBoundary>}
          {tab === 'replies' && <PanelErrorBoundary name="Replies"><CommentRepliesPanel /></PanelErrorBoundary>}
          {tab === 'seo' && <PanelErrorBoundary name="SEO"><SeoPanel /></PanelErrorBoundary>}
          {tab === 'commerce' && <PanelErrorBoundary name="Commerce"><CommercePanel /></PanelErrorBoundary>}
          {tab === 'billing' && <PanelErrorBoundary name="Billing"><MonetizationPanel revenue={revenue} commerceRevenue={commerceRevenue} onRefresh={fetchRevenue} initialView="billing" /></PanelErrorBoundary>}
          {tab === 'revenue' && <PanelErrorBoundary name="Revenue"><MonetizationPanel revenue={revenue} commerceRevenue={commerceRevenue} onRefresh={fetchRevenue} initialView="revenue" /></PanelErrorBoundary>}
          {tab === 'account' && <PanelErrorBoundary name="Account"><AccountPanel /></PanelErrorBoundary>}
          {tab === 'settings' && <PanelErrorBoundary name="Settings"><SettingsPanel /></PanelErrorBoundary>}
          {tab === 'email-sequences' && <PanelErrorBoundary name="Email Sequences"><EmailSequencesPanel /></PanelErrorBoundary>}
          {tab === 'email-subscribers' && <PanelErrorBoundary name="Email Subscribers"><EmailSubscribersPanel /></PanelErrorBoundary>}
          {tab === 'email-analytics' && <PanelErrorBoundary name="Email Analytics"><EmailAnalyticsPanel /></PanelErrorBoundary>}
          {tab === 'email-forms' && <PanelErrorBoundary name="Email Forms"><EmailFormsPanel /></PanelErrorBoundary>}
          {tab === 'email-broadcasts' && <PanelErrorBoundary name="Email Broadcasts"><EmailBroadcastPanel /></PanelErrorBoundary>}
          {tab === 'stripe-analytics' && <PanelErrorBoundary name="Stripe Analytics"><StripeAnalyticsPanel /></PanelErrorBoundary>}
        </main>
      </div>
    </div>
  )
}
