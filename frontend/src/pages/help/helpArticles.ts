export interface HelpArticle {
  slug: string
  title: string
  category: string
}

export const HELP_ARTICLES: HelpArticle[] = [
  { slug: 'encomendas-unitario',  title: 'Receber encomenda (unitário)',  category: 'Encomendas' },
  { slug: 'encomendas-multiplo',  title: 'Receber encomendas (múltiplo)', category: 'Encomendas' },
  { slug: 'cadastrar-morador',    title: 'Cadastrar morador',             category: 'Moradores'  },
  { slug: 'cadastrar-dependente', title: 'Cadastrar dependente',          category: 'Moradores'  },
  { slug: 'mensalidade',          title: 'Lançar mensalidade',            category: 'Financeiro' },
  { slug: 'unificacao-cadastro',  title: 'Unificar cadastros',            category: 'Moradores'  },
]

export const CATEGORIES = [...new Set(HELP_ARTICLES.map((a) => a.category))]
