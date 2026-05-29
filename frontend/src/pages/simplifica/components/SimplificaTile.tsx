interface Props {
  icon: string
  label: string
  onClick: () => void
  badge?: string
  color?: string
}

export function SimplificaTile({ icon, label, onClick, badge, color = '#1a3f6f' }: Props) {
  return (
    <button
      onClick={onClick}
      className="group relative aspect-square rounded-2xl flex flex-col items-center justify-center gap-3 bg-white dark:bg-gray-800 shadow-sm active:scale-[0.97] active:shadow-none transition-all duration-100"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)' }}
    >
      {badge && (
        <span className="absolute top-2.5 right-2.5 min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center px-1.5 shadow">
          {badge}
        </span>
      )}
      <span
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, white)` }}
      >
        {icon}
      </span>
      <span className="text-sm font-semibold text-center text-gray-700 dark:text-gray-100 px-2 leading-tight">{label}</span>
    </button>
  )
}
