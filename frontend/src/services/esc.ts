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

  movimentacoes: () => api.get('/esc/financeiro/movimentacoes'),
  sangrias: () => api.get('/esc/financeiro/sangrias'),
  sessoesConferidas: () => api.get('/esc/financeiro/sessoes-conferidas'),

  permissoes: () => api.get('/esc/administracao/permissoes'),
  estoque: () => api.get('/esc/administracao/estoque'),

  infra: () => api.get('/esc/ti/infra'),

  // ── escrita (Fase 11) ──
  criarUsuario: (body: any) => api.post('/esc/cadastros/usuarios', body),
  editarUsuario: (id: string, body: any) => api.put(`/esc/cadastros/usuarios/${id}`, body),
  desativarUsuario: (id: string) => api.delete(`/esc/cadastros/usuarios/${id}`),

  categorias: () => api.get('/esc/cadastros/categorias'),
  criarCategoria: (body: any) => api.post('/esc/cadastros/categorias', body),
  formasPagamento: () => api.get('/esc/cadastros/formas-pagamento'),
  criarForma: (body: any) => api.post('/esc/cadastros/formas-pagamento', body),

  getAccessGroups: () => api.get('/esc/administracao/access-groups'),
  putAccessGroups: (access_groups: any) => api.put('/esc/administracao/access-groups', { access_groups }),
  auditoria: (limit = 200) => api.get(`/esc/administracao/auditoria?limit=${limit}`),
  enviarAviso: (title: string, body: string) => api.post('/esc/administracao/avisos', { title, body }),
  listAvisos: () => api.get('/esc/administracao/avisos'),
}
