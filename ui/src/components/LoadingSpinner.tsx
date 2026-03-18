interface Props {
  label?: string
  size?: number
  fullPanel?: boolean
}

export default function LoadingSpinner({ label = 'Loading…', size = 28, fullPanel = false }: Props) {
  const spinner = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `3px solid var(--border)`,
        borderTopColor: 'var(--accent)',
        animation: 'ap-spin 0.7s linear infinite',
        flexShrink: 0,
      }} />
      {label && (
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
      )}
      <style>{`@keyframes ap-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  if (!fullPanel) return spinner

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '64px 32px',
    }}>
      {spinner}
    </div>
  )
}
