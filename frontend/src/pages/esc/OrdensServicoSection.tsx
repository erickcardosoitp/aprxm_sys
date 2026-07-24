import { useCallback, useState } from 'react'
import EscDataTable from './EscDataTable'
import { EscField, escInputCls, escInputStyle } from './EscFormKit'
import { escService } from '../../services/esc'

const OS_PRIORITY_PT: Record<string, string> = {
  low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica',
}
const OS_STATUS_PT: Record<string, string> = {
  draft: 'Rascunho', pending: 'Pendente', in_progress: 'Em Andamento',
  resolved: 'Concluída', archived: 'Arquivada', cancelled: 'Cancelada',
}

export default function OrdensServicoSection() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchFn = useCallback(
    () => escService.ordensServico({ date_from: dateFrom || undefined, date_to: dateTo || undefined }),
    [dateFrom, dateTo],
  )

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-3 flex items-end gap-3">
        <EscField label="Criada de" hint="Sem filtro: só as 200 mais recentes">
          <input type="date" className={escInputCls + ' w-36'} style={escInputStyle} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </EscField>
        <EscField label="até">
          <input type="date" className={escInputCls + ' w-36'} style={escInputStyle} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </EscField>
      </div>
      <div className="flex-1 overflow-hidden">
        <EscDataTable
          fetchFn={fetchFn}
          searchKeys={['title']}
          filterKeys={[
            { key: 'unidade', label: 'Unidade' },
            { key: 'priority', label: 'Prioridade' },
            { key: 'status', label: 'Status' },
          ]}
          columns={[
            { key: 'number', label: 'Nº' },
            { key: 'title', label: 'Título' },
            { key: 'priority', label: 'Prioridade', render: (r) => OS_PRIORITY_PT[r.priority] ?? r.priority },
            { key: 'status', label: 'Status', render: (r) => OS_STATUS_PT[r.status] ?? r.status },
            { key: 'unidade', label: 'Unidade' },
            { key: 'created_at', label: 'Criada em', render: (r) => new Date(r.created_at).toLocaleString('pt-BR') },
          ]}
        />
      </div>
    </div>
  )
}
