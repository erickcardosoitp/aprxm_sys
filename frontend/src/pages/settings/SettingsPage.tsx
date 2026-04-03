import { useEffect, useState } from 'react'
import { Save, Settings } from 'lucide-react'
import toast from 'react-hot-toast'
import { settingsService } from '../../services/settings'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import type { AssociationSettings } from '../../types'

interface AssociationData {
  name?: string
  phone?: string
  email?: string
  address?: string
  cep?: string
  president_user_id?: string
}

export default function SettingsPage() {
  const role = useAuthStore((s) => s.role)
  const canSeeAssociation =
    role === 'conferente' || role === 'admin' || role === 'superadmin'

  // ── Caixa state ──
  const [settings, setSettings] = useState<AssociationSettings | null>(null)
  const [defaultCash, setDefaultCash] = useState('')
  const [maxCash, setMaxCash] = useState('')
  const [loading, setLoading] = useState(false)

  // ── Association state ──
  const [assoc, setAssoc] = useState<AssociationData>({})
  const [assocForm, setAssocForm] = useState<AssociationData>({})
  const [loadingAssoc, setLoadingAssoc] = useState(false)
  const [savingAssoc, setSavingAssoc] = useState(false)

  // ── Load Caixa settings ──
  const load = async () => {
    try {
      const res = await settingsService.get()
      setSettings(res.data)
      setDefaultCash(res.data.default_cash_balance)
      setMaxCash(res.data.max_cash_before_sangria)
    } catch {
      toast.error('Erro ao carregar configurações.')
    }
  }

  useEffect(() => { load() }, [])

  // ── Load Association data ──
  useEffect(() => {
    if (!canSeeAssociation) return
    const loadAssoc = async () => {
      setLoadingAssoc(true)
      try {
        const res = await api.get<AssociationData>('/settings/association')
        setAssoc(res.data)
        setAssocForm(res.data)
      } catch {
        // Association settings may not exist yet; ignore silently
      } finally {
        setLoadingAssoc(false)
      }
    }
    loadAssoc()
  }, [canSeeAssociation])

  // ── Save Caixa settings ──
  const handleSave = async () => {
    const dc = parseFloat(defaultCash)
    const mc = parseFloat(maxCash)
    if (isNaN(dc) || isNaN(mc) || dc < 0 || mc < 0) {
      toast.error('Valores inválidos.')
      return
    }
    if (mc < dc) {
      toast.error('O limite máximo deve ser maior ou igual ao fundo de caixa.')
      return
    }
    setLoading(true)
    try {
      const res = await settingsService.update({ default_cash_balance: dc, max_cash_before_sangria: mc })
      setSettings(res.data)
      toast.success('Configurações salvas!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setLoading(false)
    }
  }

  // ── Save Association settings ──
  const handleSaveAssoc = async () => {
    setSavingAssoc(true)
    try {
      const res = await api.put<AssociationData>('/settings/association', assocForm)
      setAssoc(res.data)
      setAssocForm(res.data)
      toast.success('Dados da associação salvos!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar dados da associação.')
    } finally {
      setSavingAssoc(false)
    }
  }

  const setAssocField = (field: keyof AssociationData, value: string) =>
    setAssocForm((f) => ({ ...f, [field]: value }))

  const inputCls =
    'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

  return (
    <div className="flex flex-col gap-6 p-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Settings className="w-6 h-6 text-[#26619c]" />
        Configurações
      </h1>

      {/* ── Caixa section ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-5">
        <div>
          <h2 className="font-semibold text-gray-800 mb-1">Caixa</h2>
          <p className="text-xs text-gray-400 mb-4">Configurações por associação. Cada associação tem seus próprios valores.</p>

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fundo de caixa (valor padrão ao final do dia)
              </label>
              <p className="text-xs text-gray-400 mb-2">
                O saldo que deve permanecer no caixa ao fim do dia. O excedente deve ser retirado via sangria.
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
                <input
                  type="number" min="0" step="0.01" value={defaultCash}
                  onChange={e => setDefaultCash(e.target.value)}
                  className={`${inputCls} pl-9`} placeholder="200.00"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Limite máximo no caixa antes de sangria obrigatória
              </label>
              <p className="text-xs text-gray-400 mb-2">
                Quando o saldo do caixa atingir este valor, uma sangria deve ser realizada.
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
                <input
                  type="number" min="0" step="0.01" value={maxCash}
                  onChange={e => setMaxCash(e.target.value)}
                  className={`${inputCls} pl-9`} placeholder="500.00"
                />
              </div>
            </div>
          </div>
        </div>

        {settings && (
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 border border-gray-100">
            <p>Configuração atual:</p>
            <p>Fundo de caixa: <strong>R$ {parseFloat(settings.default_cash_balance).toFixed(2)}</strong></p>
            <p>Limite máximo: <strong>R$ {parseFloat(settings.max_cash_before_sangria).toFixed(2)}</strong></p>
          </div>
        )}

        <button onClick={handleSave} disabled={loading}
          className="flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-50">
          <Save className="w-4 h-4" />
          {loading ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </div>

      {/* ── Dados da Associação section (conferente+) ── */}
      {canSeeAssociation && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-5">
          <div>
            <h2 className="font-semibold text-gray-800 mb-1">Dados da Associação</h2>
            <p className="text-xs text-gray-400 mb-4">Informações institucionais da associação exibidas nos documentos e relatórios.</p>

            {loadingAssoc ? (
              <div className="py-6 text-center text-gray-400 text-sm">Carregando…</div>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome da associação</label>
                  <input
                    type="text"
                    value={assocForm.name ?? ''}
                    onChange={e => setAssocField('name', e.target.value)}
                    className={inputCls}
                    placeholder="Ex: Instituto Tia Pretinha"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                    <input
                      type="text"
                      value={assocForm.phone ?? ''}
                      onChange={e => setAssocField('phone', e.target.value)}
                      className={inputCls}
                      placeholder="(21) 99999-9999"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
                    <input
                      type="text"
                      value={assocForm.cep ?? ''}
                      onChange={e => setAssocField('cep', e.target.value)}
                      className={inputCls}
                      placeholder="00000-000"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                  <input
                    type="email"
                    value={assocForm.email ?? ''}
                    onChange={e => setAssocField('email', e.target.value)}
                    className={inputCls}
                    placeholder="contato@associacao.org.br"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Endereço</label>
                  <input
                    type="text"
                    value={assocForm.address ?? ''}
                    onChange={e => setAssocField('address', e.target.value)}
                    className={inputCls}
                    placeholder="Rua, número, bairro, cidade"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ID do Presidente (UUID)</label>
                  <p className="text-xs text-gray-400 mb-2">Usuário responsável pela presidência da associação.</p>
                  <input
                    type="text"
                    value={assocForm.president_user_id ?? ''}
                    onChange={e => setAssocField('president_user_id', e.target.value)}
                    className={inputCls}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>
              </div>
            )}
          </div>

          {!loadingAssoc && (
            <button onClick={handleSaveAssoc} disabled={savingAssoc}
              className="flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-50">
              <Save className="w-4 h-4" />
              {savingAssoc ? 'Salvando…' : 'Salvar dados da associação'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
