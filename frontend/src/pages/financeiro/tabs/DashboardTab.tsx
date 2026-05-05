import { useEffect, useState } from 'react'
import api from '../../../services/api'
import toast from 'react-hot-toast'
import { fmt } from '../utils/formatters'
import { SUBTYPE_LABELS } from '../constants/financeiro'
import type { FinanceSummary, Tab } from '../types/financeiro'

interface Props {
  period: string
  setPeriod: (p: string) => void
  onNavigate?: (tab: Tab) => void
}

export default function DashboardTab({ period, setPeriod, onNavigate }: Props) {
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const loadSummary = async () => {
    setLoading(true)
    try {
      const res = await api.get<FinanceSummary>('/financeiro/summary', { params: { period } })
      setSummary(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao carregar resumo.')
    } finally { setLoading(false) }
  }

  useEffect(() => { loadSummary() }, [period])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(['week', 'month', 'year'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${period === p ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600'}`}>
            {p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : 'Ano'}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Carregando…</div>
      ) : summary ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1">Receitas</p>
              <p className="text-xl font-bold text-green-600">{fmt(summary.total_income)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1">Despesas</p>
              <p className="text-xl font-bold text-red-600">{fmt(summary.total_expense)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 col-span-2">
              <p className="text-xs text-gray-500 mb-1">Saldo do período</p>
              <p className={`text-2xl font-bold ${summary.total_balance >= 0 ? 'text-[#26619c]' : 'text-red-600'}`}>
                {fmt(summary.total_balance)}
              </p>
              <p className="text-xs text-gray-400 mt-1">{summary.transactions_count} transações · {summary.period_label}</p>
            </div>
          </div>

          {summary.income_by_type && Object.keys(summary.income_by_type).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-600 mb-3">Receitas por tipo</p>
              <div className="flex flex-col gap-2">
                {Object.entries(summary.income_by_type).map(([type, total]) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-xs text-gray-600">{SUBTYPE_LABELS[type] ?? type}</span>
                    <span className="text-xs font-semibold text-green-700">{fmt(total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {(summary.contas_a_receber ?? 0) > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs text-blue-600 mb-1">Contas a Receber</p>
                <p className="text-lg font-bold text-blue-800">{fmt(summary.contas_a_receber ?? 0)}</p>
                <p className="text-xs text-blue-500">{summary.contas_a_receber_count} mensalidade(s)</p>
              </div>
            )}
            {(summary.contas_a_receber_count ?? 0) > 0 && (
              <button onClick={() => onNavigate?.('cobrancas')}
                className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left hover:bg-amber-100 transition">
                <p className="text-xs text-amber-600 mb-1">Ver Cobranças</p>
                <p className="text-lg font-bold text-amber-800">→</p>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          Nenhum dado disponível.
        </div>
      )}
    </div>
  )
}
