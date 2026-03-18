export interface AuthConfig {
  url: string
  anonKey: string
  configured: boolean
}

export interface AuthSession {
  access_token: string
  refresh_token?: string
  expires_in?: number
  expires_at?: number
  token_type?: string
  user?: {
    id: string
    email?: string
    user_metadata?: Record<string, unknown>
  }
}

type Listener = (session: AuthSession | null) => void

const authUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
const listeners = new Set<Listener>()
const SESSION_STORAGE_KEY = 'autonomous-prime.auth.session'
const SESSION_REFRESH_BUFFER_SECONDS = 30

let currentSession: AuthSession | null = loadStoredSession()

function normalizeSession(session: AuthSession | null): AuthSession | null {
  if (!session) return null
  const expiresAt = typeof session.expires_at === 'number'
    ? session.expires_at
    : typeof session.expires_in === 'number'
      ? Math.floor(Date.now() / 1000) + session.expires_in
      : undefined
  return {
    ...session,
    ...(typeof expiresAt === 'number' ? { expires_at: expiresAt } : {}),
  }
}

function loadStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    return normalizeSession(JSON.parse(raw) as AuthSession | null)
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    return null
  }
}

function persistSession(session: AuthSession | null) {
  if (typeof window === 'undefined') return
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

function emit() {
  listeners.forEach(listener => listener(currentSession))
}

function setSession(session: AuthSession | null) {
  currentSession = normalizeSession(session)
  persistSession(currentSession)
  emit()
}

function isSessionExpired(session: AuthSession | null) {
  if (!session?.access_token) return true
  if (typeof session.expires_at !== 'number') return false
  return session.expires_at <= Math.floor(Date.now() / 1000) + SESSION_REFRESH_BUFFER_SECONDS
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!authUrl || !anonKey) {
    throw new Error('Supabase auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  const response = await fetch(`${authUrl}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
      ...(currentSession?.access_token ? { Authorization: `Bearer ${currentSession.access_token}` } : {}),
      ...(init.headers || {}),
    },
  })

  const payloadText = await response.text()
  const payload = payloadText ? JSON.parse(payloadText) : {}
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.error_description || payload?.error || `Auth request failed: ${response.status}`)
  }
  return payload as T
}

export function getAuthConfig(): AuthConfig {
  // Reject placeholder values copied from .env.example unchanged
  const isReal = Boolean(authUrl && anonKey && !authUrl.includes('your-project') && anonKey.length > 32)
  return {
    url: authUrl,
    anonKey,
    configured: isReal,
  }
}

export function getAccessToken(): string {
  return currentSession?.access_token || ''
}

export function getSession(): AuthSession | null {
  return currentSession
}

export function subscribeAuth(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function restoreSession() {
  if (!currentSession) return null
  if (!isSessionExpired(currentSession)) return currentSession
  if (!currentSession.refresh_token) {
    setSession(null)
    return null
  }

  try {
    const session = await authRequest<AuthSession>('/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: currentSession.refresh_token }),
    })
    setSession(session)
    return session
  } catch {
    setSession(null)
    return null
  }
}

export async function signInWithPassword(email: string, password: string) {
  const session = await authRequest<AuthSession>('/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setSession(session)
  return session
}

export async function signUpWithPassword(email: string, password: string) {
  const result = await authRequest<AuthSession & { user?: AuthSession['user'] }>('/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (result.access_token) {
    setSession(result)
  }
  return result
}

export async function signOut() {
  if (currentSession?.access_token) {
    try {
      await authRequest('/logout', { method: 'POST' })
    } catch {
      // Clear local session even if Supabase logout fails.
    }
  }
  setSession(null)
}
