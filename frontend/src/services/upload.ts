import api from './api'

export const uploadService = {
  /** Upload file (foto) — retorna URL pública do Supabase */
  uploadFile: async (file: File, folder: string): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', folder)
    const res = await api.post<{ url: string }>('/uploads', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data.url
  },

  /** Upload base64 data URL (assinatura canvas) — retorna URL pública */
  uploadBase64: async (dataUrl: string, folder: string): Promise<string> => {
    const res = await api.post<{ url: string }>('/uploads/base64', { data_url: dataUrl, folder })
    return res.data.url
  },
}
