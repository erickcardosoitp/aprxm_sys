import { useState } from 'react'
import toast from 'react-hot-toast'
import { Pencil } from 'lucide-react'
import EscDataTable from './EscDataTable'
import { EscModal, EscField, EscButton, EscSelect, escInputCls, escInputStyle } from './EscFormKit'
import { escService } from '../../services/esc'

interface AssocRow { id: string; name: string; slug: string; plan_name: string; is_active: boolean }

export default function AssociacoesSection() {
  const [editTarget, setEditTarget] = useState<AssocRow | null>(null)
  const [form, setForm] = useState({ name: '', slug: '', plan_name: '', is_active: true })
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const openEdit = (r: AssocRow) => {
    setEditTarget(r)
    setForm({ name: r.name, slug: r.slug, plan_name: r.plan_name, is_active: r.is_active })
  }

  const handleSave = async () => {
    if (!editTarget) return
    if (!form.name.trim() || !form.slug.trim()) { toast.error('Nome e slug são obrigatórios.'); return }
    setSaving(true)
    try {
      await escService.editarAssociacao(editTarget.id, form)
      toast.success('Associação atualizada.')
      setEditTarget(null); setReloadKey((k) => k + 1)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao atualizar.')
    } finally { setSaving(false) }
  }

  return (
    <>
      <EscDataTable
        fetchFn={escService.associacoes}
        searchKeys={['name', 'slug']}
        statusFilter
        reloadKey={reloadKey}
        columns={[
          { key: 'name', label: 'Nome' },
          { key: 'slug', label: 'Slug' },
          { key: 'plan_name', label: 'Plano' },
          { key: 'is_active', label: 'Ativa', render: (r) => (r.is_active ? 'Sim' : 'Não') },
        ]}
        rowActions={(r: AssocRow) => (
          <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-slate-800" title="Editar">
            <Pencil className="w-4 h-4" />
          </button>
        )}
      />

      {editTarget && (
        <EscModal
          title={`Editar associação — ${editTarget.name}`}
          onClose={() => setEditTarget(null)}
          footer={<>
            <EscButton variant="ghost" onClick={() => setEditTarget(null)}>Cancelar</EscButton>
            <EscButton onClick={handleSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</EscButton>
          </>}
        >
          <EscField label="Nome" required>
            <input className={escInputCls} style={escInputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </EscField>
          <EscField label="Slug" required hint="Usado em URLs internas — evite mudar sem necessidade.">
            <input className={escInputCls} style={escInputStyle} value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
          </EscField>
          <EscField label="Plano">
            <input className={escInputCls} style={escInputStyle} value={form.plan_name} onChange={(e) => setForm((f) => ({ ...f, plan_name: e.target.value }))} />
          </EscField>
          <EscField label="Status">
            <EscSelect value={form.is_active ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === '1' }))}>
              <option value="1">Ativa</option>
              <option value="0">Inativa</option>
            </EscSelect>
          </EscField>
        </EscModal>
      )}
    </>
  )
}
