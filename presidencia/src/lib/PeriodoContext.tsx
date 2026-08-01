import { createContext, useContext, useState, type ReactNode } from 'react'
import type { PeriodoKey } from './periodo'

function currentYYYYMM(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const MESES_POR_PERIODO: Record<PeriodoKey, number> = {
  mes: 1,
  trimestre: 3,
  semestre: 6,
  ano: 12,
}

function shiftYYYYMM(yyyymm: string, deltaMonths: number): string {
  const [y, m] = yyyymm.split('-').map(Number)
  const total = y * 12 + (m - 1) + deltaMonths
  const newY = Math.floor(total / 12)
  const newM = (total % 12) + 1
  return `${newY}-${String(newM).padStart(2, '0')}`
}

interface PeriodoContextValue {
  periodo: PeriodoKey
  setPeriodo: (p: PeriodoKey) => void
  ate: string
  isAtual: boolean
  goPrev: () => void
  goNext: () => void
  goToday: () => void
}

const PeriodoContext = createContext<PeriodoContextValue | null>(null)

export function PeriodoProvider({ children }: { children: ReactNode }) {
  const [periodo, setPeriodoState] = useState<PeriodoKey>('mes')
  const [ate, setAte] = useState<string>(currentYYYYMM())

  function setPeriodo(p: PeriodoKey) {
    setPeriodoState(p)
    setAte(currentYYYYMM())
  }

  function shift(direction: 1 | -1) {
    setAte((prev) => shiftYYYYMM(prev, direction * MESES_POR_PERIODO[periodo]))
  }

  return (
    <PeriodoContext.Provider
      value={{
        periodo,
        setPeriodo,
        ate,
        isAtual: ate === currentYYYYMM(),
        goPrev: () => shift(-1),
        goNext: () => shift(1),
        goToday: () => setAte(currentYYYYMM()),
      }}
    >
      {children}
    </PeriodoContext.Provider>
  )
}

export function usePeriodo(): PeriodoContextValue {
  const ctx = useContext(PeriodoContext)
  if (!ctx) throw new Error('usePeriodo must be used within PeriodoProvider')
  return ctx
}
