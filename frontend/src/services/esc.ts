import api from './api'

export const escService = {
  associacoes: () => api.get('/esc/cadastros/associacoes'),
  editarAssociacao: (id: string, body: any) => api.put(`/esc/cadastros/associacoes/${id}`, body),
  usuarios: () => api.get('/esc/cadastros/usuarios'),
  encomendas: (params?: Record<string, any>) => api.get('/esc/cadastros/encomendas', { params }),
  ordensServico: (params?: Record<string, any>) => api.get('/esc/cadastros/ordens-servico', { params }),
  comprovantesEstoque: () => api.get('/esc/cadastros/comprovantes-residencia'),
  editarComprovanteEstoque: (associationId: string, estoque: number) =>
    api.put(`/esc/cadastros/comprovantes-residencia/${associationId}`, { estoque }),

  associados: () => api.get('/esc/moradores/associados'),
  visitantes: () => api.get('/esc/moradores/visitantes'),
  dependentes: () => api.get('/esc/moradores/dependentes'),

  movimentacoes: (params?: Record<string, any>) => api.get('/financeiro/movimentacoes', { params }),
  movimentacoesExport: (params?: Record<string, any>) =>
    api.get('/financeiro/movimentacoes/export', { params, responseType: 'blob' }),
  sangrias: (params?: Record<string, any>) => api.get('/esc/financeiro/sangrias', { params }),
  estornarTransacao: (id: string, reason: string, admin_password: string) =>
    api.post(`/finance/transactions/${id}/reverse`, { reason, admin_password }),
  sessoesConferidas: (unidade?: string) => api.get('/esc/financeiro/sessoes-conferidas', { params: { unidade } }),
  reabrirSessao: (sessionId: string) => api.post(`/finance/sessions/${sessionId}/revert-conferencia`),
  gerarConferenciaPdf: (sessionId: string, body: Record<string, any>) =>
    api.post(`/finance/sessions/${sessionId}/conferencia-pdf`, body, { responseType: 'blob' }),
  financeiroDashboard: (unidade?: string) => api.get('/financeiro/dashboard', { params: { unidade } }),
  financeiroDre: (params: Record<string, any>) => api.get('/financeiro/dre', { params }),
  financeiroSummary: (params?: Record<string, any>) => api.get('/financeiro/summary', { params }),
  caixasAbertos: (unidade?: string) => api.get('/financeiro/caixas-abertos', { params: { unidade } }),
  zerarCaixa: (session_id: string, reason: string) => api.post('/financeiro/zerar-caixa', { session_id, reason }),
  saldoCaixaRealizado: (unidade?: string) => api.get('/financeiro/saldo-caixa-realizado', { params: { unidade } }),
  zerarCaixaTotal: (association_id: string, reason: string) =>
    api.post('/financeiro/zerar-caixa-total', { association_id, reason }),

  contasPagar: (params?: Record<string, any>) => api.get('/esc/financeiro/contas-pagar', { params }),
  criarContaPagar: (body: any) => api.post('/esc/financeiro/contas-pagar', body),
  baixarContaPagar: (id: string, body: any) => api.post(`/esc/financeiro/contas-pagar/${id}/baixa`, body),
  contasPagarTemplates: (params?: Record<string, any>) => api.get('/esc/financeiro/contas-pagar-templates', { params }),
  criarContaPagarTemplate: (body: any) => api.post('/esc/financeiro/contas-pagar-templates', body),
  atualizarContaPagarTemplate: (id: string, is_active: boolean) =>
    api.put(`/esc/financeiro/contas-pagar-templates/${id}`, null, { params: { is_active } }),
  gerarContaPagarDoTemplate: (id: string, reference_month: string) =>
    api.post(`/esc/financeiro/contas-pagar-templates/${id}/gerar`, null, { params: { reference_month } }),

  taxaEntregaPrevista: (unidade?: string) => api.get('/esc/financeiro/contas-receber/taxa-entrega', { params: { unidade } }),

  crmResidents: (params?: Record<string, any>) => api.get('/crm/residents', { params }),
  mensalidadesPending: (params?: Record<string, any>) => api.get('/mensalidades/pending', { params }),
  mensalidadesDelinquent: (params?: Record<string, any>) => api.get('/mensalidades/delinquent', { params }),
  mensalidadesPaid: (params?: Record<string, any>) => api.get('/mensalidades/paid', { params }),

  estoque: () => api.get('/esc/administracao/estoque'),

  infra: () => api.get('/esc/ti/infra'),

  // ── escrita (Fase 11) ──
  criarUsuario: (body: any) => api.post('/esc/cadastros/usuarios', body),
  editarUsuario: (id: string, body: any) => api.put(`/esc/cadastros/usuarios/${id}`, body),
  desativarUsuario: (id: string) => api.delete(`/esc/cadastros/usuarios/${id}`),
  excluirUsuario: (id: string) => api.delete(`/esc/cadastros/usuarios/${id}/permanente`),

  categorias: () => api.get('/esc/cadastros/categorias'),
  criarCategoria: (body: any) => api.post('/esc/cadastros/categorias', body),
  editarCategoria: (id: string, body: any) => api.put(`/esc/cadastros/categorias/${id}`, body),
  formasPagamento: () => api.get('/esc/cadastros/formas-pagamento'),
  criarForma: (body: any) => api.post('/esc/cadastros/formas-pagamento', body),
  editarForma: (id: string, body: any) => api.put(`/esc/cadastros/formas-pagamento/${id}`, body),
  categoriasContasPagar: () => api.get('/esc/cadastros/categorias-contas-pagar'),
  criarCategoriaContasPagar: (name: string) => api.post('/esc/cadastros/categorias-contas-pagar', { name }),
  editarCategoriaContasPagar: (id: string, body: any) => api.put(`/esc/cadastros/categorias-contas-pagar/${id}`, body),

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
