import api from './api'
import type { Package } from '../types'

export type ReceiveHistoryItem = {
  resident_name: string
  unit: string | null
  block: string | null
  tracking_code: string | null
  carrier_name: string | null
  status: string
}

export type ReceiveHistoryEntry = {
  id: string
  is_bulk: boolean
  received_at: string
  received_by_name: string
  count: number
  status: 'confirmed' | 'reversed'
  items: ReceiveHistoryItem[]
}

export const packageService = {
  receive: (data: {
    resident_id?: string
    unit?: string
    block?: string
    sender_name?: string
    carrier_name?: string
    tracking_code?: string
    object_type?: string
    photo_urls: { url: string; label: string; taken_at: string }[]
    notes?: string
    deliverer_name?: string
    deliverer_signature_url?: string
    receive_batch_id?: string
  }) => api.post<Package>('/packages', data),

  deliver: (
    packageId: string,
    data: {
      delivered_to_name: string
      signature_url: string
      delivered_to_cpf?: string
      delivered_to_resident_id?: string
      proof_of_residence_url?: string
      recipient_id_photo_url?: string
      delivery_person_name?: string
      third_party_pickup?: boolean
      owner_id_photo_url?: string
      picker_id_photo_url?: string
      picker_phone?: string
      payment_method_id?: string
      cash_session_id?: string
    },
  ) => api.post<Package>(`/packages/${packageId}/deliver`, data),

  list: (status?: string) =>
    api.get<Package[]>('/packages', { params: status ? { status } : {} }),

  receiveHistory: (params?: { limit?: number; offset?: number }) =>
    api.get<ReceiveHistoryEntry[]>('/packages/receive-history', { params }),

  lookupCep: (cep: string) =>
    api.get<{ street: string; district: string; city: string; state: string }>(
      `/packages/cep/${cep.replace(/\D/g, '')}`,
    ),
}
