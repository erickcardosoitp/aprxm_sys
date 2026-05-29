import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SimplificaBottomSheet } from './components/SimplificaBottomSheet'

const ACOES = [
  { icon: '📝', label: 'Criar OS',           sheet: 'criar' },
  { icon: '🔍', label: 'Consultar Ordens',   sheet: 'consultar' },
  { icon: '✅', label: 'Tarefas Diárias',    sheet: 'tarefas' },
  { icon: '📋', label: 'Minhas Ordens',      sheet: 'minhas' },
] as const

type Sheet = typeof ACOES[number]['sheet'] | null

export default function SimplificaOrdens() {
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<Sheet>(null)

  const titles: Record<NonNullable<Sheet>, string> = {
    'criar':     'Criar Ordem de Serviço',
    'consultar': 'Consultar Ordens',
    'tarefas':   'Tarefas Diárias',
    'minhas':    'Minhas Ordens',
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Ordens" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        {ACOES.map(a => (
          <SimplificaTile key={a.sheet} icon={a.icon} label={a.label} onClick={() => setSheet(a.sheet)} />
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
            onClick={() => navigate('/service-orders')}
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
