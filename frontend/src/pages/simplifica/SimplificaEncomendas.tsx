import { lazy, Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PackagePlus, PackageCheck, Undo2, Plus, Search, ClipboardList } from 'lucide-react'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SECTOR_COLORS } from './theme'

// PackagesPage lazy — só carregado ao clicar Receber
const PackagesPage = lazy(() => import('../../pages/packages/PackagesPage'))

export default function SimplificaEncomendas() {
  const navigate = useNavigate()
  const [receberActive, setReceberActive] = useState(false)

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Encomendas" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        {/* Receber: abre modal nativo do PackagesPage como overlay no Simplifica */}
        <SimplificaTile icon={PackagePlus}   label="Receber"            color={SECTOR_COLORS.encomendas} onClick={() => setReceberActive(true)} />
        {/* Demais: navegam para o sistema completo conforme padrão do Simplifica */}
        <SimplificaTile icon={PackageCheck}  label="Retirada"           color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages?action=esteira')} />
        <SimplificaTile icon={Undo2}         label="Devolução"          color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages')} />
        <SimplificaTile icon={Plus}          label="Cadastros"          color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages')} />
        <SimplificaTile icon={Search}        label="Consultar"          color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages')} />
        <SimplificaTile icon={ClipboardList} label="Minhas Encomendas"  color={SECTOR_COLORS.encomendas} onClick={() => navigate('/packages')} />
      </main>

      {/*
        PackagesPage renderizado off-screen: seu conteúdo (lista) fica fora da viewport,
        mas os modais internos usam `fixed inset-0 z-50` e aparecem corretamente na tela.
        modalMode=true suprime loadPackages e loadReceiveHistory.
        onModalClosed desmonta o componente ao fechar o modal.
      */}
      {receberActive && (
        <div
          aria-hidden="true"
          style={{ position: 'fixed', left: '-99999px', width: '1px', height: '1px', overflow: 'hidden' }}
        >
          <Suspense fallback={null}>
            <PackagesPage
              modalMode={true}
              onModalClosed={() => setReceberActive(false)}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
