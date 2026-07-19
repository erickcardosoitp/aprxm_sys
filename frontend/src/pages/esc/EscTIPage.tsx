import { Activity } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscEmptySection from './EscEmptySection'
import EscInfraSection from './EscInfraSection'

export default function EscTIPage() {
  return (
    <EscModulePage
      title="TI"
      description="Infraestrutura, análise de dados e banco de dados da empresa."
      icon={Activity}
      sections={[
        { key: 'infra', label: 'Infra', content: <EscInfraSection /> },
        { key: 'analytics', label: 'Data Analytics', content: <EscEmptySection columns={['Métrica', 'Valor', 'Período']} /> },
        { key: 'bd', label: 'Banco de Dados', content: <EscEmptySection columns={['Tabela', 'Registros', 'Tamanho']} /> },
      ]}
    />
  )
}
