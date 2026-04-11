import { useRef, useState } from 'react'
import { Sparkles, X, Send, ChevronDown } from 'lucide-react'
import api from '../../services/api'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  data?: Record<string, any>
  id: number
}

let msgId = 0

const SUGGESTIONS = [
  'Quanto entrou hoje?',
  'Quem está devendo?',
  'Buscar morador João',
  'Encomendas pendentes',
  'Quantas OS abertas?',
  'Total de associados',
]

export default function AgentWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const push = (msg: Omit<Msg, 'id'>) => {
    setMsgs(p => [...p, { ...msg, id: ++msgId }])
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const send = async (text: string) => {
    if (!text.trim() || loading) return
    push({ role: 'user', text })
    setInput('')
    setLoading(true)
    try {
      const res = await api.post('/agent/chat', { message: text })
      push({ role: 'assistant', text: res.data.reply, data: res.data.data })
    } catch (e: any) {
      push({ role: 'assistant', text: e.response?.data?.detail ?? 'Erro ao conectar.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-20 right-4 z-50 w-12 h-12 bg-[#26619c] text-white rounded-full shadow-lg flex items-center justify-center hover:bg-[#1a4f87] transition"
        title="Simplifica"
      >
        {open ? <X className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
      </button>

      {open && (
        <div className="fixed bottom-36 right-4 z-50 w-80 max-h-[70vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-[#26619c] text-white">
            <Sparkles className="w-4 h-4" />
            <div className="flex-1">
              <p className="text-sm font-semibold leading-none">Simplifica</p>
              <p className="text-xs opacity-60 mt-0.5">Consulta e análise</p>
            </div>
            <button onClick={() => setOpen(false)}><ChevronDown className="w-4 h-4 opacity-70 hover:opacity-100" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
            {msgs.length === 0 && (
              <div className="flex flex-col gap-2 pt-1">
                <p className="text-xs text-gray-400 text-center mb-1">Olá! Faça uma pergunta sobre os dados.</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="text-left px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 hover:bg-blue-50 hover:border-blue-200 transition leading-snug">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map(m => (
              <div key={m.id} className={`flex flex-col gap-1.5 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#26619c] text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}>
                  {m.text}
                </div>

                {m.data?.items && m.data.items.length > 0 && (
                  <div className="w-full bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
                    <table className="w-full text-xs">
                      <tbody>
                        {m.data.items.slice(0, 8).map((item: any, i: number) => (
                          <tr key={i} className="border-b border-gray-100 last:border-0">
                            <td className="px-3 py-1.5 text-gray-700 font-medium">
                              {item.name ?? item.title ?? item.full_name ?? '—'}
                              {item.number ? ` #${item.number}` : ''}
                            </td>
                            <td className="px-3 py-1.5 text-gray-400 text-right whitespace-nowrap">
                              {item.amount != null
                                ? `R$ ${Number(item.amount).toFixed(2)}`
                                : item.month ?? item.status ?? item.unit ?? ''}
                            </td>
                          </tr>
                        ))}
                        {m.data.items.length > 8 && (
                          <tr><td colSpan={2} className="px-3 py-1 text-gray-400 text-xs">…e mais {m.data.items.length - 8}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2 text-xs text-gray-400 animate-pulse">Consultando…</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="px-3 py-2 border-t border-gray-100 flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(input)}
              placeholder="Faça uma pergunta…"
              disabled={loading}
              className="flex-1 border border-gray-300 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#26619c]/40 disabled:opacity-50"
            />
            <button onClick={() => send(input)} disabled={loading || !input.trim()}
              className="p-1.5 bg-[#26619c] text-white rounded-xl hover:bg-[#1a4f87] transition disabled:opacity-40">
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
