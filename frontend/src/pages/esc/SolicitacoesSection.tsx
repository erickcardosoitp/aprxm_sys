import { useState } from 'react'
import toast from 'react-hot-toast'
import { Check, MessageCircleReply, X } from 'lucide-react'
import EscDataTable from './EscDataTable'
import { EscButton, EscField, EscModal, escInputCls, escInputStyle } from './EscFormKit'
import api from '../../services/api'

const STATUS_LABEL: Record<string, string> = { pending: 'Pendente', approved: 'Aberta' }

interface Post {
  id: string
  author_name: string
  title: string | null
  body: string
  status: string
  created_at: string
}

export default function SolicitacoesSection() {
  const [reloadKey, setReloadKey] = useState(0)
  const [replyTarget, setReplyTarget] = useState<Post | null>(null)
  const [reply, setReply] = useState('')
  const [markResolved, setMarkResolved] = useState(true)
  const [saving, setSaving] = useState(false)

  const moderate = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.patch(`/community/posts/${id}/moderate`, { status, reason: status === 'rejected' ? 'Reprovada pela administração' : undefined })
      toast.success(status === 'approved' ? 'Aprovada!' : 'Reprovada.')
      setReloadKey(k => k + 1)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao revisar.')
    }
  }

  const openReply = (r: Post) => { setReplyTarget(r); setReply(''); setMarkResolved(true) }

  const submitReply = async () => {
    if (!replyTarget) return
    if (!reply.trim()) { toast.error('Escreva a resposta.'); return }
    setSaving(true)
    try {
      await api.patch(`/community/posts/${replyTarget.id}/reply`, { reply: reply.trim(), mark_resolved: markResolved })
      toast.success(markResolved ? 'Respondida e concluída!' : 'Resposta enviada!')
      setReplyTarget(null)
      setReloadKey(k => k + 1)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao responder.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <EscDataTable
        fetchFn={() => api.get('/community/posts', { params: { category: 'solicitacao' } })}
        searchKeys={['author_name', 'title', 'body']}
        reloadKey={reloadKey}
        columns={[
          { key: 'author_name', label: 'Morador' },
          { key: 'title', label: 'Título', render: r => r.title || '—' },
          { key: 'body', label: 'Pedido', render: r => <span className="max-w-sm truncate inline-block align-bottom">{r.body}</span> },
          { key: 'status', label: 'Status', render: r => STATUS_LABEL[r.status] ?? r.status },
          { key: 'created_at', label: 'Data', render: r => new Date(r.created_at).toLocaleDateString('pt-BR') },
        ]}
        rowActions={(r: Post) => (
          <div className="flex gap-2 justify-end">
            {r.status === 'pending' && (
              <>
                <button onClick={() => moderate(r.id, 'approved')} className="text-green-600 hover:text-green-800" title="Aprovar"><Check className="w-4 h-4" /></button>
                <button onClick={() => moderate(r.id, 'rejected')} className="text-red-500 hover:text-red-700" title="Reprovar"><X className="w-4 h-4" /></button>
              </>
            )}
            {r.status === 'approved' && (
              <button onClick={() => openReply(r)} className="text-slate-500 hover:text-slate-800" title="Responder e concluir">
                <MessageCircleReply className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      />

      {replyTarget && (
        <EscModal
          title={`Responder solicitação — ${replyTarget.author_name}`}
          onClose={() => setReplyTarget(null)}
          footer={<>
            <EscButton variant="ghost" onClick={() => setReplyTarget(null)}>Cancelar</EscButton>
            <EscButton onClick={submitReply} disabled={saving}>{saving ? 'Enviando…' : 'Enviar resposta'}</EscButton>
          </>}
        >
          <p className="text-sm text-slate-600">{replyTarget.body}</p>
          <EscField label="Resposta">
            <textarea className={escInputCls} style={escInputStyle} rows={3} value={reply} onChange={(e) => setReply(e.target.value)}
              placeholder="Ex: já providenciamos o conserto, obrigado por avisar." />
          </EscField>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={markResolved} onChange={(e) => setMarkResolved(e.target.checked)} />
            Marcar como concluída (some do feed do morador)
          </label>
        </EscModal>
      )}
    </>
  )
}
