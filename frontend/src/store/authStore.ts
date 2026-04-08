import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthState, UserRole } from '../types'

interface AuthStore extends AuthState {
  linkedAssociationIds: string[]
  associationName: string
  setAuth: (token: string, userId: string, associationId: string, role: UserRole, fullName: string, linkedAssociationIds?: string[], associationName?: string) => void
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

      setAuth: (token, userId, associationId, role, fullName, linkedAssociationIds = [], associationName = '') => {
        localStorage.setItem('aprxm_token', token)
        set({ token, userId, associationId, role, fullName, linkedAssociationIds, associationName })
      },

      clearAuth: () => {
        localStorage.removeItem('aprxm_token')
        set({ token: null, userId: null, associationId: null, role: null, fullName: null, linkedAssociationIds: [], associationName: '' })
      },

      isAuthenticated: () => !!get().token,
      isAggregator: () => (get().linkedAssociationIds?.length ?? 0) > 0,
    }),
    { name: 'aprxm-auth' },
  ),
)
