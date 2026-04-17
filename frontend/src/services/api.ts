import axios from 'axios'
import toast from 'react-hot-toast'

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

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const raw = localStorage.getItem('aprxm-auth') ?? sessionStorage.getItem('aprxm-auth')
  const token = raw ? JSON.parse(raw)?.state?.token : null
  if (token) config.headers.Authorization = `Bearer ${token}`
  config.headers['X-Device-Token'] = getDeviceToken()
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Normalize Pydantic v2 validation error arrays so components can safely do
    // toast.error(e.response?.data?.detail ?? 'fallback') without React error #31
    if (err.response?.data?.detail && Array.isArray(err.response.data.detail)) {
      err.response.data.detail = err.response.data.detail
        .map((d: any) => d?.msg ?? String(d))
        .join('; ')
    }

    if (err.response?.status === 401) {
      localStorage.removeItem('aprxm-auth')
      sessionStorage.removeItem('aprxm-auth')
      toast.error('Sessão expirada. Faça login novamente.', { duration: 4000 })
      setTimeout(() => { window.location.href = '/login' }, 1500)
    } else if (err.response?.status === 403) {
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
