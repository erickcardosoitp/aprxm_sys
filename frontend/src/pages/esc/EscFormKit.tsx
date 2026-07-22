import type { ReactNode, SelectHTMLAttributes } from 'react'
import { ChevronDown, X } from 'lucide-react'

export const ESC_ACCENT = '#16a34a'
const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

export const escInputCls =
  "w-full border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:bg-slate-50 " +
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
export const escInputStyle = { borderColor: BORDER, fontFamily: "'IBM Plex Sans', sans-serif" } as const

export function EscField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: TEXT_MUTED }}>{label}</span>
      {children}
    </label>
  )
}

// Select nativo estilizado (remove a seta padrão do navegador, usa chevron proprio) -
// mesma altura/borda/fonte do escInputCls, pra nao misturar controle "cru" com o resto.
export function EscSelect({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement> & { className?: string }) {
  return (
    <div className="relative">
      <select
        {...props}
        className={`${escInputCls} appearance-none pr-8 ${className}`}
        style={escInputStyle}
      />
      <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: TEXT_MUTED }} />
    </div>
  )
}

export function EscButton({ children, onClick, disabled, variant = 'primary', type = 'button' }: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost' | 'danger'
  type?: 'button' | 'submit'
}) {
  const base = "px-3.5 py-2 text-sm font-medium transition disabled:opacity-50"
  const styles: Record<string, React.CSSProperties> = {
    primary: { backgroundColor: ESC_ACCENT, color: '#fff' },
    ghost: { color: TEXT_MUTED, border: `1px solid ${BORDER}` },
    danger: { color: '#dc2626', border: '1px solid #fecaca' },
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={base} style={styles[variant]}>
      {children}
    </button>
  )
}

export function EscModal({ title, onClose, children, footer }: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
         style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div className="w-full max-w-md bg-white shadow-2xl border" style={{ borderColor: BORDER }}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: BORDER }}>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: BORDER }}>{footer}</div>}
      </div>
    </div>
  )
}
