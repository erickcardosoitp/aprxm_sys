import { useNavigate } from 'react-router-dom'
import { PackagePlus, PackageCheck, Undo2, Plus, Search, ClipboardList } from 'lucide-react'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SECTOR_COLORS } from './theme'

export default function SimplificaEncomendas() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Encomendas" showBack />
      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        {/* ?action=receive abre direto o seletor Unitário/Múltiplo do PackagesPage */}
        <SimplificaTile icon={PackagePlus}   label="Receber"            color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages?action=receive')} />
        <SimplificaTile icon={PackageCheck}  label="Retirada"           color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages?action=esteira')} />
        <SimplificaTile icon={Undo2}         label="Devolução"          color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages')} />
        <SimplificaTile icon={Plus}          label="Cadastros"          color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages')} />
        <SimplificaTile icon={Search}        label="Consultar"          color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages')} />
        <SimplificaTile icon={ClipboardList} label="Minhas Encomendas"  color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages')} />
      </main>
    </div>
  )
}
