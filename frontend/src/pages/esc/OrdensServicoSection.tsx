import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useSort, SortTh } from './EscDataTable'
import { EscButton, EscField, EscModal, EscSelect, escInputCls, escInputStyle } from './EscFormKit'
import { escService } from '../../services/esc'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'
const PAGE_SIZE = 50

const OS_PRIORITY_PT: Record<string, string> = {
  low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica',
}
const OS_STATUS_PT: Record<string, string> = {
  draft: 'Rascunho', pending: 'Pendente', in_progress: 'Em Andamento',
  resolved: 'Concluída', archived: 'Arquivada', cancelled: 'Cancelada',
}

interface OrdemServico {
  id: string; number: number; title: string; priority: string; status: string
  created_at: string; unidade: string
}

const emptyForm = { association_id: '', title: '', description: '', priority: 'medium', area: '', location_detail: '' }

export default function OrdensServicoSection() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)
  const [rows, setRows] = useState<OrdemServico[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [associacoes, setAssociacoes] = useState<{ id: string; name: string }[]>([])
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState(emptyForm)
  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { escService.associacoes().then((r) => setAssociacoes(r.data)).catch(() => {}) }, [])

  const params = useMemo(() => {
    const p: Record<string, any> = { skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }
    if (dateFrom) p.date_from = dateFrom
    if (dateTo) p.date_to = dateTo
    if (search.trim()) p.search = search.trim()
    return p
  }, [page, dateFrom, dateTo, search])

  useEffect(() => {
    setLoading(true)
    escService.ordensServico(params)
      .then((r) => { setRows(r.data.items); setTotal(r.data.total) })
      .catch(() => toast.error('Erro ao carregar ordens de serviço.'))
      .finally(() => setLoading(false))
  }, [params, reloadKey])

  const { sorted: sortedRows, sortKey, sortDir, toggleSort } = useSort(rows)

  const doCreate = async () => {
    if (!createForm.association_id || !createForm.title.trim() || !createForm.description.trim()) {
      toast.error('Unidade, título e descrição são obrigatórios.'); return
    }
    setSaving(true)
    try {
      await escService.criarOrdemServico(createForm)
      toast.success('OS criada.'); setCreating(false); setCreateForm(emptyForm); setReloadKey((k) => k + 1)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao criar OS.') }
    finally { setSaving(false) }
  }

  const openEdit = (r: any) => {
    setEditTarget(r)
    setEditForm({ association_id: '', title: r.title, description: r.description ?? '', priority: r.priority, area: r.area ?? '', location_detail: '' })
  }

  const doEdit = async () => {
    if (!editTarget) return
    setSaving(true)
    try {
      await escService.editarOrdemServico(editTarget.id, {
        title: editForm.title, description: editForm.description, priority: editForm.priority, area: editForm.area || null,
      })
      toast.success('OS atualizada.'); setEditTarget(null); setReloadKey((k) => k + 1)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao editar OS.') }
    finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await escService.excluirOrdemServico(deleteTarget.id)
      toast.success('OS excluída.'); setDeleteTarget(null); setReloadKey((k) => k + 1)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao excluir OS.') }
    finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-3 flex items-end gap-3 flex-wrap">
        <EscField label="Criada de">
          <input type="date" className={escInputCls + ' w-36'} style={escInputStyle} value={dateFrom} onChange={(e) => { setPage(1); setDateFrom(e.target.value) }} />
        </EscField>
        <EscField label="até">
          <input type="date" className={escInputCls + ' w-36'} style={escInputStyle} value={dateTo} onChange={(e) => { setPage(1); setDateTo(e.target.value) }} />
        </EscField>
        <EscField label="Buscar">
          <input className={escInputCls + ' w-44'} style={escInputStyle} placeholder="Título" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value) }} />
        </EscField>
        <span className="text-xs" style={{ color: TEXT_MUTED }}>{loading ? 'carregando…' : `${total} OS`}</span>
        <div className="ml-auto">
          <EscButton onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Nova OS</EscButton>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-2">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b" style={{ borderColor: BORDER }}>
              <SortTh label="Nº" sortKey="number" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('number')} />
              <SortTh label="Título" sortKey="title" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('title')} />
              <SortTh label="Prioridade" sortKey="priority" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('priority')} />
              <SortTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('status')} />
              <SortTh label="Unidade" sortKey="unidade" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('unidade')} />
              <SortTh label="Criada em" sortKey="created_at" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('created_at')} />
              <th className="py-2 pr-4" style={{ color: TEXT_MUTED }}></th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED }}>nenhuma OS encontrada.</td></tr>
            )}
            {sortedRows.map((r) => (
              <tr key={r.id} className="border-b hover:bg-slate-50" style={{ borderColor: BORDER }}>
                <td className="py-2 pr-4 whitespace-nowrap">{r.number}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r.title}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{OS_PRIORITY_PT[r.priority] ?? r.priority}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{OS_STATUS_PT[r.status] ?? r.status}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r.unidade}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{new Date(r.created_at).toLocaleString('pt-BR')}</td>
                <td className="py-2 pr-4 whitespace-nowrap text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => openEdit(r)} className="text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setDeleteTarget(r)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-6 py-2 border-t flex items-center justify-between" style={{ borderColor: BORDER }}>
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="text-xs disabled:opacity-40" style={{ color: TEXT_MUTED }}>← Anterior</button>
        <span className="text-xs" style={{ color: TEXT_MUTED }}>Página {page} · {total} no total</span>
        <button disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)} className="text-xs disabled:opacity-40" style={{ color: TEXT_MUTED }}>Próxima →</button>
      </div>

      {creating && (
        <EscModal title="Nova Ordem de Serviço" onClose={() => setCreating(false)}
          footer={<><EscButton variant="ghost" onClick={() => setCreating(false)}>Cancelar</EscButton><EscButton onClick={doCreate} disabled={saving}>{saving ? 'Criando…' : 'Criar'}</EscButton></>}>
          <EscField label="Unidade" required>
            <EscSelect value={createForm.association_id} onChange={(e) => setCreateForm((f) => ({ ...f, association_id: e.target.value }))}>
              <option value="">Selecione…</option>
              {associacoes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </EscSelect>
          </EscField>
          <EscField label="Título" required>
            <input className={escInputCls} style={escInputStyle} value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} />
          </EscField>
          <EscField label="Descrição" required>
            <textarea className={escInputCls} style={escInputStyle} rows={3} value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
          </EscField>
          <EscField label="Prioridade">
            <EscSelect value={createForm.priority} onChange={(e) => setCreateForm((f) => ({ ...f, priority: e.target.value }))}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
              <option value="critical">Crítica</option>
            </EscSelect>
          </EscField>
          <EscField label="Área">
            <input className={escInputCls} style={escInputStyle} value={createForm.area} onChange={(e) => setCreateForm((f) => ({ ...f, area: e.target.value }))} />
          </EscField>
        </EscModal>
      )}

      {editTarget && (
        <EscModal title={`Editar OS #${editTarget.number}`} onClose={() => setEditTarget(null)}
          footer={<><EscButton variant="ghost" onClick={() => setEditTarget(null)}>Cancelar</EscButton><EscButton onClick={doEdit} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</EscButton></>}>
          <EscField label="Título" required>
            <input className={escInputCls} style={escInputStyle} value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
          </EscField>
          <EscField label="Descrição" required>
            <textarea className={escInputCls} style={escInputStyle} rows={3} value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
          </EscField>
          <EscField label="Prioridade">
            <EscSelect value={editForm.priority} onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
              <option value="critical">Crítica</option>
            </EscSelect>
          </EscField>
          <EscField label="Área">
            <input className={escInputCls} style={escInputStyle} value={editForm.area} onChange={(e) => setEditForm((f) => ({ ...f, area: e.target.value }))} />
          </EscField>
        </EscModal>
      )}

      {deleteTarget && (
        <EscModal title="Excluir Ordem de Serviço" onClose={() => setDeleteTarget(null)}
          footer={<><EscButton variant="ghost" onClick={() => setDeleteTarget(null)}>Cancelar</EscButton><EscButton onClick={doDelete} disabled={saving}>{saving ? 'Excluindo…' : 'Excluir definitivamente'}</EscButton></>}>
          <p className="text-sm" style={{ color: '#dc2626' }}>
            Excluir a OS #{deleteTarget.number} — "{deleteTarget.title}" — é permanente e apaga também comentários, registros diários e histórico. Não pode ser desfeito.
          </p>
        </EscModal>
      )}
    </div>
  )
}
