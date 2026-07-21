import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthState, UserRole } from '../types'

export interface ModulePerm { can_view: boolean; can_write: boolean }
export type Permissions = Record<string, ModulePerm>

interface AuthStore extends AuthState {
  linkedAssociationIds: string[]
  associationName: string
  rememberDevice: boolean
  permissions: Permissions | null
  isOffice: boolean
  empresaId: string | null
  simplificaMode: boolean
  simplificaEnabled: boolean
  financeiroCentralizado: boolean
  setAuth: (token: string, userId: string, associationId: string, role: UserRole, fullName: string, linkedAssociationIds?: string[], associationName?: string, rememberDevice?: boolean, isOffice?: boolean, empresaId?: string | null) => void
  clearAuth: () => void
  setPermissions: (p: Permissions) => void
  setSimplificaPrefs: (mode: boolean, enabled: boolean) => void
  setFinanceiroCentralizado: (v: boolean) => void
  setSimplificaMode: (mode: boolean) => void
  isAuthenticated: () => boolean
  isAggregator: () => boolean
  isEsc: () => boolean
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      token: null,
      userId: null,
      associationId: null,
      role: null,
      fullName: null,
      linkedAssociationIds: [],
      associationName: '',
      rememberDevice: false,
      permissions: null,
      isOffice: false,
      empresaId: null,
      simplificaMode: false,
      simplificaEnabled: false,
      financeiroCentralizado: false,

      setAuth: (token, userId, associationId, role, fullName, linkedAssociationIds = [], associationName = '', rememberDevice = false, isOffice = false, empresaId = null) => {
        set({ token, userId, associationId, role, fullName, linkedAssociationIds, associationName, rememberDevice, permissions: null, isOffice, empresaId })
      },

      clearAuth: () => {
        localStorage.removeItem('aprxm-auth')
        set({ token: null, userId: null, associationId: null, role: null, fullName: null, linkedAssociationIds: [], associationName: '', rememberDevice: false, permissions: null, isOffice: false, empresaId: null, simplificaMode: false, simplificaEnabled: false, financeiroCentralizado: false })
      },

      setPermissions: (permissions) => set({ permissions }),
      setSimplificaPrefs: (simplificaMode, simplificaEnabled) => set({ simplificaMode, simplificaEnabled }),
      setSimplificaMode: (simplificaMode) => set({ simplificaMode }),
      setFinanceiroCentralizado: (financeiroCentralizado) => set({ financeiroCentralizado }),

      isAuthenticated: () => !!get().token,
      isAggregator: () => (get().linkedAssociationIds?.length ?? 0) > 0,
      isEsc: () => {
        const s = get()
        return !!s.associationId && !!s.empresaId && s.associationId === s.empresaId
      },
    }),
    {
      name: 'aprxm-auth',
      storage: {
        getItem: (key) => {
          const v = localStorage.getItem(key) ?? sessionStorage.getItem(key)
          return v ? JSON.parse(v) : null
        },
        setItem: (key, value) => {
          const str = JSON.stringify(value)
          if ((value as any).state?.rememberDevice) {
            localStorage.setItem(key, str)
          } else {
            sessionStorage.setItem(key, str)
            localStorage.removeItem(key)
          }
        },
        removeItem: (key) => { localStorage.removeItem(key); sessionStorage.removeItem(key) },
      },
    },
  ),
)
