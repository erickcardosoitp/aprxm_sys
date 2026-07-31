import axios from 'axios'

export const RESIDENT_TOKEN_KEY = 'aprxm-resident-token'
export const RESIDENT_SLUG_KEY = 'aprxm-resident-slug'

export const residentApi = axios.create({ baseURL: '/api/v1' })

residentApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(RESIDENT_TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export function residentLogout() {
  localStorage.removeItem(RESIDENT_TOKEN_KEY)
  localStorage.removeItem(RESIDENT_SLUG_KEY)
}

export function residentIsAuthenticated(): boolean {
  return !!localStorage.getItem(RESIDENT_TOKEN_KEY)
}
