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
  setAuth: (token: string, userId: string, associationId: string, role: UserRole, fullName: string, linkedAssociationIds?: string[], associationName?: string, rememberDevice?: boolean) => void
  clearAuth: () => void
  setPermissions: (p: Permissions) => void
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
      permissions: null,

      setAuth: (token, userId, associationId, role, fullName, linkedAssociationIds = [], associationName = '', rememberDevice = false) => {
        set({ token, userId, associationId, role, fullName, linkedAssociationIds, associationName, rememberDevice, permissions: null })
      },

      clearAuth: () => {
        localStorage.removeItem('aprxm-auth')
        set({ token: null, userId: null, associationId: null, role: null, fullName: null, linkedAssociationIds: [], associationName: '', rememberDevice: false, permissions: null })
      },

      setPermissions: (permissions) => set({ permissions }),

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
