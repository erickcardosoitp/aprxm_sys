import { useEffect, useRef, useState } from 'react'
import { Users, Plus, X, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import type { Resident, ResidentStatus, ResidentType } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ResidentType, string> = { member: 'Associado', guest: 'Visitante' }

type ResidentTab = 'associados' | 'dependentes' | 'visitantes'
const TAB_LABELS: Record<ResidentTab, string> = { associados: 'Associados', dependentes: 'Dependentes', visitantes: 'Visitantes' }
const STATUS_COLORS: Record<ResidentStatus, string> = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-500',
  suspended: 'bg-red-100 text-red-600',
}
const STATUS_LABELS: Record<ResidentStatus, string> = {
  active: 'Ativo', inactive: 'Inativo', suspended: 'Suspenso',
}

const RACE_OPTIONS = ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não declarar']
const EDU_OPTIONS = ['Sem escolaridade', 'Fundamental incompleto', 'Fundamental completo', 'Médio incompleto', 'Médio completo', 'Superior incompleto', 'Superior completo', 'Pós-graduação']
const ACCESS_OPTIONS = ['Ônibus', 'Metrô', 'Van', 'Bicicleta', 'A pé', 'Moto', 'Carro próprio']
const PROFILE_OPTIONS = ['Criança (0-12)', 'Adolescente (13-17)', 'Adulto (18-59)', 'Idoso (60+)', 'PCD', 'Gestante']
const INTERNET_OPTIONS = ['Banda larga', 'Dados móveis', 'Wi-Fi compartilhado', 'Sem acesso']
const NEIGHBORHOOD_OPTIONS = ['Violência', 'Tráfico', 'Falta de iluminação', 'Falta de saneamento', 'Enchentes', 'Falta de transporte', 'Abandono de imóveis']
const LOCATION_OPTIONS = ['Centro', 'Periferia', 'Rural', 'Outro']
const OWNERSHIP_OPTIONS = ['Próprio', 'Alugado', 'Cedido', 'Invasão', 'Outro']

// ─── Empty form state ──────────────────────────────────────────────────────────

const EMPTY_FORM = {
  // Sec 1
  type: 'member' as ResidentType,
  full_name: '',
  cpf: '',
  rg: '',
  date_of_birth: '',
  race: '',
  education_level: '',
  phone_primary: '',
  phone_secondary: '',
  email: '',
  // Sec 2
  address_cep: '',
  address_street: '',
  address_number: '',
  address_complement: '',
  address_city: '',
  address_state: '',
  unit: '',
  block: '',
  parking_spot: '',
  address_location: '',
  address_access: [] as string[],
  uses_public_transport: null as boolean | null,
  transport_distance: '',
  // Sec 3
  address_rooms: '',
  household_count: '',
  household_profiles: [] as string[],
  internet_access: '',
  has_sewage: null as boolean | null,
  neighborhood_problems: [] as string[],
  main_priority_request: '',
  // Sec 4
  ownership_type: '',
  move_in_date: '',
  monthly_payment_day: '',
  wants_to_join: null as boolean | null,
  is_member_confirmed: false,
  terms_accepted: false,
  lgpd_accepted: false,
  notes: '',
}

type FormState = typeof EMPTY_FORM

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Input({ label, value, onChange, type = 'text', placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
      />
    </div>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c] bg-white"
      >
        <option value="">— selecione —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function MultiCheck({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void
}) {
  const toggle = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt])
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-2">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button key={opt} type="button" onClick={() => toggle(opt)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
              selected.includes(opt)
                ? 'bg-[#26619c] text-white border-[#26619c]'
                : 'border-gray-300 text-gray-600 hover:border-[#26619c]'
            }`}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

function YesNo({ label, value, onChange }: {
  label: string; value: boolean | null; onChange: (v: boolean | null) => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="flex gap-2">
        {([true, false] as const).map((v) => (
          <button key={String(v)} type="button"
            onClick={() => onChange(value === v ? null : v)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium border transition ${
              value === v ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600'
            }`}>
            {v ? 'Sim' : 'Não'}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── ResidentForm ──────────────────────────────────────────────────────────────

const SECTION_TITLES = ['Identificação', 'Endereço & Moradia', 'Perfil Domiciliar', 'Vínculo & Legal']

function ResidentForm({ initial, onSave, onCancel }: {
  initial?: Partial<FormState>
  onSave: (data: FormState) => Promise<void>
  onCancel: () => void
}) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, ...initial })
  const [saving, setSaving] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const firstNameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { firstNameRef.current?.focus() }, [])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const lookupCep = async () => {
    const cep = form.address_cep.replace(/\D/g, '')
    if (cep.length !== 8) return
    setCepLoading(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      const data = await res.json()
      if (data.erro) { toast.error('CEP não encontrado.'); return }
      setForm((f) => ({
        ...f,
        address_street: data.logradouro || f.address_street,
        address_complement: data.complemento || f.address_complement,
        address_city: data.localidade || f.address_city,
        address_state: data.uf || f.address_state,
      }))
    } catch {
      toast.error('Erro ao consultar CEP.')
    } finally {
      setCepLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { toast.error('Nome é obrigatório.'); setStep(0); return }
    if (!form.lgpd_accepted) { toast.error('Aceite o termo LGPD para continuar.'); return }
    setSaving(true)
    try {
      await onSave(form)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto pt-4 pb-8">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{initial ? 'Editar Morador' : 'Novo Morador'}</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-gray-100">
          {SECTION_TITLES.map((title, i) => (
            <button key={i} onClick={() => setStep(i)}
              className={`flex-1 py-2.5 text-xs font-medium transition border-b-2 ${
                step === i ? 'text-[#26619c] border-[#26619c]' :
                i < step ? 'text-green-600 border-green-400' : 'text-gray-400 border-transparent'
              }`}>
              {i + 1}. {title.split(' ')[0]}
            </button>
          ))}
        </div>

        {/* Section content */}
        <div className="px-6 py-5 flex flex-col gap-4">

          {/* ── SECTION 1: Identificação ── */}
          {step === 0 && (
            <>
              <div className="flex gap-2">
                {(['member', 'guest'] as ResidentType[]).map((t) => (
                  <button key={t} type="button" onClick={() => set('type', t)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                      form.type === t ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600'
                    }`}>
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome completo <span className="text-red-500">*</span></label>
                <input ref={firstNameRef as any} value={form.full_name}
                  onChange={(e) => set('full_name', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  placeholder="Nome completo" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="CPF" value={form.cpf} onChange={(v) => set('cpf', v)} placeholder="000.000.000-00" />
                <Input label="RG" value={form.rg} onChange={(v) => set('rg', v)} placeholder="00.000.000-0" />
              </div>
              <Input label="Data de nascimento" value={form.date_of_birth} onChange={(v) => set('date_of_birth', v)} type="date" />
              <div className="grid grid-cols-2 gap-3">
                <Select label="Raça/Cor" value={form.race} onChange={(v) => set('race', v)} options={RACE_OPTIONS} />
                <Select label="Escolaridade" value={form.education_level} onChange={(v) => set('education_level', v)} options={EDU_OPTIONS} />
              </div>
              <Input label="Telefone principal" value={form.phone_primary} onChange={(v) => set('phone_primary', v)} placeholder="(21) 99999-9999" />
              <Input label="Telefone secundário" value={form.phone_secondary} onChange={(v) => set('phone_secondary', v)} placeholder="(21) 99999-9999" />
              <Input label="E-mail" value={form.email} onChange={(v) => set('email', v)} type="email" placeholder="email@exemplo.com" />
            </>
          )}

          {/* ── SECTION 2: Endereço & Moradia ── */}
          {step === 1 && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">CEP</label>
                <div className="flex gap-2">
                  <input value={form.address_cep}
                    onChange={(e) => set('address_cep', e.target.value)}
                    onBlur={lookupCep}
                    placeholder="00000-000"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                  <button type="button" onClick={lookupCep} disabled={cepLoading}
                    className="px-3 py-2 bg-[#26619c] text-white rounded-lg text-sm hover:bg-[#1a4f87] disabled:opacity-50">
                    {cepLoading ? '…' : <Search className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Input label="Logradouro" value={form.address_street} onChange={(v) => set('address_street', v)} placeholder="Rua, Av…" />
              <div className="grid grid-cols-3 gap-2">
                <Input label="Número" value={form.address_number} onChange={(v) => set('address_number', v)} placeholder="123" />
                <div className="col-span-2">
                  <Input label="Complemento" value={form.address_complement} onChange={(v) => set('address_complement', v)} placeholder="Apto, casa…" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Input label="Cidade" value={form.address_city} onChange={(v) => set('address_city', v)} />
                </div>
                <Input label="UF" value={form.address_state} onChange={(v) => set('address_state', v.toUpperCase().slice(0, 2))} placeholder="RJ" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input label="Unidade" value={form.unit} onChange={(v) => set('unit', v)} placeholder="201" />
                <Input label="Bloco" value={form.block} onChange={(v) => set('block', v)} placeholder="A" />
                <Input label="Vaga" value={form.parking_spot} onChange={(v) => set('parking_spot', v)} placeholder="12" />
              </div>
              <Select label="Localização da moradia" value={form.address_location} onChange={(v) => set('address_location', v)} options={LOCATION_OPTIONS} />
              <MultiCheck label="Meios de acesso ao bairro" options={ACCESS_OPTIONS} selected={form.address_access} onChange={(v) => set('address_access', v)} />
              <YesNo label="Usa transporte público?" value={form.uses_public_transport} onChange={(v) => set('uses_public_transport', v)} />
              {form.uses_public_transport && (
                <Input label="Distância até o ponto" value={form.transport_distance} onChange={(v) => set('transport_distance', v)} placeholder="Ex: 500m, 1km" />
              )}
            </>
          )}

          {/* ── SECTION 3: Perfil Domiciliar ── */}
          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Nº de cômodos" value={form.address_rooms} onChange={(v) => set('address_rooms', v)} type="number" placeholder="3" />
                <Input label="Nº de pessoas" value={form.household_count} onChange={(v) => set('household_count', v)} type="number" placeholder="4" />
              </div>
              <MultiCheck label="Perfis no domicílio" options={PROFILE_OPTIONS} selected={form.household_profiles} onChange={(v) => set('household_profiles', v)} />
              <Select label="Acesso à internet" value={form.internet_access} onChange={(v) => set('internet_access', v)} options={INTERNET_OPTIONS} />
              <YesNo label="Tem rede de esgoto?" value={form.has_sewage} onChange={(v) => set('has_sewage', v)} />
              <MultiCheck label="Problemas no bairro" options={NEIGHBORHOOD_OPTIONS} selected={form.neighborhood_problems} onChange={(v) => set('neighborhood_problems', v)} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Principal demanda / prioridade</label>
                <textarea value={form.main_priority_request} onChange={(e) => set('main_priority_request', e.target.value)}
                  rows={2} placeholder="Descreva a principal necessidade do morador…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c] resize-none" />
              </div>
            </>
          )}

          {/* ── SECTION 4: Vínculo & Legal ── */}
          {step === 3 && (
            <>
              <Select label="Tipo de posse do imóvel" value={form.ownership_type} onChange={(v) => set('ownership_type', v)} options={OWNERSHIP_OPTIONS} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Data de entrada" value={form.move_in_date} onChange={(v) => set('move_in_date', v)} type="date" />
                <Input label="Dia de pagamento" value={form.monthly_payment_day} onChange={(v) => set('monthly_payment_day', v)} type="number" placeholder="1-31" />
              </div>
              <YesNo label="Deseja ingressar na associação?" value={form.wants_to_join} onChange={(v) => set('wants_to_join', v)} />
              <div className="flex items-center gap-3">
                <input type="checkbox" id="confirmed" checked={form.is_member_confirmed}
                  onChange={(e) => set('is_member_confirmed', e.target.checked)}
                  className="w-4 h-4 accent-[#26619c]" />
                <label htmlFor="confirmed" className="text-sm text-gray-700">Associado confirmado / adimplente</label>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Observações</label>
                <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
                  rows={3} placeholder="Observações adicionais…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c] resize-none" />
              </div>
              <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-3 border border-gray-200">
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Termos & Privacidade</p>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.terms_accepted}
                    onChange={(e) => set('terms_accepted', e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#26619c]" />
                  <span className="text-sm text-gray-600">Aceito os termos de uso e regulamento da associação</span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.lgpd_accepted}
                    onChange={(e) => set('lgpd_accepted', e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#26619c]" />
                  <span className="text-sm text-gray-600">Autorizo o uso dos meus dados conforme a LGPD (Lei 13.709/2018) <span className="text-red-500">*</span></span>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 gap-3">
          <button onClick={step === 0 ? onCancel : () => setStep(step - 1)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ChevronLeft className="w-4 h-4" />
            {step === 0 ? 'Cancelar' : 'Anterior'}
          </button>
          {step < 3 ? (
            <button onClick={() => setStep(step + 1)}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-5 py-2 rounded-xl text-sm font-semibold transition">
              Próximo <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving}
              className="bg-[#26619c] hover:bg-[#1a4f87] text-white px-6 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
              {saving ? 'Salvando…' : 'Salvar Morador'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ResidentsPage() {
  const [residents, setResidents] = useState<Resident[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<Resident | null>(null)
  const [activeTab, setActiveTab] = useState<ResidentTab>('associados')
  const [filterStatus, setFilterStatus] = useState<ResidentStatus | ''>('')
  const [search, setSearch] = useState('')

  const load = async () => {
    try {
      const params: Record<string, string> = {}
      // For associados and dependentes, fetch members; for visitantes, fetch guests
      if (activeTab === 'visitantes') params.type = 'guest'
      else params.type = 'member'
      if (search.trim()) params.q = search.trim()
      if (filterStatus) params.status = filterStatus
      const res = await api.get<Resident[]>('/residents', { params })
      setResidents(res.data)
    } catch {
      toast.error('Erro ao carregar moradores.')
    }
  }

  useEffect(() => { load() }, [activeTab, filterStatus, search])

  // Client-side split: associados = members without responsible_id, dependentes = members with responsible_id
  const displayedResidents = residents.filter(r => {
    if (activeTab === 'associados') return r.type === 'member' && !r.responsible_id
    if (activeTab === 'dependentes') return r.type === 'member' && !!r.responsible_id
    return true // visitantes already filtered by type=guest in API call
  })

  const handleSave = async (form: FormState) => {
    const payload: Record<string, any> = {
      ...form,
      address_rooms: form.address_rooms ? parseInt(form.address_rooms) : null,
      household_count: form.household_count ? parseInt(form.household_count) : null,
      monthly_payment_day: form.monthly_payment_day ? parseInt(form.monthly_payment_day) : null,
      date_of_birth: form.date_of_birth || null,
      move_in_date: form.move_in_date || null,
      cpf: form.cpf || null,
      rg: form.rg || null,
    }
    try {
      if (editTarget) {
        await api.put(`/residents/${editTarget.id}`, payload)
        toast.success('Morador atualizado!')
      } else {
        await api.post('/residents', payload)
        toast.success('Morador cadastrado!')
      }
      setShowForm(false)
      setEditTarget(null)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
      throw e
    }
  }

  const toggleStatus = async (r: Resident) => {
    const next: ResidentStatus = r.status === 'active' ? 'suspended' : 'active'
    try {
      await api.patch(`/residents/${r.id}/status`, null, { params: { status: next } })
      toast.success('Status atualizado.')
      load()
    } catch {
      toast.error('Erro ao atualizar status.')
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="w-6 h-6 text-[#26619c]" />
          Moradores
        </h1>
        <button onClick={() => { setEditTarget(null); setShowForm(true) }}
          className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-4 py-2 rounded-xl text-sm font-medium transition">
          <Plus className="w-4 h-4" />
          Novo
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['associados', 'dependentes', 'visitantes'] as ResidentTab[]).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition -mb-px ${
              activeTab === t ? 'border-[#26619c] text-[#26619c]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, CPF ou CEP…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]" />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(['', 'active', 'inactive', 'suspended'] as const).map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${
                filterStatus === s ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {s === '' ? 'Todos' : STATUS_LABELS[s as ResidentStatus]}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {displayedResidents.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhum {TAB_LABELS[activeTab].toLowerCase().replace('s','')} encontrado.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {displayedResidents.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-[#e8f0fb] flex items-center justify-center text-[#26619c] font-bold text-sm shrink-0">
                    {r.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{r.full_name}</p>
                    <p className="text-xs text-gray-400">
                      {r.responsible_id ? 'Dependente' : TYPE_LABELS[r.type]}
                      {r.unit ? ` · Unid. ${r.unit}` : ''}
                      {r.block ? ` / Bl. ${r.block}` : ''}
                      {r.cpf ? ` · ${r.cpf}` : ''}
                    </p>
                    {r.address_cep && (
                      <p className="text-xs text-gray-400">CEP {r.address_cep}{r.phone_primary ? ` · ${r.phone_primary}` : ''}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditTarget(r); setShowForm(true) }}
                      className="text-xs text-[#26619c] hover:underline">
                      Editar
                    </button>
                    <button onClick={() => toggleStatus(r)} className="text-xs text-gray-400 hover:text-gray-600">
                      {r.status === 'active' ? 'Suspender' : 'Reativar'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <ResidentForm
          initial={editTarget ? {
            type: editTarget.type,
            full_name: editTarget.full_name,
            cpf: editTarget.cpf ?? '',
            rg: editTarget.rg ?? '',
            date_of_birth: editTarget.date_of_birth ?? '',
            race: editTarget.race ?? '',
            education_level: editTarget.education_level ?? '',
            phone_primary: editTarget.phone_primary ?? '',
            phone_secondary: editTarget.phone_secondary ?? '',
            email: editTarget.email ?? '',
            address_cep: editTarget.address_cep ?? '',
            address_street: editTarget.address_street ?? '',
            address_number: editTarget.address_number ?? '',
            address_complement: editTarget.address_complement ?? '',
            address_city: editTarget.address_city ?? '',
            address_state: editTarget.address_state ?? '',
            unit: editTarget.unit ?? '',
            block: editTarget.block ?? '',
            parking_spot: editTarget.parking_spot ?? '',
            address_location: editTarget.address_location ?? '',
            address_access: editTarget.address_access ?? [],
            uses_public_transport: editTarget.uses_public_transport ?? null,
            transport_distance: editTarget.transport_distance ?? '',
            address_rooms: editTarget.address_rooms?.toString() ?? '',
            household_count: editTarget.household_count?.toString() ?? '',
            household_profiles: editTarget.household_profiles ?? [],
            internet_access: editTarget.internet_access ?? '',
            has_sewage: editTarget.has_sewage ?? null,
            neighborhood_problems: editTarget.neighborhood_problems ?? [],
            main_priority_request: editTarget.main_priority_request ?? '',
            ownership_type: editTarget.ownership_type ?? '',
            move_in_date: editTarget.move_in_date ?? '',
            monthly_payment_day: editTarget.monthly_payment_day?.toString() ?? '',
            wants_to_join: editTarget.wants_to_join ?? null,
            is_member_confirmed: editTarget.is_member_confirmed,
            terms_accepted: editTarget.terms_accepted,
            lgpd_accepted: editTarget.lgpd_accepted,
            notes: editTarget.notes ?? '',
          } : undefined}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditTarget(null) }}
        />
      )}
    </div>
  )
}
