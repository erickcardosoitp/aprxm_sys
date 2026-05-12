export interface HelpArticle {
  slug: string
  title: string
  category: string
}

export const HELP_ARTICLES: HelpArticle[] = [
  // Caixa
  { slug: 'abrir-caixa',           title: 'Abrir e fechar caixa',             category: 'Caixa'           },
  { slug: 'nova-transacao',         title: 'Lançar transação',                 category: 'Caixa'           },
  { slug: 'sangria',                title: 'Fazer sangria',                    category: 'Caixa'           },
  // Encomendas
  { slug: 'encomendas-unitario',    title: 'Receber encomenda (unitário)',      category: 'Encomendas'      },
  { slug: 'encomendas-multiplo',    title: 'Receber encomendas (múltiplo)',     category: 'Encomendas'      },
  { slug: 'entregar-encomenda',     title: 'Entregar / devolver encomenda',     category: 'Encomendas'      },
  // Moradores
  { slug: 'cadastrar-morador',      title: 'Cadastrar morador',                category: 'Moradores'       },
  { slug: 'cadastrar-dependente',   title: 'Cadastrar dependente',             category: 'Moradores'       },
  { slug: 'converter-dependente',   title: 'Converter dependente em associado', category: 'Moradores'      },
  { slug: 'unificacao-cadastro',    title: 'Unificar cadastros (mesclar)',      category: 'Moradores'       },
  // Financeiro
  { slug: 'mensalidade',            title: 'Mensalidades',                     category: 'Financeiro'      },
  // Ordens de Serviço
  { slug: 'criar-os',               title: 'Criar Ordem de Serviço',           category: 'Ordens de Serviço' },
]

export const CATEGORIES = [...new Set(HELP_ARTICLES.map((a) => a.category))]

export const ARTICLES_BY_CATEGORY: Record<string, HelpArticle[]> = CATEGORIES.reduce(
  (acc, cat) => ({ ...acc, [cat]: HELP_ARTICLES.filter((a) => a.category === cat) }),
  {}
)
