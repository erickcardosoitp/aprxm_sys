import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const raw = sessionStorage.getItem('aprxm-auth')
  const token = raw ? JSON.parse(raw)?.state?.token : null
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      sessionStorage.removeItem('aprxm-auth')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default api
