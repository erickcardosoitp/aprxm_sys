import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, ImagePlus, Pencil, Star, Trash2, X } from 'lucide-react'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'

interface Place {
  id: string; association_id: string; category: string; name: string
  description: string | null; phone: string | null; whatsapp: string | null; address: string | null
  image_urls: string[]; is_active: boolean; avg_rating: number | null; rating_count: number
  status: string; moderation_reason: string | null; owner_resident_name: string | null
}

const PLACE_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Aguardando aprovação', cls: 'bg-amber-50 text-amber-700' },
  rejected: { label: 'Reprovado', cls: 'bg-red-50 text-red-700' },
}

interface UpdateRequest {
  id: string; place_id: string; place_name: string; changes: Record<string, string>
  notes: string | null; status: string; created_at: string; resident_name: string
}

const CATEGORY_OPTIONS = [
  { value: 'lanchonete', label: 'Lanchonete' },
  { value: 'restaurante', label: 'Restaurante' },
  { value: 'mercado', label: 'Mercado' },
  { value: 'servico', label: 'Serviço' },
  { value: 'saude', label: 'Saúde' },
  { value: 'beleza', label: 'Beleza' },
  { value: 'educacao', label: 'Educação' },
  { value: 'outro', label: 'Outro' },
]

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORY_OPTIONS.map(c => [c.value, c.label]))

const CHANGE_FIELD_LABEL: Record<string, string> = {
  name: 'Nome', description: 'Descrição', phone: 'Telefone', whatsapp: 'WhatsApp', address: 'Endereço',
}

const inputCls = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]'

const emptyForm = { category: 'outro', name: '', description: '', phone: '', whatsapp: '', address: '', image_urls: [] as string[], is_active: true }

export default function DirectoryStaffPage() {
  const associationId = useAuthStore(s => s.associationId)
  const [tab, setTab] = useState<'places' | 'requests'>('places')
  const [places, setPlaces] = useState<Place[]>([])
  const [requests, setRequests] = useState<UpdateRequest[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadPlaces = () => {
    setLoading(true)
    api.get<Place[]>('/directory/places')
      .then(r => setPlaces(r.data))
      .catch(() => toast.error('Erro ao carregar lugares.'))
      .finally(() => setLoading(false))
  }

  const loadRequests = () => {
    setLoading(true)
    api.get<UpdateRequest[]>('/directory/update-requests', { params: { status: 'pending' } })
      .then(r => setRequests(r.data))
      .catch(() => toast.error('Erro ao carregar sugestões.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { tab === 'places' ? loadPlaces() : loadRequests() }, [tab])

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const startCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const startEdit = (p: Place) => {
    setEditingId(p.id)
    setForm({
      category: p.category, name: p.name, description: p.description ?? '', phone: p.phone ?? '',
      whatsapp: p.whatsapp ?? '', address: p.address ?? '', image_urls: p.image_urls, is_active: p.is_active,
    })
    setShowForm(true)
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'directory')
      const r = await api.post<{ url: string }>('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      set('image_urls', [...form.image_urls, r.data.url])
    } catch {
      toast.error('Erro ao enviar imagem.')
    } finally {
      setUploading(false)
    }
  }

  const submitForm = async () => {
    if (!form.name.trim()) { toast.error('Informe o nome.'); return }
    setSaving(true)
    try {
      if (editingId) {
        await api.patch(`/directory/places/${editingId}`, form)
        toast.success('Atualizado!')
      } else {
        await api.post('/directory/places', { ...form, association_id: associationId })
        toast.success('Cadastrado!')
      }
      setShowForm(false)
      loadPlaces()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  const deletePlace = async (id: string) => {
    if (!confirm('Excluir esse lugar definitivamente?')) return
    try {
      await api.delete(`/directory/places/${id}`)
      toast.success('Excluído.')
      loadPlaces()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao excluir.')
    }
  }

  const moderatePlace = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.patch(`/directory/places/${id}/moderate`, { status, reason: status === 'rejected' ? 'Não aprovado pela administração' : undefined })
      toast.success(status === 'approved' ? 'Aprovado!' : 'Reprovado.')
      loadPlaces()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao revisar.')
    }
  }

  const reviewRequest = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.patch(`/directory/update-requests/${id}`, { status })
      toast.success(status === 'approved' ? 'Aprovado!' : 'Reprovado.')
      loadRequests()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao revisar.')
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-800">Diretório da Comunidade</h1>
        {tab === 'places' && (
          <button
            onClick={() => showForm ? setShowForm(false) : startCreate()}
            className="px-4 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-xl text-sm font-semibold transition"
          >
            {showForm ? 'Cancelar' : '+ Novo lugar'}
          </button>
        )}
      </div>

      <div className="flex gap-2 bg-white rounded-xl shadow-sm p-1">
        <button onClick={() => setTab('places')} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${tab === 'places' ? 'bg-[#26619c] text-white' : 'text-gray-500'}`}>Lugares</button>
        <button onClick={() => setTab('requests')} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${tab === 'requests' ? 'bg-[#26619c] text-white' : 'text-gray-500'}`}>Sugestões pendentes</button>
      </div>

      {tab === 'places' && showForm && (
        <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-3 border border-gray-100">
          <div className="grid grid-cols-4 gap-2">
            {CATEGORY_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => set('category', o.value)}
                className={`py-2 rounded-lg text-xs font-semibold transition ${form.category === o.value ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-500'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} placeholder="Nome" />
          <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} className={`${inputCls} resize-none`} placeholder="Descrição (opcional)" />
          <div className="grid grid-cols-2 gap-3">
            <input value={form.phone} onChange={e => set('phone', e.target.value)} className={inputCls} placeholder="Telefone" />
            <input value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} className={inputCls} placeholder="WhatsApp" />
          </div>
          <input value={form.address} onChange={e => set('address', e.target.value)} className={inputCls} placeholder="Endereço" />

          {form.image_urls.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {form.image_urls.map((url, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
                  <img src={url} className="w-full h-full object-cover" />
                  <button onClick={() => set('image_urls', form.image_urls.filter((_, idx) => idx !== i))} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
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
              {editingId && (
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                  <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
                  Ativo
                </label>
              )}
            </div>
            <button onClick={submitForm} disabled={saving || uploading} className="px-4 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-lg text-xs font-semibold transition disabled:opacity-50">
              {saving ? 'Salvando…' : editingId ? 'Salvar' : 'Cadastrar'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-10">Carregando…</p>
      ) : tab === 'places' ? (
        places.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">Nenhum lugar cadastrado ainda.</p>
        ) : places.map(p => {
          const statusBadge = PLACE_STATUS_BADGE[p.status]
          return (
          <div key={p.id} className={`bg-white rounded-xl shadow-sm p-4 ${!p.is_active ? 'opacity-50' : ''} ${p.status === 'pending' ? 'ring-1 ring-amber-300' : ''}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-[#26619c]">{CATEGORY_LABEL[p.category] ?? p.category}</span>
                {statusBadge && <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge.cls}`}>{statusBadge.label}</span>}
              </div>
              <div className="flex gap-2">
                {p.status === 'pending' && (
                  <>
                    <button onClick={() => moderatePlace(p.id, 'approved')} className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100" title="Aprovar"><Check className="w-4 h-4" /></button>
                    <button onClick={() => moderatePlace(p.id, 'rejected')} className="p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100" title="Reprovar"><X className="w-4 h-4" /></button>
                  </>
                )}
                <button onClick={() => startEdit(p)} className="p-1.5 rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100" title="Editar"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => deletePlace(p.id)} className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100" title="Excluir"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <p className="text-sm font-semibold text-gray-800">{p.name}{!p.is_active && <span className="text-xs text-gray-400 font-normal"> (inativo)</span>}</p>
            {p.owner_resident_name && <p className="text-xs text-gray-400">Cadastrado por morador: {p.owner_resident_name}</p>}
            {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}
            <div className="flex items-center gap-1 mt-1.5">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span className="text-xs text-gray-600">{p.avg_rating != null ? `${p.avg_rating.toFixed(1)} (${p.rating_count})` : 'Sem avaliações'}</span>
            </div>
            <div className="flex gap-3 mt-1.5 text-xs text-gray-500">
              {p.phone && <span>{p.phone}</span>}
              {p.whatsapp && <span>WhatsApp: {p.whatsapp}</span>}
            </div>
            {p.address && <p className="text-xs text-gray-400 mt-0.5">{p.address}</p>}
          </div>
        )})
      ) : (
        requests.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">Nenhuma sugestão pendente.</p>
        ) : requests.map(r => (
          <div key={r.id} className="bg-white rounded-xl shadow-sm p-4">
            <p className="text-sm font-semibold text-gray-800">{r.place_name}</p>
            <p className="text-xs text-gray-400 mb-2">Sugerido por {r.resident_name} em {new Date(r.created_at).toLocaleDateString('pt-BR')}</p>
            <div className="bg-gray-50 rounded-lg p-3 flex flex-col gap-1">
              {Object.entries(r.changes).map(([k, v]) => (
                <p key={k} className="text-xs text-gray-700"><strong>{CHANGE_FIELD_LABEL[k] ?? k}:</strong> {v}</p>
              ))}
            </div>
            {r.notes && <p className="text-xs text-gray-500 mt-2 italic">"{r.notes}"</p>}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => reviewRequest(r.id, 'rejected')} className="px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg text-xs font-semibold transition flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> Reprovar
              </button>
              <button onClick={() => reviewRequest(r.id, 'approved')} className="px-3 py-1.5 bg-green-50 text-green-600 hover:bg-green-100 rounded-lg text-xs font-semibold transition flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Aprovar
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
