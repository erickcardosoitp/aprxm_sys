import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ImagePlus, Pencil, Trash2, X } from 'lucide-react'
import { residentApi } from './residentApi'

interface MyPlace {
  id: string; category: string; name: string; description: string | null
  phone: string | null; whatsapp: string | null; address: string | null
  image_urls: string[]; status: string; moderation_reason: string | null; is_active: boolean
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

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Em análise', cls: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Aprovado', cls: 'bg-green-50 text-green-700' },
  rejected: { label: 'Não aprovado', cls: 'bg-red-50 text-red-700' },
}

const inputCls = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]'
const emptyForm = { category: 'servico', name: '', description: '', phone: '', whatsapp: '', address: '', image_urls: [] as string[] }

export default function MyBusinessSection() {
  const [places, setPlaces] = useState<MyPlace[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = () => {
    residentApi.get<MyPlace[]>('/portal/directory/mine')
      .then(r => setPlaces(r.data))
      .catch(() => toast.error('Erro ao carregar seus cadastros.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const startCreate = () => { setEditingId(null); setForm(emptyForm); setShowForm(true) }

  const startEdit = (p: MyPlace) => {
    setEditingId(p.id)
    setForm({ category: p.category, name: p.name, description: p.description ?? '', phone: p.phone ?? '', whatsapp: p.whatsapp ?? '', address: p.address ?? '', image_urls: p.image_urls })
    setShowForm(true)
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (form.image_urls.length >= 4) { toast.error('Máximo de 4 imagens.'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await residentApi.post<{ url: string }>('/portal/directory/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
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
        await residentApi.patch(`/portal/directory/mine/${editingId}`, form)
        toast.success('Atualizado! Vai passar por revisão de novo.')
      } else {
        await residentApi.post('/portal/directory/mine', form)
        toast.success('Enviado! Vai aparecer no diretório assim que for aprovado.')
      }
      setShowForm(false)
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  const deletePlace = async (id: string) => {
    if (!confirm('Excluir esse cadastro?')) return
    try {
      await residentApi.delete(`/portal/directory/mine/${id}`)
      setPlaces(prev => prev.filter(p => p.id !== id))
      toast.success('Excluído.')
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao excluir.')
    }
  }

  if (loading) return <p className="text-xs text-gray-400 text-center py-4">Carregando…</p>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-600">Tenho uma lanchonete, comércio ou presto serviço</p>
        <button onClick={() => showForm ? setShowForm(false) : startCreate()} className="text-xs font-semibold text-[#26619c]">
          {showForm ? 'Cancelar' : '+ Cadastrar'}
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2 border border-gray-100">
          <div className="grid grid-cols-4 gap-1.5">
            {CATEGORY_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => set('category', o.value)}
                className={`py-1.5 rounded-lg text-[11px] font-semibold transition ${form.category === o.value ? 'bg-[#26619c] text-white' : 'bg-white text-gray-500'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} placeholder="Nome do negócio/serviço" />
          <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} className={`${inputCls} resize-none`} placeholder="Descrição (opcional)" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.phone} onChange={e => set('phone', e.target.value)} className={inputCls} placeholder="Telefone" />
            <input value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} className={inputCls} placeholder="WhatsApp" />
          </div>
          <input value={form.address} onChange={e => set('address', e.target.value)} className={inputCls} placeholder="Endereço (opcional)" />

          {form.image_urls.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {form.image_urls.map((url, i) => (
                <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-gray-200">
                  <img src={url} className="w-full h-full object-cover" />
                  <button onClick={() => set('image_urls', form.image_urls.filter((_, idx) => idx !== i))} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[#26619c] cursor-pointer">
              <ImagePlus className="w-3.5 h-3.5" />
              {uploading ? 'Enviando…' : 'Foto'}
              <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} disabled={uploading} />
            </label>
            <button onClick={submitForm} disabled={saving || uploading} className="px-3 py-1.5 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-lg text-xs font-semibold transition disabled:opacity-50">
              {saving ? 'Enviando…' : editingId ? 'Salvar' : 'Enviar pra aprovação'}
            </button>
          </div>
        </div>
      )}

      {places.map(p => {
        const badge = STATUS_BADGE[p.status]
        return (
          <div key={p.id} className="bg-gray-50 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-[#26619c]">{CATEGORY_LABEL[p.category] ?? p.category}</span>
                {badge && <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(p)} className="text-gray-300 hover:text-[#26619c]"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => deletePlace(p.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <p className="text-sm font-semibold text-gray-800 mt-1">{p.name}</p>
            {p.status === 'rejected' && p.moderation_reason && (
              <p className="text-xs text-red-600 mt-1">Motivo: {p.moderation_reason}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
