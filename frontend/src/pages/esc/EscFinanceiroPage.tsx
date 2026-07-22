import { TrendingUp } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscDataTable from './EscDataTable'
import EscEmptySection from './EscEmptySection'
import { escService } from '../../services/esc'
import FluxoCaixaSection from './financeiro/FluxoCaixaSection'
import MovimentacoesSection from './financeiro/MovimentacoesSection'
import DRESection from './financeiro/DRESection'
import SessoesCaixaSection from './financeiro/SessoesCaixaSection'

export default function EscFinanceiroPage() {
  return (
    <EscModulePage
      title="Financeiro"
      description="Financeiro consolidado da empresa — todas as unidades."
      icon={TrendingUp}
      sections={[
        { key: 'fluxo', label: 'Fluxo de Caixa', content: <FluxoCaixaSection /> },
        { key: 'movimentacoes', label: 'Movimentações', content: <MovimentacoesSection /> },
        { key: 'crm', label: 'CRM', content: <EscEmptySection columns={['Morador', 'Endereço', 'Status', 'R$ Atrasado', 'Ações/mês']} /> },
        { key: 'sessoes', label: 'Sessões de Caixa', content: <SessoesCaixaSection /> },
        { key: 'dre', label: 'DRE', content: <DRESection /> },
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
