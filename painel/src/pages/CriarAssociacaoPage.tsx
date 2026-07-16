import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createAssociacao } from '../lib/api'

const initialState = {
  name: '',
  slug: '',
  community_name: '',
  default_mensalidade_amount: '0.00',
  default_cash_balance: '200.00',
  inventory_day_of_month: 1,
  president_name: '',
  admin_first_name: '',
  admin_last_name: '',
  admin_email: '',
  admin_cargo: '',
}

export function CriarAssociacaoPage() {
  const { empresaId } = useParams<{ empresaId: string }>()
  const [form, setForm] = useState(initialState)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    setError(null)
    setLoading(true)
    try {
      await createAssociacao(empresaId, { ...form, president_name: form.president_name || null })
      navigate(`/empresas/${empresaId}`)
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Erro ao criar associação.')
    } finally {
      setLoading(false)
    }
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-lg font-semibold text-slate-100">Criar associação</h1>
      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nome da associação">
          <input name="name" required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Slug">
          <input name="slug" required value={form.slug} onChange={(e) => set('slug', e.target.value)} className={inputClass} placeholder="minha-associacao" />
        </Field>
        <Field label="Nome da comunidade">
          <input name="community_name" required value={form.community_name} onChange={(e) => set('community_name', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Nome do presidente">
          <input value={form.president_name} onChange={(e) => set('president_name', e.target.value)} className={inputClass} />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Valor mensalidade (R$)">
            <input required value={form.default_mensalidade_amount} onChange={(e) => set('default_mensalidade_amount', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Saldo inicial caixa (R$)">
            <input required value={form.default_cash_balance} onChange={(e) => set('default_cash_balance', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Dia do inventário">
            <input
              type="number"
              min={1}
              max={28}
              required
              value={form.inventory_day_of_month}
              onChange={(e) => set('inventory_day_of_month', Number(e.target.value))}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="border-t border-slate-800 pt-4">
          <p className="mb-3 text-sm font-medium text-slate-300">Admin da associação</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nome">
              <input name="admin_first_name" required value={form.admin_first_name} onChange={(e) => set('admin_first_name', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Sobrenome">
              <input name="admin_last_name" required value={form.admin_last_name} onChange={(e) => set('admin_last_name', e.target.value)} className={inputClass} />
            </Field>
          </div>
          <Field label="E-mail">
            <input name="admin_email" type="email" required value={form.admin_email} onChange={(e) => set('admin_email', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Cargo">
            <input name="admin_cargo" required value={form.admin_cargo} onChange={(e) => set('admin_cargo', e.target.value)} className={inputClass} placeholder="Síndico" />
          </Field>
          <p className="text-xs text-slate-500">A senha é gerada automaticamente e enviada por e-mail.</p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? 'Criando...' : 'Criar associação'}
        </button>
      </form>
    </div>
  )
}

const inputClass = 'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 py-1">
      <label className="text-sm text-slate-400">{label}</label>
      {children}
    </div>
  )
}
