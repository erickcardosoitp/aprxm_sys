import { useNavigate } from 'react-router-dom'
import { PackagePlus, PackageCheck, Undo2, Plus, Search, ClipboardList } from 'lucide-react'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SECTOR_COLORS } from './theme'

export default function SimplificaEncomendas() {
  const navigate = useNavigate()

  // Navega para o sistema completo de encomendas.
  // O operacional é idêntico ao original — não duplicamos lógica.
  // O botão "Simplifica" no AppShell header permite voltar ao modo Simplifica.
  const goPackages = () => navigate('/packages')

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Encomendas" showBack />
      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        <SimplificaTile icon={PackagePlus}   label="Receber"            color={SECTOR_COLORS.encomendas} onClick={goPackages} />
        <SimplificaTile icon={PackageCheck}  label="Retirada"           color={SECTOR_COLORS.encomendas} onClick={goPackages} />
        <SimplificaTile icon={Undo2}         label="Devolução"          color={SECTOR_COLORS.encomendas} onClick={goPackages} />
        <SimplificaTile icon={Plus}          label="Cadastros"          color={SECTOR_COLORS.encomendas} onClick={goPackages} />
        <SimplificaTile icon={Search}        label="Consultar"          color={SECTOR_COLORS.encomendas} onClick={goPackages} />
        <SimplificaTile icon={ClipboardList} label="Minhas Encomendas"  color={SECTOR_COLORS.encomendas} onClick={goPackages} />
      </main>
    </div>
  )
}
