import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { escService } from '../../../services/esc'
import { EscButton, EscField, EscModal, escInputCls, escInputStyle } from '../EscFormKit'
import { useAuthStore } from '../../../store/authStore'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

interface Dashboard {
  faturamento_dia: Record<string, number>
  total_caixa: number
  total_banco_mes: number
  inadimplencia_total: number
  inadimplentes_count: number
}
interface Summary {
  total_income: number
  total_expense: number
  total_sangria: number
  total_balance: number
  period_label: string
}
interface SaldoUnidade {
  association_id: string
  unidade: string
  saldo: number
}

export default function FluxoCaixaSection() {
  const role = useAuthStore((s) => s.role)
  const isAdmin = role === 'admin' || role === 'admin_master' || role === 'superadmin'

  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [saldos, setSaldos] = useState<SaldoUnidade[]>([])
  const [loading, setLoading] = useState(true)
  const [zerarAberto, setZerarAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([
      escService.financeiroDashboard(),
      escService.financeiroSummary({ period: 'month' }),
      escService.saldoCaixaRealizado(),
    ])
      .then(([d, s, sc]) => {
        setDashboard(d.data)
        setSummary(s.data)
        setSaldos(sc.data)
      })
      .catch(() => toast.error('Erro ao carregar fluxo de caixa.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const totalSaldo = saldos.reduce((s, c) => s + c.saldo, 0)

  const handleZerar = async () => {
    if (motivo.trim().length < 5) { toast.error('Motivo precisa de pelo menos 5 caracteres.'); return }
    const alvos = saldos.filter((c) => c.saldo > 0)
    setSaving(true)
    try {
      for (const c of alvos) {
        await escService.zerarCaixaTotal(c.association_id, motivo.trim())
      }
      toast.success(`Saldo total zerado em ${alvos.length} unidade(s).`)
      setZerarAberto(false)
      setMotivo('')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao zerar caixa.')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !dashboard) {
    return <div className="p-6 text-center text-sm" style={{ color: TEXT_MUTED }}>Carregando…</div>
  }

  return (
    <div className="flex flex-col h-full overflow-auto px-6 py-4 gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Saldo em caixa" value={fmt(dashboard?.total_caixa ?? 0)} />
        <Card label="Entrou (mês)" value={fmt(summary?.total_income ?? 0)} color="#16a34a" />
        <Card label="Saiu (mês)" value={fmt(summary?.total_expense ?? 0)} color="#dc2626" />
        <Card label="Sangrias (mês)" value={fmt(summary?.total_sangria ?? 0)} color="#6366f1" />
      </div>

      <div className="border" style={{ borderColor: BORDER }}>
        <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: BORDER }}>
          <span className="text-sm font-semibold text-slate-800">Saldo físico de caixa por unidade (produção)</span>
          {isAdmin && saldos.length > 0 && (
            <EscButton variant="danger" onClick={() => setZerarAberto(true)}>
              Zerar caixa — total {fmt(totalSaldo)}
            </EscButton>
          )}
        </div>
        <p className="px-4 pt-2 text-xs" style={{ color: TEXT_MUTED }}>
          Dinheiro físico no cofre: entradas − saídas já confirmadas (sessões conferidas + lançamentos sem caixa).
        </p>
        {saldos.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center" style={{ color: TEXT_MUTED }}>Nenhuma unidade no escopo.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: BORDER }}>
                <th className="text-left py-2 px-4 font-medium" style={{ color: TEXT_MUTED }}>Unidade</th>
                <th className="text-right py-2 px-4 font-medium" style={{ color: TEXT_MUTED }}>Saldo físico</th>
              </tr>
            </thead>
            <tbody>
              {saldos.map((c) => (
                <tr key={c.association_id} className="border-b" style={{ borderColor: BORDER }}>
                  <td className="py-2 px-4">{c.unidade}</td>
                  <td className="py-2 px-4 text-right font-medium">{fmt(c.saldo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t" style={{ borderColor: BORDER }}>
                <td className="py-2 px-4 text-right font-semibold" style={{ color: TEXT_MUTED }}>Total</td>
                <td className="py-2 px-4 text-right font-bold">{fmt(totalSaldo)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {zerarAberto && (
        <EscModal
          title="Zerar caixa — total das unidades de produção"
          onClose={() => { setZerarAberto(false); setMotivo('') }}
          footer={<>
            <EscButton variant="ghost" onClick={() => { setZerarAberto(false); setMotivo('') }}>Cancelar</EscButton>
            <EscButton variant="danger" onClick={handleZerar} disabled={saving}>{saving ? 'Zerando…' : 'Confirmar zeramento'}</EscButton>
          </>}
        >
          <p className="text-sm" style={{ color: TEXT_MUTED }}>
            Registra uma sangria administrativa remota (sem foto) em cada uma das {saldos.filter((c) => c.saldo > 0).length} unidade(s) com saldo,
            somando <strong>{fmt(totalSaldo)}</strong> no total. O saldo físico de cada unidade vai a zero.
          </p>
          <EscField label="Motivo">
            <textarea className={escInputCls} style={escInputStyle} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: repasse consolidado pra tesouraria da empresa" />
          </EscField>
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
