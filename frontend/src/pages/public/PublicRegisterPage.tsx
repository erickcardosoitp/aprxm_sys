import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import axios from 'axios'
import { formatCpf, formatPhone, formatCep } from '../../utils'

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://aprxm-backend.onrender.com/api/v1'

interface AssocInfo {
  id: string; name: string; slug: string
  address_city?: string; logo_url?: string; phone?: string; email?: string
}

const inputCls = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]'

export default function PublicRegisterPage() {
  const { slug } = useParams<{ slug: string }>()
  const [assoc, setAssoc] = useState<AssocInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    full_name: '', cpf: '', phone_primary: '', phone_secondary: '',
    email: '', date_of_birth: '', unit: '', block: '',
    address_cep: '', address_street: '', address_number: '',
    address_complement: '', address_city: '', address_state: '', notes: '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!slug) return
    axios.get(`${API_BASE}/public/associations/${slug}`)
      .then(r => setAssoc(r.data))
      .catch(() => setNotFound(true))
  }, [slug])

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { toast.error('Nome é obrigatório.'); return }
    if (!form.phone_primary.trim()) { toast.error('Telefone é obrigatório.'); return }
    setSaving(true)
    try {
      await axios.post(`${API_BASE}/public/associations/${slug}/residents`, {
        ...form,
        cpf: form.cpf ? form.cpf.replace(/\D/g, '') : null,
        phone_primary: form.phone_primary,
        date_of_birth: form.date_of_birth || null,
        unit: form.unit || null,
        block: form.block || null,
        address_cep: form.address_cep || null,
        address_street: form.address_street || null,
        address_number: form.address_number || null,
        address_complement: form.address_complement || null,
        address_city: form.address_city || null,
        address_state: form.address_state || null,
        notes: form.notes || null,
      })
      setSubmitted(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao enviar cadastro.')
    } finally {
      setSaving(false)
    }
  }

  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center">
        <p className="text-2xl font-bold text-gray-700 mb-2">Associação não encontrada</p>
        <p className="text-gray-500 text-sm">Verifique o link e tente novamente.</p>
      </div>
    </div>
  )

  if (!assoc) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-400 text-sm animate-pulse">Carregando…</p>
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Cadastro enviado!</h1>
        <p className="text-gray-500 text-sm">Seu cadastro foi recebido pela <strong>{assoc.name}</strong> e será analisado em breve.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          {assoc.logo_url && <img src={assoc.logo_url} alt="logo" className="h-16 mx-auto mb-3 object-contain" />}
          <h1 className="text-xl font-bold text-gray-900">{assoc.name}</h1>
          {assoc.address_city && <p className="text-sm text-gray-500">{assoc.address_city}</p>}
          <p className="mt-2 text-sm text-[#26619c] font-medium">Formulário de cadastro de associado</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-6 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome completo <span className="text-red-500">*</span></label>
            <input value={form.full_name} onChange={e => set('full_name', e.target.value)} className={inputCls} placeholder="Seu nome completo" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CPF</label>
              <input value={form.cpf} onChange={e => set('cpf', formatCpf(e.target.value))} className={inputCls} placeholder="000.000.000-00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Data de nascimento</label>
              <input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Telefone <span className="text-red-500">*</span></label>
            <input value={form.phone_primary} onChange={e => set('phone_primary', formatPhone(e.target.value))} className={inputCls} placeholder="(21) 99999-9999" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Telefone secundário</label>
            <input value={form.phone_secondary} onChange={e => set('phone_secondary', formatPhone(e.target.value))} className={inputCls} placeholder="(21) 99999-9999" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-mail</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} placeholder="email@exemplo.com" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Unidade</label>
              <input value={form.unit} onChange={e => set('unit', e.target.value)} className={inputCls} placeholder="Ex: 101" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bloco</label>
              <input value={form.block} onChange={e => set('block', e.target.value)} className={inputCls} placeholder="Ex: A" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">CEP</label>
            <input value={form.address_cep} onChange={e => set('address_cep', formatCep(e.target.value))} className={inputCls} placeholder="00000-000" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Logradouro</label>
            <input value={form.address_street} onChange={e => set('address_street', e.target.value)} className={inputCls} placeholder="Rua, Av…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Número</label>
              <input value={form.address_number} onChange={e => set('address_number', e.target.value)} className={inputCls} placeholder="123" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cidade</label>
              <input value={form.address_city} onChange={e => set('address_city', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Observações</label>
            <textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} className={`${inputCls} resize-none`} placeholder="Informações adicionais…" />
          </div>

          <button onClick={handleSubmit} disabled={saving}
            className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl text-sm font-semibold transition disabled:opacity-50 mt-2">
            {saving ? 'Enviando…' : 'Enviar cadastro'}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Seus dados serão tratados com sigilo conforme a LGPD.
        </p>
      </div>
    </div>
  )
}
