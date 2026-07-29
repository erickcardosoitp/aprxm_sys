import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { escService } from '../../../services/esc'
import { uploadService } from '../../../services/upload'
import { PhotoCapture } from '../../../components/packages/PhotoCapture'
import { EscButton, EscField, EscModal, escInputCls, escInputStyle } from '../EscFormKit'
import { useSort, SortTh } from '../EscDataTable'
import { useAuthStore } from '../../../store/authStore'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

type Periodo = 'dia' | 'semana' | 'mes' | 'trimestre' | 'semestre' | 'ano' | 'personalizado'

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: 'dia', label: 'Dia' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mês' },
  { value: 'trimestre', label: 'Trimestre' },
  { value: 'semestre', label: 'Semestre' },
  { value: 'ano', label: 'Ano' },
  { value: 'personalizado', label: 'Período personalizado' },
]

interface Summary {
  total_income: number
  total_expense: number
  total_sangria: number
  period_label: string
}
interface SaldoUnidade {
  association_id: string
  unidade: string
  saldo: number
}
interface MovimentoUnidade {
  association_id: string
  unidade: string
  entrou: number
  saiu: number
  sangria: number
  liquido: number
}
interface AlertaPendente {
  association_id: string
  unidade: string
  qtd: number
  mais_antiga: string | null
}

export default function FluxoCaixaSection() {
  const role = useAuthStore((s) => s.role)
  const isAdmin = role === 'admin' || role === 'admin_master' || role === 'superadmin'

  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  const [summary, setSummary] = useState<Summary | null>(null)
  const [saldoFisico, setSaldoFisico] = useState<SaldoUnidade[]>([])
  const [movimento, setMovimento] = useState<MovimentoUnidade[]>([])
  const [alertas, setAlertas] = useState<AlertaPendente[]>([])
  const [loading, setLoading] = useState(true)
  const [zerarAberto, setZerarAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [fotoRecibo, setFotoRecibo] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, any> = { period: periodo }
    if (periodo === 'personalizado') {
      if (!dataInicio || !dataFim) { setLoading(false); return }
      params.date_from = dataInicio
      params.date_to = dataFim
    }
    Promise.all([
      escService.financeiroSummary(params),
      escService.saldoCaixaRealizado(),
      escService.movimentoPorUnidade(params),
      escService.alertasSessoesPendentes(),
    ])
      .then(([s, sf, mv, al]) => {
        setSummary(s.data)
        setSaldoFisico(sf.data)
        setMovimento(mv.data)
        setAlertas(al.data)
      })
      .catch(() => toast.error('Erro ao carregar fluxo de caixa.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [periodo, dataInicio, dataFim])

  // Saldo em caixa = total receita - total despesa em lancamentos manuais,
  // migracao e sessoes CONFERIDAS (mesma fonte de /financeiro/saldo-caixa-realizado).
  // Nao e afetado pelo filtro de periodo — e o que "Zerar caixa" zera.
  const totalSaldoEmCaixa = saldoFisico.reduce((s, c) => s + c.saldo, 0)
  const totalLiquido = movimento.reduce((s, c) => s + c.liquido, 0)

  const { sorted: sortedMovimento, sortKey, sortDir, toggleSort } = useSort(movimento)

  const handleZerar = async () => {
    if (motivo.trim().length < 5) { toast.error('Motivo precisa de pelo menos 5 caracteres.'); return }
    if (!fotoRecibo) { toast.error('Foto do recibo é obrigatória.'); return }
    const alvos = saldoFisico.filter((c) => c.saldo > 0)
    setSaving(true)
    try {
      for (const c of alvos) {
        await escService.zerarCaixaTotal(c.association_id, motivo.trim(), fotoRecibo)
      }
      toast.success(`Saldo em caixa zerado em ${alvos.length} unidade(s).`)
      setZerarAberto(false)
      setMotivo('')
      setFotoRecibo('')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao zerar caixa.')
    } finally {
      setSaving(false)
    }
  }

  if (loading && saldoFisico.length === 0 && !summary) {
    return <div className="p-6 text-center text-sm" style={{ color: TEXT_MUTED }}>Carregando…</div>
  }

  return (
    <div className="flex flex-col h-full overflow-auto px-6 py-4 gap-4">
      {alertas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {alertas.map((a) => (
            <div key={a.association_id} className="flex items-center gap-2 border px-3 py-2 text-xs"
              style={{ borderColor: '#fecaca', backgroundColor: '#fef2f2', color: '#991b1b' }}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span><strong>{a.unidade}</strong> tem <strong>{a.qtd}</strong> caixa(s) fechado(s) não conferido(s) há mais de 3 dias!</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriodo(p.value)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition"
            style={periodo === p.value
              ? { backgroundColor: '#26619c', color: '#fff' }
              : { backgroundColor: '#f3f4f6', color: '#4b5563' }}
          >
            {p.label}
          </button>
        ))}
        {periodo === 'personalizado' && (
          <div className="flex items-center gap-2 ml-1">
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
              className="border rounded-lg px-2 py-1 text-xs" style={{ borderColor: BORDER }} />
            <span className="text-xs" style={{ color: TEXT_MUTED }}>até</span>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
              className="border rounded-lg px-2 py-1 text-xs" style={{ borderColor: BORDER }} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Saldo em caixa" value={fmt(totalSaldoEmCaixa)} />
        <Card label="Entrou" value={fmt(summary?.total_income ?? 0)} color="#16a34a" />
        <Card label="Saiu" value={fmt(summary?.total_expense ?? 0)} color="#dc2626" />
        <Card label="Sangrias" value={fmt(summary?.total_sangria ?? 0)} color="#6366f1" />
      </div>

      <div className="border" style={{ borderColor: BORDER }}>
        <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: BORDER }}>
          <span className="text-sm font-semibold text-slate-800">Movimento por unidade — {summary?.period_label ?? ''}</span>
          {isAdmin && saldoFisico.length > 0 && (
            <EscButton variant="danger" onClick={() => setZerarAberto(true)}>
              Zerar caixa — saldo em caixa {fmt(totalSaldoEmCaixa)}
            </EscButton>
          )}
        </div>
        {movimento.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center" style={{ color: TEXT_MUTED }}>Nenhuma unidade no escopo.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: BORDER }}>
                <SortTh label="Unidade" sortKey="unidade" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('unidade')} />
                <SortTh label="Entrou" sortKey="entrou" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('entrou')} align="right" />
                <SortTh label="Saiu" sortKey="saiu" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('saiu')} align="right" />
                <SortTh label="Sangria" sortKey="sangria" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('sangria')} align="right" />
                <SortTh label="Líquido" sortKey="liquido" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('liquido')} align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedMovimento.map((c) => (
                <tr key={c.association_id} className="border-b" style={{ borderColor: BORDER }}>
                  <td className="py-2 px-4">{c.unidade}</td>
                  <td className="py-2 px-4 text-right text-green-700">{fmt(c.entrou)}</td>
                  <td className="py-2 px-4 text-right text-red-700">{fmt(c.saiu)}</td>
                  <td className="py-2 px-4 text-right" style={{ color: '#6366f1' }}>{fmt(c.sangria)}</td>
                  <td className="py-2 px-4 text-right font-medium">{fmt(c.liquido)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t" style={{ borderColor: BORDER }}>
                <td className="py-2 px-4 text-right font-semibold" style={{ color: TEXT_MUTED }}>Total</td>
                <td className="py-2 px-4"></td>
                <td className="py-2 px-4"></td>
                <td className="py-2 px-4"></td>
                <td className="py-2 px-4 text-right font-bold">{fmt(totalLiquido)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {zerarAberto && (
        <EscModal
          title="Zerar caixa — saldo em caixa"
          onClose={() => { setZerarAberto(false); setMotivo(''); setFotoRecibo('') }}
          footer={<>
            <EscButton variant="ghost" onClick={() => { setZerarAberto(false); setMotivo(''); setFotoRecibo('') }}>Cancelar</EscButton>
            <EscButton variant="danger" onClick={handleZerar} disabled={saving}>{saving ? 'Zerando…' : 'Confirmar zeramento'}</EscButton>
          </>}
        >
          <p className="text-sm" style={{ color: TEXT_MUTED }}>
            Sangria de {fmt(totalSaldoEmCaixa)} em {saldoFisico.filter((c) => c.saldo > 0).length} unidade(s).
          </p>
          <EscField label="Motivo">
            <textarea className={escInputCls} style={escInputStyle} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: repasse consolidado pra tesouraria da empresa" />
          </EscField>
          <PhotoCapture
            label="Foto do recibo *"
            onCapture={(entry) => setFotoRecibo(entry.url)}
            onUpload={(file) => uploadService.uploadFile(file, 'financeiro/zeramentos')}
          />
        </EscModal>
      )}
    </div>
  )
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border p-3" style={{ borderColor: BORDER }}>
      <p className="text-[11px] mb-0.5" style={{ color: TEXT_MUTED }}>{label}</p>
      <p className="text-base font-bold" style={{ color: color ?? '#0f172a' }}>{value}</p>
    </div>
  )
}
