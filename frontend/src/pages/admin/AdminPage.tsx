import { useEffect, useState } from 'react'
import { ShieldCheck, Plus, X, Pencil, UserX, UserCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import type { User, UserRole } from '../../types'
import { useAuthStore } from '../../store/authStore'

type ExtendedRole = UserRole | 'diretoria_adjunta'

const ROLE_LABELS: Record<ExtendedRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Administrador',
  conferente: 'Conferente',
  diretoria_adjunta: 'Diretoria Adjunta',
  operator: 'Operador',
  viewer: 'Visualizador',
}

const ROLE_COLORS: Record<ExtendedRole, string> = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  conferente: 'bg-teal-100 text-teal-700',
  diretoria_adjunta: 'bg-indigo-100 text-indigo-700',
  operator: 'bg-green-100 text-green-700',
  viewer: 'bg-gray-100 text-gray-600',
}

const EDITABLE_ROLES: ExtendedRole[] = ['admin', 'conferente', 'diretoria_adjunta', 'operator', 'viewer']

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

export default function AdminPage() {
  const currentUserId = useAuthStore((s) => s.userId)
  const [users, setUsers] = useState<User[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<User | null>(null)

  const load = async () => {
    try {
      const res = await api.get<User[]>('/admin/users')
      setUsers(res.data)
    } catch {
      toast.error('Erro ao carregar usuários.')
    }
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
    <div className="flex flex-col gap-5 p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-[#26619c]" />
          Usuários
        </h1>
        <button onClick={() => { setEditTarget(null); setShowForm(true) }}
          className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-4 py-2 rounded-xl text-sm font-medium transition">
          <Plus className="w-4 h-4" />
          Novo
        </button>
      </div>

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
