import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error('Painel crashou:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
          <p className="text-lg font-semibold text-ink">Algo quebrou nessa tela</p>
          <pre className="max-w-xl overflow-auto rounded-lg border border-border bg-surface-muted p-3 text-left text-xs text-red-600">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-md bg-marque-500 px-4 py-2 text-sm font-medium text-white hover:bg-marque-700"
          >
            Tentar de novo
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
