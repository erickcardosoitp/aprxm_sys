import api from './api'
import type { Package, PackageStatus } from '../types'

export const packageService = {
  receive: (data: {
    unit: string
    block?: string
    resident_id?: string
    sender_name?: string
    carrier_name?: string
    tracking_code?: string
    object_type?: string
    photo_urls: { url: string; label: string; taken_at: string }[]
    notes?: string
  }) => api.post<Package>('/packages', data),

  deliver: (
    packageId: string,
    data: {
      delivered_to_name: string
      signature_url: string
      delivered_to_cpf?: string
      delivered_to_resident_id?: string
    },
  ) => api.post<Package>(`/packages/${packageId}/deliver`, data),

  list: (status?: string) =>
    api.get<Package[]>('/packages', { params: status ? { status } : {} }),
}
