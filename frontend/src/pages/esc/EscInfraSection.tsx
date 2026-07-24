import { useEffect, useState } from 'react'
import { escService } from '../../services/esc'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

interface Infra {
  db_ok: boolean
  db_latency_ms: number
  open_cash_sessions: number
}

export default function EscInfraSection() {
  const [data, setData] = useState<Infra | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    escService.infra().then((r) => setData(r.data)).finally(() => setLoading(false))
  }, [])

  const stats = data
    ? [
        { label: 'Banco de dados', value: data.db_ok ? 'Online' : 'Offline' },
        { label: 'Latência do banco', value: `${data.db_latency_ms} ms` },
        { label: 'Sessões de caixa abertas', value: String(data.open_cash_sessions) },
      ]
    : []

  return (
    <div className="px-6 py-4">
      {loading && <p className="text-sm" style={{ color: TEXT_MUTED }}>carregando…</p>}
      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="border p-4" style={{ borderColor: BORDER }}>
            <p className="text-xs mb-1" style={{ color: TEXT_MUTED }}>{s.label}</p>
            <p className="text-xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
