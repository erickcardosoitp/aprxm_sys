import { FolderKanban } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscDataTable from './EscDataTable'
import EscEmptySection from './EscEmptySection'
import { escService } from '../../services/esc'

export default function CadastrosPage() {
  return (
    <EscModulePage
      title="Cadastros"
      description="Associações, usuários, grupos, produtos e demais cadastros centralizados da empresa."
      icon={FolderKanban}
      sections={[
        {
          key: 'associacoes', label: 'Associações',
          content: <EscDataTable
            fetchFn={escService.associacoes}
            searchKeys={['name', 'slug']}
            columns={[
              { key: 'name', label: 'Nome' },
              { key: 'slug', label: 'Slug' },
              { key: 'plan_name', label: 'Plano' },
              { key: 'is_active', label: 'Ativa', render: (r) => (r.is_active ? 'Sim' : 'Não') },
            ]}
          />,
        },
        {
          key: 'usuarios', label: 'Usuários',
          content: <EscDataTable
            fetchFn={escService.usuarios}
            searchKeys={['full_name', 'email']}
            columns={[
              { key: 'full_name', label: 'Nome' },
              { key: 'email', label: 'E-mail' },
              { key: 'role', label: 'Cargo' },
              { key: 'unidade', label: 'Unidade' },
              { key: 'is_active', label: 'Ativo', render: (r) => (r.is_active ? 'Sim' : 'Não') },
            ]}
          />,
        },
        {
          key: 'grupos', label: 'Grupos de Usuários',
          content: <EscDataTable
            fetchFn={escService.gruposUsuarios}
            searchKeys={['unidade', 'grupo']}
            columns={[
              { key: 'unidade', label: 'Unidade' },
              { key: 'grupo', label: 'Cargo' },
              { key: 'modulos', label: 'Módulos', render: (r) => Object.keys(r.modulos ?? {}).join(', ') },
            ]}
          />,
        },
        {
          key: 'encomendas', label: 'Encomendas',
          content: <EscDataTable
            fetchFn={escService.encomendas}
            searchKeys={['sender_name', 'carrier_name']}
            columns={[
              { key: 'sender_name', label: 'Remetente' },
              { key: 'carrier_name', label: 'Transportadora' },
              { key: 'status', label: 'Status' },
              { key: 'unidade', label: 'Unidade' },
              { key: 'received_at', label: 'Recebido em' },
            ]}
          />,
        },
        {
          key: 'ordens', label: 'Ordens de Serviço',
          content: <EscDataTable
            fetchFn={escService.ordensServico}
            searchKeys={['title']}
            columns={[
              { key: 'number', label: 'Nº' },
              { key: 'title', label: 'Título' },
              { key: 'priority', label: 'Prioridade' },
              { key: 'unidade', label: 'Unidade' },
              { key: 'created_at', label: 'Criada em' },
            ]}
          />,
        },
        {
          key: 'comprovantes', label: 'Comprovantes de Residência',
          content: <EscDataTable
            fetchFn={escService.comprovantesEstoque}
            searchKeys={['unidade']}
            columns={[
              { key: 'unidade', label: 'Unidade' },
              { key: 'estoque', label: 'Estoque atual' },
            ]}
          />,
        },
        {
          key: 'produtos', label: 'Produtos',
          content: <EscEmptySection columns={['Código', 'Descrição', 'Preço Associado', 'Preço Não Associado']} />,
        },
      ]}
    />
  )
}
