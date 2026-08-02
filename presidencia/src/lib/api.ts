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
    receita_mes_anterior: number
    taxa_cobranca: number | null
    taxa_cobranca_anterior: number | null
    total_inadimplente: number
    mensalidades_pagas: number
    mensalidades_pagas_anterior: number
    mensalidades_vencidas: number
    mensalidades_vencidas_anterior: number
    taxa_retencao: number | null
    taxa_retencao_anterior: number | null
  }
  moradores: {
    total: number
    associados: number
    dependentes: number
    visitantes: number
  }
  pacotes_os: {
    pacotes_recebidos: number
    pacotes_recebidos_anterior: number
    tempo_medio_entrega_dias: number | null
    os_abertas: number
    os_fechadas: number
    os_fechadas_anterior: number
  }
  alertas: string[]
  por_unidade: Record<string, {
    receita?: number
    taxa_cobranca?: number | null
    mensalidades_pagas?: number
    mensalidades_vencidas?: number
    total_inadimplente?: number
    taxa_retencao?: number | null
    pacotes_recebidos?: number
    os_fechadas?: number
    moradores_total?: number
  }> | null
}

export async function getStatus(): Promise<FreshnessInfo & { dw_reachable: boolean }> {
  const { data } = await api.get<FreshnessInfo & { dw_reachable: boolean }>('/presidencia/status')
  return data
}

export interface KpiWow {
  atual: number
  anterior: number
  wow_pct: number | null
  mom_pct: number | null
  yoy_pct: number | null
  tot_pct: number | null
  serie: { label: string; value: number }[]
}

export interface ResumoData {
  receita_liquida: KpiWow
  encomendas: KpiWow
  crescimento: KpiWow
  tempo_entrega: KpiWow
  taxa_cobranca: KpiWow
  inadimplencia: KpiWow
  retencao: KpiWow
  tarefas_no_prazo: KpiWow
  score_operadores: KpiWow
}

export async function getResumo(
  nomeAssociacao?: string | null,
  periodo?: string,
): Promise<FreshnessInfo & { data: ResumoData }> {
  const { data } = await api.get<FreshnessInfo & { data: ResumoData }>('/presidencia/resumo', {
    params: {
      ...(nomeAssociacao ? { unidade: nomeAssociacao } : {}),
      ...(periodo ? { periodo } : {}),
    },
  })
  return data
}

export async function getInicio(
  nomeAssociacao?: string | null,
  periodo?: string,
  ate?: string,
): Promise<FreshnessInfo & { data: InicioData }> {
  const { data } = await api.get<FreshnessInfo & { data: InicioData }>('/presidencia/inicio', {
    params: {
      ...(nomeAssociacao ? { unidade: nomeAssociacao } : {}),
      ...(periodo ? { periodo } : {}),
      ...(ate ? { ate } : {}),
    },
  })
  return data
}
