import api from './api'
import type { CashSession, CashSessionSummary, Transaction } from '../types'

export const financeService = {
  openSession: (opening_balance: number, notes?: string) =>
    api.post<CashSession>('/finance/sessions/open', { opening_balance, notes }),

  getCurrentSession: () =>
    api.get<CashSession>('/finance/sessions/current'),

  closeSession: (closing_balance: number, notes?: string) =>
    api.post<CashSession>('/finance/sessions/close', { closing_balance, notes }),

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
    category_id?: string
    payment_method_id?: string
    resident_id?: string
  }) => api.post<Transaction>('/finance/transactions', data),

  listTransactions: (session_id?: string) =>
    api.get<Transaction[]>('/finance/transactions', { params: { session_id } }),

  listSessions: () =>
    api.get<CashSessionSummary[]>('/finance/sessions'),
}
