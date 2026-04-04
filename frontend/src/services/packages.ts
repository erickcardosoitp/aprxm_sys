import api from './api'
import type { Package } from '../types'

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
  }) => api.post<Package>('/packages', data),

  deliver: (
    packageId: string,
    data: {
      delivered_to_name: string
      signature_url: string
      delivered_to_cpf?: string
      delivered_to_resident_id?: string
      proof_of_residence_url: string
      recipient_id_photo_url?: string
      delivery_person_name?: string
    },
  ) => api.post<Package>(`/packages/${packageId}/deliver`, data),

  list: (status?: string) =>
    api.get<Package[]>('/packages', { params: status ? { status } : {} }),

  lookupCep: (cep: string) =>
    api.get<{ street: string; district: string; city: string; state: string }>(
      `/packages/cep/${cep.replace(/\D/g, '')}`,
    ),
}
