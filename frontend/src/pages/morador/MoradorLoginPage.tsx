import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import axios from 'axios'
import { formatCpf, formatPhone } from '../../utils'
import { RESIDENT_TOKEN_KEY, RESIDENT_SLUG_KEY } from './residentApi'

const API = '/api/v1'

interface AssocInfo {
  id: string; name: string; slug: string
  address_city?: string; logo_url?: string
}

const inputCls = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]'

export default function MoradorLoginPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [assoc, setAssoc] = useState<AssocInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [mode, setMode] = useState<'login' | 'criar'>('login')
  const [saving, setSaving] = useState(false)

  const [loginValue, setLoginValue] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [cpf, setCpf] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    if (!slug) return
    axios.get(`${API}/public/associations/${slug}`)
      .then(r => setAssoc(r.data))
      .catch(() => setNotFound(true))
  }, [slug])

  const handleLogin = async () => {
    if (!loginValue.trim() || !password) {
      toast.error('Preencha seu login e senha.')
      return
    }
    setSaving(true)
    try {
      const r = await axios.post(`${API}/portal/${slug}/login`, {
        login: loginValue, password,
      })
      localStorage.setItem(RESIDENT_TOKEN_KEY, r.data.access_token)
      localStorage.setItem(RESIDENT_SLUG_KEY, slug ?? '')
      navigate('/morador/painel')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao entrar.')
    } finally {
      setSaving(false)
    }
  }

  const handleCriarAcesso = async () => {
    if (!fullName.trim() || !phone.trim() || !cpf.trim()) {
      toast.error('Preencha nome, telefone e CPF.')
      return
    }
    if (password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      toast.error('As senhas não coincidem.')
      return
    }
    setSaving(true)
    try {
      const r = await axios.post(`${API}/portal/${slug}/set-senha`, {
        full_name: fullName, phone_primary: phone, cpf, password, username: username.trim() || null,
      })
      localStorage.setItem(RESIDENT_TOKEN_KEY, r.data.access_token)
      localStorage.setItem(RESIDENT_SLUG_KEY, slug ?? '')
      toast.success('Acesso criado!')
      navigate('/morador/painel')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao criar acesso.')
    } finally {
      setSaving(false)
    }
  }

  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center">
        <p className="text-2xl font-bold text-gray-700 mb-2">Associação não encontrada</p>
        <p className="text-gray-500 text-sm">Verifique o link e tente novamente.</p>
      </div>
    </div>
  )

  if (!assoc) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-400 text-sm animate-pulse">Carregando…</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          {assoc.logo_url && <img src={assoc.logo_url} alt="logo" className="h-16 mx-auto mb-3 object-contain" />}
          <h1 className="text-xl font-bold text-gray-900">{assoc.name}</h1>
          <p className="mt-2 text-sm text-[#26619c] font-medium">Portal do Morador</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex mb-5 bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${mode === 'login' ? 'bg-white shadow-sm text-[#26619c]' : 'text-gray-500'}`}
            >Entrar</button>
            <button
              onClick={() => setMode('criar')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${mode === 'criar' ? 'bg-white shadow-sm text-[#26619c]' : 'text-gray-500'}`}
            >Primeiro acesso</button>
          </div>

          <div className="flex flex-col gap-4">
            {mode === 'login' ? (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome, e-mail ou usuário</label>
                <input value={loginValue} onChange={e => setLoginValue(e.target.value)} className={inputCls} placeholder="Como preferir entrar" />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nome completo</label>
                  <input value={fullName} onChange={e => setFullName(e.target.value)} className={inputCls} placeholder="Como está no seu cadastro" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Telefone</label>
                  <input value={phone} onChange={e => setPhone(formatPhone(e.target.value))} className={inputCls} placeholder="(21) 99999-9999" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CPF</label>
                  <input value={cpf} onChange={e => setCpf(formatCpf(e.target.value))} className={inputCls} placeholder="000.000.000-00" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nome de usuário <span className="text-gray-400 font-normal">(opcional, pra entrar mais fácil depois)</span></label>
                  <input value={username} onChange={e => setUsername(e.target.value)} className={inputCls} placeholder="ex: joaosilva" />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{mode === 'criar' ? 'Nova senha' : 'Senha'}</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
            </div>

            {mode === 'criar' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Confirmar senha</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
              </div>
            )}

            <button
              onClick={mode === 'login' ? handleLogin : handleCriarAcesso}
              disabled={saving}
              className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl text-sm font-semibold transition disabled:opacity-50 mt-2"
            >
              {saving ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar acesso'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Seus dados serão tratados com sigilo conforme a LGPD.
        </p>
      </div>
    </div>
  )
}
