import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Package, Receipt, User, LogOut, Users, Store, Pencil } from 'lucide-react'
import { residentApi, residentIsAuthenticated, residentLogout, RESIDENT_SLUG_KEY } from './residentApi'
import CommunityFeedTab from './CommunityFeedTab'
import DirectoryTab from './DirectoryTab'
import MyBusinessSection from './MyBusinessSection'
import NotificationBell from './NotificationBell'

interface Perfil {
  full_name: string; type: string; status: string; email: string | null
  phone_primary: string | null; phone_secondary: string | null
  address_street: string | null; address_number: string | null; address_complement: string | null
  address_neighborhood: string | null; address_city: string | null; address_state: string | null
  address_cep: string | null; association_name: string; username: string | null
}

interface Encomenda {
  id: string; status: string; sender_name: string | null; carrier_name: string | null
  object_type: string | null; received_at: string | null; delivered_at: string | null
  has_delivery_fee: boolean; delivery_fee_paid: boolean
}

interface Mensalidade {
  reference_month: string; due_date: string | null; amount: number; status: string; paid_at: string | null
}

interface MensalidadesResp {
  items: Mensalidade[]; total_em_aberto: number; quantidade_em_aberto: number
}

const PACKAGE_STATUS_LABEL: Record<string, string> = {
  received: 'Na portaria', notified: 'Notificado', delivered: 'Entregue', returned: 'Devolvido', reversed: 'Estornado',
}

const MENSALIDADE_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente', paid: 'Pago', overdue: 'Em atraso', agreement: 'Acordo',
}

const TABS = [
  { key: 'comunidade', label: 'Comunidade', icon: Users },
  { key: 'diretorio', label: 'Diretório', icon: Store },
  { key: 'encomendas', label: 'Encomendas', icon: Package },
  { key: 'mensalidades', label: 'Mensalidades', icon: Receipt },
  { key: 'perfil', label: 'Perfil', icon: User },
] as const

type TabKey = typeof TABS[number]['key']

export default function MoradorPainelPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('comunidade')
  const [loading, setLoading] = useState(true)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [encomendas, setEncomendas] = useState<Encomenda[]>([])
  const [mensalidades, setMensalidades] = useState<MensalidadesResp | null>(null)
  const [editingUsername, setEditingUsername] = useState(false)
  const [usernameDraft, setUsernameDraft] = useState('')
  const [savingUsername, setSavingUsername] = useState(false)

  useEffect(() => {
    if (!residentIsAuthenticated()) {
      const slug = localStorage.getItem(RESIDENT_SLUG_KEY)
      navigate(slug ? `/morador/${slug}` : '/login', { replace: true })
      return
    }
    Promise.all([
      residentApi.get<Perfil>('/portal/me'),
      residentApi.get<Encomenda[]>('/portal/encomendas'),
      residentApi.get<MensalidadesResp>('/portal/mensalidades'),
    ])
      .then(([p, e, m]) => {
        setPerfil(p.data); setEncomendas(e.data); setMensalidades(m.data)
      })
      .catch((err) => {
        if (err.response?.status === 401) {
          residentLogout()
          const slug = localStorage.getItem(RESIDENT_SLUG_KEY)
          navigate(slug ? `/morador/${slug}` : '/login', { replace: true })
        } else {
          toast.error('Erro ao carregar seus dados.')
        }
      })
      .finally(() => setLoading(false))
  }, [navigate])

  const startEditUsername = () => {
    setUsernameDraft(perfil?.username ?? '')
    setEditingUsername(true)
  }

  const saveUsername = async () => {
    if (!usernameDraft.trim()) { toast.error('Informe um nome de usuário.'); return }
    setSavingUsername(true)
    try {
      await residentApi.patch('/portal/me/username', { username: usernameDraft.trim() })
      setPerfil(p => p ? { ...p, username: usernameDraft.trim() } : p)
      setEditingUsername(false)
      toast.success('Nome de usuário atualizado!')
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setSavingUsername(false)
    }
  }

  const handleLogout = () => {
    const slug = localStorage.getItem(RESIDENT_SLUG_KEY)
    residentLogout()
    navigate(slug ? `/morador/${slug}` : '/login', { replace: true })
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-400 text-sm animate-pulse">Carregando…</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-[#26619c] text-white px-4 py-5">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs opacity-80">{perfil?.association_name}</p>
            <p className="font-bold">{perfil?.full_name}</p>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <button onClick={handleLogout} className="p-2 rounded-lg hover:bg-white/10" title="Sair">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 -mt-3">
        <div className="bg-white rounded-2xl shadow-sm flex overflow-hidden">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition ${tab === t.key ? 'text-[#26619c] border-b-2 border-[#26619c]' : 'text-gray-400'}`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 mt-4 flex flex-col gap-3">
        {tab === 'comunidade' && <CommunityFeedTab />}
        {tab === 'diretorio' && <DirectoryTab />}

        {tab === 'encomendas' && (
          encomendas.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">Nenhuma encomenda encontrada.</p>
          ) : encomendas.map(e => (
            <div key={e.id} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-800">{e.object_type || 'Encomenda'}</span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-[#26619c]">
                  {PACKAGE_STATUS_LABEL[e.status] ?? e.status}
                </span>
              </div>
              {e.sender_name && <p className="text-xs text-gray-500">De: {e.sender_name}</p>}
              {e.carrier_name && <p className="text-xs text-gray-500">Transportadora: {e.carrier_name}</p>}
              <p className="text-xs text-gray-400 mt-1">
                Recebida em {e.received_at ? new Date(e.received_at).toLocaleDateString('pt-BR') : '—'}
              </p>
              {e.has_delivery_fee && (
                <p className={`text-xs mt-1 font-medium ${e.delivery_fee_paid ? 'text-green-600' : 'text-amber-600'}`}>
                  Taxa de entrega {e.delivery_fee_paid ? 'paga' : 'pendente'}
                </p>
              )}
            </div>
          ))
        )}

        {tab === 'mensalidades' && mensalidades && (
          <>
            {mensalidades.quantidade_em_aberto > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-amber-800">
                  {mensalidades.quantidade_em_aberto} mensalidade(s) em aberto
                </p>
                <p className="text-xs text-amber-700">
                  Total: {mensalidades.total_em_aberto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </div>
            )}
            {mensalidades.items.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-10">Nenhuma mensalidade encontrada.</p>
            ) : mensalidades.items.map(m => (
              <div key={m.reference_month} className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{m.reference_month}</p>
                  <p className="text-xs text-gray-400">Venc. {m.due_date ? new Date(m.due_date).toLocaleDateString('pt-BR') : '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-800">
                    {m.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </p>
                  <span className={`text-xs font-medium ${m.status === 'paid' ? 'text-green-600' : m.status === 'overdue' ? 'text-red-600' : 'text-amber-600'}`}>
                    {MENSALIDADE_STATUS_LABEL[m.status] ?? m.status}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}

        {tab === 'perfil' && perfil && (
          <div className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-3 text-sm">
            <div><p className="text-xs text-gray-400">Nome</p><p className="font-medium text-gray-800">{perfil.full_name}</p></div>
            <div><p className="text-xs text-gray-400">Telefone</p><p className="font-medium text-gray-800">{perfil.phone_primary || '—'}</p></div>
            {perfil.email && <div><p className="text-xs text-gray-400">E-mail</p><p className="font-medium text-gray-800">{perfil.email}</p></div>}

            <div>
              <p className="text-xs text-gray-400">Nome de usuário</p>
              {editingUsername ? (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    value={usernameDraft}
                    onChange={e => setUsernameDraft(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]"
                    placeholder="ex: joaosilva"
                  />
                  <button onClick={saveUsername} disabled={savingUsername} className="px-3 py-1.5 bg-[#26619c] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                    {savingUsername ? '...' : 'Salvar'}
                  </button>
                  <button onClick={() => setEditingUsername(false)} className="text-xs text-gray-400">Cancelar</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-800">{perfil.username || '—'}</p>
                  <button onClick={startEditUsername} className="text-gray-300 hover:text-[#26619c]">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-400">Endereço</p>
              <p className="font-medium text-gray-800">
                {[perfil.address_street, perfil.address_number, perfil.address_complement].filter(Boolean).join(', ') || '—'}
              </p>
              <p className="text-xs text-gray-500">
                {[perfil.address_neighborhood, perfil.address_city, perfil.address_state].filter(Boolean).join(' - ')}
              </p>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Para atualizar seus dados cadastrais, procure a administração da associação.
            </p>
          </div>
        )}

        {tab === 'perfil' && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <MyBusinessSection />
          </div>
        )}
      </div>
    </div>
  )
}
