import { lazy, Suspense, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

const ChatPage = lazy(() => import('../chat/ChatPage'))

export default function SimplificaChat() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const vv = window.visualViewport
    const el = containerRef.current
    if (!vv || !el) return

    const update = () => {
      // visualViewport ajusta em tempo real quando teclado iOS/Android abre
      el.style.height = `${vv.height}px`
      el.style.top    = `${vv.offsetTop}px`
      el.style.left   = `${vv.offsetLeft}px`
      el.style.width  = `${vv.width}px`
    }

    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()

    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
      className="flex flex-col"
    >
      {/* Header do Simplifica */}
      <div
        className="flex items-center gap-2 px-4 py-3 text-white shrink-0"
        style={{
          backgroundColor: 'var(--brand-header)',
          paddingTop: 'max(12px, env(safe-area-inset-top))',
        }}
      >
        <button
          onClick={() => navigate('/simplifica')}
          className="p-1 -ml-1 rounded-lg hover:bg-white/10 transition"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold text-base">Chat</span>
      </div>

      {/* ChatPage preenche o restante do espaço visível */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: 'var(--brand-header)' }} />
          </div>
        }>
          <ChatPage fillHeight />
        </Suspense>
      </div>
    </div>
  )
}
