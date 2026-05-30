import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  label: string
  onClick: () => void
  badge?: string
  color?: string
}

export function SimplificaTile({ icon: Icon, label, onClick, badge, color = '#1a3f6f' }: Props) {
  return (
    <button
      onClick={onClick}
      className="group relative rounded-2xl flex flex-col items-start justify-between bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 active:scale-[0.96] transition-transform duration-100"
      style={{
        minHeight: '120px',
        padding: '14px',
        boxShadow: '0 1px 3px rgba(16,24,40,0.07), 0 1px 2px rgba(16,24,40,0.04)',
      }}
    >
      {badge && (
        <span className="absolute top-3 right-3 min-w-[22px] h-[22px] rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center px-1.5 shadow-sm">
          {badge}
        </span>
      )}

      {/* Ícone com chip colorido */}
      <span
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 13%, white)` }}
      >
        <Icon className="w-5 h-5" strokeWidth={1.8} style={{ color }} />
      </span>

      {/* Label */}
      <span
        className="text-[13px] font-semibold text-left text-gray-800 dark:text-gray-100 leading-tight tracking-tight w-full"
        style={{ marginTop: '10px' }}
      >
        {label}
      </span>
    </button>
  )
}
