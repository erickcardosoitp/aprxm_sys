import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { escInputCls, escInputStyle, EscButton } from './EscFormKit'
import { escService } from '../../services/esc'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

export function CategoriasSection() {
  const [rows, setRows] = useState<any[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState('income')
  const [saving, setSaving] = useState(false)

  const load = () => escService.categorias().then((r) => setRows(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!name.trim()) { toast.error('Informe o nome.'); return }
    setSaving(true)
    try {
      await escService.criarCategoria({ name: name.trim(), type })
      setName(''); toast.success('Categoria criada.'); load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao criar.') }
    finally { setSaving(false) }
  }

  return (
    <div className="px-6 py-4 max-w-2xl" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div className="flex gap-2 mb-4">
        <select className={escInputCls} style={{ ...escInputStyle, maxWidth: 140 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="income">Receita</option>
          <option value="expense">Despesa</option>
        </select>
        <input className={escInputCls} style={escInputStyle} placeholder="Nova categoria" value={name}
               onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <EscButton onClick={add} disabled={saving}><Plus className="w-4 h-4" /></EscButton>
      </div>
      <ul className="border-t" style={{ borderColor: BORDER }}>
        {rows.length === 0 && <li className="py-6 text-center text-sm" style={{ color: TEXT_MUTED, fontFamily: "'IBM Plex Mono', monospace" }}>nenhuma categoria da empresa</li>}
        {rows.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 border-b text-sm" style={{ borderColor: BORDER }}>
            <span>{c.name}</span>
            <span className="text-xs px-2 py-0.5" style={{ color: TEXT_MUTED, border: `1px solid ${BORDER}` }}>{c.type === 'income' ? 'Receita' : 'Despesa'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function FormasPagamentoSection() {
  const [rows, setRows] = useState<any[]>([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => escService.formasPagamento().then((r) => setRows(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!name.trim()) { toast.error('Informe o nome.'); return }
    setSaving(true)
    try {
      await escService.criarForma({ name: name.trim() })
      setName(''); toast.success('Forma de pagamento criada.'); load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao criar.') }
    finally { setSaving(false) }
  }

  return (
    <div className="px-6 py-4 max-w-2xl" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div className="flex gap-2 mb-4">
        <input className={escInputCls} style={escInputStyle} placeholder="Nova forma de pagamento" value={name}
               onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <EscButton onClick={add} disabled={saving}><Plus className="w-4 h-4" /></EscButton>
      </div>
      <ul className="border-t" style={{ borderColor: BORDER }}>
        {rows.length === 0 && <li className="py-6 text-center text-sm" style={{ color: TEXT_MUTED, fontFamily: "'IBM Plex Mono', monospace" }}>nenhuma forma da empresa</li>}
        {rows.map((p) => (
          <li key={p.id} className="py-2 border-b text-sm" style={{ borderColor: BORDER }}>{p.name}</li>
        ))}
      </ul>
    </div>
  )
}
