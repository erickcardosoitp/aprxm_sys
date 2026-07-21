import { TrendingUp } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscDataTable from './EscDataTable'
import EscEmptySection from './EscEmptySection'
import { escService } from '../../services/esc'

export default function EscFinanceiroPage() {
  return (
    <EscModulePage
      title="Financeiro"
      description="Financeiro consolidado da empresa — todas as unidades."
      icon={TrendingUp}
      sections={[
        { key: 'fluxo', label: 'Fluxo de Caixa', content: <EscEmptySection columns={['Unidade', 'Entrada', 'Saída', 'Saldo']} /> },
        {
          key: 'movimentacoes', label: 'Movimentações',
          content: <EscDataTable
            fetchFn={escService.movimentacoes}
            searchKeys={['description', 'unidade']}
            filterKeys={[{ key: 'unidade', label: 'Unidade' }, { key: 'type', label: 'Tipo' }]}
            columns={[
              { key: 'type', label: 'Tipo' },
              { key: 'description', label: 'Descrição' },
              { key: 'unidade', label: 'Unidade' },
              { key: 'amount', label: 'Valor', render: (r) => `R$ ${r.amount}` },
              { key: 'transaction_at', label: 'Data' },
            ]}
          />,
        },
        { key: 'crm', label: 'CRM', content: <EscEmptySection columns={['Morador', 'Endereço', 'Status', 'R$ Atrasado', 'Ações/mês']} /> },
        {
          key: 'sessoes', label: 'Sessões de Caixa',
          content: <EscDataTable
            fetchFn={escService.sessoesConferidas}
            searchKeys={['unidade']}
            filterKeys={[{ key: 'unidade', label: 'Unidade' }, { key: 'status', label: 'Status' }]}
            columns={[
              { key: 'unidade', label: 'Unidade' },
              { key: 'opening_balance', label: 'Saldo Abertura', render: (r) => `R$ ${r.opening_balance}` },
              { key: 'status', label: 'Status' },
              { key: 'opened_at', label: 'Aberta em' },
            ]}
          />,
        },
        { key: 'dre', label: 'DRE', content: <EscEmptySection columns={['Unidade', 'Receita', 'Despesa', 'Resultado']} /> },
        { key: 'contas-pagar', label: 'Contas a Pagar', content: <EscEmptySection columns={['Descrição', 'Unidade', 'Vencimento', 'Valor', 'Status']} /> },
        { key: 'contas-receber', label: 'Contas a Receber', content: <EscEmptySection columns={['Morador', 'Unidade', 'Origem', 'Valor']} /> },
        {
          key: 'sangrias', label: 'Sangrias',
          content: <EscDataTable
            fetchFn={escService.sangrias}
            searchKeys={['unidade', 'reason']}
            filterKeys={[{ key: 'unidade', label: 'Unidade' }]}
            columns={[
              { key: 'unidade', label: 'Unidade' },
              { key: 'amount', label: 'Valor', render: (r) => `R$ ${r.amount}` },
              { key: 'destination', label: 'Destino' },
              { key: 'transaction_at', label: 'Data' },
            ]}
          />,
        },
        { key: 'relatorios', label: 'Relatórios', content: <EscEmptySection columns={['Relatório', 'Período', 'Unidade']} /> },
        { key: 'pix', label: 'Conciliação PIX', content: <EscEmptySection columns={['Data', 'Valor', 'Unidade', 'Status']} /> },
      ]}
    />
  )
}
