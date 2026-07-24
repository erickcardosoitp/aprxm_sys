import { TrendingUp } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscEmptySection from './EscEmptySection'
import { escService } from '../../services/esc'
import FluxoCaixaSection from './financeiro/FluxoCaixaSection'
import MovimentacoesSection from './financeiro/MovimentacoesSection'
import DRESection from './financeiro/DRESection'
import SessoesCaixaSection from './financeiro/SessoesCaixaSection'
import CrmSection from './financeiro/CrmSection'
import ContasPagarSection from './financeiro/ContasPagarSection'
import ContasReceberSection from './financeiro/ContasReceberSection'
import SangriasSection from './financeiro/SangriasSection'

export default function EscFinanceiroPage() {
  return (
    <EscModulePage
      title="Financeiro"
      description="Financeiro consolidado da empresa — todas as unidades."
      icon={TrendingUp}
      sections={[
        { key: 'fluxo', label: 'Fluxo de Caixa', content: <FluxoCaixaSection /> },
        { key: 'movimentacoes', label: 'Movimentações', content: <MovimentacoesSection /> },
        { key: 'crm', label: 'CRM', content: <CrmSection /> },
        { key: 'sessoes', label: 'Sessões de Caixa', content: <SessoesCaixaSection /> },
        { key: 'dre', label: 'DRE', content: <DRESection /> },
        { key: 'contas-pagar', label: 'Contas a Pagar', content: <ContasPagarSection /> },
        { key: 'contas-receber', label: 'Contas a Receber', content: <ContasReceberSection /> },
        {
          key: 'sangrias', label: 'Sangrias',
          content: <SangriasSection />,
        },
        { key: 'relatorios', label: 'Relatórios', content: <EscEmptySection columns={['Relatório', 'Período', 'Unidade']} /> },
        { key: 'pix', label: 'Conciliação PIX', content: <EscEmptySection columns={['Data', 'Valor', 'Unidade', 'Status']} /> },
      ]}
    />
  )
}
