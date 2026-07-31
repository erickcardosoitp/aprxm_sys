import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { EscField, escInputCls, escInputStyle } from './EscFormKit'
import { useSort, SortTh } from './EscDataTable'
import { escService } from '../../services/esc'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'
const PAGE_SIZE = 50

const PACKAGE_STATUS_PT: Record<string, string> = {
  received: 'Recebida', notified: 'Notificada', delivered: 'Entregue', returned: 'Devolvida', reversed: 'Revertida',
}

interface Encomenda {
  id: string; status: string; sender_name: string; carrier_name: string
  received_at: string; unidade: string
}

export default function EncomendasSection() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Encomenda[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const params = useMemo(() => {
    const p: Record<string, any> = { skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }
    if (dateFrom) p.date_from = dateFrom
    if (dateTo) p.date_to = dateTo
    if (search.trim()) p.search = search.trim()
    return p
  }, [page, dateFrom, dateTo, search])

  useEffect(() => {
    setLoading(true)
    escService.encomendas(params)
      .then((r) => { setRows(r.data.items); setTotal(r.data.total) })
      .catch(() => toast.error('Erro ao carregar encomendas.'))
      .finally(() => setLoading(false))
  }, [params])

  const { sorted: sortedRows, sortKey, sortDir, toggleSort } = useSort(rows)

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-3 flex items-end gap-3 flex-wrap">
        <EscField label="Recebido de">
          <input type="date" className={escInputCls + ' w-36'} style={escInputStyle} value={dateFrom} onChange={(e) => { setPage(1); setDateFrom(e.target.value) }} />
        </EscField>
        <EscField label="até">
          <input type="date" className={escInputCls + ' w-36'} style={escInputStyle} value={dateTo} onChange={(e) => { setPage(1); setDateTo(e.target.value) }} />
        </EscField>
        <EscField label="Buscar">
          <input className={escInputCls + ' w-44'} style={escInputStyle} placeholder="Remetente ou transportadora"
            value={search} onChange={(e) => { setPage(1); setSearch(e.target.value) }} />
        </EscField>
        <span className="text-xs ml-auto mb-2" style={{ color: TEXT_MUTED }}>{loading ? 'carregando…' : `${total} encomenda(s)`}</span>
      </div>

      <div className="flex-1 overflow-auto px-6 py-2">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b" style={{ borderColor: BORDER }}>
              <SortTh label="Remetente" sortKey="sender_name" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('sender_name')} />
              <SortTh label="Transportadora" sortKey="carrier_name" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('carrier_name')} />
              <SortTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('status')} />
              <SortTh label="Unidade" sortKey="unidade" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('unidade')} />
              <SortTh label="Recebido em" sortKey="received_at" activeKey={sortKey} dir={sortDir} onClick={() => toggleSort('received_at')} />
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED }}>nenhuma encomenda encontrada.</td></tr>
            )}
            {sortedRows.map((r) => (
              <tr key={r.id} className="border-b hover:bg-slate-50" style={{ borderColor: BORDER }}>
                <td className="py-2 pr-4 whitespace-nowrap">{r.sender_name}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r.carrier_name}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{PACKAGE_STATUS_PT[r.status] ?? r.status}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r.unidade}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{new Date(r.received_at).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-6 py-2 border-t flex items-center justify-between" style={{ borderColor: BORDER }}>
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="text-xs disabled:opacity-40" style={{ color: TEXT_MUTED }}>← Anterior</button>
        <span className="text-xs" style={{ color: TEXT_MUTED }}>Página {page} · {total} no total</span>
        <button disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)} className="text-xs disabled:opacity-40" style={{ color: TEXT_MUTED }}>Próxima →</button>
      </div>
    </div>
  )
}
