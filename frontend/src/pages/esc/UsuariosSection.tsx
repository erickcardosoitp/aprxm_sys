import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Pencil, Ban, Plus, Trash2 } from 'lucide-react'
import EscDataTable from './EscDataTable'
import { EscModal, EscField, EscButton, escInputCls, escInputStyle } from './EscFormKit'
import { escService } from '../../services/esc'
import { useAuthStore } from '../../store/authStore'

const ROLES = ['admin_master', 'superadmin', 'diretoria', 'conselho', 'admin', 'conferente', 'diretoria_adjunta', 'operator', 'viewer']

interface UserRow {
  id: string; full_name: string; email: string; role: string; unidade: string; is_active: boolean
}
interface Assoc { id: string; name: string }

const EMPTY = { full_name: '', email: '', password: '', role: 'operator', association_id: '' }

export default function UsuariosSection() {
  const empresaId = useAuthStore((s) => s.empresaId)
  const [units, setUnits] = useState<Assoc[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<UserRow | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    escService.associacoes().then((r) => setUnits((r.data as Assoc[]).filter((a) => a.id !== empresaId))).catch(() => {})
  }, [empresaId])

  const openNew = () => { setEditTarget(null); setForm({ ...EMPTY }); setShowForm(true) }
  const openEdit = (u: UserRow) => {
    setEditTarget(u)
    setForm({ full_name: u.full_name, email: u.email, password: '', role: u.role,
              association_id: u.unidade === 'Escritório' ? '' : (units.find((x) => x.name === u.unidade)?.id ?? '') })
    setShowForm(true)
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.full_name.trim() || !form.email.trim()) { toast.error('Nome e e-mail são obrigatórios.'); return }
    if (!editTarget && form.password.length < 6) { toast.error('Senha: mínimo 6 caracteres.'); return }
    setSaving(true)
    try {
      const association_id = form.association_id || null
      if (editTarget) {
        await escService.editarUsuario(editTarget.id, { full_name: form.full_name, role: form.role, association_id })
        toast.success('Usuário atualizado.')
      } else {
        await escService.criarUsuario({ full_name: form.full_name, email: form.email, password: form.password, role: form.role, association_id })
        toast.success('Usuário criado.')
      }
      setShowForm(false); setEditTarget(null); setReloadKey((k) => k + 1)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar usuário.')
    } finally { setSaving(false) }
  }

  const deactivate = async (u: UserRow) => {
    if (!confirm(`Desativar ${u.full_name}?`)) return
    try {
      await escService.desativarUsuario(u.id)
      toast.success('Usuário desativado.'); setReloadKey((k) => k + 1)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao desativar.') }
  }

  const remove = async (u: UserRow) => {
    if (!confirm(`Excluir DEFINITIVAMENTE ${u.full_name}? Só é possível se não houver movimentação.`)) return
    try {
      await escService.excluirUsuario(u.id)
      toast.success('Usuário excluído.'); setReloadKey((k) => k + 1)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao excluir.') }
  }

  return (
    <>
      <EscDataTable
        fetchFn={escService.usuarios}
        searchKeys={['full_name', 'email']}
        reloadKey={reloadKey}
        statusFilter
        toolbarAction={
          <EscButton onClick={openNew}><span className="inline-flex items-center gap-1"><Plus className="w-4 h-4" />Novo usuário</span></EscButton>
        }
        columns={[
          { key: 'full_name', label: 'Nome' },
          { key: 'email', label: 'E-mail' },
          { key: 'role', label: 'Cargo' },
          { key: 'unidade', label: 'Unidade' },
          { key: 'is_active', label: 'Ativo', render: (r) => (r.is_active ? 'Sim' : 'Não') },
        ]}
        rowActions={(r: UserRow) => (
          <div className="inline-flex gap-2 justify-end">
            <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-slate-800" title="Editar"><Pencil className="w-4 h-4" /></button>
            {r.is_active && <button onClick={() => deactivate(r)} className="text-amber-600 hover:text-amber-700" title="Desativar"><Ban className="w-4 h-4" /></button>}
            <button onClick={() => remove(r)} className="text-red-500 hover:text-red-700" title="Excluir (sem movimentação)"><Trash2 className="w-4 h-4" /></button>
          </div>
        )}
      />

      {showForm && (
        <EscModal
          title={editTarget ? 'Editar usuário' : 'Novo usuário'}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <EscButton variant="ghost" onClick={() => setShowForm(false)}>Cancelar</EscButton>
              <EscButton onClick={handleSave} disabled={saving}>{saving ? 'Salvando…' : editTarget ? 'Atualizar' : 'Criar'}</EscButton>
            </>
          }
        >
          <EscField label="Nome completo">
            <input className={escInputCls} style={escInputStyle} value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
          </EscField>
          <EscField label="E-mail">
            <input className={escInputCls} style={escInputStyle} type="email" value={form.email}
                   disabled={!!editTarget} onChange={(e) => set('email', e.target.value)} />
          </EscField>
          {!editTarget && (
            <EscField label="Senha provisória">
              <input className={escInputCls} style={escInputStyle} type="text" value={form.password} onChange={(e) => set('password', e.target.value)} />
            </EscField>
          )}
          <EscField label="Cargo">
            <select className={escInputCls} style={escInputStyle} value={form.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </EscField>
          <EscField label="Unidade">
            <select className={escInputCls} style={escInputStyle} value={form.association_id} onChange={(e) => set('association_id', e.target.value)}>
              <option value="">Escritório (acesso à empresa)</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </EscField>
        </EscModal>
      )}
    </>
  )
}
