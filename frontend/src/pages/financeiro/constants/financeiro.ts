import { BarChart2, GitBranch, ArrowLeftRight, UserCheck, DollarSign, FileBarChart, CheckCircle } from 'lucide-react'
import type { Tab } from '../types/financeiro'

export const SUBTYPE_LABELS: Record<string, string> = {
  delivery_fee: 'Taxa de Entrega',
  mensalidade: 'Mensalidade',
  proof_of_residence: 'Comprovante',
  other: 'Outros',
}

export const SUBTYPE_COLORS: Record<string, string> = {
  delivery_fee: 'bg-amber-100 text-amber-700',
  mensalidade: 'bg-blue-100 text-blue-700',
  proof_of_residence: 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-600',
}

export const PERIOD_LABEL: Record<string, string> = {
  week: 'Últimos 7 dias',
  month: 'Este mês',
  year: 'Este ano',
}

export const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'dashboard',      label: 'Resumo',        icon: BarChart2 },
  { key: 'esteira',        label: 'Esteira',       icon: GitBranch },
  { key: 'movimentacoes',  label: 'Movimentações', icon: ArrowLeftRight },
  { key: 'cobrancas',      label: 'CRM',           icon: UserCheck },
  { key: 'relatorios',     label: 'Sessões',       icon: DollarSign },
  { key: 'dre',            label: 'Relatórios',    icon: FileBarChart },
  { key: 'conciliacao',    label: 'PIX',           icon: CheckCircle },
]
