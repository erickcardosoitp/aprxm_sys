import { ShieldCheck } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscDataTable from './EscDataTable'
import EscEmptySection from './EscEmptySection'
import { AvisosSection } from './AdminSections'
import InventarioEncomendasSection from './InventarioEncomendasSection'
import ComprovantesEstoqueSection from './ComprovantesEstoqueSection'
import { escService } from '../../services/esc'

export default function AdministracaoPage() {
  return (
    <EscModulePage
      title="Administração"
      description="Gestão centralizada da empresa: avisos, auditoria, metas e estoque. Permissões agora ficam em Cadastros > Grupos de Usuários."
      icon={ShieldCheck}
      sections={[
        { key: 'inventario-encomendas', label: 'Inventário de Encomendas', content: <InventarioEncomendasSection /> },
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
        { key: 'estoque', label: 'Estoque', content: <ComprovantesEstoqueSection /> },
        { key: 'metas', label: 'Plano de Metas', content: <EscEmptySection columns={['Unidade', 'Meta', 'Período', 'Progresso']} /> },
      ]}
    />
  )
}
