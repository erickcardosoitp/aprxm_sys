import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { SimplificaHeader } from './components/SimplificaHeader'
import { useAuthStore } from '../../store/authStore'
import api from '../../services/api'

const FONT_SIZES = ['14px', '16px', '18px', '20px'] as const
const FONT_LABELS = ['P', 'M', 'G', 'GG'] as const

export default function SimplificaConfig() {
  const navigate = useNavigate()
  const setSimplificaMode = useAuthStore((s) => s.setSimplificaMode)

  const [fontSize, setFontSize] = useState(() => localStorage.getItem('simplifica-font-size') ?? '16px')
  const [fontType, setFontType] = useState(() => localStorage.getItem('simplifica-font-type') ?? 'system')
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'))

  function applyFontSize(size: string) {
    setFontSize(size)
    localStorage.setItem('simplifica-font-size', size)
    document.documentElement.style.fontSize = size
  }

  function applyFontType(type: string) {
    setFontType(type)
    localStorage.setItem('simplifica-font-type', type)
    const map: Record<string, string> = {
      system: "Inter, system-ui, sans-serif",
      serif:  "Georgia, serif",
      mono:   "monospace",
    }
    document.documentElement.style.fontFamily = map[type] ?? map.system
  }

  function toggleDark(on: boolean) {
    setDarkMode(on)
    document.documentElement.classList.toggle('dark', on)
    localStorage.setItem('simplifica-dark', on ? '1' : '0')
  }

  async function handleVoltar() {
    try {
      await api.patch('/auth/me/preferences', { simplifica_mode: false })
      setSimplificaMode(false)
      navigate('/', { replace: true })
      toast.success('Modo Simplifica desativado.')
    } catch {
      toast.error('Erro ao desativar modo.')
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Configurações" showBack />

      <main className="flex-1 p-4 flex flex-col gap-6">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Tamanho da fonte</label>
          <div className="grid grid-cols-4 gap-2">
            {FONT_SIZES.map((size, i) => (
              <button
                key={size}
                onClick={() => applyFontSize(size)}
                className="py-3 rounded-xl text-sm font-semibold border-2 transition"
                style={fontSize === size
                  ? { backgroundColor: 'var(--brand-header)', color: 'white', borderColor: 'var(--brand-header)' }
                  : { backgroundColor: 'white', color: '#374151', borderColor: '#e5e7eb' }
                }
              >
                {FONT_LABELS[i]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Tipo de fonte</label>
          <div className="grid grid-cols-3 gap-2">
            {(['system', 'serif', 'mono'] as const).map(t => (
              <button
                key={t}
                onClick={() => applyFontType(t)}
                className="py-3 rounded-xl text-sm font-semibold border-2 transition capitalize"
                style={fontType === t
                  ? { backgroundColor: 'var(--brand-header)', color: 'white', borderColor: 'var(--brand-header)' }
                  : { backgroundColor: 'white', color: '#374151', borderColor: '#e5e7eb' }
                }
              >
                {t === 'system' ? 'Sistema' : t === 'serif' ? 'Serif' : 'Mono'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Tema</label>
          <div className="grid grid-cols-2 gap-2">
            {[false, true].map(dark => (
              <button
                key={String(dark)}
                onClick={() => toggleDark(dark)}
                className="py-3 rounded-xl text-sm font-semibold border-2 transition"
                style={darkMode === dark
                  ? { backgroundColor: 'var(--brand-header)', color: 'white', borderColor: 'var(--brand-header)' }
                  : { backgroundColor: 'white', color: '#374151', borderColor: '#e5e7eb' }
                }
              >
                {dark ? '🌙 Escuro' : '☀️ Claro'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto pt-6 border-t border-gray-200">
          <button
            onClick={handleVoltar}
            className="w-full py-4 rounded-xl text-sm font-semibold border-2 border-gray-300 text-gray-600 hover:bg-gray-50 transition"
          >
            Voltar ao modo completo
          </button>
        </div>
      </main>
    </div>
  )
}
