import { useEffect, useState } from 'react'
import { Trophy, Users, TrendingUp, CheckCircle, XCircle } from 'lucide-react'
import api from '../../services/api'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'

interface AgentRank {
  agent_id: string
  agent_name: string
  cobrancas: number
  novos: number
  position: number
  prize: number
}

interface BonusInfo {
  liberado: boolean
  novos_ok: boolean
  adimplencia_pct: number
  adimplencia_ok: boolean
  agentes_com_5_novos: number
  total_agentes: number
}

const MEDAL = ['🏆', '🥈', '🥉']
const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

export default function AgentesPage() {
  const role = useAuthStore(s => s.role)
  const userId = useAuthStore(s => s.userId)

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const [ranking, setRanking] = useState<AgentRank[]>([])
  const [bonus, setBonus] = useState<BonusInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const isAgente = role === 'agente'

  async function fetchRanking() {
    setLoading(true)
    try {
      const res = await api.get('/crm/agentes/ranking', { params: { year, month } })
      setRanking(isAgente
        ? res.data.ranking.filter((a: AgentRank) => a.agent_id === userId)
        : res.data.ranking
      )
      setBonus(res.data.bonus)
    } catch {
      toast.error('Erro ao carregar ranking')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRanking() }, [year, month])

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    const cur = new Date()
    if (year === cur.getFullYear() && month === cur.getMonth() + 1) return
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Trophy size={22} className="text-amber-500" />
        <h1 className="text-xl font-bold text-gray-800">Ranking de Agentes</h1>
      </div>

      {/* Navegação de mês */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <button onClick={prevMonth} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">‹</button>
        <span className="font-medium text-gray-700 capitalize">{monthLabel(year, month)}</span>
        <button onClick={nextMonth} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40">›</button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Carregando...</div>
      ) : (
        <>
          {/* Ranking cards */}
          <div className="space-y-3 mb-6">
            {ranking.length === 0 && (
              <p className="text-center text-gray-400 py-8">Nenhuma atividade registrada neste mês</p>
            )}
            {ranking.map(agent => (
              <div
                key={agent.agent_id}
                className={`rounded-xl border p-4 flex items-center gap-4 ${
                  agent.position === 1 ? 'border-amber-300 bg-amber-50' :
                  agent.position === 2 ? 'border-gray-300 bg-gray-50' :
                  agent.position === 3 ? 'border-orange-200 bg-orange-50' :
                  'border-gray-100 bg-white'
                }`}
              >
                <div className="text-2xl w-8 text-center">
                  {agent.position <= 3 ? MEDAL[agent.position - 1] : `${agent.position}º`}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-800">{agent.agent_name}</p>
                  <div className="flex gap-4 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <TrendingUp size={12} className="text-[#26619c]" />
                      {agent.cobrancas} cobranças
                    </span>
                    <span className="flex items-center gap-1">
                      <Users size={12} className="text-emerald-600" />
                      {agent.novos} novos
                    </span>
                  </div>
                </div>
                {agent.prize > 0 && (
                  <div className="text-right">
                    <p className="font-bold text-gray-800">{fmt(agent.prize)}</p>
                    <p className="text-xs text-gray-400">prêmio</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Bônus de equipe */}
          {bonus && !isAgente && (
            <div className={`rounded-xl border p-4 ${bonus.liberado ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
              <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                {bonus.liberado ? <CheckCircle size={16} className="text-green-600" /> : <XCircle size={16} className="text-gray-400" />}
                Bônus de Equipe (+R$ 30 por agente)
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">
                    Agentes com ≥5 novos: {bonus.agentes_com_5_novos}/{bonus.total_agentes}
                  </span>
                  {bonus.novos_ok
                    ? <CheckCircle size={14} className="text-green-500" />
                    : <XCircle size={14} className="text-red-400" />
                  }
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">
                    Adimplência: {bonus.adimplencia_pct}%
                  </span>
                  {bonus.adimplencia_ok
                    ? <CheckCircle size={14} className="text-green-500" />
                    : <XCircle size={14} className="text-red-400" />
                  }
                </div>
                <p className={`text-sm font-semibold mt-2 ${bonus.liberado ? 'text-green-700' : 'text-gray-400'}`}>
                  {bonus.liberado ? '✓ Bônus liberado!' : '✗ Bônus não liberado este mês'}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
