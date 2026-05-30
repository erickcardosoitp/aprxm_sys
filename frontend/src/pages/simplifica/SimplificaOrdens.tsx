import { lazy, Suspense, useState } from 'react'
import { FilePlus2, Search, ListChecks, ClipboardList } from 'lucide-react'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SimplificaTarefas } from './SimplificaTarefas'
import { SECTOR_COLORS } from './theme'

const ServiceOrdersPage = lazy(() => import('../../pages/service_orders/ServiceOrdersPage'))

type Modo = 'criar' | 'consultar' | 'minhas' | null

export default function SimplificaOrdens() {
  const [modo, setModo] = useState<Modo>(null)
  const [tarefasOpen, setTarefasOpen] = useState(false)


  const offscreen: React.CSSProperties = {
    position: 'fixed', left: '-99999px', width: '1px', height: '1px', overflow: 'hidden',
  }
  const color = SECTOR_COLORS.ordens

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Ordens" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-3 content-start">
        <SimplificaTile icon={FilePlus2}     label="Criar OS"         color={color} onClick={() => setModo('criar')} />
        <SimplificaTile icon={Search}        label="Consultar Ordens" color={color} onClick={() => setModo('consultar')} />
        <SimplificaTile icon={ListChecks}    label="Tarefas Diárias"  color={color} onClick={() => setTarefasOpen(true)} />
        <SimplificaTile icon={ClipboardList} label="Minhas Ordens"    color={color} onClick={() => setModo('minhas')} />
      </main>

      {/* Criar / Consultar / Minhas — off-screen, modais fixed escapam */}
      {modo && (
        <div aria-hidden="true" style={offscreen}>
          <Suspense fallback={null}>
            <ServiceOrdersPage
              criarMode={modo === 'criar'}
              consultarMode={modo === 'consultar'}
              minhasMode={modo === 'minhas'}
              onModalClosed={() => setModo(null)}
            />
          </Suspense>
        </div>
      )}

      {/* Tarefas Diárias — componente dedicado Simplifica */}
      {tarefasOpen && <SimplificaTarefas onClose={() => setTarefasOpen(false)} />}
    </div>
  )
}
