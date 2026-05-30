import { lazy, Suspense, useState } from 'react'
import { PackagePlus, PackageCheck, Undo2, Users2, Search, ClipboardList } from 'lucide-react'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SimplificaCadastros } from './SimplificaCadastros'
import { SECTOR_COLORS } from './theme'

// PackagesPage lazy — carregado ao usar Receber / Retirada / Devolução
const PackagesPage = lazy(() => import('../../pages/packages/PackagesPage'))

type Modo = 'receber' | 'retirada' | 'devolucao' | 'consultar' | 'minhas' | null

export default function SimplificaEncomendas() {
  const [modo, setModo] = useState<Modo>(null)
  const [cadastrosOpen, setCadastrosOpen] = useState(false)

  // Cada modo monta PackagesPage off-screen com a prop correspondente.
  // Os modais internos usam `fixed inset-0 z-50` e aparecem sobre o Simplifica.
  // onModalClosed desmonta o componente quando o usuário fecha o modal.
  const offscreen: React.CSSProperties = {
    position: 'fixed', left: '-99999px', width: '1px', height: '1px', overflow: 'hidden',
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Encomendas" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-3 content-start">
        <SimplificaTile icon={PackagePlus}  label="Receber"            color={SECTOR_COLORS.encomendas} onClick={() => setModo('receber')} />
        <SimplificaTile icon={PackageCheck} label="Retirada"           color={SECTOR_COLORS.encomendas} onClick={() => setModo('retirada')} />
        <SimplificaTile icon={Undo2}        label="Devolução"          color={SECTOR_COLORS.encomendas} onClick={() => setModo('devolucao')} />
        <SimplificaTile icon={Users2}       label="Cadastros"          color={SECTOR_COLORS.encomendas} onClick={() => setCadastrosOpen(true)} />
        <SimplificaTile icon={Search}       label="Consultar"          color={SECTOR_COLORS.encomendas} onClick={() => setModo('consultar')} />
        <SimplificaTile icon={ClipboardList} label="Minhas Encomendas" color={SECTOR_COLORS.encomendas} onClick={() => setModo('minhas')} />
      </main>

      {/* PackagesPage off-screen — cada modo abre o modal/picker correto */}
      {modo && (
        <div aria-hidden="true" style={offscreen}>
          <Suspense fallback={null}>
            <PackagesPage
              modalMode={modo === 'receber'}
              retiradaMode={modo === 'retirada'}
              devolucaoMode={modo === 'devolucao'}
              consultarMode={modo === 'consultar'}
              minhasMode={modo === 'minhas'}
              onModalClosed={() => setModo(null)}
            />
          </Suspense>
        </div>
      )}

      {/* Cadastros — tela cheia Simplifica (Transportadoras | Entregadores) */}
      {cadastrosOpen && <SimplificaCadastros onClose={() => setCadastrosOpen(false)} />}
    </div>
  )
}
