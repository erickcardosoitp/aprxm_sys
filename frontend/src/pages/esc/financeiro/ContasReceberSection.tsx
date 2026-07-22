import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { escService } from '../../../services/esc'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'
const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

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

  const totalMensalidade = mensalidades.reduce((s, m) => s + Number(m.amount), 0)
  const totalTaxa = taxas.reduce((s, t) => s + t.valor_previsto, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-3 border-b flex gap-4" style={{ borderColor: BORDER }}>
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className="text-sm pb-2 border-b-2 -mb-px"
            style={{ borderColor: view === v.key ? '#16a34a' : 'transparent', color: view === v.key ? '#0f172a' : TEXT_MUTED, fontWeight: view === v.key ? 600 : 500 }}>
            {v.label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs" style={{ color: TEXT_MUTED }}>
          {loading ? 'carregando…' : view === 'mensalidade'
            ? `${mensalidades.length} lançamento(s) · ${fmt(totalMensalidade)}`
            : `${taxas.length} morador(es) · ${fmt(totalTaxa)}`}
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
              {!loading && mensalidades.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED }}>nenhuma mensalidade a receber.</td></tr>
              )}
              {mensalidades.map((m, i) => (
                <tr key={i} className="border-b" style={{ borderColor: BORDER }}>
                  <td className="py-2 pr-4 whitespace-nowrap">{m.resident_name}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{m.unidade}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{m.reference_month}</td>
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
                {!loading && taxas.length === 0 && (
                  <tr><td colSpan={4} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED }}>nenhuma taxa de entrega prevista.</td></tr>
                )}
                {taxas.map((t) => (
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
