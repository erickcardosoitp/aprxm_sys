import { lazy, Suspense, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { BookOpen, ChevronDown, ChevronRight, Menu, X } from 'lucide-react'
import { ARTICLES_BY_CATEGORY, CATEGORIES, HELP_ARTICLES } from './helpArticles'

const ARTICLE_COMPONENTS: Record<string, React.LazyExoticComponent<() => JSX.Element>> = {
  'abrir-caixa':           lazy(() => import('./articles/AbrirCaixa')),
  'nova-transacao':        lazy(() => import('./articles/NovaTransacao')),
  'sangria':               lazy(() => import('./articles/Sangria')),
  'encomendas-unitario':   lazy(() => import('./articles/EncomendasUnitario')),
  'encomendas-multiplo':   lazy(() => import('./articles/EncomendasMultiplo')),
  'entregar-encomenda':    lazy(() => import('./articles/EntregarEncomenda')),
  'cadastrar-morador':     lazy(() => import('./articles/CadastrarMorador')),
  'cadastrar-dependente':  lazy(() => import('./articles/CadastrarDependente')),
  'converter-dependente':  lazy(() => import('./articles/ConverterDependente')),
  'unificacao-cadastro':   lazy(() => import('./articles/UnificacaoCadastro')),
  'mensalidade':           lazy(() => import('./articles/Mensalidade')),
  'criar-os':              lazy(() => import('./articles/CriarOS')),
}

function Sidebar({ currentSlug, onClose }: { currentSlug: string; onClose?: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => Object.fromEntries(CATEGORIES.map((c) => [c, true]))
  )

  return (
    <nav className="w-full">
      <div className="flex items-center gap-2 mb-4 px-1">
        <BookOpen className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-semibold text-gray-700">Central de Ajuda</span>
      </div>
      {CATEGORIES.map((cat) => (
        <div key={cat} className="mb-2">
          <button
            onClick={() => setOpen((o) => ({ ...o, [cat]: !o[cat] }))}
            className="flex items-center justify-between w-full px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition"
          >
            {cat}
            {open[cat] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          {open[cat] && (
            <ul className="mt-0.5 space-y-0.5">
              {(ARTICLES_BY_CATEGORY[cat] ?? []).map((a) => (
                <li key={a.slug}>
                  <Link
                    to={`/help/${a.slug}`}
                    onClick={onClose}
                    className={`block px-3 py-2 rounded-lg text-sm transition ${
                      currentSlug === a.slug
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  )
}

export default function HelpPage() {
  const { slug } = useParams<{ slug: string }>()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!slug) return <Navigate to={`/help/${HELP_ARTICLES[0].slug}`} replace />

  const Article = ARTICLE_COMPONENTS[slug]
  if (!Article) return <Navigate to={`/help/${HELP_ARTICLES[0].slug}`} replace />

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-56 shrink-0 border-r border-gray-200 bg-white p-4 sticky top-0 h-screen overflow-y-auto">
        <Sidebar currentSlug={slug} />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="relative w-64 bg-white h-full p-4 overflow-y-auto shadow-xl">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-3 right-3 p-1 rounded-lg text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
            <Sidebar currentSlug={slug} onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 max-w-2xl mx-auto px-4 py-6">
        {/* Mobile menu toggle */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden flex items-center gap-2 mb-4 text-sm text-gray-500 hover:text-gray-700 transition"
        >
          <Menu className="w-4 h-4" />
          Menu de ajuda
        </button>

        <Suspense fallback={<div className="text-sm text-gray-400 py-8 text-center">Carregando…</div>}>
          <Article />
        </Suspense>
      </main>
    </div>
  )
}
