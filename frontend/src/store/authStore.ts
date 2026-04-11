import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthState, UserRole } from '../types'

interface AuthStore extends AuthState {
  linkedAssociationIds: string[]
  associationName: string
  rememberDevice: boolean
  setAuth: (token: string, userId: string, associationId: string, role: UserRole, fullName: string, linkedAssociationIds?: string[], associationName?: string, rememberDevice?: boolean) => void
  clearAuth: () => void
  isAuthenticated: () => boolean
  isAggregator: () => boolean
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

      setAuth: (token, userId, associationId, role, fullName, linkedAssociationIds = [], associationName = '', rememberDevice = false) => {
        set({ token, userId, associationId, role, fullName, linkedAssociationIds, associationName, rememberDevice })
      },

      clearAuth: () => {
        localStorage.removeItem('aprxm-auth')
        set({ token: null, userId: null, associationId: null, role: null, fullName: null, linkedAssociationIds: [], associationName: '', rememberDevice: false })
      },

      isAuthenticated: () => !!get().token,
      isAggregator: () => (get().linkedAssociationIds?.length ?? 0) > 0,
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
