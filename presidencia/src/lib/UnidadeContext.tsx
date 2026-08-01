import { createContext, useContext, useState, type ReactNode } from 'react'
import type { UnidadeKey } from './unidade'

interface UnidadeContextValue {
  unidade: UnidadeKey
  setUnidade: (u: UnidadeKey) => void
}

const UnidadeContext = createContext<UnidadeContextValue | null>(null)

export function UnidadeProvider({ children }: { children: ReactNode }) {
  const [unidade, setUnidade] = useState<UnidadeKey>('todos')
  return (
    <UnidadeContext.Provider value={{ unidade, setUnidade }}>
      {children}
    </UnidadeContext.Provider>
  )
}

export function useUnidade(): UnidadeContextValue {
  const ctx = useContext(UnidadeContext)
  if (!ctx) throw new Error('useUnidade must be used within UnidadeProvider')
  return ctx
}
