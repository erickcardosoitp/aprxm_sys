import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Coffee, GraduationCap, HeartPulse, Phone, Pencil, Scissors, ShoppingCart, Star, Store, UtensilsCrossed, Wrench, MessageCircle } from 'lucide-react'
import { residentApi } from './residentApi'

interface Place {
  id: string; category: string; name: string; description: string | null
  phone: string | null; whatsapp: string | null; address: string | null
  image_urls: string[]; avg_rating: number | null; rating_count: number; my_rating: number | null
}

const CATEGORIES = [
  { key: '', label: 'Todos', icon: Store },
  { key: 'lanchonete', label: 'Lanchonetes', icon: Coffee },
  { key: 'restaurante', label: 'Restaurantes', icon: UtensilsCrossed },
  { key: 'mercado', label: 'Mercados', icon: ShoppingCart },
  { key: 'servico', label: 'Serviços', icon: Wrench },
  { key: 'saude', label: 'Saúde', icon: HeartPulse },
  { key: 'beleza', label: 'Beleza', icon: Scissors },
  { key: 'educacao', label: 'Educação', icon: GraduationCap },
  { key: 'outro', label: 'Outros', icon: Store },
] as const

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]))

const inputCls = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]'

function StarRow({ value, onRate }: { value: number | null; onRate?: (n: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={!onRate}
          onClick={() => onRate?.(n)}
          className={onRate ? 'cursor-pointer' : 'cursor-default'}
        >
          <Star className={`w-4 h-4 ${value && n <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
        </button>
      ))}
    </div>
  )
}

export default function DirectoryTab() {
  const [places, setPlaces] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPhone, setEditPhone] = useState('')
  const [editWhatsapp, setEditWhatsapp] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    residentApi.get<Place[]>('/portal/directory/places')
      .then(r => setPlaces(r.data))
      .catch(() => toast.error('Erro ao carregar o diretório.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const rate = async (placeId: string, stars: number) => {
    setPlaces(prev => prev.map(p => p.id === placeId ? { ...p, my_rating: stars } : p))
    try {
      const r = await residentApi.post<{ avg_rating: number | null; rating_count: number }>(`/portal/directory/places/${placeId}/rate`, { stars })
      setPlaces(prev => prev.map(p => p.id === placeId ? { ...p, avg_rating: r.data.avg_rating, rating_count: r.data.rating_count } : p))
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao avaliar.')
      load()
    }
  }

  const startEdit = (p: Place) => {
    setEditingId(p.id)
    setEditPhone(p.phone ?? '')
    setEditWhatsapp(p.whatsapp ?? '')
    setEditAddress(p.address ?? '')
    setEditNotes('')
  }

  const submitUpdateRequest = async (p: Place) => {
    const changes: Record<string, string> = {}
    if (editPhone !== (p.phone ?? '')) changes.phone = editPhone
    if (editWhatsapp !== (p.whatsapp ?? '')) changes.whatsapp = editWhatsapp
    if (editAddress !== (p.address ?? '')) changes.address = editAddress
    if (Object.keys(changes).length === 0) { toast.error('Nada foi alterado.'); return }

    setSaving(true)
    try {
      await residentApi.post(`/portal/directory/places/${p.id}/update-request`, { changes, notes: editNotes.trim() || null })
      toast.success('Sugestão enviada! A administração vai revisar.')
      setEditingId(null)
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao enviar sugestão.')
    } finally {
      setSaving(false)
    }
  }

  const filtered = category ? places.filter(p => p.category === category) : places

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {CATEGORIES.map(c => {
          const Icon = c.icon
          return (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`flex flex-col items-center gap-1 py-3 rounded-xl text-xs font-medium transition ${category === c.key ? 'bg-[#26619c] text-white' : 'bg-white text-gray-600 shadow-sm'}`}
            >
              <Icon className="w-4 h-4" />
              {c.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-10">Carregando…</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-10">Nenhum lugar cadastrado ainda nessa categoria.</p>
      ) : filtered.map(p => (
        <div key={p.id} className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-[#26619c]">
              {CATEGORY_LABEL[p.category] ?? p.category}
            </span>
            <button onClick={() => startEdit(p)} className="text-gray-300 hover:text-[#26619c]" title="Sugerir atualização">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-sm font-semibold text-gray-800">{p.name}</p>
          {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}

          <div className="flex items-center gap-2 mt-1.5">
            <StarRow value={p.avg_rating ? Math.round(p.avg_rating) : null} />
            {p.avg_rating != null ? (
              <span className="text-xs text-gray-500">{p.avg_rating.toFixed(1)} ({p.rating_count})</span>
            ) : (
              <span className="text-xs text-gray-400">Sem avaliações</span>
            )}
          </div>

          {p.image_urls.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-2">
              {p.image_urls.map((url, i) => (
                <img key={i} src={url} className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-0.5 mt-2 text-xs text-gray-600">
            {p.phone && <a href={`tel:${p.phone}`} className="flex items-center gap-1.5 hover:text-[#26619c]"><Phone className="w-3.5 h-3.5" />{p.phone}</a>}
            {p.whatsapp && <a href={`https://wa.me/55${p.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-green-600"><MessageCircle className="w-3.5 h-3.5" />WhatsApp</a>}
            {p.address && <p className="text-gray-400">{p.address}</p>}
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-400">Sua avaliação:</span>
            <StarRow value={p.my_rating} onRate={n => rate(p.id, n)} />
          </div>

          {editingId === p.id && (
            <div className="mt-2 pt-2 border-t border-gray-100 flex flex-col gap-2">
              <p className="text-xs font-semibold text-gray-600">Sugerir atualização</p>
              <input value={editPhone} onChange={e => setEditPhone(e.target.value)} className={inputCls} placeholder="Telefone" />
              <input value={editWhatsapp} onChange={e => setEditWhatsapp(e.target.value)} className={inputCls} placeholder="WhatsApp" />
              <input value={editAddress} onChange={e => setEditAddress(e.target.value)} className={inputCls} placeholder="Endereço" />
              <textarea rows={2} value={editNotes} onChange={e => setEditNotes(e.target.value)} className={`${inputCls} resize-none`} placeholder="Observação (opcional)" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-xs font-medium text-gray-500">Cancelar</button>
                <button
                  onClick={() => submitUpdateRequest(p)}
                  disabled={saving}
                  className="px-3 py-1.5 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                >
                  {saving ? 'Enviando…' : 'Enviar sugestão'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
