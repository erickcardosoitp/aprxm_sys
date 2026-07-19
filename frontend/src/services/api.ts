import axios from 'axios'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'

function getDeviceToken(): string {
  const KEY = 'aprxm-device-token'
  let dt = localStorage.getItem(KEY)
  if (!dt) {
    const raw = [navigator.userAgent, Intl.DateTimeFormat().resolvedOptions().timeZone, screen.width, screen.height, navigator.language].join('|')
    let h = 5381
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i)
    dt = (h >>> 0).toString(16).padStart(8, '0') + '-' + Date.now().toString(36)
    localStorage.setItem(KEY, dt)
  }
  return dt
}

const REFRESH_TOKEN_KEY = 'aprxm-refresh-token'

export function saveRefreshToken(token: string) {
  localStorage.setItem(REFRESH_TOKEN_KEY, token)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function clearRefreshToken() {
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  paramsSerializer: (params) => {
    const parts: string[] = []
    for (const [key, val] of Object.entries(params)) {
      if (val === undefined || val === null) continue
      if (Array.isArray(val)) {
        val.forEach(v => parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`))
      } else {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val as string)}`)
      }
    }
    return parts.join('&')
  },
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  config.headers['X-Device-Token'] = getDeviceToken()
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type']
  }
  return config
})

let _refreshing = false
let _queue: Array<(token: string) => void> = []

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    // Normalize Pydantic v2 validation error arrays
    if (err.response?.data?.detail && Array.isArray(err.response.data.detail)) {
      err.response.data.detail = err.response.data.detail
        .map((d: any) => d?.msg ?? String(d))
        .join('; ')
    }

    if (err.response?.status === 401) {
      const originalReq = err.config
      // Não tenta refresh se já é a chamada de refresh (evita loop)
      if (originalReq?.url?.includes('/auth/refresh') || originalReq?._retried) {
        clearRefreshToken()
        localStorage.removeItem('aprxm-auth')
        sessionStorage.removeItem('aprxm-auth')
        toast.error('Sessão expirada. Faça login novamente.', { duration: 4000 })
        setTimeout(() => { window.location.href = '/login' }, 1500)
        return Promise.reject(err)
      }

      const refreshToken = getRefreshToken()
      if (!refreshToken) {
        localStorage.removeItem('aprxm-auth')
        sessionStorage.removeItem('aprxm-auth')
        toast.error('Sessão expirada. Faça login novamente.', { duration: 4000 })
        setTimeout(() => { window.location.href = '/login' }, 1500)
        return Promise.reject(err)
      }

      if (_refreshing) {
        // Enfileira requests enquanto refresh está em progresso
        return new Promise(resolve => {
          _queue.push((newToken: string) => {
            originalReq.headers.Authorization = `Bearer ${newToken}`
            resolve(api(originalReq))
          })
        })
      }

      _refreshing = true
      originalReq._retried = true

      try {
        const res = await axios.post(
          `${import.meta.env.VITE_API_URL ?? '/api/v1'}/auth/refresh`,
          { refresh_token: refreshToken }
        )
        const { access_token, refresh_token: newRefresh } = res.data

        // Atualiza token no store Zustand (fonte de verdade para o interceptor)
        const s = useAuthStore.getState()
        s.setAuth(access_token, s.userId!, s.associationId!, s.role!, s.fullName ?? '', s.linkedAssociationIds, s.associationName, s.rememberDevice, s.isOffice)
        if (newRefresh) saveRefreshToken(newRefresh)

        // Resolve fila
        _queue.forEach(cb => cb(access_token))
        _queue = []

        originalReq.headers.Authorization = `Bearer ${access_token}`
        return api(originalReq)
      } catch {
        clearRefreshToken()
        localStorage.removeItem('aprxm-auth')
        sessionStorage.removeItem('aprxm-auth')
        toast.error('Sessão expirada. Faça login novamente.', { duration: 4000 })
        setTimeout(() => { window.location.href = '/login' }, 1500)
        return Promise.reject(err)
      } finally {
        _refreshing = false
      }
    }

    if (err.response?.status === 403) {
      toast.error('Você não tem permissão para esta ação.')
    } else if (err.response?.status >= 500) {
      toast.error('Erro no servidor. Tente novamente.')
    } else if (!err.response) {
      toast.error('Sem conexão com o servidor.')
    }
    return Promise.reject(err)
  },
)

export default api
