import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Mic, MicOff, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'

interface ChatMessage {
  id: string
  sender_id: string | null
  sender_name: string
  content: string | null
  message_type: 'text' | 'audio' | 'photo' | 'system'
  media_url: string | null
  mention_ids: string[]
  created_at: string
}

interface ChatUser {
  id: string
  name: string
}

export default function ChatPage() {
  const userId = useAuthStore(s => s.userId)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [users, setUsers] = useState<ChatUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [text, setText] = useState('')
  const [mentionIdx, setMentionIdx] = useState<number | null>(null)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
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

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get<ChatMessage[]>('/chat/messages/since', {
          params: { since: lastSinceRef.current },
        })
        if (res.data.length > 0) {
          lastSinceRef.current = res.data[res.data.length - 1].created_at
          setMessages(prev => {
            const ids = new Set(prev.map(m => m.id))
            const fresh = res.data.filter(m => !ids.has(m.id))
            return fresh.length ? [...prev, ...fresh] : prev
          })
          if (atBottomRef.current) setTimeout(() => scrollToBottom(), 50)
        }
      } catch { /* silent */ }
    }, 2000)
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const [msgRes, userRes] = await Promise.all([
          api.get<ChatMessage[]>('/chat/messages', { params: { limit: 50 } }),
          api.get<ChatUser[]>('/chat/users'),
        ])
        setMessages(msgRes.data)
        setUsers(userRes.data)
        setHasMore(msgRes.data.length === 50)
        if (msgRes.data.length > 0)
          lastSinceRef.current = msgRes.data[msgRes.data.length - 1].created_at
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
    const m = before.match(/@(\w*)$/)
    if (m) {
      setMentionIdx(m.index!)
      setMentionFilter(m[1].toLowerCase())
    } else {
      setMentionIdx(null)
      setMentionFilter('')
    }
    // auto-resize
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 112) + 'px'
  }

  const filteredUsers = mentionIdx !== null
    ? users.filter(u => u.name.toLowerCase().includes(mentionFilter)).slice(0, 5)
    : []

  const insertMention = (user: ChatUser) => {
    const pos = textRef.current?.selectionStart ?? text.length
    const before = text.slice(0, mentionIdx!)
    const after = text.slice(pos)
    setText(`${before}@${user.name} ${after}`)
    setMentionIds(prev => prev.includes(user.id) ? prev : [...prev, user.id])
    setMentionIdx(null)
    setMentionFilter('')
    setTimeout(() => textRef.current?.focus(), 0)
  }

  async function sendText() {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    const ids = [...mentionIds]
    setText('')
    setMentionIds([])
    if (textRef.current) { textRef.current.style.height = 'auto' }
    try {
      const res = await api.post<ChatMessage>('/chat/messages', {
        content, message_type: 'text', mention_ids: ids,
      })
      lastSinceRef.current = res.data.created_at
      setMessages(prev => [...prev, res.data])
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
      setMessages(prev => [...prev, res.data])
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
      setMessages(prev => [...prev, res.data])
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
      } else {
        sendText()
      }
    }
    if (e.key === 'Escape') { setMentionIdx(null) }
  }

  const grouped = groupByDate(messages)

  return (
    <div className="flex flex-col bg-gray-50" style={{ height: 'calc(100vh - 130px)' }}>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 shrink-0">
        <h1 className="font-semibold text-gray-800 text-sm">Chat da Associação</h1>
        <p className="text-xs text-gray-400">Histórico de 15 dias</p>
      </div>

      {/* Messages */}
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-2">
        {loadingMore && (
          <div className="text-center text-xs text-gray-400 py-2">Carregando...</div>
        )}
        {hasMore && !loadingMore && messages.length >= 50 && (
          <button onClick={loadMore} className="w-full text-xs text-blue-500 py-2 hover:underline">
            Carregar mensagens anteriores
          </button>
        )}

        {loading ? (
          <div className="flex justify-center items-center h-32">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-400">
            <span className="text-3xl">💬</span>
            <p className="text-sm">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          grouped.map(({ date, msgs }) => (
            <div key={date}>
              <div className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 shrink-0">{date}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              {msgs.map(msg => (
                <MessageBubble key={msg.id} msg={msg} isOwn={msg.sender_id === userId} />
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
              className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex items-center gap-2"
            >
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                {u.name[0]?.toUpperCase()}
              </span>
              {u.name}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="border-t border-gray-200 bg-white px-3 py-2 flex items-end gap-2 shrink-0">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || recording}
          className="text-gray-400 hover:text-blue-500 p-1.5 shrink-0 disabled:opacity-40 transition"
        >
          <Image className="w-5 h-5" />
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhotoSelect} />

        <textarea
          ref={textRef}
          value={text}
          onChange={onTextChange}
          onKeyDown={onKeyDown}
          placeholder={recording ? 'Gravando áudio…' : 'Mensagem… (@ para mencionar)'}
          rows={1}
          disabled={recording || uploading}
          className="flex-1 resize-none rounded-2xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-gray-50 disabled:opacity-50"
          style={{ minHeight: '38px', maxHeight: '112px' }}
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
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-full p-2.5 shrink-0 disabled:opacity-50 transition"
          >
            <Send className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={toggleRecording}
            disabled={uploading}
            className="text-gray-400 hover:text-blue-500 p-1.5 shrink-0 disabled:opacity-40 transition"
          >
            <Mic className="w-5 h-5" />
          </button>
        )}

        {uploading && (
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
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
  const parts = content.split(/(@\S+)/g)
  return parts.map((p, i) =>
    p.startsWith('@')
      ? <span key={i} className="font-semibold opacity-90">{p}</span>
      : p
  )
}

function MessageBubble({ msg, isOwn }: { msg: ChatMessage; isOwn: boolean }) {
  const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  if (msg.message_type === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-gray-500 bg-gray-200/80 px-3 py-1 rounded-full max-w-xs text-center">
          {msg.content}
        </span>
      </div>
    )
  }

  return (
    <div className={`flex gap-2 mb-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isOwn && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-1 select-none">
          {msg.sender_name[0]?.toUpperCase()}
        </div>
      )}
      <div className={`max-w-[75%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
        {!isOwn && (
          <span className="text-[10px] text-gray-400 ml-1 mb-0.5 font-medium">{msg.sender_name}</span>
        )}
        <div className={`rounded-2xl px-3 py-2 ${
          isOwn
            ? 'bg-blue-600 text-white rounded-tr-sm'
            : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
        }`}>
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
        <span className={`text-[10px] text-gray-400 mt-0.5 ${isOwn ? 'mr-1' : 'ml-1'}`}>{time}</span>
      </div>
    </div>
  )
}
