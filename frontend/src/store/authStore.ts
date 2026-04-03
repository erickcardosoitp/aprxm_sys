import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthState, UserRole } from '../types'

interface AuthStore extends AuthState {
  setAuth: (token: string, userId: string, associationId: string, role: UserRole, fullName: string) => void
  clearAuth: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      token: null,
      userId: null,
      associationId: null,
      role: null,
      fullName: null,

      setAuth: (token, userId, associationId, role, fullName) => {
        localStorage.setItem('aprxm_token', token)
        set({ token, userId, associationId, role, fullName })
      },

      clearAuth: () => {
        localStorage.removeItem('aprxm_token')
        set({ token: null, userId: null, associationId: null, role: null, fullName: null })
      },

      isAuthenticated: () => !!get().token,
    }),
    { name: 'aprxm-auth' },
  ),
)
