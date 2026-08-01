import { create } from 'zustand'

const STORAGE_KEY = 'presidencia_token'

function readToken(): string | null {
  return localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY)
}

interface AuthState {
  token: string | null
  setToken: (token: string, remember: boolean) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: readToken(),
  setToken: (token: string, remember: boolean) => {
    if (remember) {
      localStorage.setItem(STORAGE_KEY, token)
    } else {
      sessionStorage.setItem(STORAGE_KEY, token)
    }
    set({ token })
  },
  logout: () => {
    localStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(STORAGE_KEY)
    set({ token: null })
  },
}))
