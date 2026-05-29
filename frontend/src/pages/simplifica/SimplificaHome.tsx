import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SECTOR_COLORS } from './theme'
import api from '../../services/api'

interface CaixaAberto {
  id: string
  opened_at: string
  opened_by_name?: string
  is_mine: boolean
}

export default function SimplificaHome() {
  const navigate = useNavigate()
  const [caixas, setCaixas] = useState<CaixaAberto[]>([])
  const [loadingCaixa, setLoadingCaixa] = useState(true)

  useEffect(() => {
    api.get<CaixaAberto[]>('/finance/sessions/open')
      .then(r => setCaixas(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingCaixa(false))
  }, [])

  const meuCaixa = caixas.find(c => c.is_mine)
  const outrosCaixas = caixas.filter(c => !c.is_mine)

  function formatHour(iso: string) {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader />

      {/* Barra de caixa */}
      {!loadingCaixa && (
        <div
          className="px-4 py-2 flex items-center gap-3 border-b"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--brand-header) 8%, white)',
            borderColor: 'color-mix(in srgb, var(--brand-header) 15%, transparent)',
          }}
        >
          {meuCaixa ? (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-medium" style={{ color: 'var(--brand-header)' }}>
                Aberto em: {formatHour(meuCaixa.opened_at)}
              </span>
            </div>
          ) : (
            <button
              onClick={() => navigate('/simplifica/caixa')}
              className="text-sm font-semibold text-white px-4 py-1.5 rounded-lg"
              style={{ backgroundColor: 'var(--brand-header)' }}
            >
              ABRIR CAIXA
            </button>
          )}

          {outrosCaixas.length > 0 && (
            <div className="flex gap-2 overflow-x-auto flex-1">
              {outrosCaixas.map(c => (
                <span key={c.id} className="flex-shrink-0 bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-500 whitespace-nowrap">
                  {c.opened_by_name?.split(' ')[0] ?? 'Usuário'} • {formatHour(c.opened_at)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grade principal */}
      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        <SimplificaTile icon="💰" label="Caixa"        color={SECTOR_COLORS.caixa}      onClick={() => navigate('/simplifica/caixa')} />
        <SimplificaTile icon="📦" label="Encomendas"   color={SECTOR_COLORS.encomendas} onClick={() => navigate('/simplifica/encomendas')} />
        <SimplificaTile icon="👥" label="Moradores"    color={SECTOR_COLORS.moradores}  onClick={() => navigate('/simplifica/moradores')} />
        <SimplificaTile icon="🔧" label="Ordens"       color={SECTOR_COLORS.ordens}     onClick={() => navigate('/simplifica/ordens')} />
        <SimplificaTile icon="💬" label="Chat"         color={SECTOR_COLORS.chat}       onClick={() => navigate('/simplifica/chat')} />
        <SimplificaTile icon="⚙️" label="Configurações" color={SECTOR_COLORS.config}    onClick={() => navigate('/simplifica/configuracoes')} />
      </main>
    </div>
  )
}
