import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Download, RotateCcw, X } from 'lucide-react'
import { escService } from '../../../services/esc'
import { EscButton, EscField, EscSelect, escInputCls, escInputStyle } from '../EscFormKit'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'
const fmt = (v: number | null) => v == null ? '—' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

interface Sessao {
  id: string; unidade: string; opened_at: string; closed_at: string | null
  usuario: string; conferido_por: string; origin: string
  entradas: number; saidas: number; estornos: number
  bruto_pix: number; bruto_dinheiro: number; baixas: number; liquido: number
  quebra_caixa: number | null; sobra_falta: number | null; qtd_mensalidades: number
  dinheiro_contado: number | null; pix_contado: number | null; quebra_motivo: string | null
}

export default function SessoesCaixaSection() {
  const [rows, setRows] = useState<Sessao[]>([])
  const [associacoes, setAssociacoes] = useState<{ id: string; name: string }[]>([])
  const [unidade, setUnidade] = useState('')
  const [loading, setLoading] = useState(true)
  const [detalhe, setDetalhe] = useState<Sessao | null>(null)
  const [pdfTarget, setPdfTarget] = useState<Sessao | null>(null)
  const [pdfForm, setPdfForm] = useState({ conferente_nome: '', dinheiro_contado: '0', pix_contado: '0', quebra_motivo: '' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    escService.sessoesConferidas(unidade || undefined)
      .then((r) => setRows(r.data))
      .catch(() => toast.error('Erro ao carregar sessões.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { escService.associacoes().then((r) => setAssociacoes(r.data)).catch(() => {}) }, [])
  useEffect(() => { load() }, [unidade])

  const handleReabrir = async (s: Sessao) => {
    if (!confirm(`Reabrir a sessão de ${s.unidade} (${new Date(s.opened_at).toLocaleDateString('pt-BR')})? Ela volta a status "fechada".`)) return
    try {
      await escService.reabrirSessao(s.id)
      toast.success('Sessão reaberta.')
      setDetalhe(null)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao reabrir sessão.')
    }
  }

  const openPdfModal = (s: Sessao) => {
    setPdfTarget(s)
    setPdfForm({
      conferente_nome: s.conferido_por ?? '',
      dinheiro_contado: String(s.dinheiro_contado ?? s.bruto_dinheiro ?? 0),
      pix_contado: String(s.pix_contado ?? s.bruto_pix ?? 0),
      quebra_motivo: s.quebra_motivo ?? '',
    })
  }

  const handleGerarPdf = async () => {
    if (!pdfTarget) return
    setSaving(true)
    try {
      const res = await escService.gerarConferenciaPdf(pdfTarget.id, {
        conferente_nome: pdfForm.conferente_nome,
        dinheiro_contado: Number(pdfForm.dinheiro_contado),
        pix_contado: Number(pdfForm.pix_contado),
        quebra_motivo: pdfForm.quebra_motivo || null,
      })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a'); a.href = url; a.download = `conferencia_${pdfTarget.id}.pdf`; a.click()
      window.URL.revokeObjectURL(url)
      setPdfTarget(null)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao gerar PDF.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b flex items-center gap-3" style={{ borderColor: BORDER }}>
        <EscSelect className="w-56" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
          <option value="">Todas as unidades</option>
          {associacoes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </EscSelect>
        <span className="text-xs ml-auto" style={{ color: TEXT_MUTED }}>{loading ? 'carregando…' : `${rows.length} sessão(ões) conferida(s)`}</span>
      </div>

      <div className="flex-1 overflow-auto px-6 py-2">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b" style={{ borderColor: BORDER }}>
              {['Data/hora', 'Associação', 'Usuário', 'Entradas', 'Saídas', 'Líquido', 'Conferido por', 'Ações'].map((h) => (
                <th key={h} className="text-left py-2 pr-4 font-medium whitespace-nowrap" style={{ color: TEXT_MUTED }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED }}>nenhuma sessão conferida.</td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="border-b hover:bg-slate-50" style={{ borderColor: BORDER }}>
                <td className="py-2 pr-4 whitespace-nowrap cursor-pointer" onClick={() => setDetalhe(s)}>{new Date(s.opened_at).toLocaleString('pt-BR')}</td>
                <td className="py-2 pr-4 whitespace-nowrap cursor-pointer" onClick={() => setDetalhe(s)}>{s.unidade}</td>
                <td className="py-2 pr-4 whitespace-nowrap cursor-pointer" onClick={() => setDetalhe(s)}>{s.usuario}</td>
                <td className="py-2 pr-4 whitespace-nowrap text-green-700 font-medium cursor-pointer" onClick={() => setDetalhe(s)}>{fmt(s.entradas)}</td>
                <td className="py-2 pr-4 whitespace-nowrap text-red-700 cursor-pointer" onClick={() => setDetalhe(s)}>{fmt(s.saidas)}</td>
                <td className="py-2 pr-4 whitespace-nowrap font-semibold cursor-pointer" onClick={() => setDetalhe(s)}>{fmt(s.liquido)}</td>
                <td className="py-2 pr-4 whitespace-nowrap cursor-pointer" onClick={() => setDetalhe(s)}>{s.conferido_por ?? '—'}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  <button title="Reabrir sessão" onClick={() => handleReabrir(s)} className="p-1 text-slate-400 hover:text-orange-600"><RotateCcw className="w-4 h-4" /></button>
                  <button title="2ª via do fechamento" onClick={() => openPdfModal(s)} className="p-1 text-slate-400 hover:text-blue-600"><Download className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm bg-white shadow-2xl border" style={{ borderColor: BORDER }}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: BORDER }}>
              <h2 className="text-sm font-semibold text-slate-800">Sessão de caixa — {detalhe.unidade}</h2>
              <button onClick={() => setDetalhe(null)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-2">
              {[
                ['Aberto em', new Date(detalhe.opened_at).toLocaleString('pt-BR')],
                ['Fechado em', detalhe.closed_at ? new Date(detalhe.closed_at).toLocaleString('pt-BR') : '—'],
                ['Estornos', fmt(detalhe.estornos)],
                ['Qtd. mensalidades pagas', String(detalhe.qtd_mensalidades)],
                ['Bruto PIX', fmt(detalhe.bruto_pix)],
                ['Bruto Dinheiro', fmt(detalhe.bruto_dinheiro)],
                ['Sobra/Falta', fmt(detalhe.sobra_falta)],
                ['Quebra de caixa', fmt(detalhe.quebra_caixa)],
                ['Origem', detalhe.origin],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span style={{ color: TEXT_MUTED }}>{k}</span>
                  <span className="font-medium text-right">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {pdfTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm bg-white shadow-2xl border" style={{ borderColor: BORDER }}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: BORDER }}>
              <h2 className="text-sm font-semibold text-slate-800">2ª via do fechamento</h2>
              <button onClick={() => setPdfTarget(null)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-xs" style={{ color: TEXT_MUTED }}>Valores pré-preenchidos com o que foi registrado na conferência — confirme ou ajuste antes de gerar.</p>
              <EscField label="Conferente">
                <input className={escInputCls} style={escInputStyle} value={pdfForm.conferente_nome}
                  onChange={(e) => setPdfForm((f) => ({ ...f, conferente_nome: e.target.value }))} />
              </EscField>
              <EscField label="Dinheiro contado">
                <input type="number" className={escInputCls} style={escInputStyle} value={pdfForm.dinheiro_contado}
                  onChange={(e) => setPdfForm((f) => ({ ...f, dinheiro_contado: e.target.value }))} />
              </EscField>
              <EscField label="PIX contado">
                <input type="number" className={escInputCls} style={escInputStyle} value={pdfForm.pix_contado}
                  onChange={(e) => setPdfForm((f) => ({ ...f, pix_contado: e.target.value }))} />
              </EscField>
              <EscField label="Motivo da quebra (opcional)">
                <input className={escInputCls} style={escInputStyle} value={pdfForm.quebra_motivo}
                  onChange={(e) => setPdfForm((f) => ({ ...f, quebra_motivo: e.target.value }))} />
              </EscField>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: BORDER }}>
              <EscButton variant="ghost" onClick={() => setPdfTarget(null)}>Cancelar</EscButton>
              <EscButton onClick={handleGerarPdf} disabled={saving}>Gerar PDF</EscButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
