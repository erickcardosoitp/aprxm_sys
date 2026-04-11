import api from './api'
import type { AssociationSettings } from '../types'

export const settingsService = {
  get: () => api.get<AssociationSettings>('/settings'),
  update: (data: { default_cash_balance: number; max_cash_before_sangria: number; default_mensalidade_amount?: number; delinquency_grace_days?: number }) =>
    api.put<AssociationSettings>('/settings', data),
}
