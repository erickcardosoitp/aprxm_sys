import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil } from 'lucide-react'
import { escInputCls, escInputStyle, EscButton, EscModal, EscField } from './EscFormKit'
import { useSort, SortTh } from './EscDataTable'
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

export function ProdutosSection() {
  const [rows, setRows] = useState<any[]>([])
  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [precoAssociado, setPrecoAssociado] = useState('')
  const [precoNaoAssociado, setPrecoNaoAssociado] = useState('')
  const [saving, setSaving] = useState(false)
  const [conflito, setConflito] = useState<{ divergentes: any[]; novo_valor: string } | null>(null)

  const load = () => escService.produtos().then((r) => setRows(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const openEdit = (p: any) => {
    setEditTarget(p); setPrecoAssociado(p.preco_associado); setPrecoNaoAssociado(p.preco_nao_associado); setConflito(null)
  }

  const { sorted: sortedRows, sortKey, sortDir, toggleSort } = useSort(rows)

  const doSave = async (force: boolean, aplicarDivergentes: boolean) => {
    if (!editTarget) return
    setSaving(true)
    try {
      const r = await escService.editarProduto(editTarget.id, {
        preco_associado: precoAssociado, preco_nao_associado: precoNaoAssociado,
        force, aplicar_divergentes: aplicarDivergentes,
      })
      if (r.data?.conflito) {
        setConflito({ divergentes: r.data.divergentes, novo_valor: r.data.novo_valor })
        return
      }
      toast.success('Produto atualizado.'); setEditTarget(null); setConflito(null); load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao salvar.') }
    finally { setSaving(false) }
  }

  return (
    <div className="px-6 py-4 max-w-3xl h-full overflow-y-auto" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <p className="text-xs mb-3" style={{ color: TEXT_MUTED }}>
        Preço padrão de cada produto — Mensalidade é um valor sugerido (cada associação pode ter o seu próprio,
        configurado em Config). Taxa de Entrega e Comprovante de Residência usam o preço não-associado diretamente.
      </p>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b" style={{ borderColor: BORDER }}>
            <SortTh label="Produto" sortKey="name" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('name')} />
            <SortTh label="Preço Associado" sortKey="preco_associado" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('preco_associado')} />
            <SortTh label="Preço Não Associado" sortKey="preco_nao_associado" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('preco_nao_associado')} />
            <th className="py-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((p) => (
            <tr key={p.id} className="border-b" style={{ borderColor: BORDER }}>
              <td className="py-2 pr-4">{p.name}</td>
              <td className="py-2 pr-4">R$ {Number(p.preco_associado).toFixed(2)}</td>
              <td className="py-2 pr-4">R$ {Number(p.preco_nao_associado).toFixed(2)}</td>
              <td className="py-2 pr-4 text-right">
                <button onClick={() => openEdit(p)} className="text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editTarget && !conflito && (
        <EscModal title={`Editar preço — ${editTarget.name}`} onClose={() => setEditTarget(null)}
          footer={<><EscButton variant="ghost" onClick={() => setEditTarget(null)}>Cancelar</EscButton><EscButton onClick={() => doSave(false, false)} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</EscButton></>}>
          <EscField label="Preço Associado" required>
            <input className={escInputCls} style={escInputStyle} type="number" step="0.01" min="0" value={precoAssociado} onChange={(e) => setPrecoAssociado(e.target.value)} />
          </EscField>
          <EscField label="Preço Não Associado" required>
            <input className={escInputCls} style={escInputStyle} type="number" step="0.01" min="0" value={precoNaoAssociado} onChange={(e) => setPrecoNaoAssociado(e.target.value)} />
          </EscField>
        </EscModal>
      )}

      {editTarget && conflito && (
        <EscModal title="Valor diferente nas associações" onClose={() => setConflito(null)}
          footer={
            <>
              <EscButton variant="ghost" onClick={() => doSave(true, false)} disabled={saving}>Respeitar valor da associação</EscButton>
              <EscButton onClick={() => doSave(true, true)} disabled={saving}>Aplicar novo valor a todas</EscButton>
            </>
          }>
          <p className="text-sm mb-3" style={{ color: TEXT_MUTED }}>
            Estas associações já têm um valor de mensalidade diferente do padrão atual — escolha se o novo valor
            (R$ {Number(conflito.novo_valor).toFixed(2)}) deve sobrescrever essas associações também, ou se elas
            devem manter o que já está configurado.
          </p>
          <ul className="border-t" style={{ borderColor: BORDER }}>
            {conflito.divergentes.map((d) => (
              <li key={d.association_id} className="flex justify-between py-1.5 border-b text-sm" style={{ borderColor: BORDER }}>
                <span>{d.name}</span>
                <span className="font-medium">R$ {Number(d.valor_atual).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </EscModal>
      )}
    </div>
  )
}
