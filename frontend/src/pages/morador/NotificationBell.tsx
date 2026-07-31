import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { residentApi } from './residentApi'

interface Notification {
  id: string; type: string; title: string; body: string | null
  post_id: string | null; read: boolean; created_at: string
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<Notification[]>([])
  const [loaded, setLoaded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const loadCount = () => {
    residentApi.get<{ count: number }>('/portal/notifications/unread-count')
      .then(r => setCount(r.data.count))
      .catch(() => {})
  }

  useEffect(() => {
    loadCount()
    const interval = setInterval(loadCount, 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = async () => {
    setOpen(v => !v)
    if (!loaded) {
      try {
        const r = await residentApi.get<Notification[]>('/portal/notifications')
        setItems(r.data)
        setLoaded(true)
      } catch {}
    }
  }

  const markRead = async (id: string) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    setCount(c => Math.max(0, c - 1))
    try { await residentApi.post(`/portal/notifications/${id}/read`) } catch {}
  }

  const markAllRead = async () => {
    setItems(prev => prev.map(n => ({ ...n, read: true })))
    setCount(0)
    try { await residentApi.post('/portal/notifications/read-all') } catch {}
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={handleOpen} className="relative p-2 rounded-lg hover:bg-white/10" title="Notificações">
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-xl shadow-lg border border-gray-100 z-50 text-gray-800">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <p className="text-sm font-semibold">Notificações</p>
            {items.some(n => !n.read) && (
              <button onClick={markAllRead} className="text-xs text-[#26619c] font-medium">Marcar todas como lidas</button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-8">Nenhuma notificação ainda.</p>
          ) : items.map(n => (
            <button
              key={n.id}
              onClick={() => markRead(n.id)}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 ${!n.read ? 'bg-blue-50/50' : ''}`}
            >
              <div className="flex items-start gap-2">
                {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-[#26619c] mt-1.5 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800">{n.title}</p>
                  {n.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
                  <p className="text-[10px] text-gray-400 mt-1">{new Date(n.created_at).toLocaleString('pt-BR')}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
