import { useState } from 'react'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import EscDataTable from './EscDataTable'
import api from '../../services/api'

const CHANGE_FIELD_LABEL: Record<string, string> = {
  name: 'Nome', description: 'Descrição', phone: 'Telefone', whatsapp: 'WhatsApp', address: 'Endereço',
}

function formatChanges(changes: Record<string, string>) {
  return Object.entries(changes).map(([k, v]) => `${CHANGE_FIELD_LABEL[k] ?? k}: ${v}`).join(' · ')
}

export default function DiretorioSugestoesPendentesSection() {
  const [reloadKey, setReloadKey] = useState(0)

  const review = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.patch(`/directory/update-requests/${id}`, { status })
      toast.success(status === 'approved' ? 'Aprovado!' : 'Reprovado.')
      setReloadKey(k => k + 1)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao revisar.')
    }
  }

  return (
    <EscDataTable
      fetchFn={() => api.get('/directory/update-requests', { params: { status: 'pending' } })}
      searchKeys={['place_name', 'resident_name']}
      reloadKey={reloadKey}
      columns={[
        { key: 'place_name', label: 'Lugar' },
        { key: 'resident_name', label: 'Sugerido por' },
        { key: 'changes', label: 'Alterações', render: r => <span className="max-w-xs truncate inline-block align-bottom">{formatChanges(r.changes)}</span> },
        { key: 'notes', label: 'Observação', render: r => r.notes || '—' },
        { key: 'created_at', label: 'Data', render: r => new Date(r.created_at).toLocaleDateString('pt-BR') },
      ]}
      rowActions={(r) => (
        <div className="flex gap-2 justify-end">
          <button onClick={() => review(r.id, 'approved')} className="text-green-600 hover:text-green-800" title="Aprovar"><Check className="w-4 h-4" /></button>
          <button onClick={() => review(r.id, 'rejected')} className="text-red-500 hover:text-red-700" title="Reprovar"><X className="w-4 h-4" /></button>
        </div>
      )}
    />
  )
}
