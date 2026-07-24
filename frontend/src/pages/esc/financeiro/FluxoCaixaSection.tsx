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
interface CaixaAberto {
  session_id: string
  unidade: string
  opened_at: string
  aberto_por: string
  saldo_disponivel: number
}

export default function FluxoCaixaSection() {
  const role = useAuthStore((s) => s.role)
  const isAdmin = role === 'admin' || role === 'admin_master' || role === 'superadmin'

  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [caixas, setCaixas] = useState<CaixaAberto[]>([])
  const [loading, setLoading] = useState(true)
  const [zerarTarget, setZerarTarget] = useState<CaixaAberto | null>(null)
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([
      escService.financeiroDashboard(),
      escService.financeiroSummary({ period: 'month' }),
      escService.caixasAbertos(),
    ])
      .then(([d, s, c]) => {
        setDashboard(d.data)
        setSummary(s.data)
        setCaixas(c.data)
      })
      .catch(() => toast.error('Erro ao carregar fluxo de caixa.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleZerar = async () => {
    if (!zerarTarget || motivo.trim().length < 5) { toast.error('Motivo precisa de pelo menos 5 caracteres.'); return }
    setSaving(true)
    try {
      await escService.zerarCaixa(zerarTarget.session_id, motivo.trim())
      toast.success(`Caixa de ${zerarTarget.unidade} zerado.`)
      setZerarTarget(null)
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
        <div className="px-4 py-2.5 border-b text-sm font-semibold text-slate-800" style={{ borderColor: BORDER }}>
          Caixas abertos agora
        </div>
        {caixas.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center" style={{ color: TEXT_MUTED }}>Nenhum caixa aberto no momento.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: BORDER }}>
                <th className="text-left py-2 px-4 font-medium" style={{ color: TEXT_MUTED }}>Unidade</th>
                <th className="text-left py-2 px-4 font-medium" style={{ color: TEXT_MUTED }}>Aberto por</th>
                <th className="text-left py-2 px-4 font-medium" style={{ color: TEXT_MUTED }}>Aberto em</th>
                <th className="text-right py-2 px-4 font-medium" style={{ color: TEXT_MUTED }}>Saldo disponível</th>
                {isAdmin && <th className="py-2 px-4" />}
              </tr>
            </thead>
            <tbody>
              {caixas.map((c) => (
                <tr key={c.session_id} className="border-b" style={{ borderColor: BORDER }}>
                  <td className="py-2 px-4">{c.unidade}</td>
                  <td className="py-2 px-4">{c.aberto_por}</td>
                  <td className="py-2 px-4">{new Date(c.opened_at).toLocaleString('pt-BR')}</td>
                  <td className="py-2 px-4 text-right font-medium">{fmt(c.saldo_disponivel)}</td>
                  {isAdmin && (
                    <td className="py-2 px-4 text-right">
                      <EscButton variant="danger" onClick={() => setZerarTarget(c)}>Zerar caixa</EscButton>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {zerarTarget && (
        <EscModal
          title={`Zerar caixa — ${zerarTarget.unidade}`}
          onClose={() => { setZerarTarget(null); setMotivo('') }}
          footer={<>
            <EscButton variant="ghost" onClick={() => { setZerarTarget(null); setMotivo('') }}>Cancelar</EscButton>
            <EscButton variant="danger" onClick={handleZerar} disabled={saving}>Confirmar zeramento</EscButton>
          </>}
        >
          <p className="text-sm" style={{ color: TEXT_MUTED }}>
            Registra uma sangria administrativa remota de <strong>{fmt(zerarTarget.saldo_disponivel)}</strong>, sem foto de recibo — o saldo do caixa vai a zero.
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
