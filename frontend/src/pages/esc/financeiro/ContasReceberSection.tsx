import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { escService } from '../../../services/esc'
import { EscSelect, escInputCls, escInputStyle } from '../EscFormKit'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'
const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
const formatCompetencia = (v: string) => {
  const [ano, mes] = (v ?? '').split('-')
  return ano && mes ? `${mes}/${ano}` : v
}

interface Pendente { resident_name: string; unidade: string; due_date: string; reference_month: string; amount: string }
interface TaxaEntrega { resident_id: string; resident_name: string; unidade: string; qtd_pendente: number; valor_previsto: number }

const VIEWS = [
  { key: 'mensalidade', label: 'Mensalidade' },
  { key: 'taxa', label: 'Taxa de Entrega' },
]

export default function ContasReceberSection() {
  const [view, setView] = useState('mensalidade')
  const [mensalidades, setMensalidades] = useState<Pendente[]>([])
  const [taxas, setTaxas] = useState<TaxaEntrega[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [unidade, setUnidade] = useState('')

  useEffect(() => {
    setLoading(true)
    if (view === 'mensalidade') {
      escService.mensalidadesPending()
        .then((r) => setMensalidades(r.data))
        .catch(() => toast.error('Erro ao carregar mensalidades a receber.'))
        .finally(() => setLoading(false))
    } else {
      escService.taxaEntregaPrevista()
        .then((r) => setTaxas(r.data))
        .catch(() => toast.error('Erro ao carregar taxas de entrega previstas.'))
        .finally(() => setLoading(false))
    }
  }, [view])

  const unidades = useMemo(() => {
    const src = view === 'mensalidade' ? mensalidades : taxas
    return [...new Set(src.map((r) => r.unidade))].sort()
  }, [view, mensalidades, taxas])

  const mensalidadesFiltradas = mensalidades.filter((m) =>
    (!search.trim() || m.resident_name.toLowerCase().includes(search.trim().toLowerCase())) &&
    (!unidade || m.unidade === unidade))
  const taxasFiltradas = taxas.filter((t) =>
    (!search.trim() || t.resident_name.toLowerCase().includes(search.trim().toLowerCase())) &&
    (!unidade || t.unidade === unidade))

  const totalMensalidade = mensalidadesFiltradas.reduce((s, m) => s + Number(m.amount), 0)
  const totalTaxa = taxasFiltradas.reduce((s, t) => s + t.valor_previsto, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-3 border-b flex items-end gap-4 flex-wrap" style={{ borderColor: BORDER }}>
        <div className="flex gap-4">
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)}
              className="text-sm pb-2 border-b-2 -mb-px"
              style={{ borderColor: view === v.key ? '#16a34a' : 'transparent', color: view === v.key ? '#0f172a' : TEXT_MUTED, fontWeight: view === v.key ? 600 : 500 }}>
              {v.label}
            </button>
          ))}
        </div>
        <input className={escInputCls + ' w-44 mb-2'} style={escInputStyle} placeholder="Buscar morador…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <EscSelect className="w-40 mb-2" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
          <option value="">Todas as unidades</option>
          {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
        </EscSelect>
        <span className="ml-auto self-center mb-2 text-xs" style={{ color: TEXT_MUTED }}>
          {loading ? 'carregando…' : view === 'mensalidade'
            ? `${mensalidadesFiltradas.length} lançamento(s) · ${fmt(totalMensalidade)}`
            : `${taxasFiltradas.length} morador(es) · ${fmt(totalTaxa)}`}
        </span>
      </div>

      <div className="flex-1 overflow-auto px-6 py-2">
        {view === 'mensalidade' ? (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b" style={{ borderColor: BORDER }}>
                {['Morador', 'Unidade', 'Competência', 'Vencimento', 'Valor'].map((h) => (
                  <th key={h} className="text-left py-2 pr-4 font-medium whitespace-nowrap" style={{ color: TEXT_MUTED }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && mensalidadesFiltradas.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED }}>nenhuma mensalidade a receber.</td></tr>
              )}
              {mensalidadesFiltradas.map((m, i) => (
                <tr key={i} className="border-b" style={{ borderColor: BORDER }}>
                  <td className="py-2 pr-4 whitespace-nowrap">{m.resident_name}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{m.unidade}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatCompetencia(m.reference_month)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{new Date(m.due_date).toLocaleDateString('pt-BR')}</td>
                  <td className="py-2 pr-4 whitespace-nowrap font-medium">{fmt(Number(m.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <p className="text-xs py-2" style={{ color: TEXT_MUTED }}>
              1 taxa por morador não-associado com encomenda parada — não conta por encomenda (retirada é em lote).
            </p>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b" style={{ borderColor: BORDER }}>
                  {['Morador', 'Unidade', 'Encomendas paradas', 'Valor previsto'].map((h) => (
                    <th key={h} className="text-left py-2 pr-4 font-medium whitespace-nowrap" style={{ color: TEXT_MUTED }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading && taxasFiltradas.length === 0 && (
                  <tr><td colSpan={4} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED }}>nenhuma taxa de entrega prevista.</td></tr>
                )}
                {taxasFiltradas.map((t) => (
                  <tr key={t.resident_id} className="border-b" style={{ borderColor: BORDER }}>
                    <td className="py-2 pr-4 whitespace-nowrap">{t.resident_name}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{t.unidade}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{t.qtd_pendente}</td>
                    <td className="py-2 pr-4 whitespace-nowrap font-medium">{fmt(t.valor_previsto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
