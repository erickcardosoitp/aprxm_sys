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
  },
)

export interface OrgOption {
  id: string
  name: string
  slug: string
  role: string
}

export async function listAssociationsForEmail(email: string): Promise<OrgOption[]> {
  const { data } = await api.get<OrgOption[]>('/auth/associations', { params: { email } })
  return data
}

export async function login(email: string, password: string, associationId: string): Promise<string> {
  const { data } = await api.post<{ access_token: string }>('/auth/login', {
    email,
    password,
    association_id: associationId,
  })
  return data.access_token
}

export interface FreshnessInfo {
  generated_at: string | null
  stale: boolean
}

export interface InicioData {
  financeiro: {
    receita_mes_atual: number
    taxa_cobranca: number | null
    total_inadimplente: number
  }
  moradores: {
    total: number
    associados: number
    dependentes: number
    visitantes: number
  }
  pacotes_os: {
    pacotes_recebidos: number
    tempo_medio_entrega_dias: number | null
    os_abertas: number
    os_fechadas: number
  }
  alertas: string[]
}

export async function getInicio(
  nomeAssociacao?: string | null,
  periodo?: string,
): Promise<FreshnessInfo & { data: InicioData }> {
  const { data } = await api.get<FreshnessInfo & { data: InicioData }>('/presidencia/inicio', {
    params: {
      ...(nomeAssociacao ? { unidade: nomeAssociacao } : {}),
      ...(periodo ? { periodo } : {}),
    },
  })
  return data
}
