import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import axios from 'axios'
import { Camera, CheckCircle2, Upload, X } from 'lucide-react'
import { formatCpf, formatPhone, formatCep } from '../../utils'

// Always use relative URL — Vercel rewrite proxies /api/* to backend
const API = '/api/v1'

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
  const [cepLoading, setCepLoading] = useState(false)

  // proof upload
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofUrl, setProofUrl] = useState('')
  const [uploadingProof, setUploadingProof] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    full_name: '', cpf: '', phone_primary: '', phone_secondary: '',
    email: '', date_of_birth: '', unit: '', block: '',
    address_cep: '', address_street: '', address_number: '',
    address_complement: '', address_district: '', address_city: '',
    address_state: '', notes: '', registered_by: '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!slug) return
    axios.get(`${API}/public/associations/${slug}`)
      .then(r => setAssoc(r.data))
      .catch(() => setNotFound(true))
  }, [slug])

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
    } catch { /* silent */ } finally { setCepLoading(false) }
  }

  const uploadProof = async (file: File) => {
    if (!slug) return
    setProofFile(file)
    setUploadingProof(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'public/proofs')
      const r = await axios.post<{ url: string }>(`${API}/public/associations/${slug}/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setProofUrl(r.data.url)
      toast.success('Comprovante enviado!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao enviar comprovante.')
      setProofFile(null)
    } finally {
      setUploadingProof(false)
    }
  }

  const handleProofSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadProof(file)
  }

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { toast.error('Nome é obrigatório.'); return }
    if (!form.phone_primary.trim()) { toast.error('Telefone é obrigatório.'); return }
    if (!proofUrl) { toast.error('Comprovante de pagamento é obrigatório.'); return }
    setSaving(true)
    try {
      await axios.post(`${API}/public/associations/${slug}/residents`, {
        ...form,
        cpf: form.cpf ? form.cpf.replace(/\D/g, '') : null,
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
        registered_by: form.registered_by || null,
        proof_of_payment_url: proofUrl,
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
        <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
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

          {/* Dados pessoais */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome completo <span className="text-red-500">*</span></label>
            <input value={form.full_name} onChange={e => set('full_name', e.target.value)} className={inputCls} placeholder="Seu nome completo" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CPF (opcional)</label>
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

          {/* Endereço */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              CEP {cepLoading && <span className="text-gray-400 font-normal">buscando…</span>}
            </label>
            <input
              value={form.address_cep}
              onChange={e => {
                const v = formatCep(e.target.value)
                set('address_cep', v)
                lookupCep(v)
              }}
              className={inputCls} placeholder="00000-000"
            />
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
              <label className="block text-xs font-medium text-gray-600 mb-1">Complemento</label>
              <input value={form.address_complement} onChange={e => set('address_complement', e.target.value)} className={inputCls} placeholder="Apto, Bloco…" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bairro</label>
            <input value={form.address_district} onChange={e => set('address_district', e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cidade</label>
              <input value={form.address_city} onChange={e => set('address_city', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Estado</label>
              <input value={form.address_state} onChange={e => set('address_state', e.target.value)} className={inputCls} placeholder="RJ" maxLength={2} />
            </div>
          </div>

          {/* Lançado por */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lançado por</label>
            <input value={form.registered_by} onChange={e => set('registered_by', e.target.value)} className={inputCls} placeholder="Nome de quem está lançando o cadastro" />
          </div>

          {/* Comprovante de pagamento — obrigatório */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-blue-900 mb-1">
              Comprovante de pagamento <span className="text-red-500">*</span>
            </p>
            <p className="text-xs text-blue-700 mb-3">Envie uma foto ou PDF do comprovante de pagamento da mensalidade ou taxa de associação.</p>

            {proofUrl ? (
              <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                <span className="text-xs text-green-700 flex-1 truncate">{proofFile?.name ?? 'Comprovante enviado'}</span>
                <button type="button" onClick={() => { setProofUrl(''); setProofFile(null) }}
                  className="text-gray-400 hover:text-red-500 shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingProof}
                  className="flex-1 border-2 border-dashed border-blue-300 rounded-xl py-4 flex flex-col items-center gap-1.5 text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition disabled:opacity-50">
                  <Upload className="w-5 h-5" />
                  <span className="text-xs font-medium">{uploadingProof ? 'Enviando…' : 'Arquivo / PDF'}</span>
                </button>
                <button type="button" onClick={() => cameraInputRef.current?.click()}
                  disabled={uploadingProof}
                  className="flex-1 border-2 border-dashed border-blue-300 rounded-xl py-4 flex flex-col items-center gap-1.5 text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition disabled:opacity-50">
                  <Camera className="w-5 h-5" />
                  <span className="text-xs font-medium">Tirar foto</span>
                </button>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleProofSelect} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleProofSelect} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Observações</label>
            <textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} className={`${inputCls} resize-none`} placeholder="Informações adicionais…" />
          </div>

          <button onClick={handleSubmit} disabled={saving || uploadingProof}
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
