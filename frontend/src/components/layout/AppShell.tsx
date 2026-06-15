import { type ComponentType, useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Activity, Award, BarChart2, Bell, Building2, Check, ChevronDown, DollarSign, Download, FileText, HelpCircle, LogOut, MessageSquare, Package, Palette, RotateCcw, Settings, ShieldCheck, TrendingUp, UserCheck, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { jwtDecode } from 'jwt-decode'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import type { UserRole } from '../../types'
import LoadingScreen from '../ui/LoadingScreen'

interface AppNotification {
  id: string
  title: string
  body: string
  type: string
  read: boolean
  created_at: string
}

function _urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean }

const MODULE_NAV: { module: string; item: NavItem }[] = [
  { module: 'finance',        item: { to: '/finance',        label: 'Caixa',      icon: DollarSign } },
  { module: 'finance',        item: { to: '/financeiro',     label: 'Financeiro', icon: TrendingUp } },
  { module: 'packages',       item: { to: '/packages',       label: 'Encomendas', icon: Package } },
  { module: 'service_orders', item: { to: '/service-orders', label: 'Ordens',     icon: FileText } },
  { module: 'residents',      item: { to: '/residents',      label: 'Moradores',  icon: Users } },
]

const REPORTS_NAV    = { to: '/reports',    label: 'Relatórios', icon: Download }
const ADMIN_NAV      = { to: '/admin',      label: 'Admin',  icon: ShieldCheck }
const LOGS_NAV       = { to: '/logs',       label: 'Logs',   icon: RotateCcw }
const SETTINGS_NAV   = { to: '/settings',   label: 'Config', icon: Settings }

interface AssocOption {
  id: string
  name: string
  slug: string
  role: UserRole
  current: boolean
}

export function AppShell() {
  const clearAuth         = useAuthStore((s) => s.clearAuth)
  const setAuth           = useAuthStore((s) => s.setAuth)
  const setPermissions    = useAuthStore((s) => s.setPermissions)
  const role              = useAuthStore((s) => s.role)
  const permissions       = useAuthStore((s) => s.permissions)
  const fullName          = useAuthStore((s) => s.fullName)
  const associationName   = useAuthStore((s) => s.associationName)
  const navigate          = useNavigate()
  const location          = useLocation()
  const isMonitoring      = location.pathname === '/superadmin'

  const [menuOpen, setMenuOpen] = useState(false)
  const [assocs, setAssocs] = useState<AssocOption[]>([])
  const [switching, setSwitching] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const [chatUnread, setChatUnread] = useState(0)
  const chatLastReadRef = useRef<string>(localStorage.getItem('chatLastRead') ?? new Date(0).toISOString())
  const isOnChat = location.pathname === '/chat'

  const [notifOpen, setNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifs, setNotifs] = useState<AppNotification[]>([])
  const notifRef = useRef<HTMLDivElement>(null)
  const [pushPerm, setPushPerm] = useState<NotificationPermission | 'unsupported'>('default')
  const [pushDismissed, setPushDismissed] = useState(() => localStorage.getItem('push-dismissed') === '1')

  const isOffice           = useAuthStore((s) => s.isOffice)
  const simplificaEnabled  = useAuthStore((s) => s.simplificaEnabled)
  const setSimplificaPrefs = useAuthStore((s) => s.setSimplificaPrefs)
  const setSimplificaMode  = useAuthStore((s) => s.setSimplificaMode)
  const isSuperAdmin = role === 'superadmin' || role === 'admin_master'
  const isAdmin      = role === 'admin' || role === 'diretoria' || role === 'conselho' || isSuperAdmin

  const [simplificaLoading, setSimplificaLoading] = useState(false)

  const [themeColor, setThemeColor] = useState(() => localStorage.getItem('aprxm-theme') ?? '#1a3f6f')

  function _applyTheme(hex: string) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    const root = document.documentElement
    root.style.setProperty('--brand-header', hex)
    root.style.setProperty('--brand-rgb', `${r}, ${g}, ${b}`)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex)
  }

  const handleThemeChange = (hex: string) => {
    setThemeColor(hex)
    localStorage.setItem('aprxm-theme', hex)
    _applyTheme(hex)
  }

  useEffect(() => { _applyTheme(themeColor) }, [])

  useEffect(() => {
    const storedToken = useAuthStore.getState().token
    if (storedToken && !useAuthStore.getState().associationName) {
      try {
        const payload = jwtDecode<{ sub: string; association_id: string; role: string; full_name: string; linked_association_ids?: string[]; association_name?: string; is_office?: boolean }>(storedToken)
        if (payload.association_name) {
          useAuthStore.getState().setAuth(
            storedToken, payload.sub, payload.association_id, payload.role as UserRole,
            payload.full_name ?? '', payload.linked_association_ids ?? [], payload.association_name,
            false, payload.is_office ?? false,
          )
        }
      } catch { /* token inválido */ }
    }
  }, [])

  useEffect(() => {
    if (!role || isSuperAdmin) return
    api.get('/admin/my-permissions').then(r => setPermissions(r.data)).catch(() => {})
  }, [role])

  useEffect(() => {
    if (!role) return
    api.get<{ simplifica_mode: boolean; simplifica_enabled: boolean }>('/auth/me')
      .then(r => setSimplificaPrefs(r.data.simplifica_mode, r.data.simplifica_enabled))
      .catch(() => {})
  }, [role])

  const handleSimplificaToggle = async () => {
    if (!confirm('Mudar para o Modo Simplifica?')) return
    try {
      await api.patch('/auth/me/preferences', { simplifica_mode: true })
      setSimplificaMode(true)
      setSimplificaLoading(true)
      setTimeout(() => { navigate('/simplifica', { replace: true }) }, 1500)
    } catch {
      toast.error('Erro ao ativar Modo Simplifica.')
    }
  }

  const fetchUnread = useCallback(() => {
    api.get<{ count: number }>('/notifications/unread-count').then(r => setUnreadCount(r.data.count)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!role) return
    fetchUnread()
    const id = setInterval(fetchUnread, 30_000)
    return () => clearInterval(id)
  }, [role, fetchUnread])

  useEffect(() => {
    if (!role || isOnChat) return
    const fetchChatUnread = () => {
      api.get<{ count: number }>('/chat/unread-count', { params: { since: chatLastReadRef.current } })
        .then(r => setChatUnread(r.data.count))
        .catch(() => {})
    }
    fetchChatUnread()
    const id = setInterval(fetchChatUnread, 30_000)
    return () => clearInterval(id)
  }, [role, isOnChat])

  useEffect(() => {
    if (!isOnChat) return
    setChatUnread(0)
    const now = new Date().toISOString()
    localStorage.setItem('chatLastRead', now)
    chatLastReadRef.current = now
  }, [isOnChat])

  useEffect(() => {
    if (!role) return
    const warm = () => {
      api.get('/health').catch(() => {})
      api.get('/residents/search?q=_warm').catch(() => {})
      api.get('/packages/counts').catch(() => {})
    }
    warm()
    const id = setInterval(warm, 9 * 60_000)
    return () => clearInterval(id)
  }, [role])

  const openNotifs = async () => {
    setNotifOpen(true)
    try {
      const r = await api.get<AppNotification[]>('/notifications')
      setNotifs(r.data)
    } catch { /* silent */ }
  }

  const markAllRead = async () => {
    await api.patch('/notifications/read-all').catch(() => {})
    setNotifs(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  const markRead = async (id: string) => {
    await api.patch(`/notifications/${id}/read`).catch(() => {})
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  useEffect(() => {
    if (!role) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushPerm('unsupported'); return
    }
    const perm = 'Notification' in window ? Notification.permission : 'default'
    setPushPerm(perm)
    navigator.serviceWorker.register('/sw.js').catch(() => {})
    // auto re-subscribe if already granted (ensures fresh subscription after key rotation)
    if (perm === 'granted') {
      navigator.serviceWorker.ready.then(async reg => {
        try {
          const existing = await reg.pushManager.getSubscription()
          const vapidRes = await api.get<{ key: string }>('/notifications/vapid-public-key')
          const newKey = vapidRes.data.key
          if (existing) {
            // check if subscription matches current VAPID key
            const existingKey = existing.options?.applicationServerKey
            const expectedKey = _urlBase64ToUint8Array(newKey)
            const match = existingKey && new Uint8Array(existingKey as ArrayBuffer).join() === expectedKey.join()
            if (match) return // already subscribed with correct key
            await existing.unsubscribe()
          }
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: _urlBase64ToUint8Array(newKey) as unknown as BufferSource,
          })
          const j = sub.toJSON()
          await api.post('/notifications/subscribe', { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth })
        } catch { /* silent */ }
      })
    }
  }, [role])

  const enablePushNotifications = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    try {
      const perm = await Notification.requestPermission()
      setPushPerm(perm)
      if (perm !== 'granted') return
      const reg = await navigator.serviceWorker.ready
      // unsubscribe old subscription before re-subscribing with current VAPID key
      const existing = await reg.pushManager.getSubscription()
      if (existing) await existing.unsubscribe()
      const vapidRes = await api.get<{ key: string }>('/notifications/vapid-public-key')
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(vapidRes.data.key) as unknown as BufferSource,
      })
      const j = sub.toJSON()
      await api.post('/notifications/subscribe', {
        endpoint: j.endpoint,
        p256dh: j.keys?.p256dh,
        auth: j.keys?.auth,
      })
      setPushPerm('granted')
    } catch (e) { console.error('Push subscribe error:', e) }
  }

  // Close notif dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [notifOpen])

  const canView = (module: string) => {
    if (isSuperAdmin) return true
    if (!permissions) return true  // loading — show all until resolved
    return permissions[module]?.can_view ?? false
  }

  const isAgente = role === 'agente'

  const navItems: NavItem[] = isOffice
    ? [{ to: '/geral', label: 'Escritório', icon: Building2 }]
    : isAgente
    ? [
        { to: '/crm',     label: 'CRM',     icon: UserCheck },
        { to: '/agentes', label: 'Agentes', icon: Award },
      ]
    : (() => {
        const items: NavItem[] = [{ to: '/overview', label: 'Visão', icon: BarChart2 }]
        for (const { module, item } of MODULE_NAV) {
          if (canView(module)) items.push(item)
        }
        items.push(REPORTS_NAV)
        if (permissions?.settings?.can_view || isSuperAdmin) items.push(SETTINGS_NAV)
        if (isAdmin) { items.push(ADMIN_NAV); items.push(LOGS_NAV) }
        if (isSuperAdmin) { items.push({ to: '/ti', label: 'TI', icon: Activity }) }
        if (isAdmin || isSuperAdmin) {
          items.push({ to: '/crm', label: 'CRM', icon: UserCheck })
          items.push({ to: '/agentes', label: 'Agentes', icon: Award })
        }
        items.push({ to: '/help', label: 'Ajuda', icon: HelpCircle, end: false })
        return items
      })()

  const handleLogout = () => { clearAuth(); navigate('/login') }

  const initials = fullName
    ? fullName.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    : '?'

  const openMenu = async () => {
    setMenuOpen(true)
    try {
      const res = await api.get<AssocOption[]>('/auth/my-associations')
      setAssocs(res.data)
    } catch { /* silent */ }
  }

  const handleSwitch = async (assocId: string) => {
    if (switching) return
    setSwitching(assocId)
    try {
      const res = await api.post<{ access_token: string }>('/auth/switch-association', { association_id: assocId })
      const token = res.data.access_token
      const payload = jwtDecode<{ sub: string; association_id: string; role: UserRole; full_name: string; linked_association_ids?: string[]; association_name?: string; is_office?: boolean }>(token)
      setAuth(token, payload.sub, payload.association_id, payload.role, payload.full_name ?? '', payload.linked_association_ids ?? [], payload.association_name ?? '', false, payload.is_office ?? false)
      setMenuOpen(false)
      navigate('/')
      toast.success(`Ambiente: ${payload.association_name}`)
    } catch {
      toast.error('Erro ao trocar de ambiente.')
    } finally {
      setSwitching(null)
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {simplificaLoading && (
        <LoadingScreen message="Carregando Simplifica..." color={themeColor} />
      )}
      {!pushDismissed && (pushPerm === 'default' || pushPerm === 'denied') && (
        <div className="bg-blue-600 text-white text-xs flex flex-col items-center gap-1.5 px-4 py-2.5 text-center" style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
          {pushPerm === 'denied' ? (
            <div className="flex items-center gap-2 w-full max-w-xs justify-between">
              <span>Notificações bloqueadas. Habilite nas configurações do navegador e recarregue.</span>
              <button onClick={() => { localStorage.setItem('push-dismissed', '1'); setPushDismissed(true) }} className="shrink-0 text-white/70 hover:text-white underline">
                Fechar
              </button>
            </div>
          ) : (
            <>
              <span>Ative as notificações para receber alertas em tempo real.</span>
              <button onClick={enablePushNotifications} className="font-semibold bg-white text-blue-600 px-4 py-1.5 rounded-lg w-full max-w-xs">
                Ativar notificações
              </button>
              <button onClick={() => { localStorage.setItem('push-dismissed', '1'); setPushDismissed(true) }} className="text-white/60 hover:text-white/90 underline text-[11px]">
                Não perguntar mais
              </button>
            </>
          )}
        </div>
      )}
      <header className="text-white flex items-center justify-between px-4 py-3 shadow"
        style={{ backgroundColor: themeColor, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <div className="flex flex-col leading-tight min-w-0 max-w-[55vw]">
          <img src="/logo.png" alt="APRXM" className="h-6 w-auto object-contain" />
          {associationName && (
            <span className="text-[10px] opacity-70 leading-none whitespace-nowrap overflow-hidden text-ellipsis">{associationName}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Simplifica toggle */}
          {simplificaEnabled && !isOffice && (
            <button
              onClick={handleSimplificaToggle}
              className="text-xs font-semibold text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-lg transition"
            >
              Simplifica
            </button>
          )}

          {/* Theme color picker */}
          <label className="relative p-2.5 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer" title="Cor do tema">
            <Palette className="w-5 h-5" />
            <input
              type="color"
              value={themeColor}
              onChange={e => handleThemeChange(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </label>

          {/* Chat */}
          <NavLink
            to="/chat"
            className={({ isActive }) =>
              `p-2.5 rounded-xl transition ${isActive ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`
            }
            onClick={() => {
              setChatUnread(0)
              const now = new Date().toISOString()
              localStorage.setItem('chatLastRead', now)
              chatLastReadRef.current = now
            }}
          >
            <div className="relative">
              <MessageSquare className="w-5 h-5" />
              {chatUnread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5">
                  {chatUnread > 9 ? '9+' : chatUnread}
                </span>
              )}
            </div>
          </NavLink>

          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={notifOpen ? () => setNotifOpen(false) : openNotifs}
              className="relative p-2.5 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-80 max-w-[calc(100vw-1rem)] bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-800">Notificações</span>
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-xs text-blue-600 hover:text-blue-700">
                      Marcar tudo como lido
                    </button>
                  )}
                </div>
                {pushPerm === 'default' && !pushDismissed && (
                  <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center justify-between gap-2">
                    <span className="text-xs text-blue-700">Ativar notificações push?</span>
                    <div className="flex items-center gap-2">
                      <button onClick={enablePushNotifications} className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-lg transition">
                        Ativar
                      </button>
                      <button onClick={() => { localStorage.setItem('push-dismissed', '1'); setPushDismissed(true) }} className="text-xs text-blue-500 hover:text-blue-700">
                        Não
                      </button>
                    </div>
                  </div>
                )}
                <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                  {notifs.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">Nenhuma notificação</p>
                  )}
                  {notifs.map(n => (
                    <button
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition ${n.read ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                        {n.read && <span className="mt-1.5 w-2 h-2 shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{n.title}</p>
                          <p className="text-xs text-gray-500 line-clamp-2">{n.body}</p>
                          <p className="text-[10px] text-gray-300 mt-0.5">
                            {new Date(n.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={menuOpen ? () => setMenuOpen(false) : openMenu}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/10 transition"
            >
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold shrink-0">
                {initials}
              </div>
              {fullName && (
                <span className="text-sm opacity-90 hidden sm:block truncate max-w-[120px]">{fullName.split(' ')[0]}</span>
              )}
              <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 max-w-[calc(100vw-1rem)] bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                {/* User info */}
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800 break-words">{fullName}</p>
                  <p className="text-xs text-gray-400 break-words">{associationName}</p>
                </div>

                {/* Environment switcher */}
                {assocs.length > 1 && (
                  <div className="px-4 pt-3 pb-2">
                    <p className="text-xs font-medium text-gray-400 mb-2">Trocar ambiente</p>
                    <div className="flex flex-col gap-1">
                      {assocs.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => !a.current && handleSwitch(a.id)}
                          disabled={a.current || switching === a.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition w-full text-sm ${
                            a.current
                              ? 'bg-gray-50 cursor-default'
                              : 'hover:bg-gray-50 text-gray-700 cursor-pointer disabled:opacity-50'
                          }`}
                          style={a.current ? { color: themeColor } : undefined}
                        >
                          <Building2 className="w-4 h-4 shrink-0 opacity-60" />
                          <span className="flex-1 truncate font-medium">{a.name}</span>
                          {a.current && <Check className="w-3.5 h-3.5 shrink-0" />}
                          {switching === a.id && <span className="text-xs opacity-60">…</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Logout */}
                <div className="px-4 py-3 border-t border-gray-100">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition w-full"
                  >
                    <LogOut className="w-4 h-4" />
                    Sair
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: isMonitoring ? '0' : 'calc(72px + env(safe-area-inset-bottom))' }}>
        <Outlet />
      </main>


      {!isMonitoring && <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        <div className="flex justify-center overflow-x-auto scrollbar-none px-2 gap-3 sm:gap-1" style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }}>
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end ?? true}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 px-3 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs font-medium transition shrink-0 min-w-[64px] min-h-[56px] sm:min-w-0 sm:min-h-0 ${
                  isActive ? '' : 'text-gray-400 hover:text-gray-600'
                }`
              }
              style={({ isActive }) => isActive
                ? { backgroundColor: themeColor + '1a', color: themeColor }
                : undefined}
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>}
    </div>
  )
}
