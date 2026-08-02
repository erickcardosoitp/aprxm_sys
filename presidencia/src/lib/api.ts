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
  ate?: string,
): Promise<FreshnessInfo & { data: ResumoData }> {
  const { data } = await api.get<FreshnessInfo & { data: ResumoData }>('/presidencia/resumo', {
    params: {
      ...(nomeAssociacao ? { unidade: nomeAssociacao } : {}),
      ...(periodo ? { periodo } : {}),
      ...(ate ? { ate } : {}),
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

async function getDetalhe<T>(
  path: string,
  nomeAssociacao?: string | null,
  periodo?: string,
  ate?: string,
): Promise<FreshnessInfo & { data: T }> {
  const { data } = await api.get<FreshnessInfo & { data: T }>(`/presidencia/${path}`, {
    params: {
      ...(nomeAssociacao ? { unidade: nomeAssociacao } : {}),
      ...(periodo ? { periodo } : {}),
      ...(ate ? { ate } : {}),
    },
  })
  return data
}

export interface FinanceiroData {
  receita_total: number
  despesa_total: number
  saldo_liquido: number
  receita_total_anterior: number
  margem_pct: number | null
  saldo_caixa: number
  runway_semanas: number | null
  total_inadimplente: number
  qtd_inadimplentes: number
  inadimplentes: { nome: string; associacao: string; meses_atraso: number; valor_devido: number }[]
  serie_diaria: {
    data: string
    receita_total: number
    despesa_total: number
    saldo_liquido: number
    mensalidade: number
    taxa_entrega: number
    comprovante_residencia: number
    outras_receitas: number
  }[]
  receita_por_rua: { rua: string; receita_total: number; qtd_transacoes: number }[]
  comparativo_unidades: {
    nome_associacao: string
    receita_total: number
    despesa_total: number
    saldo_liquido: number
    margem_pct: number | null
    taxa_cobranca_pct: number | null
  }[]
  recuperacao: {
    valor_recuperada: number
    valor_nunca_recuperada: number
    valor_parcelamento: number
    taxa_recuperacao_pct: number | null
  }
  aging: { faixa: string; qtd: number; valor: number }[]
  motivos_sangria: { motivo: string; ocorrencias: number; valor: number }[]
  quebras_caixa: {
    com_quebra: number
    valor_total: number
    com_diferenca: number
    detalhe: {
      semana: string | null
      operador: string
      associacao: string
      total_sessoes: number
      com_quebra: number
      com_diferenca: number
      valor_quebra: number
      valor_diferenca: number
      pct_diferenca: number | null
    }[]
  }
}
export const getFinanceiro = (u?: string | null, p?: string, a?: string) => getDetalhe<FinanceiroData>('financeiro', u, p, a)

export interface MoradoresData {
  total: number
  associados: number
  dependentes: number
  visitantes: number
  sem_internet: number
  novos_mes: number
  crescimento_serie: { label: string; value: number }[]
  churn: { nome: string; associacao: string; meses_sem_pagar: number | null; ultimo_pagamento: string | null }[]
  por_rua: { rua: string; total: number; associados: number; visitantes: number; com_problemas: number; sem_internet: number }[]
}
export const getMoradores = (u?: string | null) => getDetalhe<MoradoresData>('moradores', u)

export interface MensalidadesData {
  pagas: number
  total: number
  vencidas: number
  acordos: number
  valor_vencido: number
  taxa_cobranca_pct: number | null
  recuperacao: {
    valor_recuperada: number
    valor_nunca_recuperada: number
    valor_parcelamento: number
    taxa_recuperacao_pct: number | null
  }
  devedores: { nome: string; associacao: string; tipo: string; rua: string; meses_atraso: number; valor_devido: number }[]
  por_rua: { rua: string; total: number; pagas: number; vencidas: number; valor_total: number }[]
}
export const getMensalidades = (u?: string | null, p?: string, a?: string) => getDetalhe<MensalidadesData>('mensalidades', u, p, a)

export interface PacotesData {
  recebidos: number
  entregues: number
  devolvidos: number
  pendentes: number
  tempo_medio_dias: number | null
  paradas_3d: number
  paradas_7d: number
  ranking_moradores: { nome: string; tipo: string; rua: string; associacao: string; total: number; media_horas_espera: number | null; entregues: number; pendentes_agora: number }[]
  por_rua: { rua: string; total: number; moradores_distintos: number; media_espera_horas: number | null }[]
}
export const getPacotes = (u?: string | null, p?: string, a?: string) => getDetalhe<PacotesData>('pacotes', u, p, a)

export interface OsData {
  abertas: number
  fechadas: number
  pendentes: number
  serie: { label: string; abertas: number; fechadas: number }[]
  sla_por_tipo: { tipo: string; entregues: number; media_horas_espera: number | null }[]
}
export const getOs = (u?: string | null, p?: string, a?: string) => getDetalhe<OsData>('os', u, p, a)

export interface OperadoresData {
  score_medio: number | null
  ranking: { nome: string; score: number | null; estornos: number; tarefas_atraso: number; entregas: number }[]
  desempenho: { nome: string; sessoes: number; encomendas_recebidas: number; encomendas_entregues: number }[]
  feedback: { nome: string; qtd: number }[]
}
export const getOperadores = (u?: string | null, p?: string, a?: string) => getDetalhe<OperadoresData>('operadores', u, p, a)

export interface SensoData {
  total_moradores: number
  com_pragas: number
  sem_internet: number
  com_problemas: number
  por_rua: { rua: string; total: number; associados: number; visitantes: number; com_pragas: number; sem_internet: number; com_problemas: number }[]
}
export const getSenso = (u?: string | null, p?: string, a?: string) => getDetalhe<SensoData>('senso', u, p, a)
