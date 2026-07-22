import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import toast from 'react-hot-toast'
import { escService } from '../../../services/esc'
import EscDataTable from '../EscDataTable'
import { EscButton, EscField, EscSelect, escInputCls, escInputStyle, ESC_ACCENT } from '../EscFormKit'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'
const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

const VIEWS = [
  { key: 'associados', label: 'Associados' },
  { key: 'receber', label: 'A receber' },
  { key: 'inadimplentes', label: 'Inadimplentes' },
  { key: 'pagos', label: 'Pagos' },
]

interface AssociadoRow {
  id: string; full_name: string; address: string; unidade: string
  associado_desde: string | null; valor_atrasado: number; qtd_pendentes: number
  ultima_entrega: string | null; enc_mes: number; acoes_mes: number
  forma_pagamento_recorrente: string | null; situacao: string
}

export default function CrmSection() {
  const [view, setView] = useState('associados')

  // filtros de "Associados"
  const [search, setSearch] = useState('')
  const [rua, setRua] = useState('')
  const [status, setStatus] = useState('')
  const [minAtrasado, setMinAtrasado] = useState('')
  const [maxAtrasado, setMaxAtrasado] = useState('')
  const [minMeses, setMinMeses] = useState('')
  const [tempoAssociado, setTempoAssociado] = useState('')
  const [dependentes, setDependentes] = useState('')
  const [avancado, setAvancado] = useState(false)
  const [rows, setRows] = useState<AssociadoRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const params = useMemo(() => {
    const p: Record<string, any> = { page }
    if (search.trim()) p.search = search.trim()
    if (rua.trim()) p.rua = rua.trim()
    if (status) p.status = status
    if (minAtrasado) p.min_atrasado = Number(minAtrasado)
    if (maxAtrasado) p.max_atrasado = Number(maxAtrasado)
    if (minMeses) p.min_meses_atrasado = Number(minMeses)
    if (tempoAssociado) p.tempo_associado_meses = Number(tempoAssociado)
    if (dependentes) p.dependentes = dependentes === 'sim'
    return p
  }, [page, search, rua, status, minAtrasado, maxAtrasado, minMeses, tempoAssociado, dependentes])

  useEffect(() => {
    if (view !== 'associados') return
    setLoading(true)
    escService.crmResidents(params)
      .then((r) => { setRows(r.data.items); setTotal(r.data.total) })
      .catch(() => toast.error('Erro ao carregar associados.'))
      .finally(() => setLoading(false))
  }, [view, params])

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-3 border-b flex gap-4" style={{ borderColor: BORDER }}>
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className="text-sm pb-2 border-b-2 -mb-px"
            style={{ borderColor: view === v.key ? ESC_ACCENT : 'transparent', color: view === v.key ? '#0f172a' : TEXT_MUTED, fontWeight: view === v.key ? 600 : 500 }}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'associados' ? (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-3 flex flex-col gap-3 border-b" style={{ borderColor: BORDER }}>
            <div className="flex items-end gap-3 flex-wrap">
              <EscField label="Nome">
                <input className={escInputCls + ' w-44'} style={escInputStyle} value={search} onChange={(e) => { setPage(1); setSearch(e.target.value) }} />
              </EscField>
              <EscField label="Rua">
                <input className={escInputCls + ' w-36'} style={escInputStyle} value={rua} onChange={(e) => { setPage(1); setRua(e.target.value) }} />
              </EscField>
              <EscField label="Status">
                <EscSelect className="w-36" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }}>
                  <option value="">Todos</option>
                  <option value="adimplente">Adimplente</option>
                  <option value="inadimplente">Inadimplente</option>
                </EscSelect>
              </EscField>
              <button onClick={() => setAvancado((v) => !v)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 border transition"
                style={avancado ? { borderColor: ESC_ACCENT, color: ESC_ACCENT } : { borderColor: BORDER, color: TEXT_MUTED }}>
                <SlidersHorizontal className="w-3.5 h-3.5" /> Mais filtros
              </button>
              <span className="text-xs ml-auto self-center" style={{ color: TEXT_MUTED }}>{loading ? 'carregando…' : `${total} associado(s)`}</span>
            </div>

            {avancado && (
              <div className="flex items-end gap-3 flex-wrap pt-3 border-t" style={{ borderColor: BORDER }}>
                <EscField label="R$ atrasado, de">
                  <input type="number" className={escInputCls + ' w-24'} style={escInputStyle} value={minAtrasado} onChange={(e) => { setPage(1); setMinAtrasado(e.target.value) }} />
                </EscField>
                <EscField label="até">
                  <input type="number" className={escInputCls + ' w-24'} style={escInputStyle} value={maxAtrasado} onChange={(e) => { setPage(1); setMaxAtrasado(e.target.value) }} />
                </EscField>
                <EscField label="Mín. meses em atraso">
                  <input type="number" className={escInputCls + ' w-24'} style={escInputStyle} value={minMeses} onChange={(e) => { setPage(1); setMinMeses(e.target.value) }} />
                </EscField>
                <EscField label="Associado há, no mínimo (meses)">
                  <input type="number" className={escInputCls + ' w-24'} style={escInputStyle} value={tempoAssociado} onChange={(e) => { setPage(1); setTempoAssociado(e.target.value) }} />
                </EscField>
                <EscField label="Dependentes">
                  <EscSelect className="w-40" value={dependentes} onChange={(e) => { setPage(1); setDependentes(e.target.value) }}>
                    <option value="">Todos</option>
                    <option value="sim">Tem dependente</option>
                    <option value="nao">Sem dependente</option>
                  </EscSelect>
                </EscField>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto px-6 py-2">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b" style={{ borderColor: BORDER }}>
                  {['Nome', 'Endereço', 'Unidade', 'Associado a', 'Status', 'R$ Atrasado', 'Qtd. meses', 'Ações/mês', 'Encomendas/mês', 'Última entrega', 'Forma pagto.'].map((h) => (
                    <th key={h} className="text-left py-2 pr-4 font-medium whitespace-nowrap" style={{ color: TEXT_MUTED }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={11} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED }}>nenhum associado encontrado.</td></tr>
                )}
                {rows.map((r) => {
                  const meses = r.associado_desde
                    ? Math.max(0, Math.floor((Date.now() - new Date(r.associado_desde).getTime()) / (30 * 86400000)))
                    : null
                  return (
                    <tr key={r.id} className="border-b hover:bg-slate-50" style={{ borderColor: BORDER }}>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.full_name}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.address}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.unidade}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{meses != null ? `${meses} meses` : '—'}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${r.situacao === 'inadimplente' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>{r.situacao}</span>
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap font-medium">{fmt(r.valor_atrasado)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.qtd_pendentes}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.acoes_mes}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.enc_mes}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.ultima_entrega ? new Date(r.ultima_entrega).toLocaleDateString('pt-BR') : '—'}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.forma_pagamento_recorrente ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-2 border-t flex items-center justify-between" style={{ borderColor: BORDER }}>
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="text-xs disabled:opacity-40" style={{ color: TEXT_MUTED }}>← Anterior</button>
            <span className="text-xs" style={{ color: TEXT_MUTED }}>Página {page} · {total} no total</span>
            <button disabled={page * 100 >= total} onClick={() => setPage((p) => p + 1)} className="text-xs disabled:opacity-40" style={{ color: TEXT_MUTED }}>Próxima →</button>
          </div>
        </div>
      ) : view === 'receber' ? (
        <EscDataTable
          fetchFn={escService.mensalidadesPending}
          searchKeys={['resident_name', 'unidade']}
          filterKeys={[{ key: 'unidade', label: 'Unidade' }]}
          columns={[
            { key: 'resident_name', label: 'Morador' },
            { key: 'unidade', label: 'Unidade' },
            { key: 'reference_month', label: 'Competência' },
            { key: 'due_date', label: 'Vencimento' },
            { key: 'amount', label: 'Valor', render: (r) => `R$ ${r.amount}` },
          ]}
        />
      ) : view === 'inadimplentes' ? (
        <EscDataTable
          fetchFn={escService.mensalidadesDelinquent}
          searchKeys={['resident_name', 'unidade', 'address_street']}
          filterKeys={[{ key: 'unidade', label: 'Unidade' }]}
          columns={[
            { key: 'resident_name', label: 'Morador' },
            { key: 'unidade', label: 'Unidade' },
            { key: 'address_street', label: 'Rua' },
            { key: 'months_overdue', label: 'Meses atrasado' },
            { key: 'amount', label: 'Valor', render: (r) => `R$ ${r.amount}` },
          ]}
        />
      ) : (
        <EscDataTable
          fetchFn={escService.mensalidadesPaid}
          searchKeys={['resident_name', 'unidade']}
          filterKeys={[{ key: 'unidade', label: 'Unidade' }]}
          columns={[
            { key: 'resident_name', label: 'Morador' },
            { key: 'unidade', label: 'Unidade' },
            { key: 'reference_month', label: 'Competência' },
            { key: 'paid_at', label: 'Pago em' },
            { key: 'amount', label: 'Valor', render: (r) => `R$ ${r.amount}` },
          ]}
        />
      )}
    </div>
  )
}
