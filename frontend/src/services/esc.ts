import api from './api'

export const escService = {
  associacoes: () => api.get('/esc/cadastros/associacoes'),
  usuarios: () => api.get('/esc/cadastros/usuarios'),
  gruposUsuarios: () => api.get('/esc/cadastros/grupos-usuarios'),
  encomendas: () => api.get('/esc/cadastros/encomendas'),
  ordensServico: () => api.get('/esc/cadastros/ordens-servico'),
  comprovantesEstoque: () => api.get('/esc/cadastros/comprovantes-residencia'),

  associados: () => api.get('/esc/moradores/associados'),
  visitantes: () => api.get('/esc/moradores/visitantes'),
  dependentes: () => api.get('/esc/moradores/dependentes'),

  movimentacoes: (params?: Record<string, any>) => api.get('/financeiro/movimentacoes', { params }),
  movimentacoesExport: (params?: Record<string, any>) =>
    api.get('/financeiro/movimentacoes/export', { params, responseType: 'blob' }),
  sangrias: () => api.get('/esc/financeiro/sangrias'),
  sessoesConferidas: (unidade?: string) => api.get('/esc/financeiro/sessoes-conferidas', { params: { unidade } }),
  reabrirSessao: (sessionId: string) => api.post(`/finance/sessions/${sessionId}/revert-conferencia`),
  gerarConferenciaPdf: (sessionId: string, body: Record<string, any>) =>
    api.post(`/finance/sessions/${sessionId}/conferencia-pdf`, body, { responseType: 'blob' }),
  financeiroDashboard: (unidade?: string) => api.get('/financeiro/dashboard', { params: { unidade } }),
  financeiroDre: (params: Record<string, any>) => api.get('/financeiro/dre', { params }),
  financeiroSummary: (params?: Record<string, any>) => api.get('/financeiro/summary', { params }),
  caixasAbertos: (unidade?: string) => api.get('/financeiro/caixas-abertos', { params: { unidade } }),
  zerarCaixa: (session_id: string, reason: string) => api.post('/financeiro/zerar-caixa', { session_id, reason }),

  permissoes: () => api.get('/esc/administracao/permissoes'),
  estoque: () => api.get('/esc/administracao/estoque'),

  infra: () => api.get('/esc/ti/infra'),

  // ── escrita (Fase 11) ──
  criarUsuario: (body: any) => api.post('/esc/cadastros/usuarios', body),
  editarUsuario: (id: string, body: any) => api.put(`/esc/cadastros/usuarios/${id}`, body),
  desativarUsuario: (id: string) => api.delete(`/esc/cadastros/usuarios/${id}`),
  excluirUsuario: (id: string) => api.delete(`/esc/cadastros/usuarios/${id}/permanente`),

  categorias: () => api.get('/esc/cadastros/categorias'),
  criarCategoria: (body: any) => api.post('/esc/cadastros/categorias', body),
  formasPagamento: () => api.get('/esc/cadastros/formas-pagamento'),
  criarForma: (body: any) => api.post('/esc/cadastros/formas-pagamento', body),

  getAccessGroups: () => api.get('/esc/administracao/access-groups'),
  putAccessGroups: (access_groups: any) => api.put('/esc/administracao/access-groups', { access_groups }),
  auditoria: (limit = 200) => api.get(`/esc/administracao/auditoria?limit=${limit}`),
  enviarAviso: (title: string, body: string) => api.post('/esc/administracao/avisos', { title, body }),
  listAvisos: () => api.get('/esc/administracao/avisos'),

  inventarioEncomendas: () => api.get('/esc/administracao/inventario-encomendas'),
  gerarInventarioEncomendas: (association_id: string, reference_at: string) =>
    api.post('/esc/administracao/inventario-encomendas', { association_id, reference_at }),
  detalheInventarioEncomendas: (id: string) => api.get(`/esc/administracao/inventario-encomendas/${id}`),
}
