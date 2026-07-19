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
}
