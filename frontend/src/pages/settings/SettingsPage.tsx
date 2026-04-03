import { useEffect, useState } from 'react'
import { Save, Settings } from 'lucide-react'
import toast from 'react-hot-toast'
import { settingsService } from '../../services/settings'
import type { AssociationSettings } from '../../types'

export default function SettingsPage() {
  const [settings, setSettings] = useState<AssociationSettings | null>(null)
  const [defaultCash, setDefaultCash] = useState('')
  const [maxCash, setMaxCash] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    try {
      const res = await settingsService.get()
      setSettings(res.data)
      setDefaultCash(res.data.default_cash_balance)
      setMaxCash(res.data.max_cash_before_sangria)
    } catch {
      toast.error('Erro ao carregar configurações.')
    }
  }

  useEffect(() => { load() }, [])

  const handleSave = async () => {
    const dc = parseFloat(defaultCash)
    const mc = parseFloat(maxCash)
    if (isNaN(dc) || isNaN(mc) || dc < 0 || mc < 0) {
      toast.error('Valores inválidos.')
      return
    }
    if (mc < dc) {
      toast.error('O limite máximo deve ser maior ou igual ao fundo de caixa.')
      return
    }
    setLoading(true)
    try {
      const res = await settingsService.update({ default_cash_balance: dc, max_cash_before_sangria: mc })
      setSettings(res.data)
      toast.success('Configurações salvas!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

  return (
    <div className="flex flex-col gap-6 p-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Settings className="w-6 h-6 text-[#26619c]" />
        Configurações
      </h1>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-5">
        <div>
          <h2 className="font-semibold text-gray-800 mb-1">Caixa</h2>
          <p className="text-xs text-gray-400 mb-4">Configurações por associação. Cada associação tem seus próprios valores.</p>

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fundo de caixa (valor padrão ao final do dia)
              </label>
              <p className="text-xs text-gray-400 mb-2">
                O saldo que deve permanecer no caixa ao fim do dia. O excedente deve ser retirado via sangria.
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
                <input
                  type="number" min="0" step="0.01" value={defaultCash}
                  onChange={e => setDefaultCash(e.target.value)}
                  className={`${inputCls} pl-9`} placeholder="200.00"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Limite máximo no caixa antes de sangria obrigatória
              </label>
              <p className="text-xs text-gray-400 mb-2">
                Quando o saldo do caixa atingir este valor, uma sangria deve ser realizada.
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
                <input
                  type="number" min="0" step="0.01" value={maxCash}
                  onChange={e => setMaxCash(e.target.value)}
                  className={`${inputCls} pl-9`} placeholder="500.00"
                />
              </div>
            </div>
          </div>
        </div>

        {settings && (
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 border border-gray-100">
            <p>Configuração atual:</p>
            <p>Fundo de caixa: <strong>R$ {parseFloat(settings.default_cash_balance).toFixed(2)}</strong></p>
            <p>Limite máximo: <strong>R$ {parseFloat(settings.max_cash_before_sangria).toFixed(2)}</strong></p>
          </div>
        )}

        <button onClick={handleSave} disabled={loading}
          className="flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-50">
          <Save className="w-4 h-4" />
          {loading ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </div>
    </div>
  )
}
