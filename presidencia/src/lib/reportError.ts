// Reporta crash de cliente (React ou global) pro backend, que loga em
// nivel ERROR e assim entra no coletor de erros do parque ITP
// (Aplicacao=APRXM). Best-effort: nunca lanca, nunca bloqueia a UI --
// um crash reportando outro crash seria pior que nao reportar.
export function reportError(message: string, stack?: string) {
  try {
    fetch('/api/v1/public/frontend-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'presidencia',
        message,
        stack,
        url: window.location.href,
        user_agent: navigator.userAgent,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // nunca deixar o reporte de erro virar outro erro
  }
}

export function installGlobalErrorReporting() {
  window.addEventListener('error', (event) => {
    reportError(event.message, event.error?.stack)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    reportError(`Unhandled promise rejection: ${message}`, stack)
  })
}
