export const STATUS_LABELS: Record<string, string> = {
  received: 'Aguardando', notified: 'Notificado', delivered: 'Entregue',
  returned: 'Devolvido', reversed: 'Estornado',
}

export const STATUS_COLORS: Record<string, string> = {
  received: 'badge-brand', notified: 'bg-yellow-100 text-yellow-700',
  delivered: 'bg-green-100 text-green-700', returned: 'bg-gray-100 text-gray-600',
  reversed: 'bg-red-100 text-red-700',
}

export const apiErr = (e: any, fallback: string) => {
  const d = e?.response?.data?.detail
  if (!d) return fallback
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d[0]?.msg ?? fallback
  return fallback
}
