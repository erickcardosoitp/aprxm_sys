import { useState } from 'react'
import toast from 'react-hot-toast'
import { financeService } from '../services/finance'

export interface CheckoutPayload {
  type: 'income' | 'expense'
  amount: number
  description: string
  income_subtype?: string
  category_id?: string
  resident_id?: string
  payment_method_id?: string
  cash_session_id?: string
  is_acordo?: boolean
  acordo_installments?: number
  acordo_months?: number
  acordo_entrada?: number
  payer_name?: string
  payer_entity_id?: string
}

type OpenSession = { id: string; opened_by: string; opened_by_name: string; opening_balance: string; opened_at: string; is_mine: boolean }

interface UseCheckoutOptions {
  onSuccess: () => void
  onClose: () => void
}

export function useCheckout({ onSuccess, onClose }: UseCheckoutOptions) {
  const [saving, setSaving] = useState(false)
  const [openSessions, setOpenSessions] = useState<OpenSession[]>([])
  const [showSessionPicker, setShowSessionPicker] = useState(false)
  const [pendingPayload, setPendingPayload] = useState<CheckoutPayload | null>(null)

  const submit = async (payload: CheckoutPayload, splitPayload?: CheckoutPayload) => {
    setSaving(true)
    try {
      try {
        await financeService.registerTransaction(payload as any)
        if (splitPayload) {
          await financeService.registerTransaction(splitPayload as any)
        }
      } catch (e: any) {
        if (e.response?.data?.detail === 'NO_SESSION') {
          setSaving(false)
          try {
            const res = await financeService.listOpenSessionsPicker()
            if (res.data.length === 0) {
              toast.error('Nenhum caixa aberto. Abra um caixa antes de registrar.')
              return
            }
            setOpenSessions(res.data as any)
            setPendingPayload(payload)
            setShowSessionPicker(true)
          } catch {
            toast.error('Nenhum caixa aberto.')
          }
          return
        }
        throw e
      }
      toast.success('Transação registrada!')
      onSuccess()
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Erro ao registrar transação.')
    } finally {
      setSaving(false)
    }
  }

  const confirmWithSession = async (sessionId: string) => {
    if (!pendingPayload) return
    setSaving(true)
    setShowSessionPicker(false)
    try {
      await financeService.registerTransaction({ ...pendingPayload, cash_session_id: sessionId } as any)
      setPendingPayload(null)
      toast.success('Transação registrada!')
      onSuccess()
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Erro ao registrar transação.')
    } finally {
      setSaving(false)
    }
  }

  return { saving, submit, openSessions, showSessionPicker, setShowSessionPicker, confirmWithSession }
}
