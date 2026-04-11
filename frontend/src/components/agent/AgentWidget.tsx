import { useRef, useState } from 'react'
import { Bot, X, Send, AlertTriangle, Check, ChevronDown } from 'lucide-react'
import api from '../../services/api'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  data?: Record<string, any>
  requires_confirmation?: boolean
  pending_action?: Record<string, any>
  id: number
}

let msgId = 0

const SUGGESTIONS = [
  'Quanto entrou hoje?',
  'Quem está devendo?',
  'Buscar morador João',
]

export default function AgentWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const push = (msg: Omit<Msg, 'id'>) => {
    const m = { ...msg, id: ++msgId }
    setMsgs(p => [...p, m])
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    return m.id
  }

  const send = async (text: string, confirmed_action?: Record<string, any>) => {
    if (!text.trim() && !confirmed_action) return
    if (text) push({ role: 'user', text })
    setInput('')
    setLoading(true)
    try {
      const res = await api.post('/agent/chat', {
        message: text,
        confirmed_action: confirmed_action ?? null,
      })
      const d = res.data
      push({
        role: 'assistant',
        text: d.reply,
        data: d.data,
        requires_confirmation: d.requires_confirmation,
        pending_action: d.pending_action,
      })
    } catch (e: any) {
      push({ role: 'assistant', text: e.response?.data?.detail ?? 'Erro ao conectar com o agente.' })
    } finally {
      setLoading(false)
    }
  }

  const confirm = (action: Record<string, any>) => {
    push({ role: 'user', text: '✅ Confirmado.' })
    send('', action)
  }

  const cancel = () => push({ role: 'assistant', text: 'Ação cancelada.' })

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-20 right-4 z-50 w-12 h-12 bg-[#26619c] text-white rounded-full shadow-lg flex items-center justify-center hover:bg-[#1a4f87] transition"
        title="Agente IA"
      >
        {open ? <X className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-36 right-4 z-50 w-80 max-h-[70vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-[#26619c] text-white">
            <Bot className="w-4 h-4" />
            <span className="text-sm font-semibold flex-1">Agente APROXIMA</span>
            <button onClick={() => setOpen(false)}><ChevronDown className="w-4 h-4 opacity-70 hover:opacity-100" /></button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
            {msgs.length === 0 && (
              <div className="flex flex-col gap-2 pt-2">
                <p className="text-xs text-gray-400 text-center mb-1">Olá! Como posso ajudar?</p>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="text-left px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 hover:bg-blue-50 hover:border-blue-200 transition">
                    {s}
                  </button>
                ))}
              </div>
            )}

            {msgs.map(m => (
              <div key={m.id} className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#26619c] text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}>
                  {m.text}
                </div>

                {/* Data table */}
                {m.data?.items && m.data.items.length > 0 && (
                  <div className="w-full overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <tbody>
                        {m.data.items.slice(0, 6).map((item: any, i: number) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-1 pr-2 text-gray-700 font-medium">{item.name ?? item.full_name ?? JSON.stringify(item).slice(0, 40)}</td>
                            <td className="py-1 text-gray-400 text-right">{item.amount ? `R$ ${Number(item.amount).toFixed(2)}` : item.month ?? item.status ?? ''}</td>
                          </tr>
                        ))}
                        {m.data.items.length > 6 && <tr><td colSpan={2} className="py-1 text-gray-400 text-xs">…e mais {m.data.items.length - 6}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Confirmation buttons */}
                {m.requires_confirmation && m.pending_action && (
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => confirm(m.pending_action!)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition">
                      <Check className="w-3 h-3" /> Confirmar
                    </button>
                    <button onClick={cancel}
                      className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-300 transition">
                      <X className="w-3 h-3" /> Cancelar
                    </button>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2 text-xs text-gray-400 animate-pulse">Pensando…</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-2 border-t border-gray-100 flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && send(input)}
              placeholder="Digite uma pergunta…"
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
