import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Mic, MicOff, Send, Reply, X, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'

interface OSSearchResult {
  id: string
  number: number
  title: string
  status: string
  priority: string
  association_name?: string
}

interface ChatMessage {
  id: string
  sender_id: string | null
  sender_name: string
  sender_role: string | null
  sender_association?: string | null
  content: string | null
  message_type: 'text' | 'audio' | 'photo' | 'system'
  media_url: string | null
  mention_ids: string[]
  created_at: string
  reply_to_id?: string | null
  reply_to_sender_name?: string | null
  reply_to_content?: string | null
  reply_to_type?: string | null
}

interface MessageReader { name: string; user_id: string }

interface ChatUser {
  id: string
  name: string
}

export default function ChatPage() {
  const userId = useAuthStore(s => s.userId)
  const associationName = useAuthStore(s => s.associationName)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [users, setUsers] = useState<ChatUser[]>([])
  const [reads, setReads] = useState<Record<string, MessageReader[]>>({})
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [text, setText] = useState('')
  const [mentionIdx, setMentionIdx] = useState<number | null>(null)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [osIdx, setOsIdx] = useState<number | null>(null)
  const [osFilter, setOsFilter] = useState('')
  const [osResults, setOsResults] = useState<OSSearchResult[]>([])
  const osSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seenIds = useRef<Set<string>>(new Set())
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordSecs, setRecordSecs] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)

  const lastSinceRef = useRef<string>(new Date().toISOString())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const atBottomRef = useRef(true)

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') =>
    messagesEndRef.current?.scrollIntoView({ behavior })

  const fetchReads = useCallback(async () => {
    try {
      const res = await api.get<{ message_id: string; readers: MessageReader[] }[]>('/chat/reads')
      const map: Record<string, MessageReader[]> = {}
      for (const r of res.data) map[r.message_id] = r.readers
      setReads(map)
    } catch { /* silent */ }
  }, [])

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    let tick = 0
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get<ChatMessage[]>('/chat/messages/since', {
          params: { since: lastSinceRef.current },
        })
        if (res.data.length > 0) {
          lastSinceRef.current = res.data[res.data.length - 1].created_at
          const fresh = res.data.filter(m => !seenIds.current.has(m.id))
          if (fresh.length) {
            fresh.forEach(m => seenIds.current.add(m.id))
            setMessages(prev => [...prev, ...fresh])
            api.post('/chat/mark-read').catch(() => {})
            if (atBottomRef.current) setTimeout(() => scrollToBottom(), 50)
          }
        }
        tick++
        if (tick % 8 === 0) fetchReads()
      } catch { /* silent */ }
    }, 2000)
  }, [fetchReads])

  useEffect(() => {
    localStorage.setItem('chatLastRead', new Date().toISOString())
    ;(async () => {
      try {
        const [msgRes, userRes] = await Promise.all([
          api.get<ChatMessage[]>('/chat/messages', { params: { limit: 50 } }),
          api.get<ChatUser[]>('/chat/users'),
        ])
        msgRes.data.forEach(m => seenIds.current.add(m.id))
        setMessages(msgRes.data)
        setUsers(userRes.data)
        setHasMore(msgRes.data.length === 50)
        if (msgRes.data.length > 0)
          lastSinceRef.current = msgRes.data[msgRes.data.length - 1].created_at
        api.post('/chat/mark-read').catch(() => {})
        fetchReads()
        setTimeout(() => { scrollToBottom('auto'); startPolling() }, 100)
      } finally {
        setLoading(false)
      }
    })()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [startPolling])

  async function loadMore() {
    if (!hasMore || loadingMore || messages.length === 0) return
    setLoadingMore(true)
    const el = listRef.current
    const prevH = el?.scrollHeight ?? 0
    try {
      const res = await api.get<ChatMessage[]>('/chat/messages', {
        params: { limit: 50, before_id: messages[0].id },
      })
      setHasMore(res.data.length === 50)
      res.data.forEach(m => seenIds.current.add(m.id))
      setMessages(prev => [...res.data, ...prev])
      setTimeout(() => { if (el) el.scrollTop = el.scrollHeight - prevH }, 50)
    } finally {
      setLoadingMore(false)
    }
  }

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (el.scrollTop < 80) loadMore()
  }

  const onTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const pos = e.target.selectionStart ?? val.length
    setText(val)
    const before = val.slice(0, pos)

    const atMatch = before.match(/@([^@\s]*)$/)
    if (atMatch) {
      setMentionIdx(atMatch.index!)
      setMentionFilter(atMatch[1].toLowerCase())
      setOsIdx(null)
      return
    }
    setMentionIdx(null)
    setMentionFilter('')

    const hashMatch = before.match(/#([^\s]*)$/)
    if (hashMatch) {
      setOsIdx(hashMatch.index!)
      const q = hashMatch[1]
      setOsFilter(q)
      if (osSearchTimeout.current) clearTimeout(osSearchTimeout.current)
      osSearchTimeout.current = setTimeout(async () => {
        try {
          const res = await api.get<OSSearchResult[]>('/service-orders/search', { params: { q } })
          setOsResults(res.data)
        } catch { setOsResults([]) }
      }, 250)
    } else {
      setOsIdx(null)
      setOsFilter('')
      setOsResults([])
    }
  }

  const filteredUsers = mentionIdx !== null
    ? users.filter(u => u.name.toLowerCase().includes(mentionFilter)).slice(0, 5)
    : []

  const insertMention = (user: ChatUser) => {
    const atStart = mentionIdx!
    const queryEnd = atStart + 1 + mentionFilter.length
    const before = text.slice(0, atStart)
    const after = text.slice(queryEnd)
    const newText = `${before}@${user.name} ${after}`
    setText(newText)
    setMentionIds(prev => prev.includes(user.id) ? prev : [...prev, user.id])
    setMentionIdx(null)
    setMentionFilter('')
    const newCursor = atStart + user.name.length + 2
    setTimeout(() => {
      textRef.current?.focus()
      textRef.current?.setSelectionRange(newCursor, newCursor)
    }, 0)
  }

  const insertOsMention = (os: OSSearchResult) => {
    const hashStart = osIdx!
    const queryEnd = hashStart + 1 + osFilter.length
    const before = text.slice(0, hashStart)
    const after = text.slice(queryEnd)
    const token = `#OS-${os.id}`
    const newText = `${before}${token} ${after}`
    setText(newText)
    setOsIdx(null)
    setOsFilter('')
    setOsResults([])
    const newCursor = hashStart + token.length + 1
    setTimeout(() => {
      textRef.current?.focus()
      textRef.current?.setSelectionRange(newCursor, newCursor)
    }, 0)
  }

  async function sendText() {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    const ids = [...mentionIds]
    const reply = replyTo
    setText('')
    setMentionIds([])
    setReplyTo(null)
    try {
      const res = await api.post<ChatMessage>('/chat/messages', {
        content, message_type: 'text', mention_ids: ids,
        reply_to_id: reply?.id ?? null,
      })
      lastSinceRef.current = res.data.created_at
      if (!seenIds.current.has(res.data.id)) {
        seenIds.current.add(res.data.id)
        setMessages(prev => [...prev, res.data])
      }
      setTimeout(() => scrollToBottom(), 50)
    } catch {
      toast.error('Erro ao enviar mensagem')
      setText(content)
    } finally {
      setSending(false)
    }
  }

  async function toggleRecording() {
    if (recording) { stopRecording(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mr = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        uploadAudio(new Blob(chunksRef.current, { type: mimeType }), mimeType)
      }
      mr.start()
      mediaRecRef.current = mr
      setRecording(true)
      setRecordSecs(0)
      recTimerRef.current = setInterval(() => {
        setRecordSecs(s => {
          if (s >= 29) { stopRecording(); return 30 }
          return s + 1
        })
      }, 1000)
    } catch {
      toast.error('Permissão de microfone negada')
    }
  }

  function stopRecording() {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    mediaRecRef.current?.stop()
    mediaRecRef.current = null
    setRecording(false)
    setRecordSecs(0)
  }

  async function uploadAudio(blob: Blob, mimeType: string) {
    setUploading(true)
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
      const form = new FormData()
      form.append('file', blob, `audio_${Date.now()}.${ext}`)
      form.append('folder', 'chat/audio')
      const up = await api.post<{ url: string }>('/uploads/audio', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const res = await api.post<ChatMessage>('/chat/messages', {
        message_type: 'audio', media_url: up.data.url,
      })
      lastSinceRef.current = res.data.created_at
      if (!seenIds.current.has(res.data.id)) {
        seenIds.current.add(res.data.id)
        setMessages(prev => [...prev, res.data])
      }
      setTimeout(() => scrollToBottom(), 50)
    } catch {
      toast.error('Erro ao enviar áudio')
    } finally {
      setUploading(false)
    }
  }

  async function onPhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('folder', 'chat/photos')
      const up = await api.post<{ url: string }>('/uploads', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const res = await api.post<ChatMessage>('/chat/messages', {
        message_type: 'photo', media_url: up.data.url,
      })
      lastSinceRef.current = res.data.created_at
      if (!seenIds.current.has(res.data.id)) {
        seenIds.current.add(res.data.id)
        setMessages(prev => [...prev, res.data])
      }
      setTimeout(() => scrollToBottom(), 50)
    } catch {
      toast.error('Erro ao enviar foto')
    } finally {
      setUploading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (filteredUsers.length > 0 && mentionIdx !== null) {
        insertMention(filteredUsers[0])
      } else if (osResults.length > 0 && osIdx !== null) {
        insertOsMention(osResults[0])
      } else {
        sendText()
      }
    }
    if (e.key === 'Escape') { setMentionIdx(null); setOsIdx(null); setOsResults([]) }
  }

  const grouped = groupByDate(messages)

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 130px)', background: 'var(--brand-deeper)' }}>
      {/* Header */}
      <div className="px-4 py-3 shrink-0" style={{ background: 'var(--brand-dark)', borderBottom: '1px solid rgba(var(--brand-rgb), 0.4)' }}>
        <h1 className="font-semibold text-white text-sm">Chat da Associação</h1>
        <p className="text-xs text-purple-300">Histórico de 15 dias</p>
      </div>

      {/* Messages */}
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-2">
        {loadingMore && (
          <div className="text-center text-xs text-gray-400 py-2">Carregando...</div>
        )}
        {hasMore && !loadingMore && messages.length >= 50 && (
          <button onClick={loadMore} className="w-full text-xs text-purple-500 py-2 hover:underline">
            Carregar mensagens anteriores
          </button>
        )}

        {loading ? (
          <div className="flex justify-center items-center h-32">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-header) transparent var(--brand-header) var(--brand-header)' }} />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-purple-300">
            <span className="text-3xl">💬</span>
            <p className="text-sm">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          grouped.map(({ date, msgs }) => (
            <div key={date}>
              <div className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px" style={{ background: 'var(--brand-dark)' }} />
                <span className="text-xs text-white/40 shrink-0">{date}</span>
                <div className="flex-1 h-px" style={{ background: 'var(--brand-dark)' }} />
              </div>
              {msgs.map(msg => (
                <MessageBubble key={msg.id} msg={msg} isOwn={msg.sender_id === userId} myAssociation={associationName ?? ''} readers={reads[msg.id] ?? []} onReply={setReplyTo}
                  onDelete={id => {
                    if (!confirm('Apagar esta mensagem?')) return
                    api.delete(`/chat/messages/${id}`)
                      .then(() => setMessages(prev => prev.filter(m => m.id !== id)))
                      .catch(() => toast.error('Erro ao apagar mensagem'))
                  }}
                />
              ))}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Mention autocomplete */}
      {filteredUsers.length > 0 && mentionIdx !== null && (
        <div className="mx-3 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden shrink-0">
          {filteredUsers.map(u => (
            <button
              key={u.id}
              onMouseDown={e => { e.preventDefault(); insertMention(u) }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-purple-50 flex items-center gap-2"
            >
              <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold shrink-0">
                {u.name[0]?.toUpperCase()}
              </span>
              {u.name}
            </button>
          ))}
        </div>
      )}

      {/* OS autocomplete */}
      {osResults.length > 0 && osIdx !== null && (
        <div className="mx-3 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden shrink-0">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
            <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Ordens de Serviço</span>
          </div>
          {osResults.map(os => (
            <button
              key={os.id}
              onMouseDown={e => { e.preventDefault(); insertOsMention(os) }}
              className="w-full px-3 py-2 text-left hover:bg-orange-50 flex items-center gap-2"
            >
              <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-bold shrink-0">
                #
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800">OS #{os.number}</div>
                <div className="text-xs text-gray-500 truncate">{os.title}</div>
              </div>
              <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium ${
                os.status === 'resolved' ? 'bg-green-100 text-green-700' :
                os.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                os.status === 'in_progress' ? 'bg-purple-100 text-purple-700' :
                'bg-yellow-100 text-yellow-700'
              }`}>{os.status}</span>
            </button>
          ))}
        </div>
      )}

      {/* Reply preview */}
      {replyTo && (
        <div className="mx-3 mb-1 rounded-xl px-3 py-2 flex items-start gap-2 shrink-0" style={{ background: 'var(--brand-surface)', border: '1px solid rgba(var(--brand-rgb), 0.3)' }}>
          <div className="w-0.5 rounded-full self-stretch shrink-0" style={{ background: 'var(--brand-header)' }} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--brand-header)' }}>{replyTo.sender_name}</p>
            {replyTo.message_type === 'photo' ? (
              <p className="text-xs text-gray-500">📷 Foto</p>
            ) : replyTo.message_type === 'audio' ? (
              <p className="text-xs text-gray-500">🎤 Áudio</p>
            ) : (
              <p className="text-xs text-gray-600 truncate">{replyTo.content}</p>
            )}
          </div>
          <button onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Input bar */}
      <div className="px-3 py-2 flex items-end gap-2 shrink-0" style={{ background: 'var(--chat-header)', borderTop: '1px solid rgba(var(--brand-rgb), 0.4)' }}>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || recording}
          className="text-white/50 hover:text-white p-1.5 shrink-0 disabled:opacity-40 transition"
        >
          <Image className="w-5 h-5" />
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhotoSelect} />

        <textarea
          ref={textRef}
          value={text}
          onChange={onTextChange}
          onKeyDown={onKeyDown}
          placeholder={recording ? 'Gravando áudio…' : 'Mensagem… (@ usuário, # para O.S.)'}
          rows={1}
          disabled={recording || uploading}
          className="flex-1 min-h-[40px] max-h-28 resize-none overflow-y-auto rounded-2xl px-3 py-2 text-sm focus:outline-none text-white placeholder-white/30 disabled:opacity-50"
          style={{ background: 'var(--bubble-other)', border: '1px solid rgba(var(--brand-rgb), 0.5)' }}
        />

        {recording ? (
          <button
            onClick={stopRecording}
            className="bg-red-500 text-white rounded-full px-3 py-2 shrink-0 flex items-center gap-1.5 text-sm font-medium"
          >
            <MicOff className="w-4 h-4" />
            <span className="font-mono">{String(30 - recordSecs).padStart(2, '0')}s</span>
          </button>
        ) : text.trim() ? (
          <button
            onClick={sendText}
            disabled={sending}
            className="text-white rounded-full p-2.5 shrink-0 disabled:opacity-50 transition"
          style={{ background: 'var(--bubble-me)' }}
          >
            <Send className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={toggleRecording}
            disabled={uploading}
            className="text-white/50 hover:text-white p-1.5 shrink-0 disabled:opacity-40 transition"
          >
            <Mic className="w-5 h-5" />
          </button>
        )}

        {uploading && (
          <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin shrink-0" style={{ borderColor: 'var(--brand-header) transparent var(--brand-header) var(--brand-header)' }} />
        )}
      </div>
    </div>
  )
}

function groupByDate(msgs: ChatMessage[]) {
  const groups: { date: string; msgs: ChatMessage[] }[] = []
  let cur = ''
  for (const m of msgs) {
    const d = new Date(m.created_at)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    let label: string
    if (d.toDateString() === today.toDateString()) label = 'Hoje'
    else if (d.toDateString() === yesterday.toDateString()) label = 'Ontem'
    else label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
    if (label !== cur) { cur = label; groups.push({ date: label, msgs: [m] }) }
    else groups[groups.length - 1].msgs.push(m)
  }
  return groups
}

function renderText(content: string) {
  const parts = content.split(/(#OS-[\w-]+|@\S+)/g)
  return parts.map((p, i) => {
    if (p.startsWith('@')) return <span key={i} className="font-semibold opacity-90">{p}</span>
    if (p.startsWith('#OS-')) {
      return <OSMentionCard key={i} token={p.slice(4)} />
    }
    return p
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function OSMentionCard({ token }: { token: string }) {
  const [os, setOs] = useState<OSSearchResult | null>(null)
  const isUuid = UUID_RE.test(token)

  useEffect(() => {
    if (isUuid) {
      api.get<OSSearchResult>(`/service-orders/by-id/${token}`)
        .then(r => setOs(r.data))
        .catch(() => {})
    } else {
      const num = parseInt(token, 10)
      api.get<OSSearchResult[]>('/service-orders/search', { params: { q: String(num) } })
        .then(r => { const found = r.data.find(o => o.number === num); if (found) setOs(found) })
        .catch(() => {})
    }
  }, [token])

  const statusLabel: Record<string, string> = {
    pending: 'Pendente', open: 'Aberta', in_progress: 'Em andamento',
    waiting_third_party: 'Aguardando', resolved: 'Resolvida',
    archived: 'Arquivada', cancelled: 'Cancelada',
  }
  const priorityColor: Record<string, string> = {
    low: 'text-gray-500', medium: 'text-yellow-600',
    high: 'text-orange-600', critical: 'text-red-600',
  }

  if (!os) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-50 border border-orange-200 rounded text-orange-700 text-xs font-medium">
      OS …
    </span>
  )

  return (
    <span className="block my-1 p-2 bg-orange-50 border border-orange-200 rounded-lg text-left">
      <span className="flex items-center gap-1.5 flex-wrap">
        <span className="text-orange-700 font-bold text-xs">OS #{os.number}</span>
        <span className={`text-[10px] font-semibold ${priorityColor[os.priority] ?? ''}`}>
          {os.priority === 'critical' ? '🔴' : os.priority === 'high' ? '🟠' : os.priority === 'medium' ? '🟡' : '⚪'} {os.priority}
        </span>
        <span className="ml-auto text-[10px] bg-white border border-orange-200 px-1.5 py-0.5 rounded-full text-orange-600 font-medium">
          {statusLabel[os.status] ?? os.status}
        </span>
      </span>
      <span className="block text-xs text-gray-700 mt-0.5 leading-snug">{os.title}</span>
    </span>
  )
}

function MessageBubble({ msg, isOwn, myAssociation, readers, onReply, onDelete }: { msg: ChatMessage; isOwn: boolean; myAssociation: string; readers: MessageReader[]; onReply: (m: ChatMessage) => void; onDelete: (id: string) => void }) {
  const [hovered, setHovered] = useState(false)
  const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  if (msg.message_type === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-white/60 px-3 py-1 rounded-full max-w-xs text-center" style={{ background: 'rgba(var(--brand-rgb), 0.3)' }}>
          {msg.content}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`flex gap-2 mb-1 group ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isOwn && (
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-1 select-none" style={{ background: 'linear-gradient(135deg, var(--brand-header), var(--brand-dark))' }}>
          {msg.sender_name[0]?.toUpperCase()}
        </div>
      )}
      <div className={`max-w-[75%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
        {!isOwn && (
          <span className="text-[10px] text-purple-300 ml-1 mb-0.5 font-medium">
            {msg.sender_name}
            {msg.sender_role && (
              <span className="ml-1 text-purple-400 font-normal">· {msg.sender_role}</span>
            )}
            {msg.sender_association && msg.sender_association !== myAssociation && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 text-[9px] font-semibold leading-none">{msg.sender_association}</span>
            )}
          </span>
        )}
        <div className={`rounded-2xl px-3 py-2 text-white ${isOwn ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}
          style={{ background: isOwn ? 'var(--bubble-me)' : 'var(--bubble-other)', border: isOwn ? 'none' : '1px solid rgba(var(--brand-rgb), 0.3)' }}
        >
          {/* Quoted message */}
          {msg.reply_to_sender_name && (
            <div className="mb-2 rounded-xl px-2.5 py-1.5 flex gap-1.5" style={{ background: 'rgba(0,0,0,0.25)' }}>
              <div className="w-0.5 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.5)' }} />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold mb-0.5 text-purple-200">
                  {msg.reply_to_sender_name}
                </p>
                {msg.reply_to_type === 'photo' ? (
                  <p className="text-[11px] text-purple-300">📷 Foto</p>
                ) : msg.reply_to_type === 'audio' ? (
                  <p className="text-[11px] text-purple-300">🎤 Áudio</p>
                ) : (
                  <p className="text-[11px] truncate max-w-[180px] text-purple-200">
                    {msg.reply_to_content}
                  </p>
                )}
              </div>
            </div>
          )}
          {msg.message_type === 'text' && msg.content && (
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {renderText(msg.content)}
            </p>
          )}
          {msg.message_type === 'photo' && msg.media_url && (
            <a href={msg.media_url} target="_blank" rel="noreferrer">
              <img
                src={msg.media_url}
                alt="foto"
                className="max-w-[220px] max-h-[220px] rounded-xl object-cover"
              />
            </a>
          )}
          {msg.message_type === 'audio' && msg.media_url && (
            <audio controls src={msg.media_url} className="max-w-[240px] h-8" />
          )}
        </div>
        <span className={`text-[10px] text-purple-400 mt-0.5 ${isOwn ? 'mr-1' : 'ml-1'}`}>{time}</span>
        {readers.length > 0 && (
          <div className={`flex items-center gap-0.5 mt-0.5 ${isOwn ? 'justify-end mr-1' : 'ml-1'}`}>
            {readers.slice(0, 5).map(r => (
              <span key={r.user_id} title={`Visto por ${r.name}`}
                className="w-4 h-4 rounded-full text-white/80 flex items-center justify-center text-[8px] font-bold leading-none select-none" style={{ background: 'var(--brand-dark)' }}>
                {r.name[0]?.toUpperCase()}
              </span>
            ))}
            {readers.length > 5 && (
              <span className="text-[9px] text-purple-400 ml-0.5">+{readers.length - 5}</span>
            )}
          </div>
        )}
      </div>
      {/* Action buttons */}
      <div className={`self-center flex flex-col gap-0.5 transition ${hovered ? 'opacity-100' : 'opacity-0'}`}>
        <button onClick={() => onReply(msg)} className="p-1.5 rounded-full text-white/40 hover:text-white transition" style={{ ['--hover-bg' as string]: 'var(--brand-dark)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--brand-dark)')} onMouseLeave={e => (e.currentTarget.style.background = '')} title="Responder">
          <Reply className="w-3.5 h-3.5" />
        </button>
        {isOwn && (
          <button onClick={() => onDelete(msg.id)} className="p-1.5 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition" title="Apagar">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
