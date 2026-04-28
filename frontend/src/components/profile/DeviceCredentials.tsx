import { useEffect, useState } from 'react'
import { Fingerprint, Loader2, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

function bufToB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64ToBuf(b64: string): ArrayBuffer {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i)
  return buf.buffer
}

interface Credential {
  id: string
  device_name: string | null
  created_at: string
}

export default function DeviceCredentials() {
  const [creds, setCreds] = useState<Credential[]>([])
  const [loading, setLoading] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [deviceName, setDeviceName] = useState('')

  const supported = 'credentials' in navigator && 'PublicKeyCredential' in window

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get<Credential[]>('/auth/webauthn/credentials')
      setCreds(r.data)
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const register = async () => {
    if (!supported) { toast.error('Seu navegador não suporta este recurso.'); return }
    setRegistering(true)
    try {
      const beginRes = await api.post('/auth/webauthn/register/begin')
      const options = beginRes.data

      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: b64ToBuf(options.challenge),
          rp: { id: options.rp.id, name: options.rp.name },
          user: {
            id: b64ToBuf(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          pubKeyCredParams: options.pubKeyCredParams.map((p: any) => ({ type: p.type, alg: p.alg })),
          authenticatorSelection: options.authenticatorSelection,
          excludeCredentials: (options.excludeCredentials ?? []).map((c: any) => ({
            type: 'public-key',
            id: b64ToBuf(c.id),
          })),
          timeout: options.timeout ?? 60000,
        },
      }) as PublicKeyCredential | null

      if (!cred) return

      const resp = cred.response as AuthenticatorAttestationResponse
      const credential = {
        id: cred.id,
        rawId: bufToB64(cred.rawId),
        type: cred.type,
        response: {
          clientDataJSON: bufToB64(resp.clientDataJSON),
          attestationObject: bufToB64(resp.attestationObject),
        },
      }

      await api.post('/auth/webauthn/register/complete', {
        credential,
        device_name: deviceName || guessDeviceName(),
      })

      toast.success('Dispositivo registrado!')
      setDeviceName('')
      load()
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') toast.error('Operação cancelada.')
      else toast.error(e?.response?.data?.detail ?? 'Erro ao registrar dispositivo.')
    } finally {
      setRegistering(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await api.delete(`/auth/webauthn/credentials/${id}`)
      setCreds(prev => prev.filter(c => c.id !== id))
      toast.success('Dispositivo removido.')
    } catch {
      toast.error('Erro ao remover.')
    }
  }

  if (!supported) return null

  return (
    <div className="border border-gray-200 rounded-xl p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Fingerprint className="w-4 h-4 text-[#26619c]" />
        <span className="text-sm font-semibold text-gray-700">Login por dispositivo</span>
      </div>

      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      ) : (
        <div className="flex flex-col gap-2">
          {creds.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              {c.device_name?.toLowerCase().includes('celular') || c.device_name?.toLowerCase().includes('phone')
                ? <Smartphone className="w-4 h-4 text-gray-400 shrink-0" />
                : <Monitor className="w-4 h-4 text-gray-400 shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-700 truncate">{c.device_name ?? 'Dispositivo'}</p>
                <p className="text-xs text-gray-400">{new Date(c.created_at).toLocaleDateString('pt-BR')}</p>
              </div>
              <button
                onClick={() => remove(c.id)}
                className="p-1.5 text-gray-300 hover:text-red-400 transition"
                title="Remover"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {creds.length < 3 && (
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={deviceName}
                onChange={e => setDeviceName(e.target.value)}
                placeholder={`Nome (ex: ${guessDeviceName()})`}
                className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
              />
              <button
                onClick={register}
                disabled={registering}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#26619c] text-white text-xs font-medium rounded-lg hover:bg-[#1a4f87] transition disabled:opacity-50 shrink-0"
              >
                {registering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5" /> Registrar</>}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function guessDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Celular Android'
  if (/Mac/i.test(ua)) return 'MacBook'
  if (/Windows/i.test(ua)) return 'Notebook Windows'
  return 'Dispositivo'
}
