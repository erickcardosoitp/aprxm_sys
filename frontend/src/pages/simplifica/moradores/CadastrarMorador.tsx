import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../../services/api'
import { packageService } from '../../../services/packages'
import { SECTOR_COLORS } from '../theme'
import type { Resident } from '../../../types'

interface Props { onClose: () => void; onSaved?: (r: Resident) => void }

export function CadastrarMorador({ onClose, onSaved }: Props) {
  const color = SECTOR_COLORS.moradores

  const [tipo, setTipo] = useState<'member' | 'guest'>('member')
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [cpf, setCpf] = useState('')
  const [cep, setCep] = useState('')
  const [numero, setNumero] = useState('')
  const [bloco, setBloco] = useState('')
  const [cepInfo, setCepInfo] = useState<{ street: string; district: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) { setCepInfo(null); return }
    packageService.lookupCep(digits)
      .then(r => setCepInfo(r.data))
      .catch(() => setCepInfo(null))
  }, [cep])

  const canSave = nome.trim() && telefone.trim() && cep.replace(/\D/g, '').length === 8 && numero.trim()

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const r = await api.post<Resident>('/residents', {
        type: tipo,
        full_name: nome.trim(),
        phone_primary: telefone.trim(),
        cpf: cpf.trim() || undefined,
        address_cep: cep.replace(/\D/g, ''),
        address_street: cepInfo?.street || undefined,
        address_neighborhood: cepInfo?.district || undefined,
        unit: numero.trim(),
        block: bloco.trim() || undefined,
        status: 'active',
        is_member_confirmed: tipo === 'member',
        terms_accepted: false,
        lgpd_accepted: false,
      })
      toast.success('Morador cadastrado!')
      onSaved?.(r.data)
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao cadastrar.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-blue-500 bg-white'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-semibold text-gray-900 flex-1">Novo Morador</span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            {(['member', 'guest'] as const).map(t => (
              <button key={t} type="button" onClick={() => setTipo(t)}
                className={`py-3 rounded-xl text-sm font-semibold border-2 transition ${
                  tipo === t ? 'text-white border-transparent' : 'bg-white border-gray-200 text-gray-600'
                }`}
                style={tipo === t ? { backgroundColor: color, borderColor: color } : undefined}>
                {t === 'member' ? 'Associado' : 'Visitante'}
              </button>
            ))}
          </div>

          {/* Nome */}
          <input value={nome} onChange={e => setNome(e.target.value)}
            placeholder="Nome completo *"
            className={inputCls} autoFocus />

          {/* Telefone + CPF */}
          <div className="grid grid-cols-2 gap-3">
            <input value={telefone} onChange={e => setTelefone(e.target.value)}
              placeholder="Telefone *" type="tel" inputMode="tel"
              className={inputCls} />
            <input value={cpf} onChange={e => setCpf(e.target.value)}
              placeholder="CPF" inputMode="numeric"
              className={inputCls} />
          </div>

          {/* CEP */}
          <div>
            <input value={cep} onChange={e => setCep(e.target.value)}
              placeholder="CEP *" inputMode="numeric"
              className={inputCls} />
            {cepInfo && (
              <p className="text-[11px] text-emerald-700 mt-1.5 ml-1">
                ✓ {cepInfo.street}{cepInfo.district ? `, ${cepInfo.district}` : ''}
              </p>
            )}
          </div>

          {/* Número + Bloco */}
          <div className="grid grid-cols-2 gap-3">
            <input value={numero} onChange={e => setNumero(e.target.value)}
              placeholder="Casa/Apto *"
              className={inputCls} />
            <input value={bloco} onChange={e => setBloco(e.target.value)}
              placeholder="Bloco (opcional)"
              className={inputCls} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0"
          style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          <button onClick={handleSave} disabled={saving || !canSave}
            className="w-full py-4 rounded-xl text-base font-bold text-white disabled:opacity-40 transition"
            style={{ backgroundColor: color }}>
            {saving ? 'Cadastrando…' : 'Cadastrar Morador'}
          </button>
        </div>
      </div>
    </div>
  )
}
