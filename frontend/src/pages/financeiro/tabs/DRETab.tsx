import { useRef, useState } from 'react'
import { FileBarChart, FileSpreadsheet, Image, TrendingUp, TrendingDown } from 'lucide-react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import api from '../../../services/api'
import { fmt } from '../utils/formatters'

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

export default function DRETab() {
  const [dreYear, setDreYear] = useState(new Date().getFullYear())
  const [dreMonth, setDreMonth] = useState<number | ''>(new Date().getMonth() + 1)
  const [dre, setDre] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [dreFilter, setDreFilter] = useState<'all' | 'receitas' | 'despesas'>('all')
  const [dreCatFilter, setDreCatFilter] = useState('')
  const dreRef = useRef<HTMLDivElement>(null)

  const loadDre = async () => {
    setLoading(true)
    try {
      const params: any = { year: dreYear }
      if (dreMonth) params.month = dreMonth
      const res = await api.get('/financeiro/dre', { params })
      setDre(res.data)
    } catch { toast.error('Erro ao gerar DRE.') } finally { setLoading(false) }
  }

  const exportXLSX = () => {
    if (!dre) return
    const wb = XLSX.utils.book_new()
    const rows: any[][] = [
      [`DRE — ${dre.period_label}`], [],
      ['RECEITAS', ''],
      ...dre.receitas.map((r: any) => [r.descricao, r.valor]),
      ['Total Receitas', dre.total_receitas], [],
      ['DESPESAS', ''],
      ...dre.despesas.map((d: any) => [d.descricao, d.valor]),
      ['Total Despesas', dre.total_despesas], [],
      [dre.resultado >= 0 ? 'SUPERÁVIT' : 'DÉFICIT', Math.abs(dre.resultado)],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 35 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, ws, 'DRE')
    XLSX.writeFile(wb, `dre_${dre.period_label}.xlsx`)
  }

  const exportPNG = async () => {
    if (!dreRef.current) return
    try {
      const canvas = await html2canvas(dreRef.current, { scale: 2, backgroundColor: '#ffffff' })
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a'); a.href = url; a.download = `dre_${dre.period_label}.png`; a.click()
    } catch { toast.error('Erro ao exportar imagem.') }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <FileBarChart className="w-4 h-4 text-[#26619c]" />
          Demonstrativo de Resultado
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Ano</label>
            <input type="number" min="2020" max="2099" value={dreYear}
              onChange={e => setDreYear(parseInt(e.target.value) || new Date().getFullYear())}
              className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mês</label>
            <select value={dreMonth} onChange={e => setDreMonth(e.target.value ? parseInt(e.target.value) : '')} className={inputCls}>
              <option value="">Ano completo</option>
              {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Visualizar</label>
            <select value={dreFilter} onChange={e => { setDreFilter(e.target.value as any); setDreCatFilter('') }} className={inputCls}>
              <option value="all">Receitas e Despesas</option>
              <option value="receitas">Somente Receitas</option>
              <option value="despesas">Somente Despesas</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Categoria</label>
            <select value={dreCatFilter} onChange={e => setDreCatFilter(e.target.value)} className={inputCls}>
              <option value="">Todas</option>
              {dre && [
                ...(dreFilter !== 'despesas' ? dre.receitas.map((r: any) => r.descricao) : []),
                ...(dreFilter !== 'receitas' ? dre.despesas.map((d: any) => d.descricao) : []),
              ].map((cat: string) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
        </div>
        <button onClick={loadDre} disabled={loading}
          className="bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
          {loading ? 'Gerando…' : 'Gerar DRE'}
        </button>
      </div>

      {dre && (() => {
        const receitasFilt = dreCatFilter ? dre.receitas.filter((r: any) => r.descricao === dreCatFilter) : dre.receitas
        const despesasFilt = dreCatFilter ? dre.despesas.filter((d: any) => d.descricao === dreCatFilter) : dre.despesas
        const totalRec = receitasFilt.reduce((s: number, r: any) => s + r.valor, 0)
        const totalDesp = despesasFilt.reduce((s: number, d: any) => s + d.valor, 0)
        const resultado = totalRec - totalDesp
        return (
          <div ref={dreRef} className="flex flex-col gap-3 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-base font-bold text-gray-900">DRE</h3>
                  <p className="text-xs text-gray-400">{dre.period_label}{dreCatFilter ? ` · ${dreCatFilter}` : ''}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={exportXLSX}
                    className="flex items-center gap-1.5 text-xs bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 transition font-medium">
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                  </button>
                  <button onClick={exportPNG}
                    className="flex items-center gap-1.5 text-xs bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 transition font-medium">
                    <Image className="w-3.5 h-3.5" /> PNG
                  </button>
                </div>
              </div>
              <div className={`grid gap-2 ${dreFilter === 'all' ? 'grid-cols-4' : 'grid-cols-2'}`}>
                {dreFilter !== 'despesas' && (
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-green-600 font-medium mb-1">RECEITAS</p>
                    <p className="text-sm font-bold text-green-700">{fmt(totalRec)}</p>
                  </div>
                )}
                {dreFilter !== 'receitas' && (
                  <div className="bg-red-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-red-600 font-medium mb-1">DESPESAS</p>
                    <p className="text-sm font-bold text-red-700">{fmt(totalDesp)}</p>
                  </div>
                )}
                {dreFilter === 'all' && (() => {
                  const margem = totalRec > 0 ? ((resultado / totalRec) * 100) : 0
                  return (
                    <>
                      <div className={`rounded-lg p-3 text-center ${resultado >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
                        <p className={`text-[10px] font-medium mb-1 ${resultado >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                          {resultado >= 0 ? 'SUPERÁVIT' : 'DÉFICIT'}
                        </p>
                        <p className={`text-sm font-bold ${resultado >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>{fmt(Math.abs(resultado))}</p>
                      </div>
                      <div className={`rounded-lg p-3 text-center ${margem >= 0 ? 'bg-indigo-50' : 'bg-yellow-50'}`}>
                        <p className={`text-[10px] font-medium mb-1 ${margem >= 0 ? 'text-indigo-600' : 'text-yellow-700'}`}>MARGEM</p>
                        <p className={`text-sm font-bold ${margem >= 0 ? 'text-indigo-700' : 'text-yellow-700'}`}>{margem.toFixed(1)}%</p>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>

            <div className="px-4 pb-4 flex flex-col gap-4">
              {dreFilter !== 'despesas' && receitasFilt.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-green-700 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> Receitas
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {receitasFilt.map((r: any) => {
                      const pct = totalRec > 0 ? (r.valor / totalRec) * 100 : 0
                      return (
                        <div key={r.descricao} className="flex flex-col gap-0.5 py-2 border-b border-gray-50 last:border-0">
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-gray-700">{r.descricao}</p>
                            <p className="text-sm font-semibold text-green-700">{fmt(r.valor)}</p>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-green-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                    <div className="flex items-center justify-between py-2 mt-1">
                      <p className="text-sm font-bold text-gray-900">Total Receitas</p>
                      <p className="text-sm font-bold text-green-700">{fmt(totalRec)}</p>
                    </div>
                  </div>
                </div>
              )}

              {dreFilter !== 'receitas' && despesasFilt.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-red-600 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5" /> Despesas
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {despesasFilt.map((d: any) => {
                      const pct = totalDesp > 0 ? (d.valor / totalDesp) * 100 : 0
                      return (
                        <div key={d.descricao} className="flex flex-col gap-0.5 py-2 border-b border-gray-50 last:border-0">
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-gray-700">{d.descricao}</p>
                            <p className="text-sm font-semibold text-red-600">{fmt(d.valor)}</p>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                    <div className="flex items-center justify-between py-2 mt-1">
                      <p className="text-sm font-bold text-gray-900">Total Despesas</p>
                      <p className="text-sm font-bold text-red-600">{fmt(totalDesp)}</p>
                    </div>
                  </div>
                </div>
              )}

              {dreFilter === 'all' && (
                <div className={`rounded-xl p-4 text-center border-2 ${resultado >= 0 ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
                  <p className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Resultado do Período</p>
                  <p className={`text-3xl font-bold ${resultado >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {resultado >= 0 ? '+' : ''}{fmt(resultado)}
                  </p>
                  <p className={`text-sm font-medium mt-1 ${resultado >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {resultado >= 0 ? '✓ Superávit' : '✗ Déficit'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
