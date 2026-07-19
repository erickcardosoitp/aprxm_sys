import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Eye } from 'lucide-react'
import EscDataTable from './EscDataTable'
import { EscModal, EscField, EscButton, escInputCls, escInputStyle } from './EscFormKit'
import { escService } from '../../services/esc'
import { useAuthStore } from '../../store/authStore'

interface Assoc { id: string; name: string }

export default function InventarioEncomendasSection() {
  const empresaId = useAuthStore((s) => s.empresaId)
  const [units, setUnits] = useState<Assoc[]>([])
  const [showForm, setShowForm] = useState(false)
  const [assoc, setAssoc] = useState('')
  const [dia, setDia] = useState('')
  const [hora, setHora] = useState('')
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [detail, setDetail] = useState<any | null>(null)

  useEffect(() => {
    escService.associacoes().then((r) => setUnits((r.data as Assoc[]).filter((a) => a.id !== empresaId))).catch(() => {})
  }, [empresaId])

  const gerar = async () => {
    if (!assoc || !dia || !hora) { toast.error('Selecione associação, dia e hora.'); return }
    setSaving(true)
    try {
      const r = await escService.gerarInventarioEncomendas(assoc, `${dia}T${hora}:00`)
      toast.success(`Inventário gerado: ${r.data.total} encomenda(s).`)
      setShowForm(false); setAssoc(''); setDia(''); setHora(''); setReloadKey((k) => k + 1)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao gerar inventário.') }
    finally { setSaving(false) }
  }

  const verDetalhe = async (id: string) => {
    try { const r = await escService.detalheInventarioEncomendas(id); setDetail(r.data) }
    catch { toast.error('Erro ao carregar detalhe.') }
  }

  const fmt = (s: string) => { try { return new Date(s).toLocaleString('pt-BR') } catch { return s } }

  return (
    <>
      <EscDataTable
        fetchFn={escService.inventarioEncomendas}
        searchKeys={['unidade', 'por']}
        reloadKey={reloadKey}
        filterKeys={[{ key: 'unidade', label: 'Unidade' }]}
        toolbarAction={<EscButton onClick={() => setShowForm(true)}><span className="inline-flex items-center gap-1"><Plus className="w-4 h-4" />Novo inventário</span></EscButton>}
        columns={[
          { key: 'unidade', label: 'Unidade' },
          { key: 'reference_at', label: 'Referência', render: (r) => fmt(r.reference_at) },
          { key: 'total', label: 'Encomendas' },
          { key: 'por', label: 'Gerado por' },
          { key: 'created_at', label: 'Gerado em', render: (r) => fmt(r.created_at) },
        ]}
        rowActions={(r) => (
          <button onClick={() => verDetalhe(r.id)} className="text-slate-500 hover:text-slate-800" title="Ver itens"><Eye className="w-4 h-4" /></button>
        )}
      />

      {showForm && (
        <EscModal
          title="Novo inventário de encomendas"
          onClose={() => setShowForm(false)}
          footer={<>
            <EscButton variant="ghost" onClick={() => setShowForm(false)}>Cancelar</EscButton>
            <EscButton onClick={gerar} disabled={saving}>{saving ? 'Gerando…' : 'Gerar'}</EscButton>
          </>}
        >
          <EscField label="Associação">
            <select className={escInputCls} style={escInputStyle} value={assoc} onChange={(e) => setAssoc(e.target.value)}>
              <option value="">Selecione…</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </EscField>
          <EscField label="Dia">
            <input className={escInputCls} style={escInputStyle} type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
          </EscField>
          <EscField label="Hora">
            <input className={escInputCls} style={escInputStyle} type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </EscField>
          <p className="text-xs" style={{ color: '#64748b' }}>Conta as encomendas a entregar fisicamente na associação no dia/hora escolhidos.</p>
        </EscModal>
      )}

      {detail && (
        <EscModal
          title={`Inventário — ${detail.unidade} (${detail.total})`}
          onClose={() => setDetail(null)}
          footer={<EscButton variant="ghost" onClick={() => setDetail(null)}>Fechar</EscButton>}
        >
          <p className="text-xs mb-2" style={{ color: '#64748b' }}>Referência: {fmt(detail.reference_at)}</p>
          {(!detail.items || detail.items.length === 0) && <p className="text-sm" style={{ color: '#64748b' }}>Nenhuma encomenda no momento.</p>}
          {(detail.items ?? []).map((it: any) => (
            <div key={it.id} className="text-sm border-b py-1.5" style={{ borderColor: '#e2e8f0' }}>
              <div className="font-medium">{it.morador || it.sender_name || '—'}</div>
              <div className="text-xs" style={{ color: '#64748b' }}>{it.carrier_name || ''} {it.tracking_code ? `· ${it.tracking_code}` : ''} · {fmt(it.received_at)}</div>
            </div>
          ))}
        </EscModal>
      )}
    </>
  )
}
