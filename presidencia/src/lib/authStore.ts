import { create } from 'zustand'
import { jwtDecode } from 'jwt-decode'

const STORAGE_KEY = 'presidencia_token'

interface JwtPayload {
  full_name?: string
}

function readToken(): string | null {
  return localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY)
}

function decodeFullName(token: string | null): string | null {
  if (!token) return null
  try {
    return jwtDecode<JwtPayload>(token).full_name ?? null
  } catch {
    return null
  }
}

interface AuthState {
  token: string | null
  fullName: string | null
  setToken: (token: string, remember: boolean) => void
  logout: () => void
}

const initialToken = readToken()

export const useAuthStore = create<AuthState>((set) => ({
  token: initialToken,
  fullName: decodeFullName(initialToken),
  setToken: (token: string, remember: boolean) => {
    if (remember) {
      localStorage.setItem(STORAGE_KEY, token)
    } else {
      sessionStorage.setItem(STORAGE_KEY, token)
    }
    set({ token, fullName: decodeFullName(token) })
  },
  logout: () => {
    localStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(STORAGE_KEY)
    set({ token: null, fullName: null })
  },
}))
