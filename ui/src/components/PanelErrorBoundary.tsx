import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  name?: string
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[PanelErrorBoundary] ${this.props.name ?? 'Panel'} crashed:`, error, info.componentStack)
  }

  reset = () => this.setState({ hasError: false, error: null })

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '64px 32px', gap: 16, textAlign: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
            {this.props.name ?? 'This panel'} ran into a problem
          </div>
          {this.state.error && (
            <div style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 480, wordBreak: 'break-word', fontFamily: 'monospace' }}>
              {this.state.error.message}
            </div>
          )}
          <button className="btn-ghost" onClick={this.reset}>Try again</button>
        </div>
      )
    }
    return this.props.children
  }
}
