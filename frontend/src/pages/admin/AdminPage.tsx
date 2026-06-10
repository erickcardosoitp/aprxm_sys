import { useEffect, useRef, useState } from 'react'
import { ShieldCheck, Plus, X, Pencil, UserX, UserCheck, Upload, FileText, Package, Eye, EyeOff, Lock, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { uploadService } from '../../services/upload'
import type { User, UserRole } from '../../types'
import { useAuthStore } from '../../store/authStore'

type ExtendedRole = UserRole | 'diretoria_adjunta' | 'diretoria' | 'admin_master' | 'conselho'

const ROLE_LABELS: Record<ExtendedRole, string> = {
  superadmin: 'Superadmin',
  admin_master: 'Admin Master',
  admin: 'Administrador',
  conferente: 'Conferente',
  diretoria: 'Diretoria',
  diretoria_adjunta: 'Diretoria Adjunta',
  conselho: 'Conselho',
  operator: 'Operador',
  viewer: 'Visualizador',
}

const ROLE_COLORS: Record<ExtendedRole, string> = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin_master: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  conferente: 'bg-teal-100 text-teal-700',
  diretoria: 'bg-orange-100 text-orange-700',
  diretoria_adjunta: 'bg-indigo-100 text-indigo-700',
  conselho: 'bg-amber-100 text-amber-700',
  operator: 'bg-green-100 text-green-700',
  viewer: 'bg-gray-100 text-gray-600',
}

const EDITABLE_ROLES: ExtendedRole[] = ['admin', 'conferente', 'diretoria', 'diretoria_adjunta', 'conselho', 'operator', 'viewer']

interface UserFormData {
  full_name: string
  email: string
  password: string
  role: ExtendedRole
  phone: string
}

const EMPTY_FORM: UserFormData = {
  full_name: '',
  email: '',
  password: '',
  role: 'operator',
  phone: '',
}

function UserFormModal({ initial, onSave, onCancel }: {
  initial?: Partial<UserFormData & { id: string }>
  onSave: (data: UserFormData) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<UserFormData>({ ...EMPTY_FORM, ...initial })
  const [saving, setSaving] = useState(false)
  const isEdit = !!initial?.email

  const set = <K extends keyof UserFormData>(k: K, v: UserFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.full_name || !form.email) { toast.error('Nome e e-mail são obrigatórios.'); return }
    if (!isEdit && !form.password) { toast.error('Senha obrigatória para novo usuário.'); return }
    setSaving(true)
    try {
      const payload: any = { full_name: form.full_name, email: form.email, role: form.role, phone: form.phone || undefined }
      if (form.password) payload.password = form.password
      await onSave(payload)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{isEdit ? 'Editar Usuário' : 'Novo Usuário'}</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome completo *</label>
            <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
              placeholder="Nome do usuário" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-mail *</label>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
              disabled={isEdit}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c] disabled:bg-gray-50 disabled:text-gray-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {isEdit ? 'Nova senha (deixe vazio para não alterar)' : 'Senha *'}
            </label>
            <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)}
              placeholder={isEdit ? 'Nova senha (opcional)' : 'Senha'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Telefone</label>
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)}
              placeholder="(21) 99999-9999"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Perfil de acesso</label>
            <div className="grid grid-cols-2 gap-2">
              {EDITABLE_ROLES.map((r) => (
                <button key={r} type="button" onClick={() => set('role', r)}
                  className={`py-2 rounded-lg text-sm font-medium border transition ${
                    form.role === r ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600'
                  }`}>
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              <strong>Administrador:</strong> acesso total ·{' '}
              <strong>Conferente:</strong> operações financeiras ·{' '}
              <strong>Diretoria Adjunta:</strong> ordens de serviço ·{' '}
              <strong>Operador:</strong> operações do dia a dia ·{' '}
              <strong>Visualizador:</strong> somente leitura
            </p>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onCancel} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
            {saving ? 'Salvando…' : isEdit ? 'Atualizar' : 'Criar Usuário'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface AuditEntry {
  id: string; acao: string; entidade: string; entidade_id: string; detalhe: string; data: string; autor: string
}

type AdminTab = 'usuarios' | 'comprovante' | 'tarefas' | 'moradores' | 'isencao' | 'permissoes' | 'caixa'

interface AssocConfig {
  assoc_logo_url?: string
  president_signature_url?: string
  president_name?: string
  community_name?: string
  address?: string
  cep?: string
  proof_stock: number
}

function ComprovanteTab() {
  const [config, setConfig] = useState<AssocConfig>({ proof_stock: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [stockQty, setStockQty] = useState('')
  const [updatingStock, setUpdatingStock] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)
  const sigRef = useRef<HTMLInputElement>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingSig, setUploadingSig] = useState(false)

  const [presidentName, setPresidentName] = useState('')
  const [communityName, setCommunityName] = useState('')

  useEffect(() => {
    api.get<AssocConfig>('/settings/association').then(r => {
      setConfig(r.data)
      setPresidentName(r.data.president_name ?? '')
      setCommunityName(r.data.community_name ?? '')
    }).catch(() => toast.error('Erro ao carregar configurações.')).finally(() => setLoading(false))
  }, [])

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploadingLogo(true)
    try {
      const url = await uploadService.uploadFile(file, 'assoc-logos')
      await api.put('/settings/association', { assoc_logo_url: url })
      setConfig(c => ({ ...c, assoc_logo_url: url }))
      toast.success('Logo salvo!')
    } catch { toast.error('Erro ao enviar logo.') } finally { setUploadingLogo(false) }
  }

  const uploadSignature = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploadingSig(true)
    try {
      const url = await uploadService.uploadFile(file, 'signatures')
      await api.put('/settings/association', { president_signature_url: url })
      setConfig(c => ({ ...c, president_signature_url: url }))
      toast.success('Assinatura salva!')
    } catch { toast.error('Erro ao enviar assinatura.') } finally { setUploadingSig(false) }
  }

  const saveNames = async () => {
    setSaving(true)
    try {
      await api.put('/settings/association', { president_name: presidentName, community_name: communityName })
      setConfig(c => ({ ...c, president_name: presidentName, community_name: communityName }))
      toast.success('Configurações salvas!')
    } catch { toast.error('Erro ao salvar.') } finally { setSaving(false) }
  }

  const updateStock = async () => {
    const qty = parseInt(stockQty)
    if (isNaN(qty) || qty < 0) { toast.error('Quantidade inválida.'); return }
    setUpdatingStock(true)
    try {
      await api.put('/settings/proof-stock', { quantity: qty })
      setConfig(c => ({ ...c, proof_stock: qty }))
      setStockQty('')
      toast.success('Estoque atualizado!')
    } catch { toast.error('Erro ao atualizar estoque.') } finally { setUpdatingStock(false) }
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>

  return (
    <div className="flex flex-col gap-5">
      {/* Estoque */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <Package className="w-4 h-4 text-[#26619c]" /> Estoque de Comprovantes
          </h3>
          <span className={`text-sm font-bold px-3 py-1 rounded-full ${config.proof_stock > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {config.proof_stock} un.
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type="number" min="0" value={stockQty}
            onChange={e => setStockQty(e.target.value)}
            placeholder="Nova quantidade total"
            className={inputCls}
          />
          <button onClick={updateStock} disabled={updatingStock || !stockQty}
            className="px-4 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-lg text-sm font-medium transition disabled:opacity-50 shrink-0">
            {updatingStock ? '…' : 'Definir'}
          </button>
        </div>
      </div>

      {/* Logo */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-4">
          <FileText className="w-4 h-4 text-[#26619c]" /> Logo da Associação
        </h3>
        {config.assoc_logo_url ? (
          <div className="mb-3">
            <img src={config.assoc_logo_url} alt="Logo" className="h-20 object-contain border border-gray-200 rounded-lg p-2 bg-gray-50" />
          </div>
        ) : (
          <p className="text-xs text-red-500 mb-3">Não cadastrado — obrigatório para emissão</p>
        )}
        <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
        <button onClick={() => logoRef.current?.click()} disabled={uploadingLogo}
          className="flex items-center gap-2 border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-50">
          <Upload className="w-4 h-4" /> {uploadingLogo ? 'Enviando…' : config.assoc_logo_url ? 'Trocar Logo' : 'Enviar Logo'}
        </button>
      </div>

      {/* Assinatura */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-4">
          <Upload className="w-4 h-4 text-[#26619c]" /> Assinatura da Presidente
        </h3>
        {config.president_signature_url ? (
          <div className="mb-3">
            <img src={config.president_signature_url} alt="Assinatura" className="h-16 object-contain border border-gray-200 rounded-lg p-2 bg-gray-50" />
          </div>
        ) : (
          <p className="text-xs text-red-500 mb-3">Não cadastrada — obrigatória para emissão</p>
        )}
        <input ref={sigRef} type="file" accept="image/*" className="hidden" onChange={uploadSignature} />
        <button onClick={() => sigRef.current?.click()} disabled={uploadingSig}
          className="flex items-center gap-2 border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-50">
          <Upload className="w-4 h-4" /> {uploadingSig ? 'Enviando…' : config.president_signature_url ? 'Trocar Assinatura' : 'Enviar Assinatura'}
        </button>
      </div>

      {/* Dados do documento */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-800 mb-4">Dados do Documento</h3>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome da Presidente</label>
            <input value={presidentName} onChange={e => setPresidentName(e.target.value)}
              placeholder="Ex: CARLA BARBOSA SALES" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome da Comunidade</label>
            <input value={communityName} onChange={e => setCommunityName(e.target.value)}
              placeholder="Ex: Vaz Lobo, Congonha" className={inputCls} />
          </div>
          <button onClick={saveNames} disabled={saving}
            className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Status de prontidão */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-600 mb-2">Status para emissão</p>
        {[
          { label: 'Logo cadastrado', ok: !!config.assoc_logo_url },
          { label: 'Assinatura cadastrada', ok: !!config.president_signature_url },
          { label: 'Nome da presidente', ok: !!presidentName },
          { label: 'Nome da comunidade', ok: !!communityName },
          { label: 'Estoque disponível', ok: config.proof_stock > 0 },
        ].map(({ label, ok }) => (
          <div key={label} className="flex items-center gap-2 text-xs py-0.5">
            <span className={ok ? 'text-green-500' : 'text-red-400'}>{'• '}{ok ? '✓' : '✗'}</span>
            <span className={ok ? 'text-gray-700' : 'text-red-500'}>{label}</span>
          </div>
        ))}
      </div>

      {/* Relatório de comprovantes emitidos */}
      <ComprovanteReport />
    </div>
  )
}

type ProofEntry = {
  id: string; amount: string; description: string; created_at: string
  reference_number: string | null; reversed_at: string | null
  payment_method: string | null; resident_name: string | null
  cpf: string | null; issued_by: string | null
}

type EditProofForm = { resident_name: string; resident_cpf: string; resident_neighborhood: string; resident_cep: string; amount: string }

function ComprovanteReport() {
  const [entries, setEntries] = useState<ProofEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<ProofEntry | null>(null)
  const [editForm, setEditForm] = useState<EditProofForm>({ resident_name: '', resident_cpf: '', resident_neighborhood: '', resident_cep: '', amount: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get<ProofEntry[]>('/finance/proof-of-residence/list')
      setEntries(res.data)
      setLoaded(true)
    } catch { toast.error('Erro ao carregar relatório.') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const maskCpf = (cpf: string) => cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')

  const startEdit = (e: ProofEntry) => {
    const name = e.resident_name ?? e.description.replace('Comprovante de Residência — ', '')
    setEditForm({ resident_name: name, resident_cpf: e.cpf ? maskCpf(e.cpf) : '', resident_neighborhood: '', resident_cep: '', amount: parseFloat(e.amount).toFixed(2) })
    setEditing(e)
  }

  const handleReissue = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const res = await api.post(`/finance/proof-of-residence/${editing.id}/reissue`, {
        resident_name: editForm.resident_name,
        resident_cpf: editForm.resident_cpf.replace(/\D/g, ''),
        resident_neighborhood: editForm.resident_neighborhood,
        resident_cep: editForm.resident_cep,
        amount: parseFloat(editForm.amount),
      }, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a'); a.href = url; a.download = 'comprovante.pdf'; a.click()
      URL.revokeObjectURL(url)
      toast.success('Comprovante re-emitido!')
      setEditing(null)
      load()
    } catch { toast.error('Erro ao re-emitir comprovante.') } finally { setSaving(false) }
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]'

  return (
    <>
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Re-emitir Comprovante</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">O comprovante anterior será estornado e um novo será gerado.</p>
            <div className="flex flex-col gap-3">
              <div><label className="text-xs font-medium text-gray-600 mb-1 block">Nome do morador</label><input value={editForm.resident_name} onChange={e => setEditForm(f => ({...f, resident_name: e.target.value}))} className={inputCls} /></div>
              <div><label className="text-xs font-medium text-gray-600 mb-1 block">CPF</label><input value={editForm.resident_cpf} onChange={e => setEditForm(f => ({...f, resident_cpf: e.target.value}))} className={inputCls} placeholder="000.000.000-00" /></div>
              <div><label className="text-xs font-medium text-gray-600 mb-1 block">Bairro</label><input value={editForm.resident_neighborhood} onChange={e => setEditForm(f => ({...f, resident_neighborhood: e.target.value}))} className={inputCls} /></div>
              <div><label className="text-xs font-medium text-gray-600 mb-1 block">CEP</label><input value={editForm.resident_cep} onChange={e => setEditForm(f => ({...f, resident_cep: e.target.value}))} className={inputCls} placeholder="00000-000" /></div>
              <div><label className="text-xs font-medium text-gray-600 mb-1 block">Valor (R$)</label><input type="number" step="0.01" value={editForm.amount} onChange={e => setEditForm(f => ({...f, amount: e.target.value}))} className={inputCls} /></div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditing(null)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm">Cancelar</button>
              <button onClick={handleReissue} disabled={saving} className="flex-1 bg-[#26619c] text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">{saving ? 'Re-emitindo…' : 'Re-emitir PDF'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#26619c]" /> Histórico de Comprovantes Emitidos
          </h3>
          <button onClick={load} className="text-gray-400 hover:text-gray-600 text-xs border border-gray-200 px-2 py-1 rounded-lg">Atualizar</button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
        ) : !loaded || entries.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhum comprovante emitido.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left whitespace-nowrap">Data</th>
                  <th className="px-5 py-3 text-left whitespace-nowrap">Morador</th>
                  <th className="px-5 py-3 text-left whitespace-nowrap">CPF</th>
                  <th className="px-5 py-3 text-right whitespace-nowrap">Valor</th>
                  <th className="px-5 py-3 text-left whitespace-nowrap">Pagamento</th>
                  <th className="px-5 py-3 text-left whitespace-nowrap">Código</th>
                  <th className="px-5 py-3 text-left whitespace-nowrap">Emitido por</th>
                  <th className="px-5 py-3 text-left whitespace-nowrap">Status</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map(e => (
                  <tr key={e.id} className={`hover:bg-blue-50/30 transition ${e.reversed_at ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-700">
                      {new Date(e.created_at).toLocaleDateString('pt-BR')}
                      <div className="text-xs text-gray-400">{new Date(e.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td className="px-5 py-3 font-medium text-gray-900 whitespace-nowrap">
                      {e.resident_name ?? e.description.replace('Comprovante de Residência — ', '')}
                    </td>
                    <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{e.cpf ? maskCpf(e.cpf) : '—'}</td>
                    <td className="px-5 py-3 text-right font-semibold text-green-700 whitespace-nowrap">R$ {parseFloat(e.amount).toFixed(2)}</td>
                    <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{e.payment_method ?? '—'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{e.reference_number ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{e.issued_by ?? '—'}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {e.reversed_at
                        ? <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">Estornado</span>
                        : <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">Válido</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {!e.reversed_at && (
                        <button onClick={() => startEdit(e)} className="text-xs border border-gray-300 text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-50 flex items-center gap-1">
                          <Pencil className="w-3 h-3" /> Editar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

type ScheduledTask = {
  id: string; name: string; description: string; task_key: string
  schedule_cron: string; schedule_label: string; enabled: boolean
  last_run_at: string | null; last_run_status: string | null; last_run_result: string | null
}

function TarefasAgendadasTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get<ScheduledTask[]>('/admin/scheduled-tasks')
      setTasks(res.data)
    } catch { toast.error('Erro ao carregar tarefas.') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const toggle = async (key: string) => {
    try {
      const res = await api.patch<{ enabled: boolean }>(`/admin/scheduled-tasks/${key}/toggle`)
      setTasks(t => t.map(x => x.task_key === key ? { ...x, enabled: res.data.enabled } : x))
    } catch { toast.error('Erro ao alterar.') }
  }

  const run = async (key: string) => {
    setRunning(key)
    try {
      const res = await api.post<{ status: string; result: string }>(`/admin/scheduled-tasks/${key}/run`)
      toast.success(res.data.result)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao executar tarefa.')
    } finally { setRunning(null) }
  }

  if (loading) return <div className="p-10 text-center text-gray-400">Carregando…</div>

  return (
    <div className="flex flex-col gap-4">
      {tasks.map(task => (
        <div key={task.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-gray-900">{task.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${task.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {task.enabled ? 'Ativa' : 'Inativa'}
                </span>
              </div>
              <p className="text-sm text-gray-500 mb-2">{task.description}</p>
              <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="font-medium text-gray-700">Agendamento:</span> {task.schedule_label}
                </span>
                {task.last_run_at && (
                  <span className="flex items-center gap-1">
                    <span className="font-medium text-gray-700">Última execução:</span>
                    {new Date(task.last_run_at).toLocaleString('pt-BR')}
                    <span className={`ml-1 px-1.5 py-0.5 rounded font-semibold ${task.last_run_status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {task.last_run_status === 'success' ? 'OK' : 'Erro'}
                    </span>
                  </span>
                )}
              </div>
              {task.last_run_result && (
                <p className="text-xs text-gray-400 mt-1 italic">{task.last_run_result}</p>
              )}
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <button onClick={() => run(task.task_key)} disabled={running === task.task_key}
                className="px-4 py-2 bg-[#26619c] text-white text-xs font-semibold rounded-lg hover:bg-[#1a4f87] transition disabled:opacity-50 whitespace-nowrap">
                {running === task.task_key ? 'Executando…' : 'Executar agora'}
              </button>
              <button onClick={() => toggle(task.task_key)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg border transition whitespace-nowrap ${task.enabled ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-green-300 text-green-700 hover:bg-green-50'}`}>
                {task.enabled ? 'Desativar' : 'Ativar'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}


// ── Relatório de Moradores por Rua ────────────────────────────────────────────
interface StreetRow {
  street: string
  total: number
  members: number
  guests: number
  active: number
  inactive: number
  with_cpf: number
  with_phone: number
  pct_of_total: number
  pct_cpf: number
}
interface MoradoresReport {
  grand_total: number
  streets: StreetRow[]
  summary: {
    total_members: number
    total_guests: number
    total_active: number
    total_inactive: number
    total_with_cpf: number
    pct_cpf_overall: number
  }
}

function MoradoresTab() {
  const [data, setData] = useState<MoradoresReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/residents/reports/by-street')
      .then(r => setData(r.data))
      .catch(() => toast.error('Erro ao carregar relatório'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
  if (!data) return null

  const { summary, streets, grand_total } = data

  return (
    <div className="flex flex-col gap-5 mt-4">
      {/* Cards de resumo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: 'Total de Moradores', value: grand_total, color: 'text-[#26619c]' },
          { label: 'Associados', value: summary.total_members, color: 'text-blue-600' },
          { label: 'Visitantes', value: summary.total_guests, color: 'text-orange-500' },
          { label: 'Ativos', value: summary.total_active, color: 'text-green-600' },
          { label: 'Inativos', value: summary.total_inactive, color: 'text-red-500' },
          { label: '% com CPF', value: `${summary.pct_cpf_overall}%`, color: 'text-purple-600' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 flex flex-col gap-1">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Tabela por rua */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-700">Cadastros por Rua</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wide">
                <th className="text-left px-4 py-2">Rua</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">% Total</th>
                <th className="text-right px-3 py-2">Assoc.</th>
                <th className="text-right px-3 py-2">Visit.</th>
                <th className="text-right px-3 py-2">Ativos</th>
                <th className="text-right px-3 py-2">Inat.</th>
                <th className="text-right px-3 py-2">% CPF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {streets.map(s => (
                <tr key={s.street} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800 max-w-[160px] truncate">{s.street}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-gray-900">{s.total}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5 hidden sm:block">
                        <div className="bg-[#26619c] h-1.5 rounded-full" style={{ width: `${s.pct_of_total}%` }} />
                      </div>
                      <span className="text-gray-600">{s.pct_of_total}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-blue-600">{s.members}</td>
                  <td className="px-3 py-2.5 text-right text-orange-500">{s.guests}</td>
                  <td className="px-3 py-2.5 text-right text-green-600">{s.active}</td>
                  <td className="px-3 py-2.5 text-right text-red-500">{s.inactive}</td>
                  <td className="px-3 py-2.5 text-right text-purple-600">{s.pct_cpf}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ExemptionTokenTab() {
  const [token, setToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!expiresAt) return
    const interval = setInterval(() => {
      const diff = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000))
      setSecondsLeft(diff)
      if (diff === 0) { setToken(null); setExpiresAt(null) }
    }, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  const generate = async () => {
    setLoading(true)
    try {
      const res = await api.post<{ token: string; expires_at: string }>('/admin/delivery-exemption-token')
      setToken(res.data.token)
      setExpiresAt(new Date(res.data.expires_at))
      setSecondsLeft(1800)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao gerar código.')
    } finally { setLoading(false) }
  }

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col items-center gap-5">
      <div className="text-center">
        <h2 className="font-semibold text-gray-800 text-base">Código de Isenção de Taxa</h2>
        <p className="text-xs text-gray-500 mt-1">Gera um código de uso único, válido por 30 minutos, para isentar a taxa de entrega de R$2,50.</p>
      </div>
      {token && secondsLeft > 0 ? (
        <div className="flex flex-col items-center gap-3">
          <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl px-8 py-5 text-center">
            <p className="text-4xl font-mono font-bold tracking-widest text-blue-700">{token}</p>
          </div>
          <p className={`text-sm font-medium ${secondsLeft < 120 ? 'text-red-500' : 'text-gray-500'}`}>
            Expira em {mins}:{secs.toString().padStart(2, '0')}
          </p>
          <p className="text-xs text-gray-400">Repasse verbalmente ao operador. Uso único.</p>
          <button onClick={generate} disabled={loading}
            className="text-xs text-blue-600 underline mt-1">
            Gerar novo código
          </button>
        </div>
      ) : (
        <button onClick={generate} disabled={loading}
          className="bg-[#26619c] hover:bg-[#1a4f87] text-white px-6 py-3 rounded-xl text-sm font-medium transition disabled:opacity-50">
          {loading ? 'Gerando…' : 'Gerar código de isenção'}
        </button>
      )}
    </div>
  )
}

const MODULES_LABELS: Record<string, string> = {
  finance: 'Caixa / Financeiro',
  service_orders: 'Ordens de Serviço',
  residents: 'Moradores',
  packages: 'Encomendas',
  settings: 'Configurações',
  daily_tasks: 'Tarefas Diárias',
  reports: 'Relatórios',
}

const ROLE_COLS: { role: string; label: string }[] = [
  { role: 'admin', label: 'Admin' },
  { role: 'conferente', label: 'Conferente' },
  { role: 'diretoria', label: 'Diretoria' },
  { role: 'diretoria_adjunta', label: 'Dir. Adjunta' },
  { role: 'conselho', label: 'Conselho' },
  { role: 'operator', label: 'Operador' },
  { role: 'viewer', label: 'Visualizador' },
]

type PermMatrix = Record<string, Record<string, { can_view: boolean; can_write: boolean }>>

function PermissoesTab() {
  const [matrix, setMatrix] = useState<PermMatrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    api.get<PermMatrix>('/admin/role-permissions')
      .then(r => setMatrix(r.data))
      .catch(() => toast.error('Erro ao carregar permissões.'))
      .finally(() => setLoading(false))
  }, [])

  const toggle = async (role: string, module: string, field: 'can_view' | 'can_write') => {
    if (!matrix) return
    const current = matrix[role][module]
    const next = { ...current, [field]: !current[field] }
    if (field === 'can_view' && !next.can_view) next.can_write = false
    if (field === 'can_write' && next.can_write) next.can_view = true

    const key = `${role}.${module}.${field}`
    setSaving(key)
    try {
      await api.put(`/admin/role-permissions/${role}/${module}`, next)
      setMatrix(m => m ? { ...m, [role]: { ...m[role], [module]: next } } : m)
    } catch { toast.error('Erro ao salvar permissão.') }
    finally { setSaving(null) }
  }

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
  if (!matrix) return null

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
        Controla quais módulos cada perfil pode <strong>ver</strong> (👁) e <strong>editar</strong> (✏) na interface.
        Superadmin sempre tem acesso total. Alterações aplicam-se imediatamente no próximo login.
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs min-w-[600px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wide w-44">Módulo</th>
              {ROLE_COLS.map(({ role, label }) => (
                <th key={role} className="text-center px-3 py-3 text-gray-500 font-semibold uppercase tracking-wide">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {Object.entries(MODULES_LABELS).map(([module, label]) => (
              <tr key={module} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-800">{label}</td>
                {ROLE_COLS.map(({ role }) => {
                  const perm = matrix[role]?.[module]
                  if (!perm) return <td key={role} />
                  const vKey = `${role}.${module}.can_view`
                  const wKey = `${role}.${module}.can_write`
                  return (
                    <td key={role} className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => toggle(role, module, 'can_view')}
                          disabled={saving === vKey}
                          title={perm.can_view ? 'Ver: ativo' : 'Ver: bloqueado'}
                          className={`p-1.5 rounded-lg border transition ${perm.can_view ? 'bg-blue-50 border-blue-300 text-blue-600' : 'bg-gray-50 border-gray-200 text-gray-300'} disabled:opacity-40`}
                        >
                          {perm.can_view ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => toggle(role, module, 'can_write')}
                          disabled={saving === wKey}
                          title={perm.can_write ? 'Editar: ativo' : 'Editar: bloqueado'}
                          className={`p-1.5 rounded-lg border transition ${perm.can_write ? 'bg-green-50 border-green-300 text-green-600' : 'bg-gray-50 border-gray-200 text-gray-300'} disabled:opacity-40`}
                        >
                          {perm.can_write ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 text-center">
        👁 Ver módulo &nbsp;·&nbsp; ✏ Criar/editar dentro do módulo
      </p>
    </div>
  )
}

function CaixaAdminTab() {
  const [balance, setBalance]         = useState<any>(null)
  const [loading, setLoading]         = useState(true)
  const [zerando, setZerando]         = useState(false)
  const [confirm, setConfirm]         = useState(false)

  useEffect(() => {
    api.get('/finance/balance-summary')
      .then(r => setBalance(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleZerar = async () => {
    setZerando(true)
    try {
      await api.post('/admin/reset-balance')
      toast.success('Saldo zerado! Contagem recomeça a partir de hoje.')
      setConfirm(false)
      const r = await api.get('/finance/balance-summary')
      setBalance(r.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao zerar caixa.')
    } finally { setZerando(false) }
  }

  const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="text-base">💰</span>
          <p className="text-sm font-semibold text-gray-800">Saldo Esperado do Caixa</p>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 text-sm py-4">Carregando…</p>
        ) : balance ? (
          <>
            <div className={`rounded-2xl p-5 text-center ${balance.saldo_esperado >= 0 ? 'bg-[#1a3f6f]' : 'bg-red-700'}`}>
              <p className="text-xs text-white/70 uppercase tracking-wide font-medium mb-1">Saldo atual</p>
              <p className="text-4xl font-bold text-white">{fmtR(balance.saldo_esperado)}</p>
              <p className="text-xs text-white/60 mt-1.5">desde {new Date(balance.balance_start_date + 'T12:00').toLocaleDateString('pt-BR')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-green-50 border border-green-100 rounded-xl p-3">
                <p className="text-xs text-green-600 font-medium mb-1">Total entradas</p>
                <p className="font-bold text-green-700">{fmtR(balance.total_entradas)}</p>
                <p className="text-[10px] text-green-500 mt-0.5">Caixa {fmtR(balance.entradas_caixa)} · Manual {fmtR(balance.entradas_manual)}</p>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-xs text-red-600 font-medium mb-1">Total saídas</p>
                <p className="font-bold text-red-700">{fmtR(balance.total_saidas)}</p>
                <p className="text-[10px] text-red-500 mt-0.5">Caixa {fmtR(balance.saidas_caixa)} · Manual {fmtR(balance.saidas_manual)}</p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-center text-gray-400 text-sm">Erro ao carregar saldo.</p>
        )}
      </div>

      {/* Zerar Caixa */}
      <div className="bg-white rounded-xl border border-red-200 shadow-sm p-5 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-700">Zerar Caixa</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Define hoje como nova data de início do saldo. As transações anteriores
              continuam no histórico mas deixam de contar para o saldo esperado.
            </p>
          </div>
        </div>
        {!confirm ? (
          <button onClick={() => setConfirm(true)}
            className="flex items-center justify-center gap-2 w-full border-2 border-red-400 text-red-600 hover:bg-red-50 py-2.5 rounded-xl text-sm font-semibold transition">
            Zerar Caixa a partir de hoje
          </button>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col gap-3">
            <p className="text-sm font-semibold text-red-800">Tem certeza?</p>
            <p className="text-xs text-red-600">O saldo passará a ser contado a partir de hoje ({new Date().toLocaleDateString('pt-BR')}). Esta ação não pode ser desfeita automaticamente.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirm(false)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm">
                Cancelar
              </button>
              <button onClick={handleZerar} disabled={zerando}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                {zerando ? 'Zerando…' : 'Confirmar Zeramento'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminPage() {
  const currentUserId = useAuthStore((s) => s.userId)
  const [tab, setTab] = useState<AdminTab>('usuarios')
  const [users, setUsers] = useState<User[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  const load = async () => {
    try {
      const res = await api.get<User[]>('/admin/users')
      setUsers(res.data)
    } catch {
      toast.error('Erro ao carregar usuários.')
    }
  }

  const loadLogs = async () => {
    setLoadingLogs(true)
    try {
      const res = await api.get<AuditEntry[]>('/admin/audit-log')
      setLogs(res.data)
    } catch { setLogs([]) }
    finally { setLoadingLogs(false) }
  }

  useEffect(() => { load() }, [])

  const handleSave = async (data: UserFormData) => {
    try {
      if (editTarget) {
        await api.put(`/admin/users/${editTarget.id}`, data)
        toast.success('Usuário atualizado!')
      } else {
        await api.post('/admin/users', data)
        toast.success('Usuário criado!')
      }
      setShowForm(false)
      setEditTarget(null)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar usuário.')
      throw e
    }
  }

  const toggleActive = async (user: User) => {
    try {
      await api.put(`/admin/users/${user.id}`, { is_active: !user.is_active })
      toast.success(user.is_active ? 'Usuário desativado.' : 'Usuário reativado.')
      load()
    } catch {
      toast.error('Erro ao alterar status.')
    }
  }

  const getRoleLabel = (role: string) =>
    ROLE_LABELS[role as ExtendedRole] ?? role

  const getRoleColor = (role: string) =>
    ROLE_COLORS[role as ExtendedRole] ?? 'bg-gray-100 text-gray-600'

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-[#26619c]" />
          Admin
        </h1>
        {tab === 'usuarios' && (
          <button onClick={() => { setEditTarget(null); setShowForm(true) }}
            className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-4 py-2 rounded-xl text-sm font-medium transition">
            <Plus className="w-4 h-4" />
            Novo
          </button>
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {([
          ['usuarios', 'Usuários'],
          ['permissoes', 'Permissões'],
          ['comprovante', 'Comprovante'],
          ['tarefas', 'Tarefas'],
          ['moradores', 'Moradores'],
          ['isencao', 'Isenção Taxa'],
          ['caixa', '💰 Caixa'],
        ] as [AdminTab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition ${tab === t ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'usuarios' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {users.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">Nenhum usuário encontrado.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {users.map((u) => (
                <li key={u.id} className={`flex items-center justify-between px-4 py-3 ${!u.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#e8f0fb] flex items-center justify-center text-[#26619c] font-bold text-sm shrink-0">
                      {u.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {u.full_name}
                        {u.id === currentUserId && <span className="ml-1 text-xs text-gray-400">(você)</span>}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{u.email}</p>
                      {u.last_login_at && (
                        <p className="text-xs text-gray-400">
                          Último acesso: {new Date(u.last_login_at).toLocaleDateString('pt-BR')}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0 ml-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRoleColor(u.role)}`}>
                      {getRoleLabel(u.role)}
                    </span>
                    {u.id !== currentUserId && (
                      <div className="flex gap-2">
                        <button onClick={() => { setEditTarget(u); setShowForm(true) }}
                          className="text-xs text-[#26619c] hover:underline flex items-center gap-0.5">
                          <Pencil className="w-3 h-3" /> Editar
                        </button>
                        <button onClick={() => toggleActive(u)}
                          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                          {u.is_active
                            ? <><UserX className="w-3 h-3" /> Desativar</>
                            : <><UserCheck className="w-3 h-3" /> Reativar</>}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'permissoes' && <PermissoesTab />}
      {tab === 'comprovante' && <ComprovanteTab />}
      {tab === 'tarefas' && <TarefasAgendadasTab />}
      {tab === 'moradores' && <MoradoresTab />}
      {tab === 'isencao' && <ExemptionTokenTab />}
      {tab === 'caixa' && <CaixaAdminTab />}

      {showForm && (
        <UserFormModal
          initial={editTarget ? {
            id: editTarget.id,
            full_name: editTarget.full_name,
            email: editTarget.email,
            phone: editTarget.phone ?? '',
            role: editTarget.role as ExtendedRole,
            password: '',
          } : undefined}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditTarget(null) }}
        />
      )}
    </div>
  )
}
