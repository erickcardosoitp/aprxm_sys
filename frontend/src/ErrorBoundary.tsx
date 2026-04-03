import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[APRXM] Render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0f2a4a] p-6">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
            <h2 className="text-lg font-bold text-red-600 mb-2">Erro inesperado</h2>
            <pre className="text-xs text-gray-600 bg-gray-50 rounded p-3 overflow-auto max-h-60 whitespace-pre-wrap">
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 w-full bg-[#26619c] text-white py-2 rounded-xl text-sm font-semibold"
            >
              Recarregar
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
