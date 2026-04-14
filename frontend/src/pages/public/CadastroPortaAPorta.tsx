import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast, { Toaster } from 'react-hot-toast'
import axios from 'axios'
import { CheckCircle2, Plus, Trash2 } from 'lucide-react'

const API = '/api/v1'
const inp = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]'

interface Dependent { name: string; phone: string; cpf: string }

export default function CadastroPortaAPorta() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    cpf: '',
    address_street: '',
    address_number: '',
    address_complement: '',
    notes: '',
  })
  const [dependents, setDependents] = useState<Dependent[]>([])

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))

  const addDep = () => {
    if (dependents.length >= 3) { toast.error('Máximo de 3 dependentes.'); return }
    setDependents(d => [...d, { name: '', phone: '', cpf: '' }])
  }
  const setDep = (i: number, k: keyof Dependent, v: string) =>
    setDependents(d => d.map((x, idx) => idx === i ? { ...x, [k]: v } : x))
  const removeDep = (i: number) => setDependents(d => d.filter((_, idx) => idx !== i))

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { toast.error('Informe o nome completo.'); return }
    if (!form.address_street.trim() || !form.address_number.trim()) { toast.error('Informe o endereço.'); return }
    if (!token) { toast.error('Link inválido.'); return }
    for (const d of dependents) {
      if (!d.name.trim()) { toast.error('Informe o nome do dependente.'); return }
    }
    setLoading(true)
    try {
      await axios.post(`${API}/porta-a-porta/public-register`, {
        token,
        ...form,
        dependents: dependents.map(d => ({ name: d.name, phone: d.phone || null, cpf: d.cpf || null })),
      })
      setDone(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao enviar cadastro.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <p className="text-gray-500 text-sm">Link inválido ou expirado.</p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 gap-4">
        <Toaster position="top-center" />
        <CheckCircle2 className="w-16 h-16 text-green-500" />
        <h1 className="text-xl font-bold text-gray-800 text-center">Cadastro enviado!</h1>
        <p className="text-sm text-gray-500 text-center max-w-xs">
          Suas informações foram recebidas. O pagamento será confirmado pelo nosso time.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4">
      <Toaster position="top-center" />
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-5">
        <div className="text-center">
          <h1 className="text-xl font-bold text-[#26619c]">Associe-se</h1>
          <p className="text-xs text-gray-500 mt-1">Preencha seus dados para se associar.</p>
        </div>

        {/* Dados pessoais */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Seus dados</p>
          <input className={inp} placeholder="Nome completo *" value={form.full_name}
            onChange={e => set('full_name', e.target.value)} />
          <input className={inp} placeholder="Telefone" value={form.phone} inputMode="tel"
            onChange={e => set('phone', e.target.value)} />
          <input className={inp} placeholder="CPF (opcional)" value={form.cpf} inputMode="numeric"
            onChange={e => set('cpf', e.target.value)} />
        </div>

        {/* Endereço */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Endereço</p>
          <input className={inp} placeholder="Nome da rua *" value={form.address_street}
            onChange={e => set('address_street', e.target.value)} />
          <div className="flex gap-2">
            <input className={`${inp} flex-1`} placeholder="Número *" value={form.address_number}
              onChange={e => set('address_number', e.target.value)} />
            <input className={`${inp} flex-[2]`} placeholder="Complemento" value={form.address_complement}
              onChange={e => set('address_complement', e.target.value)} />
          </div>
        </div>

        {/* Dependentes */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dependentes (máx. 3)</p>
            {dependents.length < 3 && (
              <button onClick={addDep}
                className="flex items-center gap-1 text-xs text-[#26619c] font-medium hover:underline">
                <Plus className="w-3.5 h-3.5" /> Adicionar
              </button>
            )}
          </div>
          {dependents.map((d, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2 border border-gray-200">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-600">Dependente {i + 1}</p>
                <button onClick={() => removeDep(i)} className="text-gray-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <input className={inp} placeholder="Nome completo *" value={d.name}
                onChange={e => setDep(i, 'name', e.target.value)} />
              <input className={inp} placeholder="Telefone" value={d.phone}
                onChange={e => setDep(i, 'phone', e.target.value)} />
              <input className={inp} placeholder="CPF (opcional)" value={d.cpf}
                onChange={e => setDep(i, 'cpf', e.target.value)} />
            </div>
          ))}
        </div>

        <input className={inp} placeholder="Observações (opcional)" value={form.notes}
          onChange={e => set('notes', e.target.value)} />

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl font-semibold text-sm transition disabled:opacity-50"
        >
          {loading ? 'Enviando…' : 'Enviar Cadastro'}
        </button>

        <p className="text-xs text-gray-400 text-center">
          Após o envio, o pagamento será confirmado pelo nosso time e você receberá a confirmação.
        </p>
      </div>
    </div>
  )
}
