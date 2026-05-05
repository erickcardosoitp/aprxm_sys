export type Tab = 'dashboard' | 'movimentacoes' | 'cobrancas' | 'relatorios' | 'conciliacao' | 'transferencias' | 'porta_a_porta' | 'dre' | 'esteira'

export interface FinanceSummary {
  total_income: number
  total_expense: number
  total_balance: number
  transactions_count: number
  income_by_type?: Record<string, number>
  contas_a_receber?: number
  contas_a_receber_count?: number
  period_label: string
}

export interface Tx {
  id: string
  type: string
  income_subtype?: string
  amount: string
  description: string
  transaction_at: string
  is_sangria: boolean
  is_reversal?: boolean
  reversal_of_id?: string
  reversed_at?: string
  payment_method_name?: string | null
  created_by_name?: string | null
  resident_name?: string | null
}

export interface Session {
  id: string; status: string; opening_balance: string
  closing_balance: string | null; expected_balance: string | null
  difference: string | null; opened_at: string; closed_at: string | null
  origin?: string; association_name?: string
  operador_name?: string; conferido_por?: string
  total_pix?: string; total_dinheiro?: string
  total_bruto?: string; total_baixas?: string
  quebra_caixa?: string | null
  malote_sent_at?: string | null
  quebra_responsavel?: string | null
  quebra_assinatura_url?: string | null
  quebra_apurada_at?: string | null
}

export interface ManualSessionForm {
  opening_balance: string; closing_balance: string
  opened_at: string; closed_at: string; notes: string
  manual_pix: string; manual_dinheiro: string
  manual_total_baixas: string
}

export interface Mensalidade {
  id: string | null; resident_id: string; resident_name?: string; reference_month: string
  due_date: string | null; amount: string; status: string
  paid_at: string | null; transaction_id: string | null; notes: string | null
  origem?: 'sistema' | 'migracao'; tipo?: string
  phone_primary?: string | null; address_street?: string | null
  address_number?: string | null; unit?: string | null
}

export interface TxReview {
  id: string; type: string; income_subtype?: string | null; amount: string
  description: string; transaction_at: string; is_sangria: boolean
  created_by_name?: string; conferido: boolean; observacao?: string | null
  payment_method_name?: string | null; reversed_at?: string | null
}

export interface CashBox {
  id: string; name: string; description?: string; balance: string; is_active: boolean; is_malote?: boolean; is_cofre?: boolean
}

export interface BoxMovement {
  id: string; amount: string; movement_type: string; description: string
  created_at: string; created_by_name?: string
}

export interface Conferente { id: string; full_name: string; role: string }

export interface DelinquentItem {
  id: string; resident_id: string; resident_name?: string; reference_month: string
  due_date: string; amount: string; months_overdue: number
  phone_primary?: string | null; address_street?: string | null
  address_number?: string | null; unit?: string | null
}

export interface ReconciliationItem {
  id: string; transaction_id?: string; bank: string; date: string; amount: number
  name: string; resident?: string; cpf?: string
  status: 'automatico' | 'sugestao' | 'pendente' | 'identificado'; score: number
  sale_description?: string; bank_statement_id?: string
}

export interface PaidItem {
  id: string; resident_id: string; resident_name: string
  reference_month: string; due_date: string; amount: string
  paid_at: string | null; transaction_id: string | null
}

export interface Tesouraria {
  open_sessions: { id: string; opened_at: string; opening_balance: string; operador: string; expected_balance: string }[]
  conferido_sessions: { id: string; opened_at: string; closing_balance: string | null; expected_balance: string | null; difference: string | null; operador: string; already_transferred: string; remaining: string }[]
  pap_today: { total: string; count: number }
  caixinhas: { id: string; name: string; balance: string; breakdown: { pm: string; total: string }[] }[]
  total_limbo: string
  faturamento_hoje: string
}

export interface PixPendingItem {
  id: string; amount: string; description: string | null; date: string
  status: string; recon_score: number | null
  resident_name: string | null; resident_id: string | null
  bank_statement_id: string | null; bank: string | null; payer_name: string | null
  session_opened_at: string | null; session_id: string | null
  operador_name: string | null; conferente_name: string | null
  delivered_to_name: string | null
}

export interface PaymentMethod { id: string; name: string }
