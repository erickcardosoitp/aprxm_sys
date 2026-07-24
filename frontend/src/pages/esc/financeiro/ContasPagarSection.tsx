import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Settings2 } from 'lucide-react'
import { escService } from '../../../services/esc'
import { EscButton, EscField, EscModal, EscSelect, escInputCls, escInputStyle, ESC_ACCENT } from '../EscFormKit'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'
const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

interface Conta {
  id: string; description: string; unidade: string; amount: number; amount_paid: number
  status: string; due_date: string; categoria: string | null; recorrente: boolean; atrasada: boolean
  association_id: string
}
interface CaixaAberto { session_id: string; unidade: string; aberto_por: string; saldo_disponivel: number }
interface Template {
  id: string; name: string; amount: number; due_day: number; is_active: boolean
  unidade: string; association_id: string
}

const STATUS_LABEL: Record<string, string> = { pending: 'Pendente', partial: 'Parcial', paid: 'Paga' }
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600', partial: 'bg-amber-50 text-amber-700', paid: 'bg-green-50 text-green-700',
}

export default function ContasPagarSection() {
  const [contas, setContas] = useState<Conta[]>([])
  const [status, setStatus] = useState('')
  const [unidade, setUnidade] = useState('')
  const [associacoes, setAssociacoes] = useState<{ id: string; name: string }[]>([])
  const [categorias, setCategorias] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)

  const [novaOpen, setNovaOpen] = useState(false)
  const [nova, setNova] = useState({ association_id: '', payable_category_id: '', description: '', amount: '', due_date: '' })
  const [saving, setSaving] = useState(false)

  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [novoTpl, setNovoTpl] = useState({ association_id: '', payable_category_id: '', name: '', amount: '', due_day: '5' })

  const [baixaTarget, setBaixaTarget] = useState<Conta | null>(null)
  const [baixaAmount, setBaixaAmount] = useState('')
  const [caixasUnidade, setCaixasUnidade] = useState<CaixaAberto[]>([])
  const [baixaCashSessionId, setBaixaCashSessionId] = useState('')

  const load = () => {
    setLoading(true)
    escService.contasPagar({ status: status || undefined, unidade: unidade || undefined })
      .then((r) => setContas(r.data))
      .catch(() => toast.error('Erro ao carregar contas a pagar.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [status, unidade])
  useEffect(() => {
    escService.associacoes().then((r) => setAssociacoes(r.data)).catch(() => {})
    escService.categoriasContasPagar().then((r) => setCategorias(r.data)).catch(() => {})
  }, [])

  const loadTemplates = () => {
    escService.contasPagarTemplates().then((r) => setTemplates(r.data)).catch(() => toast.error('Erro ao carregar templates.'))
  }

  const handleCriarConta = async () => {
    if (!nova.association_id || !nova.description.trim() || !nova.amount || !nova.due_date) {
      toast.error('Preencha unidade, descrição, valor e vencimento.'); return
    }
    setSaving(true)
    try {
      await escService.criarContaPagar({
        association_id: nova.association_id, payable_category_id: nova.payable_category_id || null,
        description: nova.description.trim(), amount: Number(nova.amount), due_date: nova.due_date,
      })
      toast.success('Conta a pagar lançada.')
      setNovaOpen(false)
      setNova({ association_id: '', payable_category_id: '', description: '', amount: '', due_date: '' })
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao lançar conta.')
    } finally { setSaving(false) }
  }

  const handleCriarTemplate = async () => {
    if (!novoTpl.association_id || !novoTpl.name.trim() || !novoTpl.amount || !novoTpl.due_day) {
      toast.error('Preencha unidade, nome, valor e dia de vencimento.'); return
    }
    try {
      await escService.criarContaPagarTemplate({
        association_id: novoTpl.association_id, payable_category_id: novoTpl.payable_category_id || null,
        name: novoTpl.name.trim(), amount: Number(novoTpl.amount), due_day: Number(novoTpl.due_day),
      })
      toast.success('Template criado.')
      setNovoTpl({ association_id: '', payable_category_id: '', name: '', amount: '', due_day: '5' })
      loadTemplates()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao criar template.')
    }
  }

  const handleGerar = async (tpl: Template) => {
    const mes = new Date().toISOString().slice(0, 7)
    try {
      await escService.gerarContaPagarDoTemplate(tpl.id, mes)
      toast.success(`Conta de ${mes} gerada a partir de "${tpl.name}".`)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao gerar conta do template.')
    }
  }

  const handleToggleTemplate = async (tpl: Template) => {
    try {
      await escService.atualizarContaPagarTemplate(tpl.id, !tpl.is_active)
      loadTemplates()
    } catch { toast.error('Erro ao atualizar template.') }
  }

  const openBaixa = (c: Conta) => {
    setBaixaTarget(c)
    setBaixaAmount(String((c.amount - c.amount_paid).toFixed(2)))
    setBaixaCashSessionId('')
    setCaixasUnidade([])
    escService.caixasAbertos(c.association_id).then((r) => setCaixasUnidade(r.data)).catch(() => {})
  }

  const handleBaixar = async () => {
    if (!baixaTarget || !baixaAmount || Number(baixaAmount) <= 0) { toast.error('Informe um valor válido.'); return }
    try {
      await escService.baixarContaPagar(baixaTarget.id, { amount: Number(baixaAmount), cash_session_id: baixaCashSessionId || null })
      toast.success('Baixa registrada.')
      setBaixaTarget(null)
      setBaixaAmount('')
      setBaixaCashSessionId('')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar baixa.')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b flex items-end gap-3 flex-wrap" style={{ borderColor: BORDER }}>
        <EscField label="Status">
          <EscSelect className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="pending">Pendente</option>
            <option value="partial">Parcial</option>
            <option value="paid">Paga</option>
          </EscSelect>
        </EscField>
        <EscField label="Unidade">
          <EscSelect className="w-48" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
            <option value="">Todas</option>
            {associacoes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </EscSelect>
        </EscField>
        <EscButton variant="ghost" onClick={() => { setTemplatesOpen(true); loadTemplates() }}>
          <Settings2 className="w-4 h-4 inline mr-1" />Templates recorrentes
        </EscButton>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs" style={{ color: TEXT_MUTED }}>{loading ? 'carregando…' : `${contas.length} conta(s)`}</span>
          <EscButton onClick={() => setNovaOpen(true)}><Plus className="w-4 h-4 inline mr-1" />Nova conta</EscButton>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-2">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b" style={{ borderColor: BORDER }}>
              {['Descrição', 'Unidade', 'Vencimento', 'Valor', 'Pago', 'Status', 'Ações'].map((h) => (
                <th key={h} className="text-left py-2 pr-4 font-medium whitespace-nowrap" style={{ color: TEXT_MUTED }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && contas.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED }}>nenhuma conta a pagar.</td></tr>
            )}
            {contas.map((c) => (
              <tr key={c.id} className="border-b hover:bg-slate-50" style={{ borderColor: BORDER }}>
                <td className="py-2 pr-4 whitespace-nowrap">{c.description}{c.recorrente && <span className="ml-1.5 text-[10px]" style={{ color: TEXT_MUTED }}>(recorrente)</span>}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{c.unidade}</td>
                <td className="py-2 pr-4 whitespace-nowrap" style={c.atrasada ? { color: '#dc2626', fontWeight: 500 } : undefined}>
                  {new Date(c.due_date).toLocaleDateString('pt-BR')}{c.atrasada && ' · atrasada'}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap font-medium">{fmt(c.amount)}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{fmt(c.amount_paid)}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {c.status !== 'paid' && (
                    <EscButton variant="ghost" onClick={() => openBaixa(c)}>Baixar</EscButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {novaOpen && (
        <EscModal title="Nova conta a pagar" onClose={() => setNovaOpen(false)}
          footer={<>
            <EscButton variant="ghost" onClick={() => setNovaOpen(false)}>Cancelar</EscButton>
            <EscButton onClick={handleCriarConta} disabled={saving}>Lançar</EscButton>
          </>}>
          <EscField label="Unidade" required>
            <EscSelect value={nova.association_id} onChange={(e) => setNova((n) => ({ ...n, association_id: e.target.value }))}>
              <option value="">Selecione a unidade…</option>
              {associacoes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </EscSelect>
          </EscField>
          <EscField label="Categoria" hint="Opcional — organiza as contas a pagar. Cadastre novas em Cadastros.">
            <EscSelect value={nova.payable_category_id} onChange={(e) => setNova((n) => ({ ...n, payable_category_id: e.target.value }))}>
              <option value="">Sem categoria</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </EscSelect>
          </EscField>
          <EscField label="Descrição" required>
            <input className={escInputCls} style={escInputStyle} placeholder="Ex: Conta de energia — julho/2026"
                   value={nova.description} onChange={(e) => setNova((n) => ({ ...n, description: e.target.value }))} />
          </EscField>
          <EscField label="Valor" required>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: TEXT_MUTED }}>R$</span>
              <input type="number" min="0" step="0.01" placeholder="0,00" className={escInputCls + ' pl-9'} style={escInputStyle}
                     value={nova.amount} onChange={(e) => setNova((n) => ({ ...n, amount: e.target.value }))} />
            </div>
          </EscField>
          <EscField label="Vencimento" required>
            <input type="date" className={escInputCls} style={escInputStyle} value={nova.due_date} onChange={(e) => setNova((n) => ({ ...n, due_date: e.target.value }))} />
          </EscField>
        </EscModal>
      )}

      {templatesOpen && (
        <EscModal title="Templates recorrentes" onClose={() => setTemplatesOpen(false)}>
          <div className="flex flex-col gap-2">
            {templates.length === 0 && <p className="text-sm" style={{ color: TEXT_MUTED }}>Nenhum template cadastrado.</p>}
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between border p-2 text-sm" style={{ borderColor: BORDER }}>
                <div>
                  <p className="font-medium">{t.name} — {fmt(t.amount)}</p>
                  <p className="text-xs" style={{ color: TEXT_MUTED }}>{t.unidade} · todo dia {t.due_day}</p>
                </div>
                <div className="flex items-center gap-2">
                  <EscButton variant="ghost" onClick={() => handleGerar(t)}>Gerar este mês</EscButton>
                  <button onClick={() => handleToggleTemplate(t)} className="text-xs px-2 py-1 border" style={{ borderColor: BORDER, color: t.is_active ? ESC_ACCENT : TEXT_MUTED }}>
                    {t.is_active ? 'Ativo' : 'Inativo'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-3 border-t flex flex-col gap-2" style={{ borderColor: BORDER }}>
            <p className="text-xs font-medium" style={{ color: TEXT_MUTED }}>Novo template</p>
            <div className="flex items-end gap-2 flex-wrap">
              <EscField label="Unidade" required>
                <EscSelect className="w-40" value={novoTpl.association_id} onChange={(e) => setNovoTpl((n) => ({ ...n, association_id: e.target.value }))}>
                  <option value="">Selecione…</option>
                  {associacoes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </EscSelect>
              </EscField>
              <EscField label="Nome" required>
                <input className={escInputCls + ' w-32'} style={escInputStyle} placeholder="Ex: Aluguel" value={novoTpl.name} onChange={(e) => setNovoTpl((n) => ({ ...n, name: e.target.value }))} />
              </EscField>
              <EscField label="Valor" required>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: TEXT_MUTED }}>R$</span>
                  <input type="number" min="0" step="0.01" placeholder="0,00" className={escInputCls + ' w-24 pl-7'} style={escInputStyle} value={novoTpl.amount} onChange={(e) => setNovoTpl((n) => ({ ...n, amount: e.target.value }))} />
                </div>
              </EscField>
              <EscField label="Dia venc." required hint="1 a 28">
                <input type="number" min="1" max="28" className={escInputCls + ' w-20'} style={escInputStyle} value={novoTpl.due_day} onChange={(e) => setNovoTpl((n) => ({ ...n, due_day: e.target.value }))} />
              </EscField>
              <EscButton onClick={handleCriarTemplate}>Criar</EscButton>
            </div>
          </div>
        </EscModal>
      )}

      {baixaTarget && (
        <EscModal title={`Baixar — ${baixaTarget.description}`} onClose={() => setBaixaTarget(null)}
          footer={<>
            <EscButton variant="ghost" onClick={() => setBaixaTarget(null)}>Cancelar</EscButton>
            <EscButton onClick={handleBaixar}>Confirmar baixa</EscButton>
          </>}>
          <p className="text-xs" style={{ color: TEXT_MUTED }}>
            Saldo devedor: {fmt(baixaTarget.amount - baixaTarget.amount_paid)}.
          </p>
          <EscField label="Valor da baixa" required>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: TEXT_MUTED }}>R$</span>
              <input type="number" min="0" step="0.01" className={escInputCls + ' pl-9'} style={escInputStyle} value={baixaAmount} onChange={(e) => setBaixaAmount(e.target.value)} />
            </div>
          </EscField>
          <EscField label="Pagar com" hint={caixasUnidade.length === 0 ? 'Nenhum caixa aberto na unidade — a baixa fica sem caixa, só reduz o faturamento no DRE.' : 'Escolha um caixa aberto pra debitar o valor físico dele, ou deixe sem caixa.'}>
            <EscSelect value={baixaCashSessionId} onChange={(e) => setBaixaCashSessionId(e.target.value)}>
              <option value="">Sem caixa (só reduz faturamento no DRE)</option>
              {caixasUnidade.map((c) => (
                <option key={c.session_id} value={c.session_id}>
                  Caixa de {c.aberto_por} — saldo {fmt(c.saldo_disponivel)}
                </option>
              ))}
            </EscSelect>
          </EscField>
        </EscModal>
      )}
    </div>
  )
}
