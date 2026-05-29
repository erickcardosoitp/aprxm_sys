import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useAuthStore } from '../../../store/authStore'

interface Props {
  title?: string
  showBack?: boolean
}

export function SimplificaHeader({ title, showBack = false }: Props) {
  const navigate = useNavigate()
  const associationName = useAuthStore((s) => s.associationName)

  return (
    <header
      className="text-white flex items-center px-4 py-3 shadow sticky top-0 z-10"
      style={{ backgroundColor: 'var(--brand-header)', paddingTop: 'max(12px, env(safe-area-inset-top))' }}
    >
      {showBack ? (
        <button onClick={() => navigate('/simplifica')} className="mr-3 p-1 -ml-1 rounded-lg hover:bg-white/10 transition">
          <ChevronLeft className="w-6 h-6" />
        </button>
      ) : (
        <div className="flex flex-col leading-tight min-w-0 mr-auto">
          <span className="font-extrabold text-base tracking-tight">APRXM</span>
          {associationName && (
            <span className="text-[10px] opacity-70 leading-none whitespace-nowrap overflow-hidden text-ellipsis">{associationName}</span>
          )}
        </div>
      )}
      {title && <span className="font-bold text-base flex-1">{title}</span>}
      {!showBack && !title && <div className="flex-1" />}
    </header>
  )
}
