import { Component, type ReactNode } from 'react'
import { reportError } from '../lib/reportError'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Ate 2026-09-14 o painel nao tinha nenhum Error Boundary -- um crash de
// render derrubava a tela inteira em branco, sem log nenhum (nem local, nem
// no catalogo de erros do parque ITP). Mesmo padrao ja usado em
// frontend/ e presidencia/.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error('Painel crashou:', error, info.componentStack)
    reportError(error.message, error.stack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 p-6 text-center">
          <p className="text-lg font-semibold text-gray-900">Algo quebrou nessa tela</p>
          <pre className="max-w-xl overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-left text-xs text-red-600">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Tentar de novo
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
