import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

const ChatPage = lazy(() => import('../chat/ChatPage'))

export default function SimplificaChat() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col min-h-screen">
      <div
        className="flex items-center gap-2 px-4 py-3 text-white sticky top-0 z-10"
        style={{ backgroundColor: 'var(--brand-header)', paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <button onClick={() => navigate('/simplifica')} className="p-1 -ml-1 rounded-lg hover:bg-white/10 transition">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold text-base">Chat</span>
      </div>
      <div className="flex-1">
        <Suspense fallback={<div className="flex items-center justify-center h-40"><div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-header)' }} /></div>}>
          <ChatPage offsetTop={56} />
        </Suspense>
      </div>
    </div>
  )
}
