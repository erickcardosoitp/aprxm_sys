import { useEffect, useRef, useState } from 'react'
import { Users, Plus, X, ChevronLeft, ChevronRight, Search, UserPlus, FileText, AlertCircle, Printer, Merge } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import type { Resident, ResidentStatus, ResidentType } from '../../types'
import { printCarne as printCarneUtil } from '../../utils/printCarne'
import { maskCpf, formatCpf, formatPhone, formatCep, formatDateInput, parseDateInput } from '../../utils'
import { useAuthStore } from '../../store/authStore'

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ResidentType, string> = { member: 'Associado', dependent: 'Dependente', guest: 'Visitante' }

type ResidentTab = 'associados' | 'dependentes' | 'visitantes' | 'atualizacoes'
const TAB_LABELS: Record<ResidentTab, string> = { associados: 'Associados', dependentes: 'Dependentes', visitantes: 'Visitantes', atualizacoes: 'Atualizações' }
const STATUS_COLORS: Record<ResidentStatus, string> = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-500',
  suspended: 'bg-red-100 text-red-600',
}
const STATUS_LABELS: Record<ResidentStatus, string> = {
  active: 'Ativo', inactive: 'Inativo', suspended: 'Suspenso',
}

function safeDate(s: string | null | undefined): string {
  if (!s) return '—'
  const str = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s
  const d = new Date(str)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

function calcCompletion(r: Resident): number {
  const checks = [
    !!r.cpf, !!r.phone_primary, !!r.phone_secondary, !!r.email, !!r.date_of_birth,
    !!r.race, !!r.education_level, !!r.unit, !!r.block, !!r.address_cep,
    !!r.address_street, !!r.address_number, (r.household_count ?? 0) > 0,
    (r.address_rooms ?? 0) > 0, !!r.internet_access, r.has_sewage != null,
    (r.neighborhood_problems?.length ?? 0) > 0, !!r.main_priority_request,
    r.terms_accepted, r.lgpd_accepted,
  ]
  return Math.round(checks.filter(Boolean).length * 5)
}

function CompletionBadge({ pct }: { pct: number }) {
  const cfg =
    pct <= 20 ? { color: 'text-red-600', bg: 'bg-red-50', label: 'Crítico' } :
    pct <= 59 ? { color: 'text-amber-600', bg: 'bg-amber-50', label: 'A melhorar' } :
    pct <= 79 ? { color: 'text-blue-600', bg: 'bg-blue-50', label: 'Regular' } :
                { color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Excelente' }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-lg ${cfg.bg} ${cfg.color}`}>
      {pct}%
    </span>
  )
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
  address_neighborhood: '',
  address_city: '',
  address_state: '',
  address_country: 'Brasil',
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
  has_pests: null as boolean | null,
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
  responsible_id: '',
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
  const [responsibleSearch, setResponsibleSearch] = useState('')
  const [responsibleResults, setResponsibleResults] = useState<Resident[]>([])
  const [responsibleName, setResponsibleName] = useState('')
  const responsibleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { firstNameRef.current?.focus() }, [])

  useEffect(() => {
    if (initial?.responsible_id && initial.type === 'dependent') {
      api.get<Resident>(`/residents/${initial.responsible_id}`).then(r => setResponsibleName(r.data.full_name)).catch(() => {})
    }
  }, [])

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
        address_neighborhood: data.bairro || f.address_neighborhood,
        address_city: data.localidade || f.address_city,
        address_state: data.uf || f.address_state,
        address_country: f.address_country || 'Brasil',
      }))
    } catch {
      toast.error('Erro ao consultar CEP.')
    } finally {
      setCepLoading(false)
    }
  }

  const isGuest = form.type === 'guest'

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { toast.error('Nome é obrigatório.'); setStep(0); return }
    if (!isGuest && !form.lgpd_accepted) { toast.error('Aceite o termo LGPD para continuar.'); return }
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

        {/* Step indicator (member only) */}
        {!isGuest && <div className="flex border-b border-gray-100">
          {SECTION_TITLES.map((title, i) => (
            <button key={i} onClick={() => setStep(i)}
              className={`flex-1 py-2.5 text-xs font-medium transition border-b-2 ${
                step === i ? 'text-[#26619c] border-[#26619c]' :
                i < step ? 'text-green-600 border-green-400' : 'text-gray-400 border-transparent'
              }`}>
              {i + 1}. {title.split(' ')[0]}
            </button>
          ))}
        </div>}

        {/* Section content */}
        <div className="px-6 py-5 flex flex-col gap-4">

          {/* ── GUEST: simplified form ── */}
          {isGuest && (
            <>
              <div className="flex gap-2">
                {(['member', 'dependent', 'guest'] as ResidentType[]).map((t) => (
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
                  onChange={(e) => set('full_name', e.target.value.replace(/(^\s*\S|\s\S)/g, c => c.toUpperCase()))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  placeholder="Nome completo" />
              </div>
              <Input label="Telefone (opcional)" value={form.phone_primary} onChange={(v) => set('phone_primary', v)} placeholder="(21) 99999-9999" />
              <Input label="CPF (opcional)" value={form.cpf} onChange={(v) => set('cpf', formatCpf(v))} placeholder="000.000.000-00" />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">CEP</label>
                <div className="flex gap-2">
                  <input value={form.address_cep}
                    onChange={(e) => set('address_cep', formatCep(e.target.value))}
                    onBlur={lookupCep}
                    placeholder="00000-000"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                  <button type="button" onClick={lookupCep} disabled={cepLoading}
                    className="px-3 py-2 bg-[#26619c] text-white rounded-lg text-sm hover:bg-[#1a4f87] disabled:opacity-50">
                    {cepLoading ? '…' : <Search className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input label="Número" value={form.address_number} onChange={(v) => set('address_number', v)} placeholder="123" />
                <div className="col-span-2">
                  <Input label="Complemento" value={form.address_complement} onChange={(v) => set('address_complement', v)} placeholder="Apto, casa…" />
                </div>
              </div>
              <Input label="Bairro" value={form.address_neighborhood} onChange={(v) => set('address_neighborhood', v)} placeholder="Bairro" />
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Input label="Cidade" value={form.address_city} onChange={(v) => set('address_city', v)} />
                </div>
                <Input label="Estado" value={form.address_state} onChange={(v) => set('address_state', v.toUpperCase().slice(0, 2))} placeholder="RJ" />
              </div>
              <Input label="País" value={form.address_country} onChange={(v) => set('address_country', v)} placeholder="Brasil" />
            </>
          )}

          {/* ── SECTION 1: Identificação ── */}
          {!isGuest && step === 0 && (
            <>
              <div className="flex gap-2">
                {(['member', 'dependent', 'guest'] as ResidentType[]).map((t) => (
                  <button key={t} type="button" onClick={() => set('type', t)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                      form.type === t ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600'
                    }`}>
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              {form.type === 'dependent' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Responsável (membro) <span className="text-red-500">*</span></label>
                  {form.responsible_id && responsibleName ? (
                    <div className="flex items-center gap-2 border border-green-300 bg-green-50 rounded-lg px-3 py-2 text-sm">
                      <span className="flex-1 font-medium text-green-800">{responsibleName}</span>
                      <button type="button" onClick={() => { set('responsible_id', ''); setResponsibleName(''); setResponsibleSearch('') }} className="text-green-600 hover:text-red-500 text-xs">✕</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        value={responsibleSearch}
                        onChange={e => {
                          const v = e.target.value
                          setResponsibleSearch(v)
                          if (responsibleTimer.current) clearTimeout(responsibleTimer.current)
                          responsibleTimer.current = setTimeout(() => {
                            if (v.length >= 3) api.get<Resident[]>(`/residents/search?q=${encodeURIComponent(v)}&type=member`).then(r => setResponsibleResults(r.data.slice(0, 6))).catch(() => setResponsibleResults([]))
                            else setResponsibleResults([])
                          }, 300)
                        }}
                        placeholder="Buscar associado por nome…"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                      />
                      {responsibleResults.length > 0 && (
                        <div className="absolute z-50 left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto max-h-40">
                          {responsibleResults.map(r => (
                            <button key={r.id} type="button"
                              onClick={() => { set('responsible_id', r.id); setResponsibleName(r.full_name); setResponsibleSearch(''); setResponsibleResults([]) }}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 flex flex-col border-b last:border-0 border-gray-100 text-sm">
                              <span className="font-medium">{r.full_name}</span>
                              {r.unit && <span className="text-xs text-gray-400">Unid. {r.unit}{r.block ? ` · Bl. ${r.block}` : ''}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome completo <span className="text-red-500">*</span></label>
                <input ref={firstNameRef as any} value={form.full_name}
                  onChange={(e) => set('full_name', e.target.value.replace(/(^\s*\S|\s\S)/g, c => c.toUpperCase()))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  placeholder="Nome completo" />
              </div>
              <Input label="CPF" value={form.cpf} onChange={(v) => set('cpf', formatCpf(v))} placeholder="000.000.000-00" />
              <Input label="Data de nascimento" value={form.date_of_birth} onChange={(v) => set('date_of_birth', formatDateInput(v))} placeholder="DD/MM/AAAA" />
              <div className="grid grid-cols-2 gap-3">
                <Select label="Raça/Cor" value={form.race} onChange={(v) => set('race', v)} options={RACE_OPTIONS} />
                <Select label="Escolaridade" value={form.education_level} onChange={(v) => set('education_level', v)} options={EDU_OPTIONS} />
              </div>
              <Input label="Telefone principal" value={form.phone_primary} onChange={(v) => set('phone_primary', formatPhone(v))} placeholder="(21) 99999-9999" />
              <Input label="Telefone secundário" value={form.phone_secondary} onChange={(v) => set('phone_secondary', formatPhone(v))} placeholder="(21) 99999-9999" />
              <Input label="E-mail" value={form.email} onChange={(v) => set('email', v)} type="email" placeholder="email@exemplo.com" />
            </>
          )}

          {/* ── SECTION 2: Endereço & Moradia ── */}
          {!isGuest && step === 1 && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">CEP</label>
                <div className="flex gap-2">
                  <input value={form.address_cep}
                    onChange={(e) => set('address_cep', formatCep(e.target.value))}
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
              <MultiCheck label="Formas de Locomoção para chegar em casa" options={ACCESS_OPTIONS} selected={form.address_access} onChange={(v) => set('address_access', v)} />
              <YesNo label="Usa transporte público?" value={form.uses_public_transport} onChange={(v) => set('uses_public_transport', v)} />
              {form.uses_public_transport && (
                <Input label="Distância até o ponto" value={form.transport_distance} onChange={(v) => set('transport_distance', v)} placeholder="Ex: 500m, 1km" />
              )}
            </>
          )}

          {/* ── SECTION 3: Perfil Domiciliar ── */}
          {!isGuest && step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Nº de cômodos" value={form.address_rooms} onChange={(v) => set('address_rooms', v)} type="number" placeholder="3" />
                <Input label="Nº de pessoas" value={form.household_count} onChange={(v) => set('household_count', v)} type="number" placeholder="4" />
              </div>
              <MultiCheck label="Perfis no domicílio" options={PROFILE_OPTIONS} selected={form.household_profiles} onChange={(v) => set('household_profiles', v)} />
              <Select label="Acesso à internet" value={form.internet_access} onChange={(v) => set('internet_access', v)} options={INTERNET_OPTIONS} />
              <YesNo label="Tem rede de esgoto?" value={form.has_sewage} onChange={(v) => set('has_sewage', v)} />
              <YesNo label="Sua residência conta com a presença constante de roedores/insetos?" value={form.has_pests} onChange={(v) => set('has_pests', v)} />
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
          {!isGuest && step === 3 && (
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
          {isGuest ? (
            <button onClick={handleSubmit} disabled={saving}
              className="bg-[#26619c] hover:bg-[#1a4f87] text-white px-6 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
              {saving ? 'Salvando…' : 'Salvar Visitante'}
            </button>
          ) : step < 3 ? (
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

// ─── Dependent Form ───────────────────────────────────────────────────────────

interface DepFormState {
  full_name: string
  cpf: string
  date_of_birth: string
  phone_primary: string
  email: string
  address_cep: string
  address_number: string
  address_complement: string
  responsible_id: string
}
const EMPTY_DEP: DepFormState = {
  full_name: '', cpf: '', date_of_birth: '', phone_primary: '',
  email: '', address_cep: '', address_number: '', address_complement: '', responsible_id: '',
}

function DependentForm({ onSave, onCancel }: {
  onSave: (data: DepFormState) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<DepFormState>(EMPTY_DEP)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Resident[]>([])
  const [responsible, setResponsible] = useState<Resident | null>(null)

  const set = <K extends keyof DepFormState>(k: K, v: DepFormState[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const searchResponsible = async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents', { params: { q, type: 'member' } })
      setResults(res.data.filter(r => !r.responsible_id).slice(0, 6))
    } catch { /* silent */ }
  }

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { toast.error('Nome é obrigatório.'); return }
    if (!form.responsible_id) { toast.error('Selecione o associado responsável.'); return }
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto pt-4 pb-8 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-[#26619c]" /> Novo Dependente
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          {/* Responsible selector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Associado responsável <span className="text-red-500">*</span></label>
            {responsible ? (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <span className="flex-1 text-sm font-medium text-green-800">{responsible.full_name}</span>
                <button onClick={() => { setResponsible(null); set('responsible_id', '') }} className="text-xs text-gray-400 hover:text-red-500">✕</button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); searchResponsible(e.target.value) }}
                  placeholder="Buscar associado…"
                  className="w-full pl-9 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                />
                {results.length > 0 && (
                  <ul className="absolute z-10 w-full border border-gray-200 rounded-lg bg-white shadow-lg max-h-40 overflow-y-auto mt-1">
                    {results.map(r => (
                      <li key={r.id}>
                        <button className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                          onClick={() => { setResponsible(r); set('responsible_id', r.id); setSearch(''); setResults([]) }}>
                          {r.full_name}{r.cpf ? ` · ${maskCpf(r.cpf)}` : ''}{r.unit ? ` · Unid. ${r.unit}` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Dependent fields */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome completo <span className="text-red-500">*</span></label>
            <input value={form.full_name} onChange={e => set('full_name', e.target.value.replace(/(^\s*\S|\s\S)/g, c => c.toUpperCase()))}
              autoFocus placeholder="Nome do dependente"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CPF</label>
              <input value={form.cpf} onChange={e => set('cpf', e.target.value)} placeholder="000.000.000-00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nascimento</label>
              <input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Telefone <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input value={form.phone_primary} onChange={e => set('phone_primary', e.target.value)} placeholder="(21) 99999-9999"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-mail</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@exemplo.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CEP</label>
              <input value={form.address_cep} onChange={e => set('address_cep', e.target.value)} placeholder="00000-000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Número</label>
              <input value={form.address_number} onChange={e => set('address_number', e.target.value)} placeholder="123"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Compl.</label>
              <input value={form.address_complement} onChange={e => set('address_complement', e.target.value)} placeholder="Apto"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onCancel}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar Dependente'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Resident Profile Modal ────────────────────────────────────────────────────

interface MensalidadeEntry {
  id: string | null; reference_month: string; due_date: string | null; amount: string; status: string; paid_at: string | null; transaction_id: string | null; origem?: string; tipo?: string
}

interface InadimplenciaEntry {
  reference_month: string; due_date: string; amount: string; status: string; paid_at: string | null; pago_em_atraso: boolean
}

interface ResidentPackage {
  id: string; status: string; received_at: string; carrier_name?: string; tracking_code?: string; object_type?: string
}

interface MigrationEntry {
  id: string; competencia: string; tipo: string; origem: string
  valor_pago?: string | null; data_pagamento?: string | null
}

type ProfileTab = 'mensalidades' | 'inadimplencia' | 'encomendas' | 'migracao'

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
function fmtComp(comp: string) {
  const [y, m] = comp.split('-')
  return `${MONTH_NAMES[parseInt(m) - 1]}/${y}`
}

function printCarne(
  resident: Resident,
  mensalidades: MensalidadeEntry[],
  assocName: string,
  operatorName?: string,
  filterMonths?: string[],
) {
  printCarneUtil(resident, mensalidades, assocName, { operatorName, filterMonths })
}

function ResidentProfileModal({ resident, onClose }: { resident: Resident; onClose: () => void }) {
  const [mensalidades, setMensalidades] = useState<MensalidadeEntry[]>([])
  const [inadimplencias, setInadimplencias] = useState<InadimplenciaEntry[]>([])
  const [pkgs, setPkgs] = useState<ResidentPackage[]>([])
  const [migracoes, setMigracoes] = useState<MigrationEntry[]>([])
  const [tab, setTab] = useState<ProfileTab>('mensalidades')
  const [loading, setLoading] = useState(true)
  const [migForm, setMigForm] = useState({ competencia: '', tipo: 'mensalidade', quitado_de: '', quitado_ate: '', mode: 'single' as 'single' | 'bulk' | 'range', valor_pago: '', data_pagamento: '' })
  const [migSaving, setMigSaving] = useState(false)
  const [editingMig, setEditingMig] = useState<string | null>(null)
  const [editMigForm, setEditMigForm] = useState({ tipo: 'mensalidade', valor_pago: '', data_pagamento: '' })
  const [editMigSaving, setEditMigSaving] = useState(false)
  const [assocName, setAssocName] = useState('')
  const loggedFullName = useAuthStore(s => s.fullName) ?? ''
  const [carneOperator, setCarneOperator] = useState('')
  const [carnePeriodModal, setCarnePeriodModal] = useState(false)
  const [carnePeriod, setCarnePeriod] = useState<'current' | 'pending' | 'year' | 'custom'>('pending')
  const [carneFrom, setCarneFrom] = useState('')
  const [carneTo, setCarneTo] = useState('')

  useEffect(() => {
    if (loggedFullName && !carneOperator) setCarneOperator(loggedFullName)
  }, [loggedFullName])

  useEffect(() => {
    api.get<{ name?: string }>('/settings/association').then(r => setAssocName(r.data.name ?? 'Associação')).catch(() => {})
  }, [])

  // ── Convert guest → member/dependent ──
  const [showConvert, setShowConvert] = useState(false)
  const [convertType, setConvertType] = useState<'member' | 'dependent'>('member')
  const [convertCpf, setConvertCpf] = useState('')
  const [convertResponsibleSearch, setConvertResponsibleSearch] = useState('')
  const [convertResponsible, setConvertResponsible] = useState<Resident | null>(null)
  const [convertResponsibleResults, setConvertResponsibleResults] = useState<Resident[]>([])
  const [convertLoading, setConvertLoading] = useState(false)
  const [currentResident, setCurrentResident] = useState(resident)

  const searchConvertResponsible = async (q: string) => {
    if (q.length < 2) { setConvertResponsibleResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents/search', { params: { q } })
      setConvertResponsibleResults(res.data.filter((r: Resident) => r.type === 'member' && !(r as any).responsible_id && r.id !== resident.id).slice(0, 6))
    } catch { }
  }

  const handleConvert = async () => {
    if (convertType === 'dependent' && !convertResponsible) { toast.error('Selecione o responsável.'); return }
    setConvertLoading(true)
    try {
      const payload: Record<string, any> = {
        type: convertType === 'dependent' ? 'dependent' : 'member',
        status: 'active',
        is_member_confirmed: true, terms_accepted: true, lgpd_accepted: true,
      }
      if (convertCpf.trim()) payload.cpf = convertCpf.trim()
      if (convertType === 'dependent' && convertResponsible) payload.responsible_id = convertResponsible.id
      const res = await api.put<Resident>(`/residents/${resident.id}`, payload)
      setCurrentResident(res.data)
      setShowConvert(false)
      toast.success(convertType === 'dependent' ? 'Convertido para Dependente!' : 'Convertido para Associado!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao converter.')
    } finally { setConvertLoading(false) }
  }

  const loadMigracoes = async () => {
    try {
      const res = await api.get<MigrationEntry[]>(`/mensalidades/migration/residents/${resident.id}`)
      setMigracoes(res.data)
    } catch { /* silent */ }
  }

  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      try {
        const [mRes, iRes, pRes] = await Promise.all([
          api.get<MensalidadeEntry[]>(`/mensalidades/residents/${resident.id}`),
          api.get<InadimplenciaEntry[]>(`/mensalidades/residents/${resident.id}/inadimplencia`),
          api.get<ResidentPackage[]>(`/packages/resident/${resident.id}`),
        ])
        setMensalidades(mRes.data)
        setInadimplencias(iRes.data)
        setPkgs(pRes.data)
      } catch { /* silent */ }
      setLoading(false)
    }
    fetch()
    loadMigracoes()
  }, [resident.id])

  const handleMigSave = async () => {
    setMigSaving(true)
    try {
      if (migForm.mode === 'bulk' || migForm.mode === 'range') {
        if (!migForm.quitado_ate) { toast.error('Informe o mês final.'); return }
        if (migForm.mode === 'range' && !migForm.quitado_de) { toast.error('Informe o mês inicial.'); return }
        await api.post('/mensalidades/migration/bulk', {
          resident_id: resident.id,
          ...(migForm.mode === 'range' && { quitado_de: migForm.quitado_de }),
          quitado_ate: migForm.quitado_ate,
          tipo: migForm.tipo,
          valor_pago: migForm.valor_pago ? parseFloat(migForm.valor_pago) : null,
          data_pagamento: migForm.data_pagamento || null,
        })
        toast.success('Histórico de migração gerado!')
      } else {
        if (!migForm.competencia) { toast.error('Informe a competência.'); return }
        await api.post('/mensalidades/migration', {
          resident_id: resident.id,
          competencia: migForm.competencia,
          tipo: migForm.tipo,
          valor_pago: migForm.valor_pago ? parseFloat(migForm.valor_pago) : null,
          data_pagamento: migForm.data_pagamento || null,
        })
        toast.success('Registro de migração criado!')
      }
      await loadMigracoes()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setMigSaving(false)
    }
  }

  const handleMigDelete = async (competencia: string) => {
    try {
      await api.delete(`/mensalidades/migration/residents/${resident.id}/${competencia}`)
      await loadMigracoes()
      const res = await api.get<MensalidadeEntry[]>(`/mensalidades/residents/${resident.id}`)
      setMensalidades(res.data)
    } catch { toast.error('Erro ao remover.') }
  }

  const handleMigEditSave = async (competencia: string) => {
    setEditMigSaving(true)
    try {
      await api.patch(`/mensalidades/migration/residents/${resident.id}/${competencia}`, {
        tipo: editMigForm.tipo || undefined,
        valor_pago: editMigForm.valor_pago ? parseFloat(editMigForm.valor_pago) : undefined,
        data_pagamento: editMigForm.data_pagamento || undefined,
      })
      toast.success('Registro atualizado!')
      setEditingMig(null)
      const res = await api.get<MensalidadeEntry[]>(`/mensalidades/residents/${resident.id}`)
      setMensalidades(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao atualizar.')
    } finally { setEditMigSaving(false) }
  }

  const handleComprovante = async (id: string) => {
    try {
      const res = await api.get<any>(`/mensalidades/${id}/comprovante`)
      const d = res.data
      const via = (label: string) => `
        <div class="via">
          <div class="via-header">
            <span class="assoc">${d.association_name}</span>
            <span class="via-label">${label}</span>
          </div>
          <div class="title">Comprovante de Mensalidade</div>
          <div class="row"><span class="lbl">Morador</span><span class="val">${d.resident_name}</span></div>
          ${d.resident_cpf ? `<div class="row"><span class="lbl">CPF</span><span class="val">${maskCpf(d.resident_cpf)}</span></div>` : ''}
          ${d.unit ? `<div class="row"><span class="lbl">Unidade</span><span class="val">${d.unit}${d.block ? ' / Bl. ' + d.block : ''}</span></div>` : ''}
          <div class="divider"></div>
          <div class="row"><span class="lbl">Referência</span><span class="val">${d.reference_month}</span></div>
          <div class="row"><span class="lbl">Vencimento</span><span class="val">${safeDate(d.due_date)}</span></div>
          <div class="row"><span class="lbl">Valor</span><span class="val bold">R$ ${parseFloat(d.amount).toFixed(2)}</span></div>
          <div class="row"><span class="lbl">Pago em</span><span class="val">${safeDate(d.paid_at)}</span></div>
          <div class="row"><span class="lbl">Pagamento</span><span class="val">${d.payment_method}</span></div>
          ${d.assoc_phone ? `<div class="row"><span class="lbl">Tel</span><span class="val">${d.assoc_phone}</span></div>` : ''}
        </div>`
      const html = `<html><head><title>Comprovante</title><style>
        @page{size:A4 portrait;margin:10mm}
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;gap:0}
        .via{width:140mm;padding:8mm;border:1px solid #ccc;background:#fff}
        .via-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
        .assoc{font-size:9px;color:#555;font-weight:600;text-transform:uppercase;max-width:80%}
        .via-label{font-size:8px;color:#888;border:1px solid #ccc;padding:1px 5px;border-radius:3px;white-space:nowrap}
        .title{font-size:11px;font-weight:700;color:#26619c;text-align:center;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
        .divider{border-top:1px dashed #ddd;margin:5px 0}
        .row{display:flex;justify-content:space-between;padding:2px 0}
        .lbl{font-size:9px;color:#777}
        .val{font-size:10px;color:#222;font-weight:500;text-align:right}
        .bold{font-weight:700;font-size:11px;color:#111}
        .cut{width:140mm;display:flex;align-items:center;gap:4px;padding:4px 0}
        .cut-line{flex:1;border-top:1px dashed #aaa}
        .cut-text{font-size:8px;color:#aaa;white-space:nowrap}
        @media print{body{margin:0}.cut{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body>
        ${via('1ª VIA — ASSOCIAÇÃO')}
        <div class="cut"><div class="cut-line"></div><span class="cut-text">✂ cortar</span><div class="cut-line"></div></div>
        ${via('2ª VIA — MORADOR')}
      </body></html>`
      const win = window.open('', '_blank')
      if (win) { win.document.write(html); win.document.close(); win.print() }
    } catch { toast.error('Comprovante não disponível.') }
  }

  const STATUS_MAP: Record<string, string> = { pending: 'Pendente', paid: 'Pago', overdue: 'Inadimplente', agreement: 'Em Acordo' }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">{currentResident.full_name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-gray-400">{currentResident.unit ? `Unid. ${currentResident.unit}` : ''}{currentResident.block ? ` / Bl. ${currentResident.block}` : ''}</p>
              {currentResident.type === 'guest'
                ? <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">Visitante</span>
                : currentResident.type === 'dependent'
                  ? <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">Dependente</span>
                  : <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Associado</span>
              }
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentResident.type === 'guest' && (
              <button onClick={() => setShowConvert(v => !v)}
                className="text-xs bg-[#26619c] text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-[#1a4f87] transition">
                Converter
              </button>
            )}
            <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
          </div>
        </div>

        {/* Convert form */}
        {showConvert && currentResident.type === 'guest' && (
          <div className="mx-4 mt-3 mb-1 border border-blue-200 bg-blue-50 rounded-xl p-4 flex flex-col gap-3 shrink-0">
            <p className="text-xs font-semibold text-blue-800">Converter para Associado ou Dependente</p>
            <p className="text-xs text-blue-600">Após a conversão, taxa de entrega não será mais cobrada.</p>
            <div className="grid grid-cols-2 gap-2">
              {(['member', 'dependent'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setConvertType(t)}
                  className={`py-1.5 rounded-lg text-xs font-semibold border transition ${convertType === t ? 'bg-[#26619c] border-[#26619c] text-white' : 'border-gray-200 bg-white text-gray-600'}`}>
                  {t === 'member' ? 'Associado' : 'Dependente'}
                </button>
              ))}
            </div>
            <input value={convertCpf} onChange={e => setConvertCpf(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
              placeholder="CPF (opcional)" />
            {convertType === 'dependent' && (
              <div className="flex flex-col gap-1">
                <input value={convertResponsibleSearch}
                  onChange={e => { setConvertResponsibleSearch(e.target.value); setConvertResponsible(null); searchConvertResponsible(e.target.value) }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
                  placeholder="Buscar associado responsável *" />
                {convertResponsibleResults.length > 0 && (
                  <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-32 overflow-y-auto">
                    {convertResponsibleResults.map(r => (
                      <li key={r.id}>
                        <button type="button" onClick={() => { setConvertResponsible(r); setConvertResponsibleSearch(r.full_name); setConvertResponsibleResults([]) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50">{r.full_name}</button>
                      </li>
                    ))}
                  </ul>
                )}
                {convertResponsible && <p className="text-xs text-green-700 font-medium">✓ {convertResponsible.full_name}</p>}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setShowConvert(false)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={handleConvert} disabled={convertLoading}
                className="flex-1 bg-[#26619c] text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                {convertLoading ? 'Convertendo…' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-1 bg-gray-100 p-1 m-4 rounded-xl shrink-0">
          {(['mensalidades', 'inadimplencia', 'encomendas', 'migracao'] as ProfileTab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition ${tab === t ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'}`}>
              {t === 'mensalidades' ? 'Mensalidades' : t === 'inadimplencia' ? 'Inadimplência' : t === 'encomendas' ? 'Encomendas' : 'Migração'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-4 pb-4">
          {loading ? (
            <div className="py-8 text-center text-gray-400 text-sm">Carregando…</div>
          ) : tab === 'mensalidades' ? (
            <>
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  value={carneOperator}
                  onChange={e => setCarneOperator(e.target.value)}
                  placeholder="Nome do operador"
                  className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
                <button
                  onClick={() => setCarnePeriodModal(true)}
                  className="flex items-center gap-1.5 text-xs text-[#26619c] border border-[#26619c]/30 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" /> Imprimir Carnê
                </button>
              </div>

              {/* Period selection modal */}
              {carnePeriodModal && (() => {
                const now = new Date()
                const year = now.getFullYear()
                const currentRef = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`
                const pendingRefs = mensalidades.filter(m => m.status !== 'paid').map(m => m.reference_month)
                const yearRefs = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

                const getFilterMonths = (): string[] | undefined => {
                  if (carnePeriod === 'current') return [currentRef]
                  if (carnePeriod === 'pending') return pendingRefs.length ? pendingRefs : undefined
                  if (carnePeriod === 'year') return yearRefs
                  if (carnePeriod === 'custom' && carneFrom && carneTo) {
                    return yearRefs.filter(r => r >= carneFrom && r <= carneTo)
                  }
                  return undefined
                }

                return (
                  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setCarnePeriodModal(false)}>
                    <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm flex flex-col gap-4" onClick={e => e.stopPropagation()}>
                      <h3 className="font-semibold text-gray-800 text-sm">Selecione o período do carnê</h3>
                      <div className="flex flex-col gap-2">
                        {([
                          ['current', 'Mês atual'],
                          ['pending', `Meses pendentes (${pendingRefs.length})`],
                          ['year', 'Ano todo'],
                          ['custom', 'Período personalizado'],
                        ] as const).map(([val, label]) => (
                          <label key={val} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="radio" name="carnePeriod" value={val} checked={carnePeriod === val}
                              onChange={() => setCarnePeriod(val)} className="accent-[#26619c]" />
                            {label}
                          </label>
                        ))}
                        {carnePeriod === 'custom' && (
                          <div className="flex gap-2 mt-1 ml-5">
                            <div className="flex flex-col gap-0.5 flex-1">
                              <label className="text-xs text-gray-500">De</label>
                              <input type="month" value={carneFrom} onChange={e => setCarneFrom(e.target.value)}
                                className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#26619c]/30" />
                            </div>
                            <div className="flex flex-col gap-0.5 flex-1">
                              <label className="text-xs text-gray-500">Até</label>
                              <input type="month" value={carneTo} onChange={e => setCarneTo(e.target.value)}
                                className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#26619c]/30" />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setCarnePeriodModal(false)}
                          className="flex-1 text-sm text-gray-500 border border-gray-200 rounded-xl py-2 hover:bg-gray-50">Cancelar</button>
                        <button
                          onClick={() => {
                            const months = getFilterMonths()
                            if (carnePeriod === 'pending' && pendingRefs.length === 0) { toast.error('Nenhum mês pendente.'); return }
                            if (carnePeriod === 'custom' && (!carneFrom || !carneTo)) { toast.error('Selecione o período.'); return }
                            setCarnePeriodModal(false)
                            printCarne(currentResident, mensalidades, assocName, carneOperator || undefined, months)
                          }}
                          className="flex-1 text-sm text-white bg-[#26619c] rounded-xl py-2 hover:bg-[#1a4f87] font-medium">
                          <Printer className="w-3.5 h-3.5 inline mr-1" /> Imprimir
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()}
            {mensalidades.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">Nenhuma mensalidade registrada.</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {mensalidades.map((m) => {
                  const isMig = m.origem === 'migracao'
                  const key = m.id ?? `mig-${m.reference_month}`
                  if (isMig && editingMig === m.reference_month) {
                    return (
                      <li key={key} className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 flex flex-col gap-2">
                        <p className="text-xs font-semibold text-amber-800">{m.reference_month} — Editar migração</p>
                        <select value={editMigForm.tipo} onChange={e => setEditMigForm(f => ({ ...f, tipo: e.target.value }))}
                          className="w-full border border-amber-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                          <option value="mensalidade">Mensalidade</option>
                          <option value="acordo">Acordo</option>
                        </select>
                        <input type="number" step="0.01" placeholder="Valor pago (R$)" value={editMigForm.valor_pago}
                          onChange={e => setEditMigForm(f => ({ ...f, valor_pago: e.target.value }))}
                          className="w-full border border-amber-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" />
                        <input type="date" value={editMigForm.data_pagamento}
                          onChange={e => setEditMigForm(f => ({ ...f, data_pagamento: e.target.value }))}
                          className="w-full border border-amber-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" />
                        <div className="flex gap-2">
                          <button onClick={() => handleMigEditSave(m.reference_month)} disabled={editMigSaving}
                            className="flex-1 text-xs bg-amber-600 text-white rounded-lg py-1.5 font-medium disabled:opacity-50">
                            {editMigSaving ? 'Salvando…' : 'Salvar'}
                          </button>
                          <button onClick={() => setEditingMig(null)}
                            className="flex-1 text-xs border border-amber-300 text-amber-700 rounded-lg py-1.5 font-medium">
                            Cancelar
                          </button>
                        </div>
                      </li>
                    )
                  }
                  return (
                    <li key={key} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-800">{m.reference_month}</p>
                          {isMig && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Migração</span>}
                        </div>
                        <p className="text-xs text-gray-500">{m.due_date ? `Venc: ${safeDate(m.due_date)} · ` : ''}R$ {parseFloat(m.amount).toFixed(2)}</p>
                        <span className={`text-xs font-medium ${m.status === 'paid' ? 'text-green-600' : m.status === 'overdue' ? 'text-red-600' : m.status === 'agreement' ? 'text-purple-600' : 'text-amber-600'}`}>
                          {STATUS_MAP[m.status] ?? m.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isMig && (
                          <button onClick={() => {
                            setEditingMig(m.reference_month)
                            setEditMigForm({ tipo: m.tipo ?? 'mensalidade', valor_pago: m.amount !== '0.00' ? m.amount : '', data_pagamento: m.paid_at ? m.paid_at.substring(0, 10) : '' })
                          }} className="text-xs text-amber-600 hover:underline">Editar</button>
                        )}
                        {isMig && (
                          <button onClick={() => handleMigDelete(m.reference_month)}
                            className="text-gray-300 hover:text-red-500 transition">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {!isMig && m.status === 'paid' && m.id && (
                          <button onClick={() => handleComprovante(m.id!)}
                            className="flex items-center gap-1 text-xs text-[#26619c] hover:underline">
                            <FileText className="w-3.5 h-3.5" /> Comprovante
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            </>
          ) : tab === 'inadimplencia' ? (
            inadimplencias.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
                <AlertCircle className="w-8 h-8 text-gray-300" />
                Nenhum histórico de inadimplência.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {inadimplencias.map((i, idx) => (
                  <li key={idx} className="bg-red-50 border border-red-100 rounded-xl px-3 py-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{i.reference_month}</p>
                        <p className="text-xs text-gray-500">Venc: {safeDate(i.due_date)} · R$ {parseFloat(i.amount).toFixed(2)}</p>
                        {i.pago_em_atraso && i.paid_at && (
                          <p className="text-xs text-amber-600">Pago em atraso: {safeDate(i.paid_at)}</p>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${i.status === 'paid' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                        {i.pago_em_atraso ? 'Pago em atraso' : STATUS_MAP[i.status] ?? i.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : tab === 'encomendas' ? (
            pkgs.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">Nenhuma encomenda registrada.</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {pkgs.map((p) => (
                  <li key={p.id} className="bg-gray-50 rounded-xl px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">{p.object_type ?? 'Encomenda'}</p>
                        <p className="text-xs text-gray-500">
                          {safeDate(p.received_at)}
                          {p.carrier_name ? ` · ${p.carrier_name}` : ''}
                          {p.tracking_code ? ` · ${p.tracking_code}` : ''}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                        p.status === 'delivered' ? 'bg-green-100 text-green-700' :
                        p.status === 'returned' ? 'bg-gray-100 text-gray-600' :
                        p.status === 'notified' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {p.status === 'delivered' ? 'Entregue' : p.status === 'returned' ? 'Devolvido' : p.status === 'notified' ? 'Notificado' : 'Aguardando'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            /* ── Migração ── */
            <div className="flex flex-col gap-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-amber-800 mb-3">Histórico de Pagamentos (Migração)</p>
                <div className="flex gap-2 mb-3">
                  {(['single', 'bulk', 'range'] as const).map(m => (
                    <button key={m} onClick={() => setMigForm(f => ({ ...f, mode: m }))}
                      className={`flex-1 py-1.5 text-xs rounded-lg border font-medium transition ${migForm.mode === m ? 'bg-amber-600 text-white border-amber-600' : 'border-amber-300 text-amber-700'}`}>
                      {m === 'single' ? '1 Mês' : m === 'bulk' ? 'Até…' : 'De → Até'}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <select value={migForm.tipo} onChange={e => setMigForm(f => ({ ...f, tipo: e.target.value }))}
                    className="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none">
                    <option value="mensalidade">Mensalidade</option>
                    <option value="acordo">Acordo</option>
                  </select>
                  {migForm.mode === 'single' ? (
                    <input type="month" value={migForm.competencia}
                      onChange={e => setMigForm(f => ({ ...f, competencia: e.target.value }))}
                      className="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none" />
                  ) : migForm.mode === 'bulk' ? (
                    <div>
                      <label className="text-xs text-amber-700 mb-1 block">Quitado até (gera de 2000/01 até este mês)</label>
                      <input type="month" value={migForm.quitado_ate}
                        onChange={e => setMigForm(f => ({ ...f, quitado_ate: e.target.value }))}
                        className="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none" />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div>
                        <label className="text-xs text-amber-700 mb-1 block">De (mês inicial)</label>
                        <input type="month" value={migForm.quitado_de}
                          onChange={e => setMigForm(f => ({ ...f, quitado_de: e.target.value }))}
                          className="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-xs text-amber-700 mb-1 block">Até (mês final)</label>
                        <input type="month" value={migForm.quitado_ate}
                          onChange={e => setMigForm(f => ({ ...f, quitado_ate: e.target.value }))}
                          className="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none" />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-amber-700 mb-1 block">Valor pago (opcional)</label>
                      <input type="number" step="0.01" min="0" value={migForm.valor_pago}
                        onChange={e => setMigForm(f => ({ ...f, valor_pago: e.target.value }))}
                        placeholder="0,00"
                        className="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-amber-700 mb-1 block">Data do pagamento</label>
                      <input type="date" value={migForm.data_pagamento}
                        onChange={e => setMigForm(f => ({ ...f, data_pagamento: e.target.value }))}
                        className="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none" />
                    </div>
                  </div>
                  <button onClick={handleMigSave} disabled={migSaving}
                    className="bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50">
                    {migSaving ? 'Salvando…' : 'Registrar'}
                  </button>
                </div>
              </div>

              {migracoes.length === 0 ? (
                <p className="text-center text-gray-400 text-xs py-4">Nenhum registro de migração.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {migracoes.map(mp => (
                    <li key={mp.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div>
                        <span className="text-sm font-medium text-gray-800">{fmtComp(mp.competencia)}</span>
                        <span className="ml-2 text-xs text-gray-400">{mp.tipo === 'mensalidade' ? 'Mensalidade' : 'Acordo'}</span>
                      </div>
                      <button onClick={() => handleMigDelete(mp.competencia)}
                        className="text-gray-300 hover:text-red-500 transition ml-2">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
  const [showDepForm, setShowDepForm] = useState(false)
  const [profileResident, setProfileResident] = useState<Resident | null>(null)
  const [activeTab, setActiveTab] = useState<ResidentTab>('associados')
  const [filterStatus, setFilterStatus] = useState<ResidentStatus | ''>('')
  const [filterDelinquent, setFilterDelinquent] = useState(false)
  const [delinquentIds, setDelinquentIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState({ associados: 0, dependentes: 0, visitantes: 0 })
  const [kpis, setKpis] = useState({ sem_cep: 0, sem_telefone: 0, sem_cpf: 0, inadimplentes: 0 })
  const [promptDep, setPromptDep] = useState(false)
  const [lastSavedId, setLastSavedId] = useState<string | null>(null)
  const [updateRequests, setUpdateRequests] = useState<any[]>([])
  const [loadingRequests, setLoadingRequests] = useState(false)
  const [reviewingRequest, setReviewingRequest] = useState(false)

  const loadUpdateRequests = async () => {
    setLoadingRequests(true)
    try { const r = await api.get<any[]>('/residents/update-requests'); setUpdateRequests(r.data) }
    catch { toast.error('Erro ao carregar solicitações.') }
    finally { setLoadingRequests(false) }
  }

  const handleApprove = async (id: string) => {
    setReviewingRequest(true)
    try { await api.post(`/residents/update-requests/${id}/approve`); toast.success('Aprovado!'); loadUpdateRequests() }
    catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
    finally { setReviewingRequest(false) }
  }

  const handleReject = async (id: string) => {
    setReviewingRequest(true)
    try { await api.post(`/residents/update-requests/${id}/reject`); toast.success('Rejeitado.'); loadUpdateRequests() }
    catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
    finally { setReviewingRequest(false) }
  }

  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set())
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [mergePrimaryId, setMergePrimaryId] = useState<string | null>(null)
  const [mergeSaving, setMergeSaving] = useState(false)

  const load = async () => {
    try {
      const params: Record<string, string> = {}
      const q = search.trim()
      const typeByTab: Record<string, string> = { associados: 'member', dependentes: 'dependent', visitantes: 'guest' }
      if (activeTab in typeByTab) params.type = typeByTab[activeTab]
      if (q.length >= 2) params.q = q
      if (filterStatus) params.status = filterStatus
      const res = await api.get<Resident[]>('/residents', { params })
      setResidents(res.data)
    } catch {
      toast.error('Erro ao carregar moradores.')
    }
  }

  const loadDelinquents = async () => {
    try {
      const res = await api.get<{ resident_id: string }[]>('/mensalidades/delinquent')
      setDelinquentIds(new Set(res.data.map((d: any) => d.resident_id ?? d.id)))
    } catch { /* silent */ }
  }

  const loadCounts = async () => {
    try {
      const [members, deps, guests] = await Promise.all([
        api.get<Resident[]>('/residents', { params: { type: 'member', status: 'active' } }),
        api.get<Resident[]>('/residents', { params: { type: 'dependent', status: 'active' } }),
        api.get<Resident[]>('/residents', { params: { type: 'guest', status: 'active' } }),
      ])
      setCounts({ associados: members.data.length, dependentes: deps.data.length, visitantes: guests.data.length })
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (activeTab !== 'atualizacoes') { load(); loadKpis(activeTab) }
  }, [activeTab, filterStatus, search])
  useEffect(() => { if (activeTab === 'atualizacoes') loadUpdateRequests() }, [activeTab])
  const loadKpis = (tab: ResidentTab) => {
    const typeByTab: Record<string, string> = { associados: 'member', dependentes: 'dependent', visitantes: 'guest' }
    const rtype = typeByTab[tab] ?? 'member'
    api.get<{ sem_cep: number; sem_telefone: number; sem_cpf: number; inadimplentes: number }>(
      '/residents/kpis', { params: { resident_type: rtype } }
    ).then(r => setKpis(r.data)).catch(() => {})
  }

  useEffect(() => { loadDelinquents(); loadCounts(); loadKpis('associados') }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const isSearching = search.trim().length >= 2
  const displayedResidents = residents.filter(r => {
    if (!isSearching) {
      if (activeTab === 'associados') { if (r.type !== 'member') return false }
      else if (activeTab === 'dependentes') { if (r.type !== 'dependent') return false }
      else if (activeTab === 'visitantes') { if (r.type !== 'guest') return false }
    }
    if (filterDelinquent && !delinquentIds.has(r.id)) return false
    return true
  })

  const handleSave = async (form: FormState) => {
    if (form.date_of_birth && !parseDateInput(form.date_of_birth)) {
      toast.error('Data de nascimento inválida. Use o formato DD/MM/AAAA com o ano completo (ex: 1978).')
      return
    }
    if (form.type === 'dependent' && !form.responsible_id) {
      toast.error('Selecione o responsável pelo dependente.')
      return
    }
    const payload: Record<string, any> = {
      ...form,
      address_rooms: form.address_rooms ? parseInt(form.address_rooms) : null,
      household_count: form.household_count ? parseInt(form.household_count) : null,
      monthly_payment_day: form.monthly_payment_day ? parseInt(form.monthly_payment_day) : null,
      date_of_birth: form.date_of_birth ? parseDateInput(form.date_of_birth) : null,
      move_in_date: form.move_in_date || null,
      cpf: form.cpf ? form.cpf.replace(/\D/g, '') : null,
    }
    try {
      if (editTarget) {
        await api.put(`/residents/${editTarget.id}`, payload)
        toast.success('Morador atualizado!')
      } else {
        const res = await api.post('/residents', payload)
        toast.success('Morador cadastrado!')
        if (form.type === 'member' && !payload.responsible_id) {
          setLastSavedId(res.data.id ?? null)
          setPromptDep(true)
        }
      }
      setShowForm(false)
      setEditTarget(null)
      load()
      loadCounts()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
      throw e
    }
  }

  const handleSaveDependent = async (form: DepFormState) => {
    const payload = {
      type: 'dependent' as const,
      full_name: form.full_name,
      cpf: form.cpf || null,
      date_of_birth: form.date_of_birth || null,
      phone_primary: form.phone_primary || null,
      email: form.email || null,
      address_cep: form.address_cep || null,
      address_number: form.address_number || null,
      address_complement: form.address_complement || null,
      responsible_id: form.responsible_id,
      status: 'active',
      is_member_confirmed: false,
      terms_accepted: false,
      lgpd_accepted: false,
    }
    try {
      await api.post('/residents', payload)
      toast.success('Dependente cadastrado!')
      setShowDepForm(false)
      load()
      loadCounts()
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
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="w-6 h-6 text-[#26619c]" />
          Moradores
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setMergeMode(m => !m); setMergeSelected(new Set()) }}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition border ${
              mergeMode ? 'bg-amber-50 border-amber-400 text-amber-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}>
            <Merge className="w-4 h-4" />
            {mergeMode ? 'Cancelar' : 'Unir'}
          </button>
          {!mergeMode && (
            <button
              onClick={() => {
                if (activeTab === 'dependentes') { setShowDepForm(true) }
                else { setEditTarget(null); setShowForm(true) }
              }}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-4 py-2 rounded-xl text-sm font-medium transition">
              <Plus className="w-4 h-4" />
              {activeTab === 'dependentes' ? 'Novo Dependente' : 'Novo'}
            </button>
          )}
          {mergeMode && mergeSelected.size >= 2 && (
            <button
              onClick={() => { setMergePrimaryId([...mergeSelected][0]); setShowMergeModal(true) }}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition">
              Unir {mergeSelected.size} cadastros
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['associados', 'dependentes', 'visitantes', 'atualizacoes'] as ResidentTab[]).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition -mb-px flex items-center justify-center gap-1 ${
              activeTab === t ? 'border-[#26619c] text-[#26619c]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {TAB_LABELS[t]}
            {t !== 'atualizacoes' && (counts as any)[t] > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                activeTab === t ? 'bg-[#26619c]/10 text-[#26619c]' : 'bg-gray-100 text-gray-500'
              }`}>{(counts as any)[t]}</span>
            )}
            {t === 'atualizacoes' && updateRequests.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{updateRequests.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* KPIs */}
      {activeTab !== 'atualizacoes' && (
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Sem CEP',      value: kpis.sem_cep,       bg: 'bg-orange-50', text: 'text-orange-700' },
          { label: 'Sem Telefone', value: kpis.sem_telefone,  bg: 'bg-yellow-50', text: 'text-yellow-700' },
          { label: 'Sem CPF',      value: kpis.sem_cpf,       bg: 'bg-blue-50',   text: 'text-blue-700'   },
          ...(activeTab === 'associados' ? [{ label: 'Inadimplentes', value: kpis.inadimplentes, bg: 'bg-red-50', text: 'text-red-700' }] : []),
        ].map(k => (
          <div key={k.label} className={`${k.bg} rounded-xl p-3`}>
            <p className={`text-[10px] uppercase tracking-wide font-semibold ${k.text} opacity-70`}>{k.label}</p>
            <p className={`text-2xl font-bold ${k.text}`}>{k.value}</p>
          </div>
        ))}
      </div>
      )}

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
          <button onClick={() => setFilterDelinquent(v => !v)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition border ${
              filterDelinquent ? 'bg-red-600 text-white border-red-600' : 'border-red-300 text-red-600 bg-red-50 hover:bg-red-100'
            }`}>
            Inadimplentes {delinquentIds.size > 0 && `(${delinquentIds.size})`}
          </button>
        </div>
      </div>

      {/* Update requests tab */}
      {activeTab === 'atualizacoes' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Solicitações de atualização</h3>
            <button onClick={loadUpdateRequests} className="text-gray-400 hover:text-gray-600">
              <Search className="w-4 h-4" />
            </button>
          </div>
          {loadingRequests ? (
            <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
          ) : updateRequests.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">Nenhuma solicitação pendente.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {updateRequests.map(req => (
                <li key={req.id} className="px-5 py-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{req.resident_name}</p>
                      <p className="text-xs text-gray-400">{req.cpf ? maskCpf(req.cpf) : ''}{req.unit ? ` · Unid. ${req.unit}` : ''}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(req.submitted_at).toLocaleString('pt-BR')}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => handleApprove(req.id)} disabled={reviewingRequest}
                        className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
                        Aprovar
                      </button>
                      <button onClick={() => handleReject(req.id)} disabled={reviewingRequest}
                        className="text-xs bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
                        Rejeitar
                      </button>
                    </div>
                  </div>
                  {req.notes && <p className="text-xs text-gray-500 italic">"{req.notes}"</p>}
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(req.changes as Record<string, string>).map(([k, v]) => (
                      <span key={k} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                        <span className="font-medium">{k}:</span> {String(v)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* List */}
      {activeTab !== 'atualizacoes' && (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {displayedResidents.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhum {TAB_LABELS[activeTab].toLowerCase().replace('s','')} encontrado.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {displayedResidents.map((r) => (
              <li key={r.id}
                className={`flex items-center justify-between px-4 py-3 ${mergeMode ? 'cursor-pointer hover:bg-amber-50' : ''} ${mergeSelected.has(r.id) ? 'bg-amber-50' : ''}`}
                onClick={mergeMode ? () => setMergeSelected(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n }) : undefined}>
                <div className="flex items-center gap-3 min-w-0">
                  {mergeMode && (
                    <input type="checkbox" readOnly checked={mergeSelected.has(r.id)}
                      className="w-4 h-4 accent-amber-500 shrink-0" />
                  )}
                  <div className="w-9 h-9 rounded-full bg-[#e8f0fb] flex items-center justify-center text-[#26619c] font-bold text-sm shrink-0">
                    {r.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-800 truncate">{r.full_name}</p>
                      {activeTab === 'associados' && <CompletionBadge pct={calcCompletion(r)} />}
                    </div>
                    <p className="text-xs text-gray-400">
                      {TYPE_LABELS[r.type] ?? r.type}
                      {r.unit ? ` · Unid. ${r.unit}` : ''}
                      {r.block ? ` / Bl. ${r.block}` : ''}
                      {r.cpf ? ` · ${maskCpf(r.cpf)}` : ''}
                    </p>
                    {(r.address_street || r.address_cep) && (
                      <p className="text-xs text-gray-400 truncate">
                        {r.address_street ? `${r.address_street}${r.address_number ? `, ${r.address_number}` : ''}` : `CEP ${r.address_cep}`}
                        {r.phone_primary ? ` · ${r.phone_primary}` : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => setProfileResident(r)}
                      className="text-xs text-gray-500 hover:text-gray-700 hover:underline">
                      Ver
                    </button>
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
      )}

      {profileResident && (
        <ResidentProfileModal
          resident={profileResident}
          onClose={() => setProfileResident(null)}
        />
      )}

      {/* Dependent Form modal */}
      {showDepForm && (
        <DependentForm
          onSave={handleSaveDependent}
          onCancel={() => setShowDepForm(false)}
        />
      )}

      {/* Merge modal */}
      {showMergeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                <Merge className="w-4 h-4 text-amber-500" /> Unir cadastros
              </h2>
              <button onClick={() => setShowMergeModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-4">
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Escolha o cadastro <strong>principal</strong> (que será mantido). Os dados em branco serão preenchidos dos outros. Mensalidades, pacotes e transações serão transferidos.
              </p>
              <div className="flex flex-col gap-2">
                {[...mergeSelected].map(id => {
                  const r = displayedResidents.find(x => x.id === id)
                  if (!r) return null
                  const isPrimary = mergePrimaryId === id
                  return (
                    <button key={id} type="button" onClick={() => setMergePrimaryId(id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition ${
                        isPrimary ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:border-amber-300'
                      }`}>
                      <div className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                        isPrimary ? 'border-amber-500 bg-amber-500' : 'border-gray-300'
                      }`}>
                        {isPrimary && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">{r.full_name} {isPrimary && <span className="text-amber-600 text-xs font-normal">(principal)</span>}</p>
                        <p className="text-xs text-gray-400">{r.cpf ? maskCpf(r.cpf) : 'Sem CPF'} · {r.phone_primary ?? '—'}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowMergeModal(false)}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm">Cancelar</button>
              <button
                disabled={!mergePrimaryId || mergeSaving}
                onClick={async () => {
                  if (!mergePrimaryId) return
                  setMergeSaving(true)
                  try {
                    await api.post('/residents/merge', {
                      primary_id: mergePrimaryId,
                      secondary_ids: [...mergeSelected].filter(id => id !== mergePrimaryId),
                    })
                    toast.success('Cadastros unidos com sucesso!')
                    setShowMergeModal(false)
                    setMergeMode(false)
                    setMergeSelected(new Set())
                    setMergePrimaryId(null)
                    load()
                    loadCounts()
                  } catch (e: any) {
                    toast.error(e.response?.data?.detail ?? 'Erro ao unir cadastros.')
                  } finally { setMergeSaving(false) }
                }}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                {mergeSaving ? 'Unindo…' : 'Confirmar fusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt: add dependent after saving associado */}
      {promptDep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm flex flex-col gap-4">
            <p className="font-bold text-gray-900 text-center">Adicionar dependente?</p>
            <p className="text-sm text-gray-500 text-center">Deseja cadastrar um dependente para este associado agora?</p>
            <div className="flex gap-3">
              <button onClick={() => { setPromptDep(false); setLastSavedId(null) }}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                Não, obrigado
              </button>
              <button onClick={() => {
                setPromptDep(false)
                setShowDepForm(true)
              }}
                className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition">
                Sim, adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <ResidentForm
          initial={editTarget ? {
            type: editTarget.type,
            responsible_id: editTarget.responsible_id ?? '',
            full_name: editTarget.full_name,
            cpf: editTarget.cpf ?? '',
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
            address_neighborhood: editTarget.address_neighborhood ?? '',
            address_city: editTarget.address_city ?? '',
            address_state: editTarget.address_state ?? '',
            address_country: editTarget.address_country ?? 'Brasil',
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
            has_pests: editTarget.has_pests ?? null,
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
          } : (activeTab === 'visitantes' ? { type: 'guest' as ResidentType } : undefined)}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditTarget(null) }}
        />
      )}
    </div>
  )
}
