import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createEmpresa } from '../lib/api'

const initialState = {
  name: '',
  slug: '',
  admin_first_name: '',
  admin_last_name: '',
  admin_email: '',
  admin_cargo: '',
  financeiro_centralizado: false,
}

export function CriarEmpresaPage() {
  const [form, setForm] = useState(initialState)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const empresa = await createEmpresa(form)
      navigate(`/empresas/${empresa.id}`)
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Erro ao criar empresa.')
    } finally {
      setLoading(false)
    }
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-lg font-semibold text-slate-100">Criar empresa</h1>
      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nome da empresa">
          <input name="name" required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Slug">
          <input name="slug" required value={form.slug} onChange={(e) => set('slug', e.target.value)} className={inputClass} placeholder="minha-empresa" />
        </Field>

        <div className="flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            id="financeiro_centralizado"
            checked={form.financeiro_centralizado}
            onChange={(e) => set('financeiro_centralizado', e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="financeiro_centralizado" className="text-sm text-slate-300">
            Financeiro centralizado no ESC
          </label>
        </div>

        <div className="border-t border-slate-800 pt-4">
          <p className="mb-3 text-sm font-medium text-slate-300">Admin inicial (admin_master)</p>
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
            <input name="admin_cargo" required value={form.admin_cargo} onChange={(e) => set('admin_cargo', e.target.value)} className={inputClass} placeholder="Diretor Financeiro" />
          </Field>
          <p className="text-xs text-slate-500">A senha é gerada automaticamente e enviada por e-mail.</p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? 'Criando...' : 'Criar empresa'}
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
