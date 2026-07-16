import { create } from 'zustand'

const STORAGE_KEY = 'painel_token'

interface AuthState {
  token: string | null
  setToken: (token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem(STORAGE_KEY),
  setToken: (token: string) => {
    localStorage.setItem(STORAGE_KEY, token)
    set({ token })
  },
  logout: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({ token: null })
  },
}))
