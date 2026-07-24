import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import html2canvas from 'html2canvas'
import { Download, FileSpreadsheet, X } from 'lucide-react'
import { escService } from '../../../services/esc'
import { EscButton, EscField, EscModal, EscSelect, escInputCls, escInputStyle, ESC_ACCENT } from '../EscFormKit'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

const TIPOS = [
  { key: 'entrada', label: 'Entrada' },
  { key: 'saida', label: 'Saída' },
  { key: 'sangria', label: 'Sangria' },
  { key: 'estorno', label: 'Estorno' },
  { key: 'devolucao', label: 'Devolução' },
]
const PRODUTOS = [
  { key: 'mensalidade', label: 'Mensalidade' },
  { key: 'delivery_fee', label: 'Taxa de Entrega' },
  { key: 'proof_of_residence', label: 'Comprovante de Residência' },
  { key: 'other', label: 'Outras' },
]
const CARGOS = ['conferente', 'admin', 'admin_master', 'diretoria', 'diretoria_adjunta', 'conselho', 'operator']
const CARGO_LABEL: Record<string, string> = {
  conferente: 'Conferente', admin: 'Administrador', admin_master: 'Admin Master',
  diretoria: 'Diretoria', diretoria_adjunta: 'Diretoria Adjunta', conselho: 'Conselho', operator: 'Operador',
}
const STATUS_MORADOR_LABEL: Record<string, string> = { active: 'Ativo', inactive: 'Inativo', suspended: 'Suspenso' }
const PERIODOS = [
  { key: 'week', label: 'Semana' }, { key: 'month', label: 'Mês' },
  { key: 'quarter', label: 'Trimestre' }, { key: 'year', label: 'Ano' },
]

function periodoToRange(periodo: string): { date_from: string; date_to: string } {
  const now = new Date()
  const to = now.toISOString().slice(0, 10)
  let from: Date
  if (periodo === 'week') from = new Date(now.getTime() - 7 * 86400000)
  else if (periodo === 'quarter') from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
  else if (periodo === 'year') from = new Date(now.getFullYear(), 0, 1)
  else from = new Date(now.getFullYear(), now.getMonth(), 1)
  return { date_from: from.toISOString().slice(0, 10), date_to: to }
}

interface Row {
  'Data/hora': string; 'Tipo Movimentação': string; 'Associação': string; 'Morador': string
  'Valor': number; 'Produto': string; 'Status Morador': string; 'Usuário': string
}

export default function MovimentacoesSection() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState('month')
  const [tipo, setTipo] = useState<string[]>([])
  const [produto, setProduto] = useState<string[]>([])
  const [morador, setMorador] = useState('')
  const [rua, setRua] = useState('')
  const [inadimplente, setInadimplente] = useState<'' | 'sim' | 'nao'>('')
  const [usuarioId, setUsuarioId] = useState('')
  const [cargo, setCargo] = useState('')
  const [usuarios, setUsuarios] = useState<{ id: string; full_name: string }[]>([])
  const [detalhe, setDetalhe] = useState<Row | null>(null)
  const detalheRef = useRef<HTMLDivElement>(null)

  useEffect(() => { escService.usuarios().then((r) => setUsuarios(r.data)).catch(() => {}) }, [])

  const params = useMemo(() => {
    const { date_from, date_to } = periodoToRange(periodo)
    const p: Record<string, any> = { date_from, date_to }
    if (tipo.length) p.tipo = tipo
    if (produto.length) p.produto = produto
    if (morador.trim()) p.morador = morador.trim()
    if (rua.trim()) p.rua = rua.trim()
    if (inadimplente) p.inadimplente = inadimplente === 'sim'
    if (usuarioId) p.usuario_id = usuarioId
    if (cargo) p.cargo = cargo
    return p
  }, [periodo, tipo, produto, morador, rua, inadimplente, usuarioId, cargo])

  useEffect(() => {
    setLoading(true)
    escService.movimentacoes(params)
      .then((r) => setRows(r.data))
      .catch(() => toast.error('Erro ao carregar movimentações.'))
      .finally(() => setLoading(false))
  }, [params])

  const toggle = (arr: string[], key: string, set: (v: string[]) => void) =>
    set(arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key])

  const handleExport = async () => {
    try {
      const res = await escService.movimentacoesExport(params)
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url; a.download = 'movimentacoes.xlsx'; a.click()
      window.URL.revokeObjectURL(url)
    } catch { toast.error('Erro ao exportar xlsx.') }
  }

  const handlePng = async () => {
    if (!detalheRef.current) return
    try {
      const canvas = await html2canvas(detalheRef.current, { scale: 2, backgroundColor: '#ffffff' })
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a'); a.href = url; a.download = 'movimentacao.png'; a.click()
    } catch { toast.error('Erro ao exportar imagem.') }
  }

  const total = rows.reduce((s, r) => s + Number(r.Valor), 0)

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b flex flex-col gap-2" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2 flex-wrap">
          {PERIODOS.map((p) => (
            <button key={p.key} onClick={() => setPeriodo(p.key)}
              className="text-xs px-2.5 py-1 rounded-full font-medium transition border"
              style={periodo === p.key ? { backgroundColor: '#fff', color: ESC_ACCENT, borderColor: ESC_ACCENT } : { backgroundColor: '#fff', color: TEXT_MUTED, borderColor: BORDER }}>
              {p.label}
            </button>
          ))}
          <span className="mx-1 text-slate-300">|</span>
          {TIPOS.map((t) => (
            <button key={t.key} onClick={() => toggle(tipo, t.key, setTipo)}
              className="text-xs px-2.5 py-1 rounded-full font-medium transition border"
              style={tipo.includes(t.key) ? { backgroundColor: '#fff', color: ESC_ACCENT, borderColor: ESC_ACCENT } : { color: TEXT_MUTED, borderColor: BORDER }}>
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs" style={{ color: TEXT_MUTED }}>{loading ? 'carregando…' : `${rows.length} lançamento(s) · R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}</span>
            <EscButton variant="ghost" onClick={handleExport}><FileSpreadsheet className="w-4 h-4 inline mr-1" />Exportar xlsx</EscButton>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {PRODUTOS.map((p) => (
            <button key={p.key} onClick={() => toggle(produto, p.key, setProduto)}
              className="text-[11px] px-2 py-1 rounded-full font-medium transition border"
              style={produto.includes(p.key) ? { backgroundColor: '#fff', color: ESC_ACCENT, borderColor: ESC_ACCENT } : { color: TEXT_MUTED, borderColor: BORDER }}>
              {p.label}
            </button>
          ))}
          <span className="mx-1 text-slate-300">|</span>
          <EscField label="Morador">
            <input className={escInputCls + ' w-36'} style={escInputStyle} value={morador} onChange={(e) => setMorador(e.target.value)} />
          </EscField>
          <EscField label="Rua">
            <input className={escInputCls + ' w-32'} style={escInputStyle} value={rua} onChange={(e) => setRua(e.target.value)} />
          </EscField>
          <EscField label="Inadimplente">
            <EscSelect className="w-32" value={inadimplente} onChange={(e) => setInadimplente(e.target.value as any)}>
              <option value="">Todos</option>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </EscSelect>
          </EscField>
          <EscField label="Usuário">
            <EscSelect className="w-40" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
              <option value="">Todos</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </EscSelect>
          </EscField>
          <EscField label="Cargo">
            <EscSelect className="w-32" value={cargo} onChange={(e) => setCargo(e.target.value)}>
              <option value="">Todos</option>
              {CARGOS.map((c) => <option key={c} value={c}>{CARGO_LABEL[c] ?? c}</option>)}
            </EscSelect>
          </EscField>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-2">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b" style={{ borderColor: BORDER }}>
              {['Data/hora', 'Tipo', 'Associação', 'Morador', 'Valor', 'Produto', 'Status Morador', 'Usuário'].map((h) => (
                <th key={h} className="text-left py-2 pr-4 font-medium whitespace-nowrap" style={{ color: TEXT_MUTED }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED }}>nenhuma movimentação no período/filtro.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-b hover:bg-slate-50 cursor-pointer" style={{ borderColor: BORDER }} onClick={() => setDetalhe(r)}>
                <td className="py-2 pr-4 whitespace-nowrap">{new Date(r['Data/hora']).toLocaleString('pt-BR')}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r['Tipo Movimentação']}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r['Associação']}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r['Morador']}</td>
                <td className="py-2 pr-4 whitespace-nowrap font-medium">R$ {Number(r.Valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r['Produto']}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{STATUS_MORADOR_LABEL[r['Status Morador']] ?? r['Status Morador']}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r['Usuário']}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm bg-white shadow-2xl border" style={{ borderColor: BORDER }}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: BORDER }}>
              <h2 className="text-sm font-semibold text-slate-800">Movimentação</h2>
              <button onClick={() => setDetalhe(null)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div ref={detalheRef} className="px-5 py-4 flex flex-col gap-2 bg-white">
              {(Object.keys(detalhe) as (keyof Row)[]).map((k) => (
                <div key={k} className="flex justify-between text-sm">
                  <span style={{ color: TEXT_MUTED }}>{k}</span>
                  <span className="font-medium text-right">
                    {k === 'Valor' ? `R$ ${Number(detalhe[k]).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                      : k === 'Data/hora' ? new Date(detalhe[k]).toLocaleString('pt-BR')
                      : k === 'Status Morador' ? (STATUS_MORADOR_LABEL[detalhe[k]] ?? detalhe[k])
                      : String(detalhe[k])}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t flex justify-end" style={{ borderColor: BORDER }}>
              <EscButton variant="ghost" onClick={handlePng}><Download className="w-4 h-4 inline mr-1" />Baixar PNG</EscButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
