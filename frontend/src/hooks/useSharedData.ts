import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import api from '../services/api'

type Opts<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>

export function useAuthMe<T = { simplifica_mode: boolean; simplifica_enabled: boolean }>(opts?: Opts<T>) {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await api.get<T>('/auth/me')).data,
    ...opts,
  })
}

export function useMyPermissions<T = string[]>(opts?: Opts<T>) {
  return useQuery({
    queryKey: ['admin', 'my-permissions'],
    queryFn: async () => (await api.get<T>('/admin/my-permissions')).data,
    ...opts,
  })
}

export function usePaymentMethods<T = { id: string; name: string }[]>(opts?: Opts<T>) {
  return useQuery({
    queryKey: ['finance', 'payment-methods'],
    queryFn: async () => (await api.get<T>('/finance/payment-methods')).data,
    ...opts,
  })
}

export function useFinanceCategories<T = { id: string; name: string }[]>(type?: string, opts?: Opts<T>) {
  return useQuery({
    queryKey: ['finance', 'categories', type ?? 'all'],
    queryFn: async () => (await api.get<T>('/finance/categories', { params: type ? { type } : undefined })).data,
    ...opts,
  })
}

export function useAssociationSettings<T = Record<string, any>>(opts?: Opts<T>) {
  return useQuery({
    queryKey: ['settings', 'association'],
    queryFn: async () => (await api.get<T>('/settings/association')).data,
    ...opts,
  })
}

export function useAssociationProfile<T = { name: string; address: string | null }>(opts?: Opts<T>) {
  return useQuery({
    queryKey: ['admin', 'association-profile'],
    queryFn: async () => (await api.get<T>('/admin/association-profile')).data,
    ...opts,
  })
}

export function useDelinquentResidents<T = { resident_id: string }[]>(opts?: Opts<T>) {
  return useQuery({
    queryKey: ['mensalidades', 'delinquent'],
    queryFn: async () => (await api.get<T>('/mensalidades/delinquent')).data,
    ...opts,
  })
}
