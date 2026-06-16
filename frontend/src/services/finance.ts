import api from './api'
import type { CashSession, CashSessionSummary, Transaction } from '../types'

function getDeviceToken(): string {
  return localStorage.getItem('aprxm-device-token') ?? ''
}

export const financeService = {
  openSession: (opening_balance: number, notes?: string, session_type?: string) =>
    api.post<CashSession>('/finance/sessions/open', { opening_balance, notes, session_type: session_type ?? 'pdv', device_token: getDeviceToken() }),

  getCurrentSession: () =>
    api.get<CashSession>('/finance/sessions/current'),

  closeSession: (closing_balance: number, notes?: string, session_id?: string, blind_pix?: number, blind_dinheiro?: number, troco?: number) =>
    api.post<CashSession>('/finance/sessions/close', { closing_balance, notes, session_id, blind_pix, blind_dinheiro, troco_deixado: troco }),

  performSangria: (data: {
    amount: number
    reason: string
    destination: string
    receipt_photo_url: string
    category_id?: string
  }) => api.post<Transaction>('/finance/sessions/sangria', data),

  registerTransaction: (data: {
    type: string
    amount: number
    description: string
    income_subtype?: string
    category_id?: string
    payment_method_id?: string
    resident_id?: string
    cash_session_id?: string
    is_acordo?: boolean
    acordo_installments?: number
    acordo_months?: number
    acordo_entrada?: number
  }) => api.post<Transaction>('/finance/transactions', data),

  listOpenSessions: () =>
    api.get<{ id: string; opened_by: string; opened_by_name: string; opening_balance: string; opened_at: string; is_mine: boolean }[]>('/finance/sessions/open'),

  listOpenSessionsPicker: () =>
    api.get<{ id: string; opened_by_name: string; opened_at: string; is_mine: boolean }[]>('/finance/sessions/open-picker'),

  listTransactions: (session_id?: string) =>
    api.get<Transaction[]>('/finance/transactions', { params: { session_id } }),

  listSessions: () =>
    api.get<CashSessionSummary[]>('/finance/sessions'),

  conferencia: (counted_amount: number) =>
    api.post<{ session_id: string; expected: string; counted: string; difference: string; income: string; exits: string; opening_balance: string }>('/finance/sessions/conferencia', { counted_amount }),

  listPendingApprovals: () =>
    api.get<PendingApproval[]>('/finance/transactions/pending-approval'),

  approveTransaction: (id: string, signature_url?: string) =>
    api.post(`/finance/transactions/${id}/approve`, { signature_url }),

  rejectTransaction: (id: string, reason: string) =>
    api.post(`/finance/transactions/${id}/reject`, { reason }),
}

export interface PendingApproval {
  id: string
  amount: string
  description: string
  category_name: string | null
  creator_name: string
  transaction_at: string
  approval_status: string
}
