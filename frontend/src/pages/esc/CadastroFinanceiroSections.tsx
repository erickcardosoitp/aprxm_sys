import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil } from 'lucide-react'
import { escInputCls, escInputStyle, EscButton, EscModal, EscField } from './EscFormKit'
import { escService } from '../../services/esc'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

export function CategoriasSection() {
  const [rows, setRows] = useState<any[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState('income')
  const [saving, setSaving] = useState(false)
  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [editName, setEditName] = useState('')

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

  const saveEdit = async () => {
    if (!editTarget || !editName.trim()) { toast.error('Informe o nome.'); return }
    try {
      await escService.editarCategoria(editTarget.id, { name: editName.trim() })
      toast.success('Categoria atualizada.'); setEditTarget(null); load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao editar.') }
  }

  const toggleActive = async (c: any) => {
    try {
      await escService.editarCategoria(c.id, { is_active: !c.is_active })
      toast.success(c.is_active ? 'Categoria desativada.' : 'Categoria reativada.'); load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao atualizar.') }
  }

  return (
    <div className="px-6 py-4 max-w-2xl h-full overflow-y-auto" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <p className="text-xs mb-3" style={{ color: TEXT_MUTED }}>
        Categorias usadas para classificar movimentações no Financeiro — valem para toda a empresa.
      </p>
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
        {rows.length === 0 && <li className="py-6 text-center text-sm" style={{ color: TEXT_MUTED, fontFamily: "'IBM Plex Mono', monospace" }}>nenhuma categoria cadastrada</li>}
        {rows.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 border-b text-sm" style={{ borderColor: BORDER, opacity: c.is_active ? 1 : 0.5 }}>
            <span>{c.name}{!c.is_active && <span className="ml-2 text-[10px]" style={{ color: TEXT_MUTED }}>(inativa)</span>}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5" style={{ color: TEXT_MUTED, border: `1px solid ${BORDER}` }}>{c.type === 'income' ? 'Receita' : 'Despesa'}</span>
              <button onClick={() => { setEditTarget(c); setEditName(c.name) }} className="text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => toggleActive(c)} className="text-xs underline" style={{ color: TEXT_MUTED }}>{c.is_active ? 'desativar' : 'reativar'}</button>
            </div>
          </li>
        ))}
      </ul>

      {editTarget && (
        <EscModal title="Editar categoria" onClose={() => setEditTarget(null)}
          footer={<><EscButton variant="ghost" onClick={() => setEditTarget(null)}>Cancelar</EscButton><EscButton onClick={saveEdit}>Salvar</EscButton></>}>
          <EscField label="Nome" required>
            <input className={escInputCls} style={escInputStyle} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </EscField>
        </EscModal>
      )}
    </div>
  )
}

export function CategoriasContasPagarSection() {
  const [rows, setRows] = useState<any[]>([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [editName, setEditName] = useState('')

  const load = () => escService.categoriasContasPagar().then((r) => setRows(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!name.trim()) { toast.error('Informe o nome.'); return }
    setSaving(true)
    try {
      await escService.criarCategoriaContasPagar(name.trim())
      setName(''); toast.success('Categoria criada.'); load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao criar.') }
    finally { setSaving(false) }
  }

  const saveEdit = async () => {
    if (!editTarget || !editName.trim()) { toast.error('Informe o nome.'); return }
    try {
      await escService.editarCategoriaContasPagar(editTarget.id, { name: editName.trim() })
      toast.success('Categoria atualizada.'); setEditTarget(null); load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao editar.') }
  }

  const toggleActive = async (c: any) => {
    try {
      await escService.editarCategoriaContasPagar(c.id, { is_active: !c.is_active })
      toast.success(c.is_active ? 'Categoria desativada.' : 'Categoria reativada.'); load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao atualizar.') }
  }

  return (
    <div className="px-6 py-4 max-w-2xl h-full overflow-y-auto" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <p className="text-xs mb-3" style={{ color: TEXT_MUTED }}>
        Categorias usadas só em Contas a Pagar (ex: Aluguel, Energia, Manutenção) — conceito separado das
        categorias de movimentação do Financeiro.
      </p>
      <div className="flex gap-2 mb-4">
        <input className={escInputCls} style={escInputStyle} placeholder="Nova categoria de conta a pagar" value={name}
               onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <EscButton onClick={add} disabled={saving}><Plus className="w-4 h-4" /></EscButton>
      </div>
      <ul className="border-t" style={{ borderColor: BORDER }}>
        {rows.length === 0 && <li className="py-6 text-center text-sm" style={{ color: TEXT_MUTED, fontFamily: "'IBM Plex Mono', monospace" }}>nenhuma categoria cadastrada</li>}
        {rows.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 border-b text-sm" style={{ borderColor: BORDER, opacity: c.is_active ? 1 : 0.5 }}>
            <span>{c.name}{!c.is_active && <span className="ml-2 text-[10px]" style={{ color: TEXT_MUTED }}>(inativa)</span>}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => { setEditTarget(c); setEditName(c.name) }} className="text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => toggleActive(c)} className="text-xs underline" style={{ color: TEXT_MUTED }}>{c.is_active ? 'desativar' : 'reativar'}</button>
            </div>
          </li>
        ))}
      </ul>

      {editTarget && (
        <EscModal title="Editar categoria" onClose={() => setEditTarget(null)}
          footer={<><EscButton variant="ghost" onClick={() => setEditTarget(null)}>Cancelar</EscButton><EscButton onClick={saveEdit}>Salvar</EscButton></>}>
          <EscField label="Nome" required>
            <input className={escInputCls} style={escInputStyle} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </EscField>
        </EscModal>
      )}
    </div>
  )
}

export function FormasPagamentoSection() {
  const [rows, setRows] = useState<any[]>([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [editName, setEditName] = useState('')

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

  const saveEdit = async () => {
    if (!editTarget || !editName.trim()) { toast.error('Informe o nome.'); return }
    try {
      await escService.editarForma(editTarget.id, { name: editName.trim() })
      toast.success('Forma de pagamento atualizada.'); setEditTarget(null); load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao editar.') }
  }

  const toggleActive = async (p: any) => {
    try {
      await escService.editarForma(p.id, { is_active: !p.is_active })
      toast.success(p.is_active ? 'Forma desativada.' : 'Forma reativada.'); load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao atualizar.') }
  }

  return (
    <div className="px-6 py-4 max-w-2xl h-full overflow-y-auto" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <p className="text-xs mb-3" style={{ color: TEXT_MUTED }}>
        Formas de pagamento aceitas nas movimentações do Financeiro — valem para toda a empresa.
      </p>
      <div className="flex gap-2 mb-4">
        <input className={escInputCls} style={escInputStyle} placeholder="Nova forma de pagamento" value={name}
               onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <EscButton onClick={add} disabled={saving}><Plus className="w-4 h-4" /></EscButton>
      </div>
      <ul className="border-t" style={{ borderColor: BORDER }}>
        {rows.length === 0 && <li className="py-6 text-center text-sm" style={{ color: TEXT_MUTED, fontFamily: "'IBM Plex Mono', monospace" }}>nenhuma forma de pagamento cadastrada</li>}
        {rows.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2 border-b text-sm" style={{ borderColor: BORDER, opacity: p.is_active ? 1 : 0.5 }}>
            <span>{p.name}{!p.is_active && <span className="ml-2 text-[10px]" style={{ color: TEXT_MUTED }}>(inativa)</span>}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => { setEditTarget(p); setEditName(p.name) }} className="text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => toggleActive(p)} className="text-xs underline" style={{ color: TEXT_MUTED }}>{p.is_active ? 'desativar' : 'reativar'}</button>
            </div>
          </li>
        ))}
      </ul>

      {editTarget && (
        <EscModal title="Editar forma de pagamento" onClose={() => setEditTarget(null)}
          footer={<><EscButton variant="ghost" onClick={() => setEditTarget(null)}>Cancelar</EscButton><EscButton onClick={saveEdit}>Salvar</EscButton></>}>
          <EscField label="Nome" required>
            <input className={escInputCls} style={escInputStyle} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </EscField>
        </EscModal>
      )}
    </div>
  )
}
