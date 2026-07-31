import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, ImagePlus, MessageCircle, Pin, Reply, Trash2, X } from 'lucide-react'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'

interface Post {
  id: string; association_id: string; author_type: string; author_name: string
  category: string; title: string | null; body: string; image_urls: string[]
  status: string; moderation_reason: string | null; moderated_by_ai: boolean
  pinned: boolean; created_at: string; comment_count: number
  admin_reply: string | null; admin_reply_at: string | null; author_resident_id: string | null
}

interface Comment {
  id: string; author_name: string; body: string; created_at: string
}

const CATEGORY_LABEL: Record<string, string> = {
  anuncio: 'Anúncio', solicitacao: 'Solicitação', aviso: 'Aviso oficial', outro: 'Publicação',
}

const BROADCAST_CATEGORY_OPTIONS = [
  { value: 'aviso', label: 'Aviso oficial' },
  { value: 'anuncio', label: 'Anúncio' },
]

const STATUS_TABS = [
  { key: 'pending', label: 'Pendentes' },
  { key: 'approved', label: 'Aprovados' },
  { key: 'rejected', label: 'Reprovados' },
  { key: 'resolved', label: 'Concluídos' },
  { key: '', label: 'Todos' },
] as const

const inputCls = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]'

export default function CommunityModerationPage() {
  const associationId = useAuthStore(s => s.associationId)
  const [status, setStatus] = useState<string>('pending')
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [broadcastCategory, setBroadcastCategory] = useState('aviso')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, Comment[]>>({})

  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyResolve, setReplyResolve] = useState(true)
  const [replying, setReplying] = useState(false)

  const [showPurge, setShowPurge] = useState(false)
  const [purgeDays, setPurgeDays] = useState(30)
  const [purging, setPurging] = useState(false)

  const loadPosts = () => {
    setLoading(true)
    api.get<Post[]>('/community/posts', { params: status ? { status } : {} })
      .then(r => setPosts(r.data))
      .catch(() => toast.error('Erro ao carregar posts.'))
      .finally(() => setLoading(false))
  }

  useEffect(loadPosts, [status])

  const moderate = async (id: string, newStatus: string, reason?: string) => {
    try {
      await api.patch(`/community/posts/${id}/moderate`, { status: newStatus, reason })
      toast.success('Atualizado.')
      loadPosts()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao atualizar.')
    }
  }

  const toggleComments = async (postId: string) => {
    if (expanded === postId) { setExpanded(null); return }
    setExpanded(postId)
    if (!comments[postId]) {
      try {
        const r = await api.get<Comment[]>(`/community/posts/${postId}/comments`)
        setComments(prev => ({ ...prev, [postId]: r.data }))
      } catch { toast.error('Erro ao carregar comentários.') }
    }
  }

  const deleteComment = async (postId: string, commentId: string) => {
    try {
      await api.delete(`/community/comments/${commentId}`)
      setComments(prev => ({ ...prev, [postId]: (prev[postId] ?? []).filter(c => c.id !== commentId) }))
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao remover comentário.')
    }
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !associationId) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'feed')
      const r = await api.post<{ url: string }>('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setImages(prev => [...prev, r.data.url])
    } catch {
      toast.error('Erro ao enviar imagem.')
    } finally {
      setUploading(false)
    }
  }

  const startReply = (p: Post) => {
    setReplyingTo(p.id)
    setReplyDraft(p.admin_reply ?? '')
    setReplyResolve(p.category === 'solicitacao')
  }

  const submitReply = async (postId: string) => {
    if (!replyDraft.trim()) { toast.error('Escreva a resposta.'); return }
    setReplying(true)
    try {
      await api.patch(`/community/posts/${postId}/reply`, { reply: replyDraft.trim(), mark_resolved: replyResolve })
      toast.success(replyResolve ? 'Respondido e concluído!' : 'Resposta enviada!')
      setReplyingTo(null); setReplyDraft('')
      loadPosts()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao responder.')
    } finally {
      setReplying(false)
    }
  }

  const hardDelete = async (postId: string) => {
    if (!confirm('Excluir esse post definitivamente? Não pode ser desfeito.')) return
    try {
      await api.delete(`/community/posts/${postId}`)
      toast.success('Excluído.')
      loadPosts()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao excluir.')
    }
  }

  const purgeOld = async () => {
    setPurging(true)
    try {
      const r = await api.post<{ deleted: number }>('/community/posts/purge', {
        older_than_days: purgeDays, statuses: ['removed', 'resolved'],
      })
      toast.success(`${r.data.deleted} post(s) removido(s) definitivamente.`)
      setShowPurge(false)
      loadPosts()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao limpar.')
    } finally {
      setPurging(false)
    }
  }

  const submitAviso = async () => {
    if (!associationId) return
    if (!body.trim()) { toast.error('Escreva o texto.'); return }
    setSaving(true)
    try {
      await api.post('/community/posts', {
        association_id: associationId, category: broadcastCategory, title: title.trim() || null, body: body.trim(), image_urls: images, pinned,
      })
      toast.success('Publicado! Todos os moradores foram notificados.')
      setTitle(''); setBody(''); setImages([]); setPinned(false); setBroadcastCategory('aviso'); setShowForm(false)
      loadPosts()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao publicar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-800">Comunidade</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPurge(v => !v)}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm font-semibold transition"
          >
            Limpar antigos
          </button>
          <button
            onClick={() => setShowForm(v => !v)}
            className="px-4 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-xl text-sm font-semibold transition"
          >
            {showForm ? 'Cancelar' : '+ Anúncio / Aviso'}
          </button>
        </div>
      </div>

      {showPurge && (
        <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 flex items-center gap-3">
          <p className="text-xs text-gray-600 flex-1">
            Exclui definitivamente posts <strong>concluídos ou removidos</strong> com mais de
          </p>
          <input
            type="number" min={1} value={purgeDays}
            onChange={e => setPurgeDays(Number(e.target.value))}
            className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center"
          />
          <p className="text-xs text-gray-600">dias.</p>
          <button
            onClick={purgeOld}
            disabled={purging}
            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
          >
            {purging ? 'Limpando…' : 'Confirmar'}
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-3 border border-gray-100">
          <div className="flex gap-2">
            {BROADCAST_CATEGORY_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => setBroadcastCategory(o.value)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${broadcastCategory === o.value ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-500'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-amber-600 -mt-1">Ao publicar, todos os moradores da associação recebem uma notificação.</p>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Título (opcional)" />
          <textarea rows={4} value={body} onChange={e => setBody(e.target.value)} className={`${inputCls} resize-none`} placeholder="Texto do anúncio/aviso…" />
          {images.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {images.map((url, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
                  <img src={url} className="w-full h-full object-cover" />
                  <button onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#26619c] cursor-pointer">
                <ImagePlus className="w-4 h-4" />
                {uploading ? 'Enviando…' : 'Foto'}
                <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} disabled={uploading} />
              </label>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />
                Fixar no topo
              </label>
            </div>
            <button onClick={submitAviso} disabled={saving || uploading} className="px-4 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-lg text-xs font-semibold transition disabled:opacity-50">
              {saving ? 'Publicando…' : 'Publicar e notificar todos'}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 bg-white rounded-xl shadow-sm p-1">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${status === t.key ? 'bg-[#26619c] text-white' : 'text-gray-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-10">Carregando…</p>
      ) : posts.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-10">Nenhum post encontrado.</p>
      ) : posts.map(p => (
        <div key={p.id} className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.category === 'aviso' ? 'bg-[#26619c] text-white' : 'bg-blue-50 text-[#26619c]'}`}>
                {CATEGORY_LABEL[p.category] ?? p.category}
              </span>
              {p.pinned && <Pin className="w-3.5 h-3.5 text-[#26619c]" />}
              {p.moderated_by_ai && <span className="text-xs text-gray-400">moderado por IA</span>}
            </div>
            <span className="text-xs text-gray-400">{new Date(p.created_at).toLocaleString('pt-BR')}</span>
          </div>

          {p.title && <p className="text-sm font-semibold text-gray-800 mb-1">{p.title}</p>}
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.body}</p>

          {p.image_urls.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-2">
              {p.image_urls.map((url, i) => <img key={i} src={url} className="w-20 h-20 rounded-lg object-cover border border-gray-200" />)}
            </div>
          )}

          {p.moderation_reason && <p className="text-xs text-gray-500 mt-2">Motivo: {p.moderation_reason}</p>}

          {p.admin_reply && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mt-2">
              <p className="text-xs font-semibold text-[#26619c]">Resposta enviada</p>
              <p className="text-xs text-gray-700 mt-0.5 whitespace-pre-wrap">{p.admin_reply}</p>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-1">— {p.author_name}</p>

          <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
            <button onClick={() => toggleComments(p.id)} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#26619c]">
              <MessageCircle className="w-3.5 h-3.5" />
              {p.comment_count > 0 ? `${p.comment_count} comentário(s)` : 'Sem comentários'}
            </button>
            <div className="flex gap-2">
              {p.author_resident_id && (
                <button onClick={() => startReply(p)} className="p-1.5 rounded-lg bg-blue-50 text-[#26619c] hover:bg-blue-100" title="Responder">
                  <Reply className="w-4 h-4" />
                </button>
              )}
              {p.status !== 'approved' && (
                <button onClick={() => moderate(p.id, 'approved')} className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100" title="Aprovar">
                  <Check className="w-4 h-4" />
                </button>
              )}
              {p.status !== 'rejected' && (
                <button onClick={() => moderate(p.id, 'rejected', 'Reprovado pela administração')} className="p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100" title="Reprovar">
                  <X className="w-4 h-4" />
                </button>
              )}
              {p.status !== 'removed' && (
                <button onClick={() => moderate(p.id, 'removed', 'Removido pela administração')} className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100" title="Remover">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              {(p.status === 'removed' || p.status === 'resolved') && (
                <button onClick={() => hardDelete(p.id)} className="p-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200" title="Excluir definitivamente">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {replyingTo === p.id && (
            <div className="mt-2 pt-2 border-t border-gray-100 flex flex-col gap-2">
              <textarea
                rows={2} value={replyDraft} onChange={e => setReplyDraft(e.target.value)}
                className={`${inputCls} resize-none`} placeholder="Escreva a resposta ao morador…"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                  <input type="checkbox" checked={replyResolve} onChange={e => setReplyResolve(e.target.checked)} />
                  Marcar como concluída (some do feed)
                </label>
                <div className="flex gap-2">
                  <button onClick={() => setReplyingTo(null)} className="px-3 py-1.5 text-xs font-medium text-gray-500">Cancelar</button>
                  <button
                    onClick={() => submitReply(p.id)}
                    disabled={replying}
                    className="px-3 py-1.5 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                  >
                    {replying ? 'Enviando…' : 'Enviar resposta'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {expanded === p.id && (
            <div className="mt-2 pt-2 border-t border-gray-100 flex flex-col gap-2">
              {(comments[p.id] ?? []).length === 0 ? (
                <p className="text-xs text-gray-400">Sem comentários.</p>
              ) : (comments[p.id] ?? []).map(c => (
                <div key={c.id} className="bg-gray-50 rounded-lg px-3 py-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-gray-700">{c.author_name}</p>
                    <p className="text-xs text-gray-600">{c.body}</p>
                  </div>
                  <button onClick={() => deleteComment(p.id, c.id)} className="text-gray-300 hover:text-red-500 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
