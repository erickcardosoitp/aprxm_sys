import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import axios from 'axios'
import { Search, CheckCircle2 } from 'lucide-react'
import { formatCpf, formatPhone, formatCep } from '../../utils'

const API = '/api/v1'

interface AssocInfo { id: string; name: string; slug: string; logo_url?: string }
interface FoundResident { id: string; full_name: string; cpf?: string; phone_primary?: string }

const inputCls = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export default function PublicUpdatePage() {
  const { slug } = useParams<{ slug: string }>()
  const [assoc, setAssoc] = useState<AssocInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  // Step 1: search resident
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FoundResident[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<FoundResident | null>(null)

  // Step 2: update form
  const [form, setForm] = useState({
    full_name: '', phone_primary: '', phone_secondary: '', email: '',
    date_of_birth: '', cpf: '',
    address_cep: '', address_street: '', address_number: '',
    address_complement: '', address_district: '', address_city: '', address_state: '',
  })
  const [notes, setNotes] = useState('')
  const [cepLoading, setCepLoading] = useState(false)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!slug) return
    axios.get(`${API}/public/associations/${slug}`)
      .then(r => setAssoc(r.data))
      .catch(() => setNotFound(true))
  }, [slug])

  const searchResidents = async () => {
    if (!searchQuery.trim() || searchQuery.length < 2) return
    setSearching(true)
    try {
      const r = await axios.get<FoundResident[]>(`${API}/public/associations/${slug}/residents/search`, { params: { q: searchQuery } })
      setSearchResults(r.data)
      if (r.data.length === 0) toast.error('Nenhum morador encontrado.')
    } catch { toast.error('Erro ao buscar.') }
    finally { setSearching(false) }
  }

  const selectResident = (r: FoundResident) => {
    setSelected(r)
    setSearchResults([])
    setForm(f => ({
      ...f,
      full_name: r.full_name,
      phone_primary: r.phone_primary ? formatPhone(r.phone_primary) : '',
      cpf: r.cpf ? formatCpf(r.cpf) : '',
    }))
  }

  const lookupCep = async (cep: string) => {
    const clean = cep.replace(/\D/g, '')
    if (clean.length !== 8) return
    setCepLoading(true)
    try {
      const r = await axios.get(`https://viacep.com.br/ws/${clean}/json/`)
      if (!r.data.erro) {
        setForm(f => ({
          ...f,
          address_street: r.data.logradouro || f.address_street,
          address_district: r.data.bairro || f.address_district,
          address_city: r.data.localidade || f.address_city,
          address_state: r.data.uf || f.address_state,
        }))
      }
    } catch { } finally { setCepLoading(false) }
  }

  const handleSubmit = async () => {
    if (!selected) return
    // Build changes: only fields with actual values
    const changes: Record<string, string> = {}
    for (const [k, v] of Object.entries(form)) {
      if (v && v.trim()) {
        changes[k] = k === 'cpf' ? v.replace(/\D/g, '')
          : k === 'phone_primary' || k === 'phone_secondary' ? v.replace(/\D/g, '')
          : v.trim()
      }
    }
    if (Object.keys(changes).length === 0) { toast.error('Preencha ao menos um campo.'); return }
    setSaving(true)
    try {
      await axios.post(`${API}/public/associations/${slug}/residents/${selected.id}/update-request`, {
        changes,
        notes: notes || null,
      })
      setSubmitted(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao enviar.')
    } finally { setSaving(false) }
  }

  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center text-gray-500">Associação não encontrada.</div>
    </div>
  )

  if (!assoc) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-[#26619c] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center flex flex-col items-center gap-3">
        <CheckCircle2 className="w-14 h-14 text-green-500" />
        <h2 className="text-xl font-bold text-gray-800">Solicitação enviada!</h2>
        <p className="text-sm text-gray-500">Suas alterações serão analisadas pela equipe da associação.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="text-center flex flex-col items-center gap-3">
          {assoc.logo_url && <img src={assoc.logo_url} alt="Logo" className="w-16 h-16 object-contain rounded-xl" />}
          <div>
            <h1 className="text-xl font-bold text-gray-900">{assoc.name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">Atualização de Cadastro</p>
          </div>
        </div>

        {/* Step 1: find resident */}
        {!selected ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-gray-800">Busque seu cadastro</h2>
            <p className="text-xs text-gray-500">Digite seu nome, CPF ou telefone para encontrar seu cadastro.</p>
            <div className="flex gap-2">
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchResidents()}
                placeholder="Nome, CPF ou telefone…"
                className={inputCls} />
              <button onClick={searchResidents} disabled={searching}
                className="px-4 py-2.5 bg-[#26619c] text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
                <Search className="w-4 h-4" />{searching ? '…' : 'Buscar'}
              </button>
            </div>
            {searchResults.length > 0 && (
              <ul className="flex flex-col gap-2">
                {searchResults.map(r => (
                  <button key={r.id} type="button" onClick={() => selectResident(r)}
                    className="text-left p-3 rounded-xl border border-gray-200 hover:border-[#26619c] hover:bg-blue-50 transition">
                    <p className="text-sm font-medium text-gray-800">{r.full_name}</p>
                    <p className="text-xs text-gray-400">{r.cpf ? formatCpf(r.cpf) : ''}</p>
                  </button>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Atualizando cadastro de</p>
                <p className="text-sm font-semibold text-gray-800">{selected.full_name}</p>
              </div>
              <button onClick={() => { setSelected(null); setSearchQuery(''); setForm({ full_name: '', phone_primary: '', phone_secondary: '', email: '', date_of_birth: '', cpf: '', address_cep: '', address_street: '', address_number: '', address_complement: '', address_district: '', address_city: '', address_state: '' }) }}
                className="text-xs text-gray-400 hover:text-gray-600 underline">Trocar</button>
            </div>

            <p className="text-xs text-gray-500 bg-blue-50 rounded-lg px-3 py-2">
              Preencha apenas os campos que deseja atualizar. Campos em branco serão ignorados.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Nome completo</label>
                <input value={form.full_name} onChange={e => set('full_name', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>CPF</label>
                <input value={form.cpf} onChange={e => set('cpf', formatCpf(e.target.value))} className={inputCls} placeholder="000.000.000-00" />
              </div>
              <div>
                <label className={labelCls}>Data de nascimento</label>
                <input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Telefone principal</label>
                <input value={form.phone_primary} onChange={e => set('phone_primary', formatPhone(e.target.value))} className={inputCls} placeholder="(00) 00000-0000" />
              </div>
              <div>
                <label className={labelCls}>Telefone secundário</label>
                <input value={form.phone_secondary} onChange={e => set('phone_secondary', formatPhone(e.target.value))} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>E-mail</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>CEP</label>
                <input value={form.address_cep} onChange={e => { const v = formatCep(e.target.value); set('address_cep', v); lookupCep(v) }}
                  className={inputCls} placeholder="00000-000" />
                {cepLoading && <p className="text-xs text-gray-400 mt-0.5">Buscando CEP…</p>}
              </div>
              <div>
                <label className={labelCls}>Número</label>
                <input value={form.address_number} onChange={e => set('address_number', e.target.value)} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Rua / Logradouro</label>
                <input value={form.address_street} onChange={e => set('address_street', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Bairro</label>
                <input value={form.address_district} onChange={e => set('address_district', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Cidade</label>
                <input value={form.address_city} onChange={e => set('address_city', e.target.value)} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Observação (opcional)</label>
                <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                  className={`${inputCls} resize-none`} placeholder="Ex: mudei de endereço, atualize meu telefone…" />
              </div>
            </div>

            <button onClick={handleSubmit} disabled={saving}
              className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl font-semibold text-sm transition disabled:opacity-50">
              {saving ? 'Enviando…' : 'Enviar solicitação de atualização'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
