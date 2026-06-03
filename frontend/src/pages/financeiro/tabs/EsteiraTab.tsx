import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import api from '../../../services/api'
import toast from 'react-hot-toast'
import { fmt } from '../utils/formatters'

export default function EsteiraTab() {
  const [esteiraData, setEsteiraData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const loadEsteira = async () => {
    setLoading(true)
    try {
      const res = await api.get('/finance/esteira')
      setEsteiraData(res.data)
    } catch { toast.error('Erro ao carregar esteira.') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadEsteira() }, [])

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">Esteira Financeira</h2>
        <button onClick={loadEsteira} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-[#26619c] border border-[#26619c]/30 px-3 py-1.5 rounded-lg hover:bg-[#26619c]/5 disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {loading && <div className="text-center text-sm text-gray-400 py-10">Carregando…</div>}

      {!loading && esteiraData && (() => {
        const loc = esteiraData.localizacao
        const fat = esteiraData.faturamento
        const pix = esteiraData.pix
        const bruto     = parseFloat(fat.bruto)
        const baixas    = parseFloat(fat.baixas)
        const liquido   = parseFloat(fat.liquido)
        const localizado = parseFloat(loc.total_localizado)
        const diferenca  = parseFloat(loc.diferenca)

        const locationRows = [
          { label: 'Em caixas abertos', sub: `${loc.em_abertos.sessoes} sessão(ões) com operador`, val: parseFloat(loc.em_abertos.total), color: 'text-blue-700', dot: 'bg-blue-400' },
          { label: 'Sessões fechadas (aguardando conferência)', sub: `${loc.no_malote.sessoes} sessão(ões) fechada(s)`, val: parseFloat(loc.no_malote.total), color: 'text-amber-700', dot: 'bg-amber-400' },
          { label: 'Conferido', sub: `${loc.a_repassar.sessoes} sessão(ões) conferida(s)`, val: parseFloat(loc.a_repassar.total), color: 'text-orange-700', dot: 'bg-orange-400' },
        ]

        return (
          <>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Faturamento (base: transações registradas)</p>
              </div>
              <div className="p-4 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Total bruto faturado</span>
                  <span className="text-sm font-bold text-gray-900">{fmt(bruto)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">(−) Baixas e saídas</span>
                  <span className="text-sm font-semibold text-red-600">−{fmt(baixas)}</span>
                </div>
                <div className="flex justify-between items-center border-t border-gray-200 pt-2 mt-1">
                  <span className="text-sm font-bold text-gray-800">= Líquido total</span>
                  <span className="text-base font-black text-[#26619c]">{fmt(liquido)}</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Esse valor deve estar distribuído nos locais abaixo ± quebras de caixa.</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Localização atual do dinheiro (base: contagem física)</p>
              </div>
              <div className="divide-y divide-gray-100">
                {locationRows.map(r => (
                  <div key={r.label} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${r.dot}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">{r.label}</p>
                        <p className="text-xs text-gray-400 truncate">{r.sub}</p>
                      </div>
                    </div>
                    <span className={`text-sm font-bold shrink-0 ${r.val > 0 ? r.color : 'text-gray-300'}`}>{fmt(r.val)}</span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">Total localizado</span>
                <span className="text-base font-black text-gray-900">{fmt(localizado)}</span>
              </div>
            </div>

            <div className={`rounded-xl border px-4 py-3 ${Math.abs(diferenca) < 0.01 ? 'bg-green-50 border-green-300' : diferenca > 0 ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    {Math.abs(diferenca) < 0.01 ? '✅ Caixa equilibrado' : diferenca > 0 ? '⚠️ Quebra de caixa (faltou dinheiro)' : '⚠️ Sobra física (mais físico que lançado)'}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Líquido registrado ({fmt(liquido)}) − Localizado fisicamente ({fmt(localizado)}) = {fmt(diferenca)}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {diferenca > 0.01
                      ? 'O sistema registrou mais do que foi contado fisicamente. Verifique quebras de caixa nas sessões.'
                      : diferenca < -0.01
                        ? 'Há mais dinheiro físico do que o registrado. Pode ser troco do fundo de caixa ou lançamentos pendentes.'
                        : 'Os valores coincidem.'}
                  </p>
                </div>
                <span className={`text-lg font-black shrink-0 ${diferenca > 0.01 ? 'text-red-600' : diferenca < -0.01 ? 'text-amber-600' : 'text-green-600'}`}>
                  {diferenca > 0 ? '+' : ''}{fmt(diferenca)}
                </span>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">PIX — Confirmação bancária</p>
                <p className="text-[10px] text-gray-400 mt-0.5">O PIX já está contabilizado na localização acima. Isso é apenas o status de confirmação no banco.</p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-gray-100">
                <div className="p-4 text-center">
                  <p className="text-xs text-gray-500 mb-1">Pendente no banco</p>
                  <p className="text-base font-bold text-orange-600">{fmt(parseFloat(pix.pendente.total))}</p>
                  <p className="text-[10px] text-gray-400">{pix.pendente.count} lançamento(s)</p>
                </div>
                <div className="p-4 text-center">
                  <p className="text-xs text-gray-500 mb-1">Confirmado no banco</p>
                  <p className="text-base font-bold text-green-600">{fmt(parseFloat(pix.conciliado.total))}</p>
                  <p className="text-[10px] text-gray-400">{pix.conciliado.count} lançamento(s)</p>
                </div>
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}
