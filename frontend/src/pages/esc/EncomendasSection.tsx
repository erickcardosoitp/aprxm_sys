import { useCallback, useState } from 'react'
import EscDataTable from './EscDataTable'
import { EscField, escInputCls, escInputStyle } from './EscFormKit'
import { escService } from '../../services/esc'

const PACKAGE_STATUS_PT: Record<string, string> = {
  received: 'Recebida', notified: 'Notificada', delivered: 'Entregue', returned: 'Devolvida', reversed: 'Revertida',
}

export default function EncomendasSection() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchFn = useCallback(
    () => escService.encomendas({ date_from: dateFrom || undefined, date_to: dateTo || undefined }),
    [dateFrom, dateTo],
  )

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-3 flex items-end gap-3">
        <EscField label="Recebido de" hint="Sem filtro: só as 200 mais recentes">
          <input type="date" className={escInputCls + ' w-36'} style={escInputStyle} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </EscField>
        <EscField label="até">
          <input type="date" className={escInputCls + ' w-36'} style={escInputStyle} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </EscField>
      </div>
      <div className="flex-1 overflow-hidden">
        <EscDataTable
          fetchFn={fetchFn}
          searchKeys={['sender_name', 'carrier_name']}
          filterKeys={[
            { key: 'unidade', label: 'Unidade' },
            { key: 'status', label: 'Status' },
            { key: 'carrier_name', label: 'Transportadora' },
          ]}
          columns={[
            { key: 'sender_name', label: 'Remetente' },
            { key: 'carrier_name', label: 'Transportadora' },
            { key: 'status', label: 'Status', render: (r) => PACKAGE_STATUS_PT[r.status] ?? r.status },
            { key: 'unidade', label: 'Unidade' },
            { key: 'received_at', label: 'Recebido em', render: (r) => new Date(r.received_at).toLocaleString('pt-BR') },
          ]}
        />
      </div>
    </div>
  )
}
