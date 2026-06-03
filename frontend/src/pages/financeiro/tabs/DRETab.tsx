import { useRef, useState } from 'react'
import { FileBarChart, FileSpreadsheet, Image, TrendingUp, TrendingDown, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import api from '../../../services/api'
import { fmt } from '../utils/formatters'

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

const NIVEIS = [
  { v: 1, label: '1 — Resumo',    desc: 'Só totais' },
  { v: 2, label: '2 — Agrupado',  desc: 'Por grupo' },
  { v: 3, label: '3 — Detalhado', desc: 'Com transações' },
]

const DIMENSOES = [
  { v: '',         label: 'Nenhum',   desc: 'Sem sub-agrupamento' },
  { v: 'tipo',     label: 'Tipo',     desc: 'Mensalidades, Taxas…' },
  { v: 'origem',   label: 'Origem',   desc: 'Caixa vs Manual' },
  { v: 'operador', label: 'Operador', desc: 'Por quem faturou' },
  { v: 'categoria',label: 'Categoria',desc: 'Categoria cadastrada' },
]

interface SubGrupo { label: string; valor: number }
interface DRELinha { label: string; valor: number; linhas: null | { descricao: string; valor: number; data: string }[]; sub_grupos?: SubGrupo[] }
interface DREData {
  period_label: string; nivel: number; agrupar_por: string; sub_agrupar_por?: string
  receitas: DRELinha[]; despesas: DRELinha[]
  total_receitas: number; total_despesas: number; resultado: number
}

export default function DRETab() {
  const [dreYear,      setDreYear]      = useState(new Date().getFullYear())
  const [dreMonth,     setDreMonth]     = useState<number | ''>(new Date().getMonth() + 1)
  const [nivel,        setNivel]        = useState(2)
  const [agruparPor,   setAgruparPor]   = useState('tipo')
  const [subAgruparPor, setSubAgruparPor] = useState('')
  const [dre,          setDre]          = useState<DREData | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set())
  const dreRef = useRef<HTMLDivElement>(null)

  const toggleExpand = (label: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n })

  const loadDre = async () => {
    setLoading(true); setExpanded(new Set())
    try {
      const params: any = { year: dreYear, nivel, agrupar_por: agruparPor }
      if (dreMonth) params.month = dreMonth
      if (subAgruparPor && subAgruparPor !== agruparPor) params.sub_agrupar_por = subAgruparPor
      const res = await api.get<DREData>('/financeiro/dre', { params })
      setDre(res.data)
    } catch { toast.error('Erro ao gerar DRE.') } finally { setLoading(false) }
  }

  const exportXLSX = () => {
    if (!dre) return
    const rows: any[][] = [[`DRE — ${dre.period_label} · Nível ${dre.nivel} · ${dre.agrupar_por}`], []]
    rows.push(['RECEITAS', ''])
    dre.receitas.forEach(r => {
      rows.push([r.label, r.valor])
      if (r.linhas) r.linhas.forEach(l => rows.push([`  ${l.descricao}`, l.valor]))
    })
    rows.push(['Total Receitas', dre.total_receitas], [])
    rows.push(['DESPESAS', ''])
    dre.despesas.forEach(d => {
      rows.push([d.label, d.valor])
      if (d.linhas) d.linhas.forEach(l => rows.push([`  ${l.descricao}`, l.valor]))
    })
    rows.push(['Total Despesas', dre.total_despesas], [])
    rows.push([dre.resultado >= 0 ? 'SUPERÁVIT' : 'DÉFICIT', Math.abs(dre.resultado)])
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 40 }, { wch: 18 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'DRE')
    XLSX.writeFile(wb, `dre_${dre.period_label.replace('/', '-')}.xlsx`)
  }

  const exportPNG = async () => {
    if (!dreRef.current) return
    try {
      const canvas = await html2canvas(dreRef.current, { scale: 2, backgroundColor: '#ffffff' })
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a'); a.href = url
      a.download = `dre_${dre?.period_label?.replace('/', '-') ?? 'periodo'}.png`; a.click()
    } catch { toast.error('Erro ao exportar imagem.') }
  }

  const LinhaItem = ({ item, cor, pct }: { item: DRELinha; cor: string; pct: number }) => {
    const open = expanded.has(item.label)
    const hasSubGrupos = item.sub_grupos && item.sub_grupos.length > 0
    const hasLinhas = item.linhas && item.linhas.length > 0
    const hasDetail = hasSubGrupos || hasLinhas
    return (
      <div className="border-b border-gray-50 last:border-0">
        <div className="flex flex-col gap-0.5 py-2">
          <div className="flex items-center justify-between gap-2">
            {hasDetail ? (
              <button onClick={() => toggleExpand(item.label)}
                className="flex items-center gap-1 text-sm text-gray-700 hover:text-[#26619c] text-left">
                {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                {item.label}
              </button>
            ) : (
              <p className="text-sm text-gray-700 flex-1">{item.label}</p>
            )}
            <p className={`text-sm font-semibold shrink-0 ${cor}`}>{fmt(item.valor)}</p>
          </div>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${cor.includes('green') ? 'bg-green-400' : 'bg-red-400'}`}
              style={{ width: `${pct}%` }} />
          </div>
        </div>
        {open && hasSubGrupos && (
          <div className="ml-5 mb-2 flex flex-col gap-0.5 bg-gray-50 rounded-lg p-2">
            {item.sub_grupos!.map((sg, i) => {
              const subPct = item.valor > 0 ? (sg.valor / item.valor) * 100 : 0
              return (
                <div key={i} className="flex flex-col gap-0.5 py-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 font-medium truncate flex-1 mr-2">{sg.label}</span>
                    <span className={`font-semibold shrink-0 ${cor}`}>{fmt(sg.valor)}</span>
                    <span className="text-gray-400 text-[10px] ml-2 shrink-0">{subPct.toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${cor.includes('green') ? 'bg-green-300' : 'bg-red-300'}`}
                      style={{ width: `${subPct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {open && hasLinhas && !hasSubGrupos && (
          <div className="ml-5 mb-2 flex flex-col gap-0.5 bg-gray-50 rounded-lg p-2">
            {item.linhas!.map((l, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-0.5">
                <span className="text-gray-600 truncate flex-1 mr-2">{l.descricao}</span>
                <span className="text-gray-500 shrink-0 mr-2">{l.data}</span>
                <span className={`font-medium shrink-0 ${cor}`}>{fmt(l.valor)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <FileBarChart className="w-4 h-4 text-[#26619c]" />
          Demonstrativo de Resultado
        </p>

        {/* Período */}
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

        {/* Nível */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Nível de detalhe</label>
          <div className="grid grid-cols-3 gap-2">
            {NIVEIS.map(n => (
              <button key={n.v} onClick={() => setNivel(n.v)}
                className={`flex flex-col items-center py-2 px-1 rounded-xl border-2 text-xs font-semibold transition ${
                  nivel === n.v ? 'border-[#26619c] bg-blue-50 text-[#26619c]' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>
                <span>{n.label.split(' — ')[0]}</span>
                <span className={`text-[10px] font-normal mt-0.5 ${nivel === n.v ? 'text-[#26619c]/70' : 'text-gray-400'}`}>{n.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Dimensão principal (nível 2 e 3) */}
        {nivel >= 2 && (
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Agrupar por</label>
            <div className="grid grid-cols-2 gap-2">
              {DIMENSOES.filter(d => d.v !== '').map(d => (
                <button key={d.v} onClick={() => setAgruparPor(d.v)}
                  className={`flex flex-col items-start px-3 py-2 rounded-xl border-2 text-xs font-semibold transition ${
                    agruparPor === d.v ? 'border-[#26619c] bg-blue-50 text-[#26619c]' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}>
                  <span>{d.label}</span>
                  <span className={`text-[10px] font-normal mt-0.5 ${agruparPor === d.v ? 'text-[#26619c]/70' : 'text-gray-400'}`}>{d.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sub-agrupamento opcional */}
        {nivel >= 2 && (
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">
              Sub-agrupar por <span className="text-gray-400 font-normal">(opcional — detalha dentro de cada grupo)</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {DIMENSOES.map(d => {
                const isDisabled = d.v !== '' && d.v === agruparPor
                const isActive = subAgruparPor === d.v
                return (
                  <button key={d.v} onClick={() => !isDisabled && setSubAgruparPor(d.v)}
                    disabled={isDisabled}
                    className={`flex flex-col items-start px-2 py-1.5 rounded-xl border-2 text-xs font-semibold transition ${
                      isActive ? 'border-emerald-500 bg-emerald-50 text-emerald-700' :
                      isDisabled ? 'border-gray-100 text-gray-300 cursor-not-allowed' :
                      'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}>
                    <span>{d.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <button onClick={loadDre} disabled={loading}
          className="bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
          {loading ? 'Gerando…' : 'Gerar DRE'}
        </button>
      </div>

      {/* DRE */}
      {dre && (
        <div ref={dreRef} className="flex flex-col gap-3 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-3 border-b border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-gray-900">DRE</h3>
                <p className="text-xs text-gray-400">
                  {dre.period_label}
                  {dre.nivel > 1 && ` · ${DIMENSOES.find(d => d.v === dre.agrupar_por)?.label}`}
                  {` · Nível ${dre.nivel}`}
                </p>
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
            {/* Cards topo */}
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-green-600 font-medium mb-1">RECEITAS</p>
                <p className="text-sm font-bold text-green-700">{fmt(dre.total_receitas)}</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-red-600 font-medium mb-1">DESPESAS</p>
                <p className="text-sm font-bold text-red-700">{fmt(dre.total_despesas)}</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${dre.resultado >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
                <p className={`text-[10px] font-medium mb-1 ${dre.resultado >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                  {dre.resultado >= 0 ? 'SUPERÁVIT' : 'DÉFICIT'}
                </p>
                <p className={`text-sm font-bold ${dre.resultado >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>
                  {fmt(Math.abs(dre.resultado))}
                </p>
              </div>
              <div className="bg-indigo-50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-indigo-600 font-medium mb-1">MARGEM</p>
                <p className="text-sm font-bold text-indigo-700">
                  {dre.total_receitas > 0 ? ((dre.resultado / dre.total_receitas) * 100).toFixed(1) : '0.0'}%
                </p>
              </div>
            </div>
          </div>

          <div className="px-4 pb-4 flex flex-col gap-4">
            {/* Receitas */}
            {dre.receitas.length > 0 && (
              <div>
                <p className="text-xs font-bold text-green-700 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> Receitas
                </p>
                <div className="flex flex-col">
                  {dre.receitas.map(r => (
                    <LinhaItem key={r.label} item={r} cor="text-green-700"
                      pct={dre.total_receitas > 0 ? (r.valor / dre.total_receitas) * 100 : 0} />
                  ))}
                  <div className="flex items-center justify-between py-2 mt-1">
                    <p className="text-sm font-bold text-gray-900">Total Receitas</p>
                    <p className="text-sm font-bold text-green-700">{fmt(dre.total_receitas)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Despesas */}
            {dre.despesas.length > 0 && (
              <div>
                <p className="text-xs font-bold text-red-600 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5" /> Despesas
                </p>
                <div className="flex flex-col">
                  {dre.despesas.map(d => (
                    <LinhaItem key={d.label} item={d} cor="text-red-600"
                      pct={dre.total_despesas > 0 ? (d.valor / dre.total_despesas) * 100 : 0} />
                  ))}
                  <div className="flex items-center justify-between py-2 mt-1">
                    <p className="text-sm font-bold text-gray-900">Total Despesas</p>
                    <p className="text-sm font-bold text-red-600">{fmt(dre.total_despesas)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Resultado final */}
            <div className={`rounded-xl p-4 text-center border-2 ${dre.resultado >= 0 ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
              <p className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Resultado do Período</p>
              <p className={`text-3xl font-bold ${dre.resultado >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {dre.resultado >= 0 ? '+' : ''}{fmt(dre.resultado)}
              </p>
              <p className={`text-sm font-medium mt-1 ${dre.resultado >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {dre.resultado >= 0 ? '✓ Superávit' : '✗ Déficit'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
