interface Props {
  icon: string
  label: string
  onClick: () => void
  badge?: string
}

export function SimplificaTile({ icon, label, onClick, badge }: Props) {
  return (
    <button
      onClick={onClick}
      className="relative aspect-square rounded-2xl flex flex-col items-center justify-center gap-3 border transition active:scale-95"
      style={{
        backgroundColor: 'var(--brand-surface)',
        borderColor: 'color-mix(in srgb, var(--brand-header) 20%, transparent)',
      }}
    >
      {badge && (
        <span className="absolute top-2 right-2 min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
          {badge}
        </span>
      )}
      <span className="text-4xl">{icon}</span>
      <span className="text-sm font-semibold text-center text-gray-800 dark:text-gray-100 px-1 leading-tight">{label}</span>
    </button>
  )
}
