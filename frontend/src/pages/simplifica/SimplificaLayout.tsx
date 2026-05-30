import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

function applySimplificaSettings() {
  const fontSize = localStorage.getItem('simplifica-font-size')
  const fontType = localStorage.getItem('simplifica-font-type')
  const dark = localStorage.getItem('simplifica-dark')

  if (fontSize) document.documentElement.style.fontSize = fontSize
  if (fontType) {
    const map: Record<string, string> = {
      system: 'Inter, system-ui, sans-serif',
      serif:  'Georgia, serif',
      mono:   'monospace',
    }
    document.documentElement.style.fontFamily = map[fontType] ?? map.system
  }
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
      // Restaura fonte padrão ao sair do Simplifica
      document.documentElement.style.fontSize = ''
      document.documentElement.style.fontFamily = ''
      document.documentElement.classList.remove('dark')
    }
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-gray-950">
      <Outlet />
    </div>
  )
}
