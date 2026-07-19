import { RefreshCw } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscEmptySection from './EscEmptySection'

export default function SincronizacaoPage() {
  return (
    <EscModulePage
      title="Sincronização"
      description="Monitor de sincronização — app offline (projeto futuro, ainda não iniciado)."
      icon={RefreshCw}
      sections={[
        { key: 'monitor', label: 'Monitor de Sincronização', content: <EscEmptySection columns={['Dispositivo', 'Unidade', 'Última sincronização', 'Status']} /> },
      ]}
    />
  )
}
