import { lazy, Suspense, useState } from 'react'
import { UserPlus, Search, AlertTriangle, Map } from 'lucide-react'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SECTOR_COLORS } from './theme'
import { MapaMoradores } from './moradores/MapaMoradores'
import { CadastrarMorador } from './moradores/CadastrarMorador'

// ResidentsPage apenas para Consultar e Inadimplentes
const ResidentsPage = lazy(() => import('../../pages/residents/ResidentsPage'))

type Modo = 'consultar' | 'inadimplentes' | null

export default function SimplificaMoradores() {
  const [modo, setModo] = useState<Modo>(null)
  const [mapaOpen, setMapaOpen] = useState(false)
  const [cadastrarOpen, setCadastrarOpen] = useState(false)

  const offscreen: React.CSSProperties = {
    position: 'fixed', left: '-99999px', width: '1px', height: '1px', overflow: 'hidden',
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Moradores" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-3" style={{ gridAutoRows: '1fr' }}>
        {/* Cadastrar: form simplificado (6 campos) */}
        <SimplificaTile icon={UserPlus}      label="Cadastrar"      color={SECTOR_COLORS.moradores} onClick={() => setCadastrarOpen(true)} />
        {/* Consultar: picker de busca → ResidentProfileModal original */}
        <SimplificaTile icon={Search}        label="Consultar"      color={SECTOR_COLORS.moradores} onClick={() => setModo('consultar')} />
        {/* Inadimplentes: lista de moradores em atraso */}
        <SimplificaTile icon={AlertTriangle} label="Inadimplentes"  color={SECTOR_COLORS.moradores} onClick={() => setModo('inadimplentes')} />
        {/* Mapa: Leaflet com marcadores por rua + lista suspensa */}
        <SimplificaTile icon={Map}           label="Mapa Moradores" color={SECTOR_COLORS.moradores} onClick={() => setMapaOpen(true)} />
      </main>

      {/* Formulário simplificado de cadastro (overlay direto) */}
      {cadastrarOpen && (
        <CadastrarMorador onClose={() => setCadastrarOpen(false)} />
      )}

      {/* Mapa GPS completo */}
      {mapaOpen && (
        <MapaMoradores onClose={() => setMapaOpen(false)} />
      )}

      {/* ResidentsPage off-screen para Consultar e Inadimplentes */}
      {modo && (
        <div aria-hidden="true" style={offscreen}>
          <Suspense fallback={null}>
            <ResidentsPage
              consultarMode={modo === 'consultar'}
              inadimplentesMode={modo === 'inadimplentes'}
              onModalClosed={() => setModo(null)}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
