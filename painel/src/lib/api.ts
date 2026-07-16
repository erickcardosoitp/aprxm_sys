import axios from 'axios'
import { useAuthStore } from './authStore'

export const api = axios.create({
  baseURL: '/api/v1',
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
    }
    return Promise.reject(error)
  }
)

export interface Empresa {
  id: string
  name: string
  slug: string
  financeiro_centralizado: boolean
  is_active: boolean
}

export interface Associacao {
  id: string
  name: string
  slug: string
  empresa_id: string
  is_active: boolean
}

export interface ProvisioningRunStep {
  step: string
  at: string
  [key: string]: unknown
}

export interface ProvisioningRun {
  id: string
  empresa_id: string | null
  run_type: 'create_empresa' | 'create_associacao'
  status: 'running' | 'success' | 'failed'
  steps: ProvisioningRunStep[]
  error_detail: string | null
  started_at: string
  finished_at: string | null
}

export async function painelLogin(email: string, password: string): Promise<string> {
  const { data } = await api.post<{ access_token: string }>('/painel-auth/login', { email, password })
  return data.access_token
}

export async function listEmpresas(): Promise<Empresa[]> {
  const { data } = await api.get<Empresa[]>('/governanca/empresas')
  return data
}

export interface CreateEmpresaPayload {
  name: string
  slug: string
  admin_first_name: string
  admin_last_name: string
  admin_email: string
  admin_cargo: string
  financeiro_centralizado: boolean
}

export async function createEmpresa(payload: CreateEmpresaPayload): Promise<Empresa> {
  const { data } = await api.post<Empresa>('/governanca/empresas', payload)
  return data
}

export interface CreateAssociacaoPayload {
  name: string
  slug: string
  community_name: string
  default_mensalidade_amount: string
  default_cash_balance: string
  inventory_day_of_month: number
  president_name: string | null
  admin_first_name: string
  admin_last_name: string
  admin_email: string
  admin_cargo: string
}

export async function createAssociacao(empresaId: string, payload: CreateAssociacaoPayload): Promise<Associacao> {
  const { data } = await api.post<Associacao>(`/governanca/empresas/${empresaId}/associacoes`, payload)
  return data
}

export async function desativarAssociacao(associacaoId: string): Promise<void> {
  await api.patch(`/governanca/associacoes/${associacaoId}/desativar`)
}

export async function listProvisioningRuns(): Promise<ProvisioningRun[]> {
  const { data } = await api.get<ProvisioningRun[]>('/governanca/provisioning-runs')
  return data
}

export async function getProvisioningRun(runId: string): Promise<ProvisioningRun> {
  const { data } = await api.get<ProvisioningRun>(`/governanca/provisioning-runs/${runId}`)
  return data
}
