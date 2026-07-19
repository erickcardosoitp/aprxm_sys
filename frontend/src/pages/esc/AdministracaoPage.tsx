import { ShieldCheck } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscDataTable from './EscDataTable'
import EscEmptySection from './EscEmptySection'
import { escService } from '../../services/esc'

export default function AdministracaoPage() {
  return (
    <EscModulePage
      title="Administração"
      description="Gestão centralizada da empresa: metas, permissões e estoque."
      icon={ShieldCheck}
      sections={[
        { key: 'metas', label: 'Plano de Metas', content: <EscEmptySection columns={['Unidade', 'Meta', 'Período', 'Progresso']} /> },
        {
          key: 'permissoes', label: 'Permissões',
          content: <EscDataTable
            fetchFn={escService.permissoes}
            searchKeys={['role', 'module', 'unidade']}
            columns={[
              { key: 'unidade', label: 'Unidade' },
              { key: 'role', label: 'Cargo' },
              { key: 'module', label: 'Módulo' },
              { key: 'can_view', label: 'Ver', render: (r) => (r.can_view ? 'Sim' : 'Não') },
              { key: 'can_write', label: 'Editar', render: (r) => (r.can_write ? 'Sim' : 'Não') },
            ]}
          />,
        },
        {
          key: 'estoque', label: 'Estoque',
          content: <EscDataTable
            fetchFn={escService.estoque}
            searchKeys={['unidade']}
            columns={[
              { key: 'unidade', label: 'Unidade' },
              { key: 'estoque', label: 'Comprovantes em estoque' },
            ]}
          />,
        },
      ]}
    />
  )
}
