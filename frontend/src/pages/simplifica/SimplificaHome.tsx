import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Wallet, Package, Users, Wrench, MessageSquare, Settings } from 'lucide-react'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SimplificaBottomSheet } from './components/SimplificaBottomSheet'
import { SECTOR_COLORS } from './theme'
import { financeService } from '../../services/finance'
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
  const [abrirSheet, setAbrirSheet] = useState(false)
  const [saldo, setSaldo] = useState('')
  const [abrindo, setAbrindo] = useState(false)

  const [chatUnread, setChatUnread] = useState(0)
  const chatLastReadRef = useRef<string>(localStorage.getItem('chatLastRead') ?? new Date(0).toISOString())

  const fetchChatUnread = useCallback(() => {
    api.get<{ count: number }>('/chat/unread-count', { params: { since: chatLastReadRef.current } })
      .then(r => setChatUnread(r.data.count))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchChatUnread()
    const id = setInterval(fetchChatUnread, 30_000)
    return () => clearInterval(id)
  }, [fetchChatUnread])

  const fetchCaixas = () => {
    api.get<CaixaAberto[]>('/finance/sessions/open')
      .then(r => setCaixas(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingCaixa(false))
  }

  useEffect(() => { fetchCaixas() }, [])

  const meuCaixa = caixas.find(c => c.is_mine)
  const outrosCaixas = caixas.filter(c => !c.is_mine)

  function formatHour(iso: string) {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  async function handleAbrirCaixa() {
    const val = parseFloat(saldo.replace(',', '.'))
    if (isNaN(val) || val < 0) { toast.error('Informe o saldo inicial.'); return }
    setAbrindo(true)
    try {
      await financeService.openSession(val)
      toast.success('Caixa aberto!')
      setAbrirSheet(false)
      setSaldo('')
      fetchCaixas()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao abrir caixa.')
    } finally {
      setAbrindo(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader />

      {/* Barra de caixa */}
      {!loadingCaixa && (
        <div className="px-4 py-2.5 flex items-center gap-3 border-b bg-white border-gray-200">
          {meuCaixa ? (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-semibold text-emerald-700">
                Aberto em: {formatHour(meuCaixa.opened_at)}
              </span>
            </div>
          ) : (
            <button
              onClick={() => setAbrirSheet(true)}
              className="text-sm font-bold text-white px-5 py-2 rounded-xl"
              style={{ backgroundColor: SECTOR_COLORS.caixa }}
            >
              ABRIR CAIXA
            </button>
          )}
          {outrosCaixas.length > 0 && (
            <div className="flex gap-2 overflow-x-auto flex-1">
              {outrosCaixas.map(c => (
                <span key={c.id} className="flex-shrink-0 bg-gray-100 rounded-lg px-2 py-1 text-xs text-gray-500 whitespace-nowrap">
                  {c.opened_by_name?.split(' ')[0] ?? 'Usuário'} • {formatHour(c.opened_at)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grade principal */}
      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        <SimplificaTile icon={Wallet}        label="Caixa"         color={SECTOR_COLORS.caixa}      onClick={() => navigate('/simplifica/caixa')} />
        <SimplificaTile icon={Package}       label="Encomendas"    color={SECTOR_COLORS.encomendas} onClick={() => navigate('/simplifica/encomendas')} />
        <SimplificaTile icon={Users}         label="Moradores"     color={SECTOR_COLORS.moradores}  onClick={() => navigate('/simplifica/moradores')} />
        <SimplificaTile icon={Wrench}        label="Ordens"        color={SECTOR_COLORS.ordens}     onClick={() => navigate('/simplifica/ordens')} />
        <SimplificaTile icon={MessageSquare} label="Chat"          color={SECTOR_COLORS.chat}       onClick={() => navigate('/simplifica/chat')}
          badge={chatUnread > 0 ? (chatUnread > 9 ? '9+' : String(chatUnread)) : undefined} />
        <SimplificaTile icon={Settings}      label="Configurações" color={SECTOR_COLORS.config}     onClick={() => navigate('/simplifica/configuracoes')} />
      </main>

      {/* Sheet: Abrir Caixa */}
      <SimplificaBottomSheet open={abrirSheet} title="Abrir Caixa" onClose={() => setAbrirSheet(false)}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Saldo inicial (R$)</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0,00"
              value={saldo}
              onChange={e => setSaldo(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-emerald-500"
              autoFocus
            />
          </div>
          <button
            onClick={handleAbrirCaixa}
            disabled={abrindo || !saldo}
            className="w-full py-4 rounded-xl text-base font-bold text-white disabled:opacity-50 transition"
            style={{ backgroundColor: SECTOR_COLORS.caixa }}
          >
            {abrindo ? 'Abrindo…' : 'Confirmar Abertura'}
          </button>
        </div>
      </SimplificaBottomSheet>
    </div>
  )
}
