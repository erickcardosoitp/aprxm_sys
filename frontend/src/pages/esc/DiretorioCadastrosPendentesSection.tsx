import { useState } from 'react'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import EscDataTable from './EscDataTable'
import api from '../../services/api'

const CATEGORY_LABEL: Record<string, string> = {
  lanchonete: 'Lanchonete', restaurante: 'Restaurante', mercado: 'Mercado', servico: 'Serviço',
  saude: 'Saúde', beleza: 'Beleza', educacao: 'Educação', outro: 'Outro',
}

export default function DiretorioCadastrosPendentesSection() {
  const [reloadKey, setReloadKey] = useState(0)

  const moderate = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.patch(`/directory/places/${id}/moderate`, { status, reason: status === 'rejected' ? 'Não aprovado pela administração' : undefined })
      toast.success(status === 'approved' ? 'Aprovado!' : 'Reprovado.')
      setReloadKey(k => k + 1)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao revisar.')
    }
  }

  return (
    <EscDataTable
      fetchFn={() => api.get('/directory/places', { params: { status: 'pending' } })}
      searchKeys={['name', 'owner_resident_name']}
      reloadKey={reloadKey}
      columns={[
        { key: 'category', label: 'Categoria', render: r => CATEGORY_LABEL[r.category] ?? r.category },
        { key: 'name', label: 'Nome' },
        { key: 'owner_resident_name', label: 'Morador', render: r => r.owner_resident_name || '—' },
        { key: 'phone', label: 'Telefone', render: r => r.phone || '—' },
      ]}
      rowActions={(r) => (
        <div className="flex gap-2 justify-end">
          <button onClick={() => moderate(r.id, 'approved')} className="text-green-600 hover:text-green-800" title="Aprovar"><Check className="w-4 h-4" /></button>
          <button onClick={() => moderate(r.id, 'rejected')} className="text-red-500 hover:text-red-700" title="Reprovar"><X className="w-4 h-4" /></button>
        </div>
      )}
    />
  )
}
