import { FolderKanban } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscEmptySection from './EscEmptySection'
import UsuariosSection from './UsuariosSection'
import ComprovantesEstoqueSection from './ComprovantesEstoqueSection'
import EncomendasSection from './EncomendasSection'
import OrdensServicoSection from './OrdensServicoSection'
import AssociacoesSection from './AssociacoesSection'
import { PermissoesSection } from './AdminSections'
import { CategoriasSection, FormasPagamentoSection, CategoriasContasPagarSection } from './CadastroFinanceiroSections'

export default function CadastrosPage() {
  return (
    <EscModulePage
      title="Cadastros"
      description="Associações, usuários, grupos, produtos e demais cadastros centralizados da empresa."
      icon={FolderKanban}
      sections={[
        {
          key: 'associacoes', label: 'Associações',
          content: <AssociacoesSection />,
        },
        {
          key: 'usuarios', label: 'Usuários',
          content: <UsuariosSection />,
        },
        {
          key: 'grupos', label: 'Grupos de Usuários',
          content: <PermissoesSection />,
        },
        {
          key: 'encomendas', label: 'Encomendas',
          content: <EncomendasSection />,
        },
        {
          key: 'ordens', label: 'Ordens de Serviço',
          content: <OrdensServicoSection />,
        },
        {
          key: 'comprovantes', label: 'Comprovantes de Residência',
          content: <ComprovantesEstoqueSection />,
        },
        {
          key: 'categorias', label: 'Categorias',
          content: <CategoriasSection />,
        },
        {
          key: 'formas', label: 'Formas de Pagamento',
          content: <FormasPagamentoSection />,
        },
        {
          key: 'categorias-contas-pagar', label: 'Categorias (Contas a Pagar)',
          content: <CategoriasContasPagarSection />,
        },
        {
          key: 'produtos', label: 'Produtos',
          content: <EscEmptySection columns={['Código', 'Descrição', 'Preço Associado', 'Preço Não Associado']} />,
        },
      ]}
    />
  )
}
