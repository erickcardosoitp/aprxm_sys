import { useState } from 'react'
import toast from 'react-hot-toast'
import { Pencil } from 'lucide-react'
import EscDataTable from './EscDataTable'
import { EscModal, EscField, EscButton, escInputCls, escInputStyle } from './EscFormKit'
import { escService } from '../../services/esc'

interface EstoqueRow { id: string; unidade: string; estoque: number }

export default function ComprovantesEstoqueSection() {
  const [editTarget, setEditTarget] = useState<EstoqueRow | null>(null)
  const [valor, setValor] = useState('0')
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const openEdit = (r: EstoqueRow) => { setEditTarget(r); setValor(String(r.estoque)) }

  const handleSave = async () => {
    if (!editTarget) return
    const n = Number(valor)
    if (!Number.isInteger(n) || n < 0) { toast.error('Informe um número inteiro maior ou igual a 0.'); return }
    setSaving(true)
    try {
      await escService.editarComprovanteEstoque(editTarget.id, n)
      toast.success('Estoque atualizado.')
      setEditTarget(null); setReloadKey((k) => k + 1)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao atualizar estoque.')
    } finally { setSaving(false) }
  }

  return (
    <>
      <EscDataTable
        fetchFn={escService.comprovantesEstoque}
        searchKeys={['unidade']}
        reloadKey={reloadKey}
        columns={[
          { key: 'unidade', label: 'Unidade' },
          { key: 'estoque', label: 'Estoque atual' },
        ]}
        rowActions={(r: EstoqueRow) => (
          <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-slate-800" title="Editar estoque">
            <Pencil className="w-4 h-4" />
          </button>
        )}
      />

      {editTarget && (
        <EscModal
          title={`Editar estoque — ${editTarget.unidade}`}
          onClose={() => setEditTarget(null)}
          footer={
            <>
              <EscButton variant="ghost" onClick={() => setEditTarget(null)}>Cancelar</EscButton>
              <EscButton onClick={handleSave} disabled={saving}>{saving ? 'Salvando…' : 'Atualizar'}</EscButton>
            </>
          }
        >
          <EscField label="Estoque de comprovantes de residência">
            <input
              className={escInputCls} style={escInputStyle} type="number" min={0}
              value={valor} onChange={(e) => setValor(e.target.value)}
            />
          </EscField>
        </EscModal>
      )}
    </>
  )
}
