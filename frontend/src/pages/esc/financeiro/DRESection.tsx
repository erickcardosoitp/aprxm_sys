import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { escService } from '../../../services/esc'
import { EscSelect, escInputCls, escInputStyle } from '../EscFormKit'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'
const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

interface Linha { descricao: string; valor: number; data: string }
interface Grupo { label: string; valor: number; linhas: Linha[] | null }
interface DRE {
  period_label: string; nivel: number
  receitas: Grupo[]; despesas: Grupo[]
  total_receitas: number; total_despesas: number; resultado: number
}

const AGRUPAR_POR = [
  { key: 'tipo', label: 'Tipo' }, { key: 'origem', label: 'Origem' },
  { key: 'operador', label: 'Operador' }, { key: 'categoria', label: 'Categoria' },
]

export default function DRESection() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState<number | ''>(now.getMonth() + 1)
  const [nivel, setNivel] = useState(2)
  const [agruparPor, setAgruparPor] = useState('tipo')
  const [dre, setDre] = useState<DRE | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    escService.financeiroDre({ year, month: month || undefined, nivel, agrupar_por: agruparPor })
      .then((r) => setDre(r.data))
      .catch(() => toast.error('Erro ao carregar DRE.'))
      .finally(() => setLoading(false))
  }, [year, month, nivel, agruparPor])

  const toggle = (label: string) => setExpanded((s) => {
    const n = new Set(s)
    n.has(label) ? n.delete(label) : n.add(label)
    return n
  })

  const Grupo = ({ item, cor }: { item: Grupo; cor: string }) => {
    const open = expanded.has(item.label)
    const hasDetail = !!item.linhas?.length
    return (
      <div className="border-b" style={{ borderColor: BORDER }}>
        <div className={`flex items-center justify-between py-2 px-3 ${hasDetail ? 'cursor-pointer hover:bg-slate-50' : ''}`}
             onClick={() => hasDetail && toggle(item.label)}>
          <span className="text-sm flex items-center gap-1.5">
            {hasDetail && (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)}
            {item.label}
          </span>
          <span className="text-sm font-semibold" style={{ color: cor }}>{fmt(item.valor)}</span>
        </div>
        {open && item.linhas && (
          <div className="pl-8 pb-2">
            {item.linhas.map((l, i) => (
              <div key={i} className="flex items-center justify-between py-1 text-xs" style={{ color: TEXT_MUTED }}>
                <span>{l.descricao} · {l.data}</span>
                <span>{fmt(l.valor)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto px-6 py-4 gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <input type="number" className={escInputCls + ' w-24'} style={escInputStyle} value={year} onChange={(e) => setYear(Number(e.target.value))} />
        <EscSelect className="w-32" value={month} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Ano inteiro</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
        </EscSelect>
        <EscSelect className="w-32" value={nivel} onChange={(e) => setNivel(Number(e.target.value))}>
          <option value={1}>Nível 1 — totais</option>
          <option value={2}>Nível 2 — grupos</option>
          <option value={3}>Nível 3 — detalhe</option>
        </EscSelect>
        <EscSelect className="w-40" value={agruparPor} onChange={(e) => setAgruparPor(e.target.value)}>
          {AGRUPAR_POR.map((a) => <option key={a.key} value={a.key}>Agrupar por {a.label}</option>)}
        </EscSelect>
        {loading && <span className="text-xs" style={{ color: TEXT_MUTED }}>carregando…</span>}
      </div>

      {dre && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="border p-3" style={{ borderColor: BORDER }}>
              <p className="text-[11px]" style={{ color: TEXT_MUTED }}>Receitas — {dre.period_label}</p>
              <p className="text-base font-bold text-green-700">{fmt(dre.total_receitas)}</p>
            </div>
            <div className="border p-3" style={{ borderColor: BORDER }}>
              <p className="text-[11px]" style={{ color: TEXT_MUTED }}>Despesas — {dre.period_label}</p>
              <p className="text-base font-bold text-red-700">{fmt(dre.total_despesas)}</p>
            </div>
            <div className="border p-3" style={{ borderColor: BORDER }}>
              <p className="text-[11px]" style={{ color: TEXT_MUTED }}>Resultado</p>
              <p className={`text-base font-bold ${dre.resultado >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(dre.resultado)}</p>
            </div>
          </div>

          <div className="border" style={{ borderColor: BORDER }}>
            <div className="px-3 py-2 border-b text-xs font-semibold uppercase" style={{ borderColor: BORDER, color: TEXT_MUTED }}>Receitas</div>
            {dre.receitas.length === 0
              ? <p className="px-3 py-4 text-sm" style={{ color: TEXT_MUTED }}>Sem receitas no período.</p>
              : dre.receitas.map((g) => <Grupo key={g.label} item={g} cor="#15803d" />)}
          </div>
          <div className="border" style={{ borderColor: BORDER }}>
            <div className="px-3 py-2 border-b text-xs font-semibold uppercase" style={{ borderColor: BORDER, color: TEXT_MUTED }}>Despesas</div>
            {dre.despesas.length === 0
              ? <p className="px-3 py-4 text-sm" style={{ color: TEXT_MUTED }}>Sem despesas no período.</p>
              : dre.despesas.map((g) => <Grupo key={g.label} item={g} cor="#b91c1c" />)}
          </div>
        </>
      )}
    </div>
  )
}
