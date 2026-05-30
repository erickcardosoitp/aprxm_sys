import { lazy, Suspense, useState } from 'react'
import { UserPlus, Search, AlertTriangle, Map } from 'lucide-react'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SECTOR_COLORS } from './theme'

const ResidentsPage = lazy(() => import('../../pages/residents/ResidentsPage'))

type Modo = 'cadastrar' | 'consultar' | 'inadimplentes' | 'mapa' | null

export default function SimplificaMoradores() {
  const [modo, setModo] = useState<Modo>(null)

  const offscreen: React.CSSProperties = {
    position: 'fixed', left: '-99999px', width: '1px', height: '1px', overflow: 'hidden',
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Moradores" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        <SimplificaTile icon={UserPlus}      label="Cadastrar"      color={SECTOR_COLORS.moradores} onClick={() => setModo('cadastrar')} />
        <SimplificaTile icon={Search}        label="Consultar"      color={SECTOR_COLORS.moradores} onClick={() => setModo('consultar')} />
        <SimplificaTile icon={AlertTriangle} label="Inadimplentes"  color={SECTOR_COLORS.moradores} onClick={() => setModo('inadimplentes')} />
        <SimplificaTile icon={Map}           label="Mapa Moradores" color={SECTOR_COLORS.moradores} onClick={() => setModo('mapa')} />
      </main>

      {/* ResidentsPage off-screen — mesmo padrão do PackagesPage */}
      {modo && (
        <div aria-hidden="true" style={offscreen}>
          <Suspense fallback={null}>
            <ResidentsPage
              cadastrarMode={modo === 'cadastrar'}
              consultarMode={modo === 'consultar'}
              inadimplentesMode={modo === 'inadimplentes'}
              mapaMode={modo === 'mapa'}
              onModalClosed={() => setModo(null)}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
