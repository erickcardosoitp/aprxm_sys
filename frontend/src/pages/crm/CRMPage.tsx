import { useEffect, useState } from 'react'
import {
  Users, Search, X, ChevronLeft, ChevronRight,
  CreditCard, MapPin, CheckCircle, AlertCircle,
  Upload, Eye
} from 'lucide-react'
import api from '../../services/api'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'

interface CRMMember {
  id: string
  full_name: string
  address: string
  created_at: string | null
  valor_atrasado: number
  qtd_pendentes: number
  ultima_entrega: string | null
  enc_mes: number
  situacao: 'adimplente' | 'inadimplente'
}

interface Mensalidade {
  id: string
  reference_month: string
  amount: number
  due_date: string
  status: string
}

interface PaymentMethod {
  id: string
  name: string
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function tenureLabel(created_at: string | null): string {
  if (!created_at) return '—'
  const diff = Date.now() - new Date(created_at).getTime()
  const days = Math.floor(diff / 86400000)
  const months = Math.floor(days / 30)
  const years = Math.floor(months / 12)
  if (years > 0) return `${years}a ${months % 12}m`
  if (months > 0) return `${months}m`
  return `${days}d`
}

function daysAgo(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return 'hoje'
  if (days === 1) return '1 dia'
  return `${days} dias`
}

export default function CRMPage() {
  const role = useAuthStore(s => s.role)
  const [members, setMembers] = useState<CRMMember[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'todos' | 'adimplente' | 'inadimplente'>('todos')
  const [loading, setLoading] = useState(false)

  // Modal: baixar mensalidade
  const [payModal, setPayModal] = useState<{ member: CRMMember } | null>(null)
  const [mensalidades, setMensalidades] = useState<Mensalidade[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [selectedMens, setSelectedMens] = useState<string | null>(null)
  const [selectedPM, setSelectedPM] = useState<string>('')
  const [proofUrl, setProofUrl] = useState<string>('')
  const [uploadingProof, setUploadingProof] = useState(false)
  const [paying, setPaying] = useState(false)

  // Modal: registrar visita
  const [visitModal, setVisitModal] = useState<{ member: CRMMember } | null>(null)
  const [visitResult, setVisitResult] = useState<'paid' | 'will_pay' | 'absent' | 'refused'>('absent')
  const [visitNotes, setVisitNotes] = useState('')
  const [savingVisit, setSavingVisit] = useState(false)

  const canPay = role !== 'agente'

  async function fetchMembers() {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page }
      if (search) params.search = search
      if (statusFilter !== 'todos') params.status = statusFilter
      const res = await api.get('/crm/residents', { params })
      setMembers(res.data.items)
      setTotal(res.data.total)
    } catch {
      toast.error('Erro ao carregar membros')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchMembers() }, [page, statusFilter])

  useEffect(() => {
    setPage(1)
    const t = setTimeout(fetchMembers, 400)
    return () => clearTimeout(t)
  }, [search])

  async function openPayModal(member: CRMMember) {
    setPayModal({ member })
    setSelectedMens(null)
    setSelectedPM('')
    setProofUrl('')
    const [mensRes, pmRes] = await Promise.all([
      api.get(`/mensalidades/residents/${member.id}`),
      api.get('/finance/payment-methods'),
    ])
    setMensalidades(mensRes.data.filter((m: Mensalidade) => m.status === 'pending'))
    setPaymentMethods(pmRes.data)
  }

  async function handleUploadProof(file: File) {
    setUploadingProof(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/uploads/proof', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setProofUrl(res.data.url)
      toast.success('Comprovante enviado')
    } catch {
      toast.error('Erro ao enviar comprovante')
    } finally {
      setUploadingProof(false)
    }
  }

  const selectedPMObj = paymentMethods.find(pm => pm.id === selectedPM)
  const isPix = selectedPMObj?.name.toLowerCase().includes('pix')

  async function confirmPay() {
    if (!payModal || !selectedMens) return
    if (isPix && !proofUrl) { toast.error('Comprovante PIX obrigatório'); return }
    setPaying(true)
    try {
      await api.post(`/crm/mensalidades/${selectedMens}/pay`, {
        mensalidade_id: selectedMens,
        payment_method_id: selectedPM || null,
        payment_proof_url: proofUrl || null,
      })
      toast.success('Mensalidade baixada')
      setPayModal(null)
      fetchMembers()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast.error(msg || 'Erro ao registrar pagamento')
    } finally {
      setPaying(false)
    }
  }

  async function confirmVisit() {
    if (!visitModal) return
    setSavingVisit(true)
    try {
      await api.post('/crm/visitas', {
        resident_id: visitModal.member.id,
        result: visitResult,
        notes: visitNotes || null,
      })
      toast.success('Visita registrada')
      setVisitModal(null)
      setVisitNotes('')
    } catch {
      toast.error('Erro ao registrar visita')
    } finally {
      setSavingVisit(false)
    }
  }

  const pages = Math.ceil(total / 100)

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Users size={20} className="text-[#26619c]" />
        <h1 className="text-xl font-bold text-gray-800">CRM — Associados</h1>
        <span className="ml-auto text-sm text-gray-500">{total} membros</span>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30"
            placeholder="Buscar nome ou logradouro..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {(['todos', 'adimplente', 'inadimplente'] as const).map(f => (
          <button
            key={f}
            onClick={() => { setStatusFilter(f); setPage(1) }}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              statusFilter === f
                ? 'bg-[#26619c] text-white border-[#26619c]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#26619c]'
            }`}
          >
            {f === 'todos' ? 'Todos' : f === 'adimplente' ? 'Adimplentes' : 'Inadimplentes'}
          </button>
        ))}
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Nome</th>
              <th className="px-4 py-3 text-left">Endereço</th>
              <th className="px-4 py-3 text-center">Tempo</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">R$ Atrasado</th>
              <th className="px-4 py-3 text-center">Pendentes</th>
              <th className="px-4 py-3 text-center">Últ. Encomenda</th>
              <th className="px-4 py-3 text-center">Enc/Mês</th>
              <th className="px-4 py-3 text-center">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Carregando...</td></tr>
            ) : members.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Nenhum membro encontrado</td></tr>
            ) : members.map(m => (
              <tr key={m.id} className="border-t border-gray-50 hover:bg-gray-50/60 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-800">{m.full_name}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{m.address || '—'}</td>
                <td className="px-4 py-3 text-center text-xs text-gray-500">{tenureLabel(m.created_at)}</td>
                <td className="px-4 py-3 text-center">
                  {m.situacao === 'adimplente' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                      <CheckCircle size={10} /> Ok
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-medium">
                      <AlertCircle size={10} /> Inadimplente
                    </span>
                  )}
                </td>
                <td className={`px-4 py-3 text-right text-sm font-semibold ${m.valor_atrasado > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {m.valor_atrasado > 0 ? fmt(m.valor_atrasado) : '—'}
                </td>
                <td className="px-4 py-3 text-center text-sm">
                  {m.qtd_pendentes > 0 ? (
                    <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full text-xs font-medium">{m.qtd_pendentes}</span>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-center text-xs text-gray-500">{daysAgo(m.ultima_entrega)}</td>
                <td className="px-4 py-3 text-center text-xs text-gray-500">{m.enc_mes > 0 ? m.enc_mes : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-center">
                    {canPay && (
                      <button
                        onClick={() => openPayModal(m)}
                        title="Baixar mensalidade"
                        className="p-1.5 rounded-lg text-[#26619c] hover:bg-[#26619c]/10 transition-colors"
                      >
                        <CreditCard size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => { setVisitModal({ member: m }); setVisitResult('absent'); setVisitNotes('') }}
                      title="Registrar visita"
                      className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                    >
                      <MapPin size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="p-2 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-gray-600">Página {page} de {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
            className="p-2 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Modal — Baixar Mensalidade */}
      {payModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="font-semibold text-gray-800">Baixar Mensalidade — Remoto</h2>
              <button onClick={() => setPayModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600 font-medium">{payModal.member.full_name}</p>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Mensalidade</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={selectedMens || ''}
                  onChange={e => setSelectedMens(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {mensalidades.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.reference_month} — {fmt(m.amount)} (venc. {m.due_date})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Forma de Pagamento</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={selectedPM}
                  onChange={e => { setSelectedPM(e.target.value); setProofUrl('') }}
                >
                  <option value="">Selecione...</option>
                  {paymentMethods.map(pm => (
                    <option key={pm.id} value={pm.id}>{pm.name}</option>
                  ))}
                </select>
              </div>

              {isPix && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Comprovante PIX <span className="text-red-500">*obrigatório</span>
                  </label>
                  {proofUrl ? (
                    <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                      <CheckCircle size={14} className="text-green-600" />
                      <span className="text-xs text-green-700 flex-1 truncate">Comprovante enviado</span>
                      <a href={proofUrl} target="_blank" rel="noreferrer" className="text-[#26619c]"><Eye size={14} /></a>
                      <button onClick={() => setProofUrl('')} className="text-gray-400"><X size={14} /></button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 cursor-pointer border border-dashed border-gray-300 rounded-lg p-3 hover:border-[#26619c] transition-colors">
                      <Upload size={16} className="text-gray-400" />
                      <span className="text-sm text-gray-500">
                        {uploadingProof ? 'Enviando...' : 'Clique para enviar PDF ou imagem'}
                      </span>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        disabled={uploadingProof}
                        onChange={e => e.target.files?.[0] && handleUploadProof(e.target.files[0])}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2 p-5 border-t">
              <button onClick={() => setPayModal(null)} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={confirmPay}
                disabled={!selectedMens || (isPix && !proofUrl) || paying}
                className="flex-1 py-2 rounded-lg bg-[#26619c] text-white text-sm font-medium disabled:opacity-50 hover:bg-[#1e4f85]"
              >
                {paying ? 'Registrando...' : 'Confirmar Pagamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — Registrar Visita */}
      {visitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="font-semibold text-gray-800">Registrar Visita</h2>
              <button onClick={() => setVisitModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm font-medium text-gray-700">{visitModal.member.full_name}</p>
              <p className="text-xs text-gray-500">{visitModal.member.address}</p>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Resultado</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: 'paid', label: 'Pagou', color: 'green' },
                    { v: 'will_pay', label: 'Vai pagar', color: 'blue' },
                    { v: 'absent', label: 'Ausente', color: 'amber' },
                    { v: 'refused', label: 'Recusou', color: 'red' },
                  ] as const).map(opt => (
                    <button
                      key={opt.v}
                      onClick={() => setVisitResult(opt.v)}
                      className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                        visitResult === opt.v
                          ? `bg-${opt.color}-100 border-${opt.color}-400 text-${opt.color}-700`
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Observação (opcional)</label>
                <textarea
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
                  rows={3}
                  placeholder="Ex: Mora no 2º andar, horário melhor à tarde..."
                  value={visitNotes}
                  onChange={e => setVisitNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 p-5 border-t">
              <button onClick={() => setVisitModal(null)} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={confirmVisit}
                disabled={savingVisit}
                className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-emerald-700"
              >
                {savingVisit ? 'Salvando...' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
