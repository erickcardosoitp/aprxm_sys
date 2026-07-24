import { useEffect, useState } from 'react'
import { AlertTriangle, KeyRound, Loader2, Save, Settings, Plus, Trash2 } from 'lucide-react'
import { SignaturePad } from '../../components/packages/SignaturePad'
import { uploadService } from '../../services/upload'
import toast from 'react-hot-toast'
import { settingsService } from '../../services/settings'
import api from '../../services/api'
import { useQueryClient } from '@tanstack/react-query'
import { useAssociationSettings, useFinanceCategories, usePaymentMethods } from '../../hooks/useSharedData'
import { useAuthStore } from '../../store/authStore'
import type { AssociationSettings } from '../../types'
import DeviceCredentials from '../../components/profile/DeviceCredentials'

// ─── SimpleListEditor ─────────────────────────────────────────────────────────

function SimpleListEditor({ title, items, onAdd, onRemove }: {
  title: string
  items: string[]
  onAdd: (item: string) => void
  onRemove: (idx: number) => void
}) {
  const [input, setInput] = useState('')
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-2">{title}</p>
      <div className="flex gap-2 mb-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && input.trim()) { onAdd(input.trim()); setInput('') } }}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
          placeholder="Adicionar…"
        />
        <button
          onClick={() => { if (input.trim()) { onAdd(input.trim()); setInput('') } }}
          className="px-3 py-2 bg-[#26619c] text-white rounded-lg text-sm font-medium"
        >+</button>
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between bg-gray-50 px-3 py-1.5 rounded-lg text-sm">
              <span>{item}</span>
              <button onClick={() => onRemove(i)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Tipos de Serviço (fixed) ─────────────────────────────────────────────────

const TIPOS_DE_SERVICO = [
  { nome: 'Comprovante de Residência', valor: 'R$ 10,00' },
  { nome: 'Taxa de Entrega', valor: 'R$ 2,50' },
  { nome: 'Mensalidade', valor: 'R$ 20,00' },
]

interface AssociationData {
  name?: string
  phone?: string
  email?: string
  address?: string
  cep?: string
  president_user_id?: string
  slug?: string
}

export default function SettingsPage() {
  const role = useAuthStore((s) => s.role)
  const canSeeAssociation =
    role === 'conferente' || role === 'admin' || role === 'superadmin'
  const isAdmin = role === 'admin' || role === 'superadmin'
  const canChangePassword = !isAdmin

  // ── Change Password state ──
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)

  // ── Reset DB state ──
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetBalance, setResetBalance] = useState('0')
  const [resetting, setResetting] = useState(false)

  // ── Clear Data state ──
  const [clearConfirm, setClearConfirm] = useState('')
  const [clearTx, setClearTx] = useState(true)
  const [clearPkg, setClearPkg] = useState(false)
  const [clearSO, setClearSO] = useState(false)
  const [clearMens, setClearMens] = useState(false)
  const [clearing, setClearing] = useState(false)

  // ── Caixa state ──
  const [settings, setSettings] = useState<AssociationSettings | null>(null)
  const [defaultCash, setDefaultCash] = useState('')
  const [maxCash, setMaxCash] = useState('')
  const [defaultMensalidade, setDefaultMensalidade] = useState('')
  const [graceDays, setGraceDays] = useState('2')
  const [loading, setLoading] = useState(false)

  // ── Association state ──
  const [assoc, setAssoc] = useState<AssociationData>({})
  const [assocForm, setAssocForm] = useState<AssociationData>({})
  const { data: assocData, isLoading: loadingAssoc } = useAssociationSettings<AssociationData>({ enabled: canSeeAssociation })
  useEffect(() => {
    if (assocData) { setAssoc(assocData); setAssocForm(assocData) }
  }, [assocData])
  const [savingAssoc, setSavingAssoc] = useState(false)
  const [users, setUsers] = useState<{ id: string; full_name: string; role: string }[]>([])

  // ── Cadastros Básicos state ──
  const [categorias, setCategorias] = useState<string[]>([])
  const [servicosImpactados, setServicosImpactados] = useState<string[]>([])
  const [orgaos, setOrgaos] = useState<string[]>([])
  const [savingCadastros, setSavingCadastros] = useState(false)

  // ── OS Phases state ──
  type OSPhase = { id: string; name: string; color: string; active: boolean }
  const [osPhases, setOsPhases] = useState<OSPhase[]>([])
  const [newPhaseName, setNewPhaseName] = useState('')
  const [newPhaseColor, setNewPhaseColor] = useState('#9333ea')
  const [savingPhase, setSavingPhase] = useState(false)

  // ── Finance categories & payment methods ──
  type FinCat = { id: string; name: string; type: string; color?: string }
  type FinPM = { id: string; name: string }
  type SangriaDest = { id: string; name: string }
  const queryClient = useQueryClient()
  const { data: finCats = [] } = useFinanceCategories<FinCat[]>()
  const { data: finPMs = [] } = usePaymentMethods<FinPM[]>()
  const [sangriaDests, setSangriaDests] = useState<SangriaDest[]>([])
  const [newCatName, setNewCatName] = useState('')
  const [newCatType, setNewCatType] = useState<'income' | 'expense'>('expense')
  const [newPMName, setNewPMName] = useState('')
  const [newDestName, setNewDestName] = useState('')

  // ── Carriers & Deliverers state ──
  type Carrier = { id: string; name: string }
  type Deliverer = { id: string; name: string; carrier_id: string | null; carrier_name: string | null; signature_url: string | null }
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [deliverers, setDeliverers] = useState<Deliverer[]>([])
  const [newCarrierName, setNewCarrierName] = useState('')
  const [newDelivererName, setNewDelivererName] = useState('')
  const [newDelivererCarrierId, setNewDelivererCarrierId] = useState('')
  const [newDelivererSig, setNewDelivererSig] = useState('')
  const [showDelivererForm, setShowDelivererForm] = useState(false)

  // ── Load Cadastros Básicos ──
  useEffect(() => {
    if (!canSeeAssociation) return
    const loadCadastros = async () => {
      try {
        const res = await api.get<{ categorias: string[]; servicos_impactados: string[]; orgaos_responsaveis: string[] }>('/settings/cadastros')
        setCategorias(res.data.categorias ?? [])
        setServicosImpactados(res.data.servicos_impactados ?? [])
        setOrgaos(res.data.orgaos_responsaveis ?? [])
      } catch {
        // Endpoint may not exist yet; ignore silently
      }
    }
    loadCadastros()
    api.get<SangriaDest[]>('/finance/sangria-destinations').then(r => setSangriaDests(r.data)).catch(() => {})
    api.get('/carriers').then(r => setCarriers(r.data)).catch(() => {})
    api.get('/carriers/deliverers').then(r => setDeliverers(r.data)).catch(() => {})
    api.get<OSPhase[]>('/service-order-phases/all').then(r => setOsPhases(r.data)).catch(() => {})
  }, [canSeeAssociation])

  const handleSaveCadastros = async () => {
    setSavingCadastros(true)
    try {
      await api.put('/settings/cadastros', {
        categorias,
        servicos_impactados: servicosImpactados,
        orgaos_responsaveis: orgaos,
      })
      toast.success('Cadastros básicos salvos!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar cadastros.')
    } finally {
      setSavingCadastros(false)
    }
  }

  const handleAddOsPhase = async () => {
    if (!newPhaseName.trim()) return
    setSavingPhase(true)
    try {
      const r = await api.post<OSPhase>('/service-order-phases', { name: newPhaseName.trim(), color: newPhaseColor })
      setOsPhases(p => [...p, r.data])
      setNewPhaseName('')
      setNewPhaseColor('#9333ea')
      toast.success('Fase criada.')
    } catch { toast.error('Erro ao criar fase.') } finally { setSavingPhase(false) }
  }

  const handleToggleOsPhase = async (id: string, active: boolean) => {
    try {
      await api.patch(`/service-order-phases/${id}`, { active: !active })
      setOsPhases(p => p.map(x => x.id === id ? { ...x, active: !active } : x))
    } catch { toast.error('Erro.') }
  }

  const handleDeleteOsPhase = async (id: string) => {
    if (!confirm('Remover esta fase?')) return
    try {
      await api.delete(`/service-order-phases/${id}`)
      setOsPhases(p => p.filter(x => x.id !== id))
      toast.success('Fase removida.')
    } catch { toast.error('Erro ao remover fase.') }
  }

  const handleAddFinCat = async () => {
    if (!newCatName.trim()) return
    try {
      const r = await api.post<FinCat>('/finance/categories', { name: newCatName.trim(), type: newCatType })
      queryClient.setQueryData<FinCat[]>(['finance', 'categories', 'all'], p => [...(p ?? []), r.data])
      queryClient.invalidateQueries({ queryKey: ['finance', 'categories'] })
      setNewCatName('')
      toast.success('Categoria criada.')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handleDeleteFinCat = async (id: string) => {
    try {
      await api.delete(`/finance/categories/${id}`)
      queryClient.setQueryData<FinCat[]>(['finance', 'categories', 'all'], p => (p ?? []).filter(c => c.id !== id))
      queryClient.invalidateQueries({ queryKey: ['finance', 'categories'] })
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handleAddPM = async () => {
    if (!newPMName.trim()) return
    try {
      const r = await api.post<FinPM>('/finance/payment-methods', { name: newPMName.trim() })
      queryClient.setQueryData<FinPM[]>(['finance', 'payment-methods'], p => [...(p ?? []), r.data])
      setNewPMName('')
      toast.success('Método criado.')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handleDeletePM = async (id: string) => {
    try {
      await api.delete(`/finance/payment-methods/${id}`)
      queryClient.setQueryData<FinPM[]>(['finance', 'payment-methods'], p => (p ?? []).filter(m => m.id !== id))
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handleAddDest = async () => {
    if (!newDestName.trim()) return
    try {
      const r = await api.post<SangriaDest>('/finance/sangria-destinations', { name: newDestName.trim() })
      setSangriaDests(p => [...p, r.data])
      setNewDestName('')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handleDeleteDest = async (id: string) => {
    try {
      await api.delete(`/finance/sangria-destinations/${id}`)
      setSangriaDests(p => p.filter(d => d.id !== id))
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handleAddCarrier = async () => {
    if (!newCarrierName.trim()) return
    try {
      const r = await api.post('/carriers', { name: newCarrierName.trim() })
      setCarriers(p => [...p, r.data])
      setNewCarrierName('')
      toast.success('Transportadora criada.')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handleDeleteCarrier = async (id: string) => {
    try {
      await api.delete(`/carriers/${id}`)
      setCarriers(p => p.filter(c => c.id !== id))
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handleAddDeliverer = async () => {
    if (!newDelivererName.trim()) return
    try {
      const r = await api.post('/carriers/deliverers', {
        name: newDelivererName.trim(),
        carrier_id: newDelivererCarrierId || null,
        signature_url: newDelivererSig || null,
      })
      setDeliverers(p => [...p, r.data])
      setNewDelivererName('')
      setNewDelivererCarrierId('')
      setNewDelivererSig('')
      setShowDelivererForm(false)
      toast.success('Entregador cadastrado.')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handleDeleteDeliverer = async (id: string) => {
    try {
      await api.delete(`/carriers/deliverers/${id}`)
      setDeliverers(p => p.filter(d => d.id !== id))
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  // ── Load Caixa settings ──
  const load = async () => {
    try {
      const res = await settingsService.get()
      setSettings(res.data)
      setDefaultCash(res.data.default_cash_balance)
      setMaxCash(res.data.max_cash_before_sangria)
      setDefaultMensalidade(res.data.default_mensalidade_amount ?? '0')
      setGraceDays(String(res.data.delinquency_grace_days ?? 2))
    } catch {
      toast.error('Erro ao carregar configurações.')
    }
  }

  useEffect(() => { load() }, [])

  // ── Load users ──
  useEffect(() => {
    if (!canSeeAssociation) return
    api.get<{ id: string; full_name: string; role: string }[]>('/admin/users')
      .then(r => setUsers(r.data)).catch(() => {})
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
      const dm = parseFloat(defaultMensalidade)
      const gd = parseInt(graceDays) || 2
      const res = await settingsService.update({ default_cash_balance: dc, max_cash_before_sangria: mc, default_mensalidade_amount: isNaN(dm) ? 0 : dm, delinquency_grace_days: gd })
      setSettings(res.data)
      toast.success('Configurações salvas!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setLoading(false)
    }
  }

  // ── CEP auto-fill ──
  const handleCepBlur = async (cep: string) => {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) return
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await res.json()
      if (data.erro) return
      const addr = [data.logradouro, data.bairro, data.localidade, data.uf].filter(Boolean).join(', ')
      setAssocForm(f => ({ ...f, address: addr || f.address }))
    } catch { /* ignore */ }
  }

  // ── Save Association settings ──
  const handleSaveAssoc = async () => {
    setSavingAssoc(true)
    try {
      await api.put('/settings/association', {
        assoc_name: assocForm.name,
        assoc_phone: assocForm.phone,
        assoc_email: assocForm.email,
        assoc_address: assocForm.address,
        assoc_cep: assocForm.cep,
        president_user_id: assocForm.president_user_id || null,
        slug: assocForm.slug,
      })
      const fresh = await api.get<AssociationData>('/settings/association')
      queryClient.setQueryData(['settings', 'association'], fresh.data)
      setAssoc(fresh.data)
      setAssocForm(fresh.data)
      toast.success('Dados da associação salvos!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar dados da associação.')
    } finally {
      setSavingAssoc(false)
    }
  }

  const setAssocField = (field: keyof AssociationData, value: string) =>
    setAssocForm((f) => ({ ...f, [field]: value }))

  const handleChangePassword = async () => {
    if (newPwd !== confirmPwd) { toast.error('As senhas não coincidem.'); return }
    if (newPwd.length < 6) { toast.error('A nova senha deve ter pelo menos 6 caracteres.'); return }
    setSavingPwd(true)
    try {
      await api.post('/auth/change-password', { current_password: currentPwd, new_password: newPwd })
      toast.success('Senha alterada com sucesso!')
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao alterar senha.')
    } finally {
      setSavingPwd(false)
    }
  }

  const handleClearData = async () => {
    if (clearConfirm !== 'CONFIRMAR') { toast.error('Digite CONFIRMAR para prosseguir.'); return }
    setClearing(true)
    try {
      const res = await api.post('/admin/clear-data', {
        confirm: 'CONFIRMAR',
        clear_transactions: clearTx,
        clear_packages: clearPkg,
        clear_service_orders: clearSO,
        clear_mensalidades: clearMens,
      })
      const deleted = res.data.deleted as Record<string, number>
      const summary = Object.entries(deleted).map(([k, v]) => `${k}: ${v}`).join(', ')
      toast.success(`Dados removidos — ${summary}`)
      setClearConfirm('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao limpar dados.')
    } finally {
      setClearing(false)
    }
  }

  const handleReset = async () => {
    if (resetConfirm !== 'RESETAR') { toast.error('Digite RESETAR para confirmar.'); return }
    setResetting(true)
    try {
      await api.post('/admin/reset-database', { confirm: 'RESETAR', initial_balance: parseFloat(resetBalance) || 0 })
      toast.success('Base resetada com sucesso! Usuários mantidos.')
      setResetConfirm('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao resetar.')
    } finally {
      setResetting(false)
    }
  }

  const inputCls =
    'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

  return (
    <div className="flex flex-col gap-6 p-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Settings className="w-6 h-6 text-[#26619c]" />
        Configurações
      </h1>

      {/* ── Alterar Senha (não-admin) ── */}
      {canChangePassword && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#26619c]" />
            Alterar Senha
          </h2>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Senha atual</label>
              <input type="password" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)}
                className={inputCls} placeholder="••••••••" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
              <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)}
                className={inputCls} placeholder="Mínimo 6 caracteres" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar nova senha</label>
              <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                className={inputCls} placeholder="••••••••" />
            </div>
          </div>
          <button onClick={handleChangePassword} disabled={savingPwd || !currentPwd || !newPwd || !confirmPwd}
            className="flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-50">
            {savingPwd ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {savingPwd ? 'Salvando…' : 'Alterar senha'}
          </button>
        </div>
      )}

      {/* ── Dispositivos (WebAuthn) ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <DeviceCredentials />
      </div>

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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Valor padrão da mensalidade
              </label>
              <p className="text-xs text-gray-400 mb-2">
                Valor sugerido ao criar uma nova mensalidade para um morador.
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
                <input
                  type="number" min="0" step="0.01" value={defaultMensalidade}
                  onChange={e => setDefaultMensalidade(e.target.value)}
                  className={`${inputCls} pl-9`} placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Carência para inadimplência (dias)
              </label>
              <p className="text-xs text-gray-400 mb-2">
                Dias após o vencimento até o morador ser considerado inadimplente e pagar taxa de entrega.
              </p>
              <input
                type="number" min="0" max="60" value={graceDays}
                onChange={e => setGraceDays(e.target.value)}
                className={inputCls} placeholder="2"
              />
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

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-blue-800 mb-1">Link público de cadastro</p>
                {assoc.slug
                  ? <p className="text-xs text-blue-600 truncate">{window.location.origin}/cadastro/{assoc.slug}</p>
                  : <p className="text-xs text-gray-400">Defina o slug abaixo para ativar o link.</p>
                }
              </div>
              {assoc.slug && (
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/cadastro/${assoc.slug}`); toast.success('Link copiado!') }}
                  className="shrink-0 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 transition"
                >
                  Copiar
                </button>
              )}
            </div>

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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Slug (link público)</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 shrink-0">/cadastro/</span>
                    <input
                      type="text"
                      value={assocForm.slug ?? ''}
                      onChange={e => setAssocField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                      className={inputCls}
                      placeholder="vaz-lobo"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Apenas letras minúsculas, números e hífens.</p>
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
                      onBlur={e => handleCepBlur(e.target.value)}
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Presidente</label>
                  <p className="text-xs text-gray-400 mb-2">Usuário responsável pela presidência da associação.</p>
                  <select
                    value={assocForm.president_user_id ?? ''}
                    onChange={e => setAssocField('president_user_id', e.target.value)}
                    className={`${inputCls} bg-white`}
                  >
                    <option value="">— Nenhum —</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                    ))}
                  </select>
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

      {/* Gestão de Acesso por Grupo (association_settings.access_groups) removida — dataset morto,
          nenhuma rota de nivel-associacao consultava esse JSON pra decidir permissao nenhuma.
          Controle de acesso real agora fica em Cadastros > Grupos de Usuarios (empresas.access_groups). */}

      {/* ── Resetar Base de Dados (admin only) ── */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-red-200 shadow-sm p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-800">Resetar Base de Dados</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Apaga todos os dados operacionais (transações, encomendas, ordens) mantendo os usuários e moradores.
                Use para reiniciar o ambiente de testes com saldo inicial limpo.
              </p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800"><strong>Atenção:</strong> Esta operação é irreversível. Todos os dados serão permanentemente apagados.</p>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Saldo inicial da organização (R$)</label>
              <p className="text-xs text-gray-400 mb-2">Valor de troco disponível ao abrir o primeiro caixa.</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
                <input
                  type="number" min="0" step="0.01" value={resetBalance}
                  onChange={e => setResetBalance(e.target.value)}
                  className={`${inputCls} pl-9`} placeholder="100.00"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Digite <span className="font-mono font-bold text-red-600">RESETAR</span> para confirmar
              </label>
              <input
                type="text"
                value={resetConfirm}
                onChange={e => setResetConfirm(e.target.value)}
                className={`${inputCls} border-red-200 focus:ring-red-300 focus:border-red-400`}
                placeholder="RESETAR"
              />
            </div>
          </div>

          <button
            onClick={handleReset}
            disabled={resetting || resetConfirm !== 'RESETAR'}
            className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-40"
          >
            {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {resetting ? 'Resetando…' : 'Resetar Base de Dados'}
          </button>
        </div>
      )}

      {/* ── Limpar Dados por tipo (admin only) ── */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-orange-200 shadow-sm p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-800">Limpar Dados por Tipo</h2>
              <p className="text-xs text-gray-500 mt-0.5">Remove dados selecionados mantendo moradores e usuários.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {[
              { label: 'Transações e caixas', val: clearTx, set: setClearTx },
              { label: 'Encomendas', val: clearPkg, set: setClearPkg },
              { label: 'Ordens de serviço', val: clearSO, set: setClearSO },
              { label: 'Mensalidades', val: clearMens, set: setClearMens },
            ].map(({ label, val, set }) => (
              <label key={label} className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} className="w-4 h-4 accent-orange-500" />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Digite <span className="font-mono font-bold text-orange-600">CONFIRMAR</span> para prosseguir
            </label>
            <input
              type="text"
              value={clearConfirm}
              onChange={e => setClearConfirm(e.target.value)}
              className={`${inputCls} border-orange-200 focus:ring-orange-300 focus:border-orange-400`}
              placeholder="CONFIRMAR"
            />
          </div>
          <button
            onClick={handleClearData}
            disabled={clearing || clearConfirm !== 'CONFIRMAR'}
            className="flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-40"
          >
            {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {clearing ? 'Removendo…' : 'Limpar Dados Selecionados'}
          </button>
        </div>
      )}

      {/* ── Cadastros Básicos section (conferente+) ── */}
      {canSeeAssociation && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-5">
          <div>
            <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#26619c]" />
              Cadastros Básicos
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Configurações de listas utilizadas nas ordens de serviço e operações.
            </p>

            <div className="flex flex-col gap-6">
              {/* 5a. Tipos de Serviço (read-only fixed values) */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Tipos de Serviço</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-200">Nome</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-200">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TIPOS_DE_SERVICO.map((t, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-3 py-2 text-gray-700">{t.nome}</td>
                          <td className="px-3 py-2 text-right text-gray-700 font-medium">{t.valor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 5b. Categorias */}
              <SimpleListEditor
                title="Categorias"
                items={categorias}
                onAdd={item => setCategorias(prev => [...prev, item])}
                onRemove={idx => setCategorias(prev => prev.filter((_, i) => i !== idx))}
              />

              {/* 5c. Serviços Impactados */}
              <SimpleListEditor
                title="Serviços Impactados"
                items={servicosImpactados}
                onAdd={item => setServicosImpactados(prev => [...prev, item])}
                onRemove={idx => setServicosImpactados(prev => prev.filter((_, i) => i !== idx))}
              />

              {/* 5d. Órgãos Responsáveis */}
              <SimpleListEditor
                title="Órgãos Responsáveis"
                items={orgaos}
                onAdd={item => setOrgaos(prev => [...prev, item])}
                onRemove={idx => setOrgaos(prev => prev.filter((_, i) => i !== idx))}
              />

              {/* 5d2. Fases de OS */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Fases de OS</p>
                <div className="flex gap-2 mb-2">
                  <input value={newPhaseName} onChange={e => setNewPhaseName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddOsPhase() }}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
                    placeholder="Nome da fase…" />
                  <input type="color" value={newPhaseColor} onChange={e => setNewPhaseColor(e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border border-gray-200 shrink-0" />
                  <button onClick={handleAddOsPhase} disabled={!newPhaseName.trim() || savingPhase}
                    className="px-3 py-2 bg-[#26619c] text-white rounded-lg text-sm font-medium disabled:opacity-40">+</button>
                </div>
                {osPhases.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {osPhases.map(p => (
                      <li key={p.id} className={`flex items-center gap-2 justify-between bg-gray-50 px-3 py-1.5 rounded-lg text-sm ${!p.active ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                          <span className={!p.active ? 'line-through text-gray-400' : ''}>{p.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleToggleOsPhase(p.id, p.active)}
                            className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100">
                            {p.active ? 'Desativar' : 'Ativar'}
                          </button>
                          {!p.active && (
                            <button onClick={() => handleDeleteOsPhase(p.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 5e. Categorias de Transação (Financeiro) */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Categorias de Transação (Financeiro)</p>
                <div className="flex gap-2 mb-2">
                  <select value={newCatType} onChange={e => setNewCatType(e.target.value as 'income' | 'expense')}
                    className="border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 bg-white">
                    <option value="expense">Despesa</option>
                    <option value="income">Receita</option>
                  </select>
                  <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddFinCat() }}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
                    placeholder="Nome da categoria…" />
                  <button onClick={handleAddFinCat} className="px-3 py-2 bg-[#26619c] text-white rounded-lg text-sm font-medium">+</button>
                </div>
                {finCats.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {finCats.map(c => (
                      <li key={c.id} className="flex items-center justify-between bg-gray-50 px-3 py-1.5 rounded-lg text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${c.type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                            {c.type === 'income' ? 'Receita' : 'Despesa'}
                          </span>
                          <span>{c.name}</span>
                        </div>
                        <button onClick={() => handleDeleteFinCat(c.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 5f. Métodos de Pagamento */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Métodos de Pagamento</p>
                <div className="flex gap-2 mb-2">
                  <input value={newPMName} onChange={e => setNewPMName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddPM() }}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
                    placeholder="Ex: Cartão débito, Pix…" />
                  <button onClick={handleAddPM} className="px-3 py-2 bg-[#26619c] text-white rounded-lg text-sm font-medium">+</button>
                </div>
                {finPMs.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {finPMs.map(m => (
                      <li key={m.id} className="flex items-center justify-between bg-gray-50 px-3 py-1.5 rounded-lg text-sm">
                        <span>{m.name}</span>
                        <button onClick={() => handleDeletePM(m.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 5g. Destinos de Sangria */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Destinos de Sangria</p>
                <div className="flex gap-2 mb-2">
                  <input value={newDestName} onChange={e => setNewDestName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddDest() }}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
                    placeholder="Ex: Cofre, Banco X…" />
                  <button onClick={handleAddDest} className="px-3 py-2 bg-[#26619c] text-white rounded-lg text-sm font-medium">+</button>
                </div>
                {sangriaDests.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {sangriaDests.map(d => (
                      <li key={d.id} className="flex items-center justify-between bg-gray-50 px-3 py-1.5 rounded-lg text-sm">
                        <span>{d.name}</span>
                        <button onClick={() => handleDeleteDest(d.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 5h. Transportadoras */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Transportadoras</p>
                <div className="flex gap-2 mb-2">
                  <input value={newCarrierName} onChange={e => setNewCarrierName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddCarrier() }}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
                    placeholder="Ex: Correios, Mercado Envios…" />
                  <button onClick={handleAddCarrier} className="px-3 py-2 bg-[#26619c] text-white rounded-lg text-sm font-medium">+</button>
                </div>
                {carriers.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {carriers.map(c => (
                      <li key={c.id} className="flex items-center justify-between bg-gray-50 px-3 py-1.5 rounded-lg text-sm">
                        <span>{c.name}</span>
                        <button onClick={() => handleDeleteCarrier(c.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 5i. Entregadores */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Entregadores</p>
                  <button onClick={() => setShowDelivererForm(v => !v)}
                    className="text-xs px-2 py-1 bg-[#26619c] text-white rounded-lg font-medium">
                    {showDelivererForm ? 'Cancelar' : '+ Novo'}
                  </button>
                </div>

                {showDelivererForm && (
                  <div className="border border-gray-200 rounded-xl p-4 flex flex-col gap-3 mb-3 bg-gray-50">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Nome do entregador <span className="text-red-500">*</span></label>
                      <input value={newDelivererName} onChange={e => setNewDelivererName(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
                        placeholder="Nome completo" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Transportadora</label>
                      <select value={newDelivererCarrierId} onChange={e => setNewDelivererCarrierId(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#26619c]/40">
                        <option value="">— Nenhuma —</option>
                        {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Assinatura</label>
                      <SignaturePad
                        label="Assinatura do entregador"
                        onSave={setNewDelivererSig}
                        onClear={() => setNewDelivererSig('')}
                        onUpload={dataUrl => uploadService.uploadBase64(dataUrl, 'packages/signatures')}
                      />
                    </div>
                    <button onClick={handleAddDeliverer} disabled={!newDelivererName.trim()}
                      className="w-full bg-[#26619c] text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                      Salvar Entregador
                    </button>
                  </div>
                )}

                {deliverers.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {deliverers.map(d => (
                      <li key={d.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          {d.signature_url && (
                            <img src={d.signature_url} alt="sig" className="h-6 w-10 object-contain border border-gray-200 rounded bg-white" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-gray-800 truncate">{d.name}</p>
                            {d.carrier_name && <p className="text-xs text-gray-400 truncate">{d.carrier_name}</p>}
                          </div>
                        </div>
                        <button onClick={() => handleDeleteDeliverer(d.id)} className="text-red-400 hover:text-red-600 text-xs shrink-0 ml-2">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={handleSaveCadastros}
            disabled={savingCadastros}
            className="flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {savingCadastros ? 'Salvando…' : 'Salvar Cadastros'}
          </button>
        </div>
      )}
    </div>
  )
}
