import { useState, type CSSProperties } from 'react'
import { Lock, LogIn, UserPlus, Zap } from 'lucide-react'
import { getAuthConfig, signInWithPassword, signUpWithPassword } from '../lib/auth'

interface Props {
  onSignedIn: () => void
}

export default function AuthScreen({ onSignedIn }: Props) {
  const config = getAuthConfig()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit() {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'signin') {
        await signInWithPassword(email.trim(), password)
        onSignedIn()
        return
      }

      const result = await signUpWithPassword(email.trim(), password)
      if (result.access_token) {
        onSignedIn()
        return
      }
      setMessage('Account created. If your Supabase project requires email confirmation, confirm it and then sign in.')
      setMode('signin')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  if (!config.configured) {
    return (
      <div style={shellStyle}>
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <Zap size={18} color="#58a6ff" />
            <span style={{ color: '#e6edf3', fontWeight: 700 }}>Autonomous Prime Login</span>
          </div>
          <h1 style={titleStyle}>Supabase auth is not configured</h1>
          <p style={copyStyle}>
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in the UI environment, then reload the app.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <Zap size={18} color="#58a6ff" />
          <span style={{ color: '#e6edf3', fontWeight: 700 }}>Autonomous Prime</span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button type="button" onClick={() => setMode('signin')} style={tabButtonStyle(mode === 'signin')}>
            <LogIn size={14} /> Sign In
          </button>
          <button type="button" onClick={() => setMode('signup')} style={tabButtonStyle(mode === 'signup')}>
            <UserPlus size={14} /> Create Account
          </button>
        </div>

        <h1 style={titleStyle}>{mode === 'signin' ? 'Sign in to your workspace' : 'Create your workspace account'}</h1>
        <p style={copyStyle}>
          Each member signs in with their own account. App access is tied to Supabase instead of local browser-only state.
        </p>

        <label style={labelStyle}>
          Email
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" style={inputStyle} placeholder="you@example.com" />
        </label>

        <label style={labelStyle}>
          Password
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" style={inputStyle} placeholder="••••••••" />
        </label>

        {error && <div style={{ color: '#f85149', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        {message && <div style={{ color: '#3fb950', fontSize: 12, marginBottom: 12 }}>{message}</div>}

        <button type="button" onClick={handleSubmit} disabled={loading || !email.trim() || !password.trim()} className="btn-primary" style={{ width: '100%', padding: '12px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Lock size={14} />
          {loading ? 'Working...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
        </button>
      </div>
    </div>
  )
}

const shellStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
}

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 420,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 28,
}

const titleStyle: CSSProperties = {
  color: '#e6edf3',
  fontSize: 22,
  fontWeight: 700,
  margin: '0 0 10px',
}

const copyStyle: CSSProperties = {
  color: 'var(--muted)',
  fontSize: 13,
  lineHeight: 1.6,
  marginBottom: 18,
}

const labelStyle: CSSProperties = {
  display: 'block',
  color: '#e6edf3',
  fontSize: 12,
  marginBottom: 14,
}

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: '#0d1117',
  color: '#e6edf3',
}

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: '9px 12px',
    borderRadius: 8,
    border: `1px solid ${active ? '#58a6ff' : 'var(--border)'}`,
    background: active ? 'rgba(88, 166, 255, 0.12)' : 'transparent',
    color: active ? '#58a6ff' : 'var(--muted)',
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  }
}
