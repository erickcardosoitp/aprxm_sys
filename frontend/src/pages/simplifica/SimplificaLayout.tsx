import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

function applySimplificaSettings() {
  const fontSize = localStorage.getItem('simplifica-font-size')
  const fontType = localStorage.getItem('simplifica-font-type')
  const dark = localStorage.getItem('simplifica-dark')

  // fontSize no <html> afeta rem units
  if (fontSize) document.documentElement.style.fontSize = fontSize

  // fontFamily no <body> sobrescreve font-sans do Tailwind
  if (fontType) {
    const map: Record<string, string> = {
      system: 'Inter, system-ui, sans-serif',
      serif:  'Georgia, serif',
      mono:   'ui-monospace, monospace',
    }
    document.body.style.fontFamily = map[fontType] ?? map.system
  }

  // dark mode via classe no <html> — Tailwind darkMode:'class'
  if (dark !== null) {
    document.documentElement.classList.toggle('dark', dark === '1')
  }
}

export default function SimplificaLayout() {
  const simplificaEnabled = useAuthStore((s) => s.simplificaEnabled)
  const navigate = useNavigate()

  useEffect(() => {
    if (simplificaEnabled === false) navigate('/', { replace: true })
  }, [simplificaEnabled])

  // Aplica configurações salvas ao entrar no Simplifica
  useEffect(() => {
    applySimplificaSettings()
    return () => {
      document.documentElement.style.fontSize = ''
      document.body.style.fontFamily = ''
      document.documentElement.classList.remove('dark')
    }
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-gray-950">
      <Outlet />
    </div>
  )
}
