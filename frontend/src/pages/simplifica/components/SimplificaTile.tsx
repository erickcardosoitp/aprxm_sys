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
      className="group relative aspect-square rounded-2xl flex flex-col items-start justify-between p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 active:scale-[0.97] transition-transform duration-100"
      style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.04)' }}
    >
      {badge && (
        <span className="absolute top-3 right-3 min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center px-1.5">
          {badge}
        </span>
      )}
      <span
        className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, white)` }}
      >
        <Icon className="w-6 h-6" strokeWidth={1.75} style={{ color }} />
      </span>
      <span className="text-[15px] font-semibold text-left text-gray-800 dark:text-gray-100 leading-tight tracking-tight">
        {label}
      </span>
    </button>
  )
}
