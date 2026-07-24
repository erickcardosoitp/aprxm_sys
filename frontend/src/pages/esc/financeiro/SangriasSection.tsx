import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import { RotateCcw } from 'lucide-react'
import EscDataTable from '../EscDataTable'
import { EscModal, EscField, EscButton, escInputCls, escInputStyle } from '../EscFormKit'
import { escService } from '../../../services/esc'

const TEXT_MUTED = '#64748b'
const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

interface SangriaRow {
  id: string; amount: string; reason: string; destination: string
  transaction_at: string; unidade: string; usuario: string
  reversed: boolean; is_reversal: boolean
}

export default function SangriasSection() {
  const [target, setTarget] = useState<SangriaRow | null>(null)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchFn = useCallback(
    () => escService.sangrias({ date_from: dateFrom || undefined, date_to: dateTo || undefined }),
    [dateFrom, dateTo],
  )

  const handleEstornar = async () => {
    if (!target) return
    if (reason.trim().length < 5) { toast.error('Motivo precisa de pelo menos 5 caracteres.'); return }
    if (!password.trim()) { toast.error('Informe a senha de um administrador.'); return }
    setSaving(true)
    try {
      await escService.estornarTransacao(target.id, reason.trim(), password.trim())
      toast.success('Sangria estornada.')
      setTarget(null); setReason(''); setPassword(''); setReloadKey((k) => k + 1)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao estornar sangria.')
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="px-6 pt-3 flex items-end gap-3">
        <EscField label="De">
          <input type="date" className={escInputCls + ' w-36'} style={escInputStyle} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </EscField>
        <EscField label="até">
          <input type="date" className={escInputCls + ' w-36'} style={escInputStyle} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </EscField>
      </div>
      <EscDataTable
        fetchFn={fetchFn}
        searchKeys={['unidade', 'usuario', 'reason']}
        filterKeys={[{ key: 'unidade', label: 'Unidade' }]}
        reloadKey={reloadKey}
        columns={[
          { key: 'transaction_at', label: 'Data/hora', render: (r) => new Date(r.transaction_at).toLocaleString('pt-BR') },
          { key: 'unidade', label: 'Unidade' },
          { key: 'usuario', label: 'Usuário' },
          { key: 'amount', label: 'Valor', render: (r) => fmt(Number(r.amount)) },
          { key: 'reason', label: 'Justificativa' },
          { key: 'reversed', label: 'Estornada', render: (r) => (r.reversed ? 'Sim' : 'Não') },
        ]}
        rowActions={(r: SangriaRow) => (
          !r.reversed && !r.is_reversal ? (
            <button onClick={() => { setTarget(r); setReason('') }} className="text-slate-500 hover:text-red-600" title="Estornar sangria">
              <RotateCcw className="w-4 h-4" />
            </button>
          ) : null
        )}
      />

      {target && (
        <EscModal
          title={`Estornar sangria — ${target.unidade}`}
          onClose={() => { setTarget(null); setReason(''); setPassword('') }}
          footer={<>
            <EscButton variant="ghost" onClick={() => { setTarget(null); setReason(''); setPassword('') }}>Cancelar</EscButton>
            <EscButton variant="danger" onClick={handleEstornar} disabled={saving}>{saving ? 'Estornando…' : 'Confirmar estorno'}</EscButton>
          </>}
        >
          <p className="text-sm" style={{ color: TEXT_MUTED }}>
            Devolve {fmt(Number(target.amount))} ao saldo de {target.unidade}. Requer a senha de um administrador (admin, admin_master ou superadmin).
          </p>
          <EscField label="Motivo do estorno" required>
            <textarea className={escInputCls} style={escInputStyle} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: sangria lançada por engano" />
          </EscField>
          <EscField label="Senha do administrador" required>
            <input type="password" className={escInputCls} style={escInputStyle} value={password} onChange={(e) => setPassword(e.target.value)} />
          </EscField>
        </EscModal>
      )}
    </>
  )
}
