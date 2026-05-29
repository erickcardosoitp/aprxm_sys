import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SimplificaBottomSheet } from './components/SimplificaBottomSheet'
import { SECTOR_COLORS } from './theme'

const ACOES = [
  { icon: '🏷️', label: 'Mensalidades',        sheet: 'mensalidades' },
  { icon: '🏠', label: 'Comp. Residência',     sheet: 'residencia' },
  { icon: '➕', label: 'Outras Entradas',      sheet: 'outras-entradas' },
  { icon: '➖', label: 'Registrar Saída',      sheet: 'saida' },
  { icon: '📊', label: 'Consultar Movim.',     sheet: 'movimentacoes' },
  { icon: '⚠️', label: 'Informar Incidente',   sheet: 'incidente' },
] as const

type Sheet = typeof ACOES[number]['sheet'] | null

export default function SimplificaCaixa() {
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<Sheet>(null)

  const titles: Record<NonNullable<Sheet>, string> = {
    'mensalidades':    'Mensalidades',
    'residencia':      'Comprovante de Residência',
    'outras-entradas': 'Outras Entradas',
    'saida':           'Registrar Saída',
    'movimentacoes':   'Consultar Movimentações',
    'incidente':       'Informar Incidente',
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Caixa" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        {ACOES.map(a => (
          <SimplificaTile key={a.sheet} icon={a.icon} label={a.label} color={SECTOR_COLORS.caixa} onClick={() => setSheet(a.sheet)} />
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
            onClick={() => navigate('/finance')}
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
