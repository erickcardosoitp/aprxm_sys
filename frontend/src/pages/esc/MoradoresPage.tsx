import { Users } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscDataTable from './EscDataTable'
import { escService } from '../../services/esc'

const residentColumns = [
  { key: 'full_name', label: 'Nome' },
  { key: 'cpf', label: 'CPF' },
  { key: 'unidade', label: 'Unidade' },
  { key: 'status', label: 'Status' },
]
const residentFilters = [{ key: 'unidade', label: 'Unidade' }, { key: 'status', label: 'Status' }]

export default function MoradoresPage() {
  return (
    <EscModulePage
      title="Moradores"
      description="Associados, visitantes e dependentes — todas as unidades da empresa."
      icon={Users}
      sections={[
        { key: 'associados', label: 'Associados', content: <EscDataTable fetchFn={escService.associados} searchKeys={['full_name', 'cpf']} filterKeys={residentFilters} columns={residentColumns} /> },
        { key: 'visitantes', label: 'Visitantes', content: <EscDataTable fetchFn={escService.visitantes} searchKeys={['full_name', 'cpf']} filterKeys={residentFilters} columns={residentColumns} /> },
        { key: 'dependentes', label: 'Dependentes', content: <EscDataTable fetchFn={escService.dependentes} searchKeys={['full_name', 'cpf']} filterKeys={residentFilters} columns={residentColumns} /> },
      ]}
    />
  )
}
