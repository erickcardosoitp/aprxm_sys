import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Heart, ImagePlus, MessageCircle, Pencil, Send, Trash2, X } from 'lucide-react'
import { residentApi } from './residentApi'

interface Post {
  id: string; author_type: string; author_name: string; category: string
  title: string | null; body: string; image_urls: string[]; status: string
  moderation_reason: string | null; pinned: boolean; created_at: string
  is_mine: boolean; comment_count: number
  admin_reply: string | null; admin_reply_at: string | null
  like_count: number; liked_by_me: boolean
}

interface Comment {
  id: string; author_name: string; body: string; created_at: string
  like_count: number; liked_by_me: boolean; is_mine: boolean
}

const CATEGORY_LABEL: Record<string, string> = {
  anuncio: 'Anúncio', solicitacao: 'Solicitação', aviso: 'Aviso oficial', outro: 'Publicação',
}

const CATEGORY_OPTIONS = [
  { value: 'solicitacao', label: 'Solicitação' },
  { value: 'outro', label: 'Publicação' },
]

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Em análise', cls: 'bg-amber-50 text-amber-700' },
  rejected: { label: 'Não publicado', cls: 'bg-red-50 text-red-700' },
  approved: { label: '', cls: '' },
  resolved: { label: 'Concluída', cls: 'bg-green-50 text-green-700' },
  removed: { label: 'Removido pela administração', cls: 'bg-gray-100 text-gray-500' },
}

const SUB_TABS = [
  { key: 'feed', label: 'Feed' },
  { key: 'mine', label: 'Minhas publicações' },
] as const

const FEED_FILTER_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'anuncio', label: 'Anúncio' },
  { value: 'solicitacao', label: 'Solicitação' },
  { value: 'aviso', label: 'Avisos' },
  { value: 'outro', label: 'Publicações' },
]

const inputCls = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]'

export default function CommunityFeedTab() {
  const [subTab, setSubTab] = useState<typeof SUB_TABS[number]['key']>('feed')
  const [feedCategoryFilter, setFeedCategoryFilter] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [category, setCategory] = useState('solicitacao')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [images, setImages] = useState<{ file: File; url: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, Comment[]>>({})
  const [commentDraft, setCommentDraft] = useState('')
  const [loadingComments, setLoadingComments] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCategory, setEditCategory] = useState('solicitacao')
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editImages, setEditImages] = useState<string[]>([])
  const [editUploading, setEditUploading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const editFileInputRef = useRef<HTMLInputElement>(null)

  const loadFeed = () => {
    setLoading(true)
    const endpoint = subTab === 'mine' ? '/portal/feed/mine' : '/portal/feed'
    residentApi.get<Post[]>(endpoint)
      .then(r => setPosts(r.data))
      .catch(() => toast.error('Erro ao carregar o feed.'))
      .finally(() => setLoading(false))
  }

  useEffect(loadFeed, [subTab])

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (images.length >= 4) { toast.error('Máximo de 4 imagens por post.'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await residentApi.post<{ url: string }>('/portal/feed/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setImages(prev => [...prev, { file, url: r.data.url }])
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao enviar imagem.')
    } finally {
      setUploading(false)
    }
  }

  const resetForm = () => {
    setCategory('anuncio'); setTitle(''); setBody(''); setImages([]); setShowForm(false)
  }

  const handleSubmit = async () => {
    if (!body.trim()) { toast.error('Escreva algo antes de publicar.'); return }
    setSaving(true)
    try {
      const r = await residentApi.post('/portal/feed', {
        category, title: category === 'solicitacao' ? (title.trim() || null) : null, body: body.trim(),
        image_urls: images.map(i => i.url),
      })
      if (r.data.status === 'approved') toast.success('Publicado!')
      else if (r.data.status === 'rejected') toast.error(r.data.moderation_reason || 'Post não pôde ser publicado.')
      else toast.success('Enviado! Vai aparecer assim que for revisado.')
      resetForm()
      if (subTab === 'mine') loadFeed()
      else setSubTab('mine')
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao publicar.')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (p: Post) => {
    setEditingId(p.id)
    setEditCategory(['aviso', 'anuncio'].includes(p.category) ? 'outro' : p.category)
    setEditTitle(p.title ?? '')
    setEditBody(p.body)
    setEditImages(p.image_urls)
  }

  const handleEditImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (editImages.length >= 4) { toast.error('Máximo de 4 imagens por post.'); return }
    setEditUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await residentApi.post<{ url: string }>('/portal/feed/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setEditImages(prev => [...prev, r.data.url])
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao enviar imagem.')
    } finally {
      setEditUploading(false)
    }
  }

  const submitEdit = async (postId: string) => {
    if (!editBody.trim()) { toast.error('Escreva algo antes de salvar.'); return }
    setEditSaving(true)
    try {
      const r = await residentApi.patch(`/portal/feed/${postId}`, {
        category: editCategory, title: editCategory === 'solicitacao' ? (editTitle.trim() || null) : null, body: editBody.trim(), image_urls: editImages,
      })
      if (r.data.status === 'rejected') toast.error(r.data.moderation_reason || 'Post não pôde ser publicado.')
      else toast.success('Atualizado!')
      setEditingId(null)
      loadFeed()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setEditSaving(false)
    }
  }

  const deletePost = async (postId: string) => {
    if (!confirm('Excluir essa publicação? Não pode ser desfeito.')) return
    try {
      await residentApi.delete(`/portal/feed/${postId}`)
      setPosts(prev => prev.filter(p => p.id !== postId))
      toast.success('Excluído.')
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao excluir.')
    }
  }

  const toggleLike = async (postId: string) => {
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, liked_by_me: !p.liked_by_me, like_count: p.like_count + (p.liked_by_me ? -1 : 1) }
      : p))
    try {
      const r = await residentApi.post<{ liked: boolean; like_count: number }>(`/portal/feed/${postId}/like`)
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, liked_by_me: r.data.liked, like_count: r.data.like_count } : p))
    } catch (err: any) {
      setPosts(prev => prev.map(p => p.id === postId
        ? { ...p, liked_by_me: !p.liked_by_me, like_count: p.like_count + (p.liked_by_me ? -1 : 1) }
        : p))
      toast.error(err.response?.data?.detail ?? 'Erro ao curtir.')
    }
  }

  const toggleComments = async (postId: string) => {
    if (expanded === postId) { setExpanded(null); return }
    setExpanded(postId)
    if (!comments[postId]) {
      setLoadingComments(true)
      try {
        const r = await residentApi.get<Comment[]>(`/portal/feed/${postId}/comments`)
        setComments(prev => ({ ...prev, [postId]: r.data }))
      } catch {
        toast.error('Erro ao carregar comentários.')
      } finally {
        setLoadingComments(false)
      }
    }
  }

  const sendComment = async (postId: string) => {
    if (!commentDraft.trim()) return
    try {
      const r = await residentApi.post<Comment>(`/portal/feed/${postId}/comments`, { body: commentDraft.trim() })
      setComments(prev => ({ ...prev, [postId]: [...(prev[postId] ?? []), { ...r.data, like_count: 0, liked_by_me: false, is_mine: true }] }))
      setCommentDraft('')
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, comment_count: p.comment_count + 1 } : p))
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao comentar.')
    }
  }

  const toggleCommentLike = async (postId: string, commentId: string) => {
    setComments(prev => ({
      ...prev,
      [postId]: (prev[postId] ?? []).map(c => c.id === commentId
        ? { ...c, liked_by_me: !c.liked_by_me, like_count: c.like_count + (c.liked_by_me ? -1 : 1) }
        : c),
    }))
    try {
      const r = await residentApi.post<{ liked: boolean; like_count: number }>(`/portal/feed/comments/${commentId}/like`)
      setComments(prev => ({
        ...prev,
        [postId]: (prev[postId] ?? []).map(c => c.id === commentId ? { ...c, liked_by_me: r.data.liked, like_count: r.data.like_count } : c),
      }))
    } catch (err: any) {
      setComments(prev => ({
        ...prev,
        [postId]: (prev[postId] ?? []).map(c => c.id === commentId
          ? { ...c, liked_by_me: !c.liked_by_me, like_count: c.like_count + (c.liked_by_me ? -1 : 1) }
          : c),
      }))
      toast.error(err.response?.data?.detail ?? 'Erro ao curtir comentário.')
    }
  }

  const deleteComment = async (postId: string, commentId: string) => {
    if (!confirm('Excluir esse comentário?')) return
    try {
      await residentApi.delete(`/portal/feed/comments/${commentId}`)
      setComments(prev => ({ ...prev, [postId]: (prev[postId] ?? []).filter(c => c.id !== commentId) }))
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, comment_count: Math.max(0, p.comment_count - 1) } : p))
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao excluir comentário.')
    }
  }

  const filteredPosts = feedCategoryFilter ? posts.filter(p => p.category === feedCategoryFilter) : posts

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 bg-white rounded-xl shadow-sm p-1">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${subTab === t.key ? 'bg-[#26619c] text-white' : 'text-gray-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl text-sm font-semibold transition"
        >
          + Nova publicação
        </button>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-3">
          <div className="flex gap-2">
            {CATEGORY_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => setCategory(o.value)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${category === o.value ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-500'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {category === 'solicitacao' && (
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Título (opcional)" />
          )}
          <textarea rows={4} value={body} onChange={e => setBody(e.target.value)} className={`${inputCls} resize-none`} placeholder="O que você quer compartilhar com a comunidade?" />

          {images.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {images.map((img, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
                  <img src={img.url} className="w-full h-full object-cover" />
                  <button
                    onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || images.length >= 4}
              className="flex items-center gap-1.5 text-xs font-medium text-[#26619c] disabled:opacity-40"
            >
              <ImagePlus className="w-4 h-4" />
              {uploading ? 'Enviando…' : 'Adicionar foto'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />

            <div className="flex gap-2">
              <button onClick={resetForm} className="px-3 py-2 text-xs font-medium text-gray-500">Cancelar</button>
              <button
                onClick={handleSubmit}
                disabled={saving || uploading}
                className="px-4 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
              >
                {saving ? 'Publicando…' : 'Publicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {FEED_FILTER_OPTIONS.map(o => (
          <button
            key={o.value}
            onClick={() => setFeedCategoryFilter(o.value)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition ${feedCategoryFilter === o.value ? 'bg-[#26619c] text-white' : 'bg-white text-gray-500 shadow-sm'}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-10">Carregando…</p>
      ) : filteredPosts.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-10">
          {posts.length === 0
            ? (subTab === 'mine' ? 'Você ainda não publicou nada.' : 'Nenhuma publicação ainda. Seja o primeiro!')
            : 'Nenhuma publicação nessa categoria.'}
        </p>
      ) : filteredPosts.map(p => {
        const badge = STATUS_BADGE[p.status]
        return (
          <div key={p.id} className={`bg-white rounded-xl shadow-sm p-4 ${p.pinned ? 'ring-1 ring-[#26619c]/30' : ''}`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.category === 'aviso' ? 'bg-[#26619c] text-white' : 'bg-blue-50 text-[#26619c]'}`}>
                  {CATEGORY_LABEL[p.category] ?? p.category}
                </span>
                {p.is_mine && badge?.label && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{new Date(p.created_at).toLocaleDateString('pt-BR')}</span>
                {p.is_mine && editingId !== p.id && (
                  <>
                    <button onClick={() => startEdit(p)} className="text-gray-300 hover:text-[#26619c]" title="Editar">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deletePost(p.id)} className="text-gray-300 hover:text-red-500" title="Excluir">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {editingId === p.id ? (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  {CATEGORY_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      onClick={() => setEditCategory(o.value)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${editCategory === o.value ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {editCategory === 'solicitacao' && (
                  <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className={inputCls} placeholder="Título (opcional)" />
                )}
                <textarea rows={4} value={editBody} onChange={e => setEditBody(e.target.value)} className={`${inputCls} resize-none`} />

                {editImages.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {editImages.map((url, i) => (
                      <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
                        <img src={url} className="w-full h-full object-cover" />
                        <button onClick={() => setEditImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                          <X className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => editFileInputRef.current?.click()}
                    disabled={editUploading || editImages.length >= 4}
                    className="flex items-center gap-1.5 text-xs font-medium text-[#26619c] disabled:opacity-40"
                  >
                    <ImagePlus className="w-4 h-4" />
                    {editUploading ? 'Enviando…' : 'Adicionar foto'}
                  </button>
                  <input ref={editFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditImageSelect} />

                  <div className="flex gap-2">
                    <button onClick={() => setEditingId(null)} className="px-3 py-2 text-xs font-medium text-gray-500">Cancelar</button>
                    <button
                      onClick={() => submitEdit(p.id)}
                      disabled={editSaving || editUploading}
                      className="px-4 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                    >
                      {editSaving ? 'Salvando…' : 'Salvar'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {p.title && <p className="text-sm font-semibold text-gray-800 mb-1">{p.title}</p>}
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.body}</p>

                {p.image_urls.length > 0 && (
                  <div className="flex gap-2 flex-wrap mt-2">
                    {p.image_urls.map((url, i) => (
                      <img key={i} src={url} className="w-20 h-20 rounded-lg object-cover border border-gray-200" />
                    ))}
                  </div>
                )}

                {p.is_mine && p.status === 'rejected' && p.moderation_reason && (
                  <p className="text-xs text-red-600 mt-2">Motivo: {p.moderation_reason}</p>
                )}

                {p.admin_reply && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mt-2">
                    <p className="text-xs font-semibold text-[#26619c]">Resposta da Administração</p>
                    <p className="text-xs text-gray-700 mt-0.5 whitespace-pre-wrap">{p.admin_reply}</p>
                  </div>
                )}

                <p className="text-xs text-gray-400 mt-2">— {p.author_name}</p>
              </>
            )}

            {editingId !== p.id && p.status === 'approved' && (
              <>
                <div className="flex items-center gap-4 mt-2">
                  <button
                    onClick={() => toggleLike(p.id)}
                    className={`flex items-center gap-1.5 text-xs transition ${p.liked_by_me ? 'text-red-500' : 'text-gray-500 hover:text-red-500'}`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${p.liked_by_me ? 'fill-red-500' : ''}`} />
                    {p.like_count > 0 ? p.like_count : 'Curtir'}
                  </button>
                  <button
                    onClick={() => toggleComments(p.id)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#26619c]"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    {p.comment_count > 0 ? `${p.comment_count} comentário(s)` : 'Comentar'}
                  </button>
                </div>

                {expanded === p.id && (
                  <div className="mt-2 pt-2 border-t border-gray-100 flex flex-col gap-2">
                    {loadingComments ? (
                      <p className="text-xs text-gray-400">Carregando…</p>
                    ) : (comments[p.id] ?? []).map(c => (
                      <div key={c.id} className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-semibold text-gray-700">{c.author_name}</p>
                          {c.is_mine && (
                            <button onClick={() => deleteComment(p.id, c.id)} className="text-gray-300 hover:text-red-500 shrink-0">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-gray-600">{c.body}</p>
                        <button
                          onClick={() => toggleCommentLike(p.id, c.id)}
                          className={`flex items-center gap-1 text-[11px] mt-1 transition ${c.liked_by_me ? 'text-red-500' : 'text-gray-400 hover:text-red-500'}`}
                        >
                          <Heart className={`w-3 h-3 ${c.liked_by_me ? 'fill-red-500' : ''}`} />
                          {c.like_count > 0 ? c.like_count : 'Curtir'}
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        value={commentDraft}
                        onChange={e => setCommentDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') sendComment(p.id) }}
                        className={inputCls}
                        placeholder="Escreva um comentário…"
                      />
                      <button onClick={() => sendComment(p.id)} className="px-3 bg-[#26619c] rounded-xl text-white">
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
