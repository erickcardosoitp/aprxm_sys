import { useState } from 'react'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import EscDataTable from './EscDataTable'
import api from '../../services/api'

const CATEGORY_LABEL: Record<string, string> = {
  anuncio: 'Anúncio', solicitacao: 'Solicitação', aviso: 'Aviso oficial', outro: 'Outro',
}

export default function PublicacoesPendentesSection() {
  const [reloadKey, setReloadKey] = useState(0)

  const moderate = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.patch(`/community/posts/${id}/moderate`, { status, reason: status === 'rejected' ? 'Reprovado pela administração' : undefined })
      toast.success(status === 'approved' ? 'Aprovado!' : 'Reprovado.')
      setReloadKey(k => k + 1)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao revisar.')
    }
  }

  return (
    <EscDataTable
      fetchFn={() => api.get('/community/posts', { params: { status: 'pending' } })}
      searchKeys={['author_name', 'title', 'body']}
      reloadKey={reloadKey}
      columns={[
        { key: 'category', label: 'Categoria', render: r => CATEGORY_LABEL[r.category] ?? r.category },
        { key: 'author_name', label: 'Morador' },
        { key: 'title', label: 'Título', render: r => r.title || '—' },
        { key: 'body', label: 'Texto', render: r => <span className="max-w-xs truncate inline-block align-bottom">{r.body}</span> },
        { key: 'created_at', label: 'Data', render: r => new Date(r.created_at).toLocaleDateString('pt-BR') },
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
