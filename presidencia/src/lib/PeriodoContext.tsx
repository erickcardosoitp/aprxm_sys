import { createContext, useContext, useState, type ReactNode } from 'react'
import type { PeriodoKey } from './periodo'

interface PeriodoContextValue {
  periodo: PeriodoKey
  setPeriodo: (p: PeriodoKey) => void
}

const PeriodoContext = createContext<PeriodoContextValue | null>(null)

export function PeriodoProvider({ children }: { children: ReactNode }) {
  const [periodo, setPeriodo] = useState<PeriodoKey>('mes')
  return (
    <PeriodoContext.Provider value={{ periodo, setPeriodo }}>
      {children}
    </PeriodoContext.Provider>
  )
}

export function usePeriodo(): PeriodoContextValue {
  const ctx = useContext(PeriodoContext)
  if (!ctx) throw new Error('usePeriodo must be used within PeriodoProvider')
  return ctx
}
