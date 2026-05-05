import { useEffect, useState } from 'react'
import api from '../../../services/api'
import toast from 'react-hot-toast'
import { fmtCurrency } from '../utils/formatters'

export function SaldoConsolidado() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (from) params.from_date = from
      if (to) params.to_date = to
      const res = await api.get('/cash-boxes/saldo-consolidado', { params })
      setData(res.data)
    } catch { toast.error('Erro ao carregar saldo consolidado') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
        <p className="text-sm font-semibold text-gray-800">Saldo Líquido Consolidado</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none" />
          <button onClick={load} disabled={loading}
            className="text-xs bg-[#26619c] text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
            {loading ? '…' : 'Filtrar'}
          </button>
        </div>
      </div>
      {data && (
        <div className="p-4 flex flex-col gap-3">
          <div className="bg-green-50 rounded-xl p-4 text-center border border-green-200">
            <p className="text-xs text-green-600 font-medium mb-1">TOTAL CONSOLIDADO</p>
            <p className="text-3xl font-bold text-green-700">{fmtCurrency(data.total_consolidado)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">Sessões de Caixa ({data.caixas.sessoes})</p>
              <div className="flex flex-col gap-1 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Bruto lançado</span><span className="font-medium">{fmtCurrency(data.caixas.bruto)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Baixas</span><span className="text-red-600 font-medium">−{fmtCurrency(data.caixas.baixas)}</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-1 mt-1"><span className="font-semibold text-gray-700">Líquido</span><span className="font-bold text-green-700">{fmtCurrency(data.caixas.liquido)}</span></div>
                <div className="flex justify-between text-gray-400 mt-1"><span>PIX</span><span>{fmtCurrency(data.caixas.pix)}</span></div>
                <div className="flex justify-between text-gray-400"><span>Dinheiro</span><span>{fmtCurrency(data.caixas.dinheiro)}</span></div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">Porta a Porta ({data.porta_a_porta.total_pagos} pagos)</p>
              <div className="flex flex-col gap-1 text-xs">
                <div className="flex justify-between border-t border-gray-100 pt-1"><span className="font-semibold text-gray-700">Recebido</span><span className="font-bold text-green-700">{fmtCurrency(data.porta_a_porta.recebido)}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
