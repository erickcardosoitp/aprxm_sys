import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import api from '../../../services/api'
import type { Conferente, PaymentMethod } from '../types/financeiro'

interface FinanceiroContextValue {
  assocName: string
  carneOperator: string
  setCarneOperator: (v: string) => void
  openSession: { id: string } | null | undefined
  setOpenSession: (s: { id: string } | null) => void
  loadOpenSession: () => Promise<void>
  conferentes: Conferente[]
  operadores: Conferente[]
  loadConferentes: () => Promise<void>
  paymentMethods: PaymentMethod[]
}

const FinanceiroContext = createContext<FinanceiroContextValue | null>(null)

export function FinanceiroProvider({ children }: { children: ReactNode }) {
  const [assocName, setAssocName] = useState('')
  const [carneOperator, setCarneOperator] = useState('')
  const [openSession, setOpenSession] = useState<{ id: string } | null | undefined>(undefined)
  const [conferentes, setConferentes] = useState<Conferente[]>([])
  const [operadores, setOperadores] = useState<Conferente[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])

  useEffect(() => {
    api.get<{ association_name?: string }>('/settings/association')
      .then(r => setAssocName(r.data.association_name ?? ''))
      .catch(() => {})
    api.get<PaymentMethod[]>('/finance/payment-methods')
      .then(r => setPaymentMethods(r.data))
      .catch(() => {})
    loadOpenSession()
    loadConferentes()
  }, [])

  const loadOpenSession = async () => {
    try {
      const res = await api.get<{ id: string; is_mine?: boolean; opened_by: string }>('/finance/sessions/current')
      setOpenSession(res.data.is_mine ? res.data : null)
    } catch {
      setOpenSession(null)
    }
  }

  const loadConferentes = async () => {
    try {
      const [rc, ro] = await Promise.all([
        api.get<Conferente[]>('/finance/conferentes'),
        api.get<Conferente[]>('/finance/operadores'),
      ])
      setConferentes(rc.data)
      setOperadores(ro.data)
    } catch { /* ignore */ }
  }

  return (
    <FinanceiroContext.Provider value={{
      assocName, carneOperator, setCarneOperator,
      openSession, setOpenSession, loadOpenSession,
      conferentes, operadores, loadConferentes,
      paymentMethods,
    }}>
      {children}
    </FinanceiroContext.Provider>
  )
}

export function useFinanceiro() {
  const ctx = useContext(FinanceiroContext)
  if (!ctx) throw new Error('useFinanceiro must be inside FinanceiroProvider')
  return ctx
}
