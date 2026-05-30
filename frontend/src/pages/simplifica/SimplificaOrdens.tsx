import { lazy, Suspense, useState } from 'react'
import { ChevronLeft, FilePlus2, Search, ListChecks, ClipboardList } from 'lucide-react'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
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

      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
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

      {/* Tarefas Diárias — tela cheia (tab content não é fixed overlay) */}
      {tarefasOpen && (
        <div className="fixed inset-0 z-40 bg-white flex flex-col">
          {/* Back button sobreposto ao header do ServiceOrdersPage */}
          <div className="flex items-center gap-3 px-4 py-3 text-white shrink-0"
            style={{ backgroundColor: color, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
            <button onClick={() => setTarefasOpen(false)} className="p-1 -ml-1 rounded-lg hover:bg-white/10">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <span className="font-bold text-base">Tarefas Diárias</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Suspense fallback={
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: color }} />
              </div>
            }>
              <ServiceOrdersPage tarefasMode />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  )
}
