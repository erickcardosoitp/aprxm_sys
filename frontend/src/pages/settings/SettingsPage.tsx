import { useEffect, useState } from 'react'
import { Save, Settings, Shield, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { settingsService } from '../../services/settings'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import type { AssociationSettings } from '../../types'

// ─── Access Groups types ───────────────────────────────────────────────────────

type PermKey = 'view' | 'create' | 'edit' | 'delete'
type ModuleKey = 'residents' | 'packages' | 'service_orders' | 'finance' | 'admin' | 'settings'
type AccessGroups = Record<string, Record<ModuleKey, PermKey[]>>

const ROLE_LABELS: Record<string, string> = {
  viewer: 'Visualizador',
  operator: 'Operador',
  conferente: 'Conferente',
  diretoria_adjunta: 'Diretoria Adjunta',
  admin: 'Administrador',
}

const MODULE_LABELS: Record<ModuleKey, string> = {
  residents: 'Moradores',
  packages: 'Encomendas',
  service_orders: 'Ordens de Serviço',
  finance: 'Operação de Caixa',
  admin: 'Admin',
  settings: 'Config',
}

const PERM_LABELS: Record<PermKey, string> = {
  view: 'Visualizar',
  create: 'Incluir',
  edit: 'Editar',
  delete: 'Excluir',
}

const ALL_ROLES = ['viewer', 'operator', 'conferente', 'diretoria_adjunta', 'admin']
const ALL_MODULES: ModuleKey[] = ['residents', 'packages', 'service_orders', 'finance', 'admin', 'settings']
const ALL_PERMS: PermKey[] = ['view', 'create', 'edit', 'delete']

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
}

export default function SettingsPage() {
  const role = useAuthStore((s) => s.role)
  const canSeeAssociation =
    role === 'conferente' || role === 'admin' || role === 'superadmin'
  const isSuperadmin = role === 'superadmin' || role === 'admin'

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

  // ── Cadastros Básicos state ──
  const [categorias, setCategorias] = useState<string[]>([])
  const [servicosImpactados, setServicosImpactados] = useState<string[]>([])
  const [orgaos, setOrgaos] = useState<string[]>([])
  const [savingCadastros, setSavingCadastros] = useState(false)

  // ── Access Groups state ──
  const [accessGroups, setAccessGroups] = useState<AccessGroups>({})
  const [loadingAccessGroups, setLoadingAccessGroups] = useState(false)
  const [savingAccessGroups, setSavingAccessGroups] = useState(false)

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

  // ── Load Access Groups ──
  useEffect(() => {
    if (!isSuperadmin) return
    const loadAccessGroups = async () => {
      setLoadingAccessGroups(true)
      try {
        const res = await api.get<AccessGroups>('/settings/access-groups')
        setAccessGroups(res.data)
      } catch {
        // May not exist yet; ignore silently
      } finally {
        setLoadingAccessGroups(false)
      }
    }
    loadAccessGroups()
  }, [isSuperadmin])

  const handleSaveAccessGroups = async () => {
    setSavingAccessGroups(true)
    try {
      await api.put('/settings/access-groups', accessGroups)
      toast.success('Permissões salvas!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar permissões.')
    } finally {
      setSavingAccessGroups(false)
    }
  }

  const togglePerm = (role: string, module: ModuleKey, perm: PermKey) => {
    setAccessGroups(prev => {
      const rolePerms = prev[role] ?? {}
      const modPerms = rolePerms[module] ?? []
      const has = modPerms.includes(perm)
      return {
        ...prev,
        [role]: {
          ...rolePerms,
          [module]: has ? modPerms.filter(p => p !== perm) : [...modPerms, perm],
        },
      }
    })
  }

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

      {/* ── Gestão de Acesso por Grupo (superadmin only) ── */}
      {isSuperadmin && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-5">
          <div>
            <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#26619c]" />
              Gestão de Acesso por Grupo
              <span className="text-xs font-normal text-gray-400 ml-1">Admin+</span>
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Define quais permissões cada grupo de usuários tem por módulo.
            </p>

            {loadingAccessGroups ? (
              <div className="py-6 text-center text-gray-400 text-sm">Carregando…</div>
            ) : (
              <div className="flex flex-col gap-6">
                {ALL_MODULES.map(mod => (
                  <div key={mod}>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2 border-b border-gray-100 pb-1">
                      {MODULE_LABELS[mod]}
                    </h3>
                    <div className="-mx-1 overflow-x-auto">
                      <table className="w-full text-xs min-w-[320px]">
                        <thead>
                          <tr>
                            <th className="text-left py-1 pr-2 text-gray-500 font-medium w-28 text-[10px]">Grupo</th>
                            {ALL_PERMS.map(perm => (
                              <th key={perm} className="text-center py-1 px-1 text-gray-500 font-medium text-[10px]">
                                {perm === 'view' ? 'Ver' : perm === 'create' ? 'Criar' : perm === 'edit' ? 'Edit' : 'Del'}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ALL_ROLES.map(r => {
                            const modPerms = accessGroups[r]?.[mod] ?? []
                            return (
                              <tr key={r} className="border-t border-gray-50">
                                <td className="py-1.5 pr-2 text-gray-700 text-[10px] leading-tight">{ROLE_LABELS[r] ?? r}</td>
                                {ALL_PERMS.map(perm => (
                                  <td key={perm} className="text-center py-1.5 px-1">
                                    <input
                                      type="checkbox"
                                      checked={modPerms.includes(perm)}
                                      onChange={() => togglePerm(r, mod, perm)}
                                      className="w-4 h-4 rounded border-gray-300 text-[#26619c] focus:ring-[#26619c]/40"
                                    />
                                  </td>
                                ))}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400 italic">
            SuperAdmin sempre tem acesso total a todos os módulos e não pode ser restringido.
          </p>

          {!loadingAccessGroups && (
            <button onClick={handleSaveAccessGroups} disabled={savingAccessGroups}
              className="flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-50">
              <Save className="w-4 h-4" />
              {savingAccessGroups ? 'Salvando…' : 'Salvar Permissões'}
            </button>
          )}
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
