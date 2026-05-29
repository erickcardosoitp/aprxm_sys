import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SimplificaBottomSheet } from './components/SimplificaBottomSheet'
import { SECTOR_COLORS } from './theme'

const ACOES = [
  { icon: '📥', label: 'Receber',          sheet: 'receber' },
  { icon: '📤', label: 'Retirada',         sheet: 'retirada' },
  { icon: '🔄', label: 'Devolução',        sheet: 'devolucao' },
  { icon: '➕', label: 'Cadastrar',        sheet: 'cadastrar' },
  { icon: '🔍', label: 'Consultar',        sheet: 'consultar' },
  { icon: '📋', label: 'Minhas Encomendas', sheet: 'minhas' },
] as const

type Sheet = typeof ACOES[number]['sheet'] | null

export default function SimplificaEncomendas() {
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<Sheet>(null)

  const titles: Record<NonNullable<Sheet>, string> = {
    'receber':   'Receber Encomenda',
    'retirada':  'Retirada de Encomenda',
    'devolucao': 'Devolução de Encomenda',
    'cadastrar': 'Cadastrar Encomenda',
    'consultar': 'Consultar Encomenda',
    'minhas':    'Minhas Encomendas',
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Encomendas" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        {ACOES.map(a => (
          <SimplificaTile key={a.sheet} icon={a.icon} label={a.label} color={SECTOR_COLORS.encomendas} onClick={() => setSheet(a.sheet)} />
        ))}
      </main>

      <SimplificaBottomSheet
        open={!!sheet}
        title={sheet ? titles[sheet] : ''}
        onClose={() => setSheet(null)}
      >
        <div className="flex flex-col items-center gap-4 py-6">
          <p className="text-gray-500 text-sm text-center">Em breve disponível aqui.</p>
          <button
            onClick={() => navigate('/packages')}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--brand-header)' }}
          >
            Abrir no modo completo
          </button>
        </div>
      </SimplificaBottomSheet>
    </div>
  )
}
