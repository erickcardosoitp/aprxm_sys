import { ShieldCheck } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscDataTable from './EscDataTable'
import EscEmptySection from './EscEmptySection'
import { PermissoesSection, AvisosSection } from './AdminSections'
import { escService } from '../../services/esc'

export default function AdministracaoPage() {
  return (
    <EscModulePage
      title="Administração"
      description="Gestão centralizada da empresa: permissões, avisos, auditoria, metas e estoque."
      icon={ShieldCheck}
      sections={[
        { key: 'permissoes', label: 'Permissões', content: <PermissoesSection /> },
        { key: 'avisos', label: 'Avisos', content: <AvisosSection /> },
        {
          key: 'auditoria', label: 'Auditoria',
          content: <EscDataTable
            fetchFn={() => escService.auditoria(200)}
            searchKeys={['action', 'user', 'unidade']}
            filterKeys={[{ key: 'unidade', label: 'Unidade' }, { key: 'action', label: 'Ação' }]}
            columns={[
              { key: 'created_at', label: 'Data' },
              { key: 'user', label: 'Usuário' },
              { key: 'action', label: 'Ação' },
              { key: 'entity', label: 'Entidade' },
              { key: 'unidade', label: 'Unidade' },
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
        { key: 'metas', label: 'Plano de Metas', content: <EscEmptySection columns={['Unidade', 'Meta', 'Período', 'Progresso']} /> },
      ]}
    />
  )
}
