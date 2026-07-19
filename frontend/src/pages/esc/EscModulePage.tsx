import { useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'
const ACCENT = '#16a34a'

export interface EscSection {
  key: string
  label: string
  content: ReactNode
}

interface EscModulePageProps {
  title: string
  description: string
  icon: ComponentType<{ className?: string; style?: CSSProperties }>
  sections: EscSection[]
}

export default function EscModulePage({ title, description, icon: Icon, sections }: EscModulePageProps) {
  const [active, setActive] = useState(sections[0]?.key)
  const current = sections.find((s) => s.key === active) ?? sections[0]

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-2.5 mb-1">
          <Icon className="w-5 h-5" style={{ color: TEXT_MUTED }} />
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        </div>
        <p className="text-sm" style={{ color: TEXT_MUTED }}>{description}</p>
      </div>

      {sections.length > 1 && (
        <div className="px-6 border-b flex gap-5" style={{ borderColor: BORDER }}>
          {sections.map((s) => (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              className="text-sm py-2 border-b-2 -mb-px transition-colors"
              style={{
                borderColor: active === s.key ? ACCENT : 'transparent',
                color: active === s.key ? '#0f172a' : TEXT_MUTED,
                fontWeight: active === s.key ? 600 : 500,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {current?.content}
      </div>
    </div>
  )
}
