import { Component, type ReactNode } from 'react'
import { Button, Card } from './ui'

/** Catches render errors so one broken page doesn't blank the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('timbre: render error', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Card>
        <h1 className="text-base font-semibold text-ink">Something went wrong</h1>
        <p className="mt-1 text-sm text-mute">{this.state.error.message || 'An unexpected error occurred.'}</p>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button onClick={() => location.assign('/')}>Go home</Button>
        </div>
      </Card>
    )
  }
}
