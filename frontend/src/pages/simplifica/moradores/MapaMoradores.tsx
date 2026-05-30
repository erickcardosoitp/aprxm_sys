import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import api from '../../../services/api'
import { SECTOR_COLORS } from '../theme'
import type { Resident } from '../../../types'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type MapFilter = 'todos' | 'associados' | 'nao_assoc' | 'inadimplentes' | 'sem_internet' | 'problemas'

interface CepGroup {
  cep: string
  street: string
  lat: number
  lng: number
  residents: Resident[]
  // contagens por categoria
  total: number
  members: number
  guests: number
  delinquents: number
  semInternet: number
  problemas: number
}

const FILTERS: { key: MapFilter; label: string; color: string }[] = [
  { key: 'todos',        label: 'Todos',          color: '#1a3f6f' },
  { key: 'associados',   label: 'Associados',      color: '#0f7a4d' },
  { key: 'nao_assoc',    label: 'Não Associados',  color: '#c2620a' },
  { key: 'inadimplentes',label: 'Inadimplentes',   color: '#dc2626' },
  { key: 'sem_internet', label: 'Sem Internet',    color: '#7c3aed' },
  { key: 'problemas',    label: 'Problemas',       color: '#b45309' },
]

function countForFilter(g: CepGroup, f: MapFilter): number {
  switch (f) {
    case 'todos':         return g.total
    case 'associados':    return g.members
    case 'nao_assoc':     return g.guests
    case 'inadimplentes': return g.delinquents
    case 'sem_internet':  return g.semInternet
    case 'problemas':     return g.problemas
  }
}

function residentsForFilter(r: Resident, f: MapFilter, delinquentIds: Set<string>): boolean {
  switch (f) {
    case 'todos':         return true
    case 'associados':    return r.type === 'member'
    case 'nao_assoc':     return r.type === 'guest'
    case 'inadimplentes': return delinquentIds.has(r.id)
    case 'sem_internet':  return !r.internet_access || r.internet_access === 'nenhum' || r.internet_access === 'Nenhum'
    case 'problemas':     return (r.neighborhood_problems ?? []).length > 0
  }
}

// ── Geocodificação ─────────────────────────────────────────────────────────────

async function geocodeCep(cep: string, streetHint?: string): Promise<{ lat: number; lng: number } | null> {
  const clean = cep.replace(/\D/g, '')
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`)
    if (r.ok) {
      const d = await r.json()
      const lat = d?.location?.coordinates?.latitude
      const lng = d?.location?.coordinates?.longitude
      if (lat && lng && !(parseFloat(lat) === 0 && parseFloat(lng) === 0)) {
        return { lat: parseFloat(lat), lng: parseFloat(lng) }
      }
      // Fallback Nominatim
      const street = streetHint || d?.street || ''
      const city = d?.city || ''
      const state = d?.state || ''
      if (city) {
        const q = street ? `${street}, ${city}, ${state}, Brasil` : `${city}, ${state}, Brasil`
        const nom = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
          { headers: { 'Accept-Language': 'pt-BR', 'User-Agent': 'APRXM-Simplifica/1.0' } }
        )
        if (nom.ok) {
          const nd = await nom.json()
          if (nd[0]?.lat && nd[0]?.lon) return { lat: parseFloat(nd[0].lat), lng: parseFloat(nd[0].lon) }
        }
      }
    }
    return null
  } catch { return null }
}

// ── Mapa Leaflet ──────────────────────────────────────────────────────────────

function MapView({ groups, filter, onMarkerClick }: {
  groups: CepGroup[]
  filter: MapFilter
  onMarkerClick: (g: CepGroup) => void
}) {
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const filterInfo = FILTERS.find(f => f.key === filter)!

  useEffect(() => {
    if (!divRef.current || groups.length === 0) return
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }

    const visible = groups.filter(g => countForFilter(g, filter) > 0)
    if (visible.length === 0) return

    const center: [number, number] = [
      visible.reduce((s, p) => s + p.lat, 0) / visible.length,
      visible.reduce((s, p) => s + p.lng, 0) / visible.length,
    ]
    const map = L.map(divRef.current).setView(center, 15)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)

    visible.forEach(g => {
      const count = countForFilter(g, filter)
      const radius = 12 + Math.min(Math.sqrt(count) * 5, 28)
      const circle = L.circleMarker([g.lat, g.lng], {
        radius,
        color: filterInfo.color,
        fillColor: filterInfo.color,
        fillOpacity: 0.75,
        weight: 2,
      })
      circle.bindTooltip(
        `<b>${g.street || g.cep}</b><br/>${count} morador(es)`,
        { permanent: false, direction: 'top', className: 'text-xs' }
      )
      circle.on('click', () => onMarkerClick(g))
      circle.addTo(map)
    })

    return () => { map.remove(); mapRef.current = null }
  }, [groups, filter])

  return <div ref={divRef} className="w-full h-full" />
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props { onClose: () => void }

export function MapaMoradores({ onClose }: Props) {
  const color = SECTOR_COLORS.moradores
  const [groups, setGroups] = useState<CepGroup[]>([])
  const [delinquentIds, setDelinquentIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [filter, setFilter] = useState<MapFilter>('todos')
  const [selected, setSelected] = useState<CepGroup | null>(null)
  const [sheetFilter, setSheetFilter] = useState<MapFilter>('todos')

  const load = async () => {
    setLoading(true)
    setProgress(0)
    setGroups([])

    try {
      // Carrega residentes e inadimplentes em paralelo
      const [residentsRes, delinqRes] = await Promise.all([
        api.get<Resident[]>('/residents', { params: { status: 'active' } }),
        api.get<{ resident_id: string }[]>('/mensalidades/delinquent').catch(() => ({ data: [] })),
      ])

      const allResidents = residentsRes.data
      const dIds = new Set(delinqRes.data.map((d: any) => d.resident_id ?? d.id))
      setDelinquentIds(dIds)

      // Agrupa por CEP
      const byCep = new Map<string, Resident[]>()
      for (const r of allResidents) {
        if (!r.address_cep) continue
        const c = r.address_cep.replace(/\D/g, '')
        if (!c) continue
        if (!byCep.has(c)) byCep.set(c, [])
        byCep.get(c)!.push(r)
      }

      const cepEntries = Array.from(byCep.entries())
      const resolved: CepGroup[] = []
      const BATCH = 4

      for (let i = 0; i < cepEntries.length; i += BATCH) {
        const batch = cepEntries.slice(i, i + BATCH)
        const geos = await Promise.all(batch.map(([cep, rs]) => {
          const street = rs[0]?.address_street ?? ''
          return geocodeCep(cep, street).then(geo => geo ? { cep, residents: rs, geo, street } : null)
        }))
        for (const item of geos) {
          if (!item) continue
          const { cep, residents: rs, geo, street } = item
          resolved.push({
            cep, street,
            lat: geo.lat, lng: geo.lng,
            residents: rs,
            total: rs.length,
            members:      rs.filter(r => r.type === 'member').length,
            guests:       rs.filter(r => r.type === 'guest').length,
            delinquents:  rs.filter(r => dIds.has(r.id)).length,
            semInternet:  rs.filter(r => !r.internet_access || r.internet_access === 'nenhum' || r.internet_access === 'Nenhum').length,
            problemas:    rs.filter(r => (r.neighborhood_problems ?? []).length > 0).length,
          })
        }
        setProgress(Math.round(Math.min((i + BATCH) / cepEntries.length * 100, 100)))
      }

      setGroups(resolved)
    } catch { /* silent */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleMarkerClick = (g: CepGroup) => {
    setSelected(g)
    setSheetFilter('todos')
  }

  const activeFilter = FILTERS.find(f => f.key === filter)!
  const sheetResidents = selected
    ? selected.residents.filter(r => residentsForFilter(r, sheetFilter, delinquentIds))
    : []

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 text-white shrink-0"
        style={{ backgroundColor: color, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-white/10">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold text-base flex-1">Mapa de Moradores</span>
        {!loading && (
          <button onClick={load} className="p-2 rounded-lg hover:bg-white/10">
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Chips de filtro do mapa */}
      {!loading && (
        <div className="flex gap-2 px-4 py-2.5 overflow-x-auto bg-white border-b border-gray-100 shrink-0 scrollbar-none">
          {FILTERS.map(f => {
            const count = groups.reduce((s, g) => s + countForFilter(g, f.key), 0)
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition"
                style={filter === f.key
                  ? { backgroundColor: f.color, borderColor: f.color, color: 'white' }
                  : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#374151' }
                }>
                {f.label}
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                  style={filter === f.key ? { backgroundColor: 'rgba(255,255,255,0.25)' } : { backgroundColor: '#f3f4f6' }}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500 p-8">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: color }} />
          <p className="text-sm">Carregando moradores… {progress}%</p>
          <div className="w-48 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: color }} />
          </div>
        </div>
      )}

      {/* Sem dados */}
      {!loading && groups.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-400 p-8">
          <p className="text-sm text-center">Nenhum morador com endereço cadastrado.</p>
          <button onClick={load} className="text-sm font-semibold underline mt-2" style={{ color }}>
            Tentar novamente
          </button>
        </div>
      )}

      {/* Mapa */}
      {!loading && groups.length > 0 && (
        <div className="flex-1 relative overflow-hidden">
          {groups.filter(g => countForFilter(g, filter) > 0).length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              Nenhum morador nesta categoria.
            </div>
          ) : (
            <MapView groups={groups} filter={filter} onMarkerClick={handleMarkerClick} />
          )}
          {/* Legenda */}
          <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 rounded-xl shadow px-3 py-2 text-xs text-gray-600 pointer-events-none">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: activeFilter.color }} />
              <span className="font-semibold">{activeFilter.label}</span>
            </div>
            <p className="text-gray-400 mt-0.5">Toque para ver moradores</p>
          </div>
        </div>
      )}

      {/* Bottom sheet — moradores da rua */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-white rounded-t-2xl w-full max-h-[70vh] flex flex-col"
            onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>

            {/* Sheet header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
              <div>
                <p className="font-semibold text-gray-900 text-sm">{selected.street || selected.cep}</p>
                <p className="text-xs text-gray-400">CEP {selected.cep} · {selected.total} morador(es)</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 text-2xl leading-none">×</button>
            </div>

            {/* Chips de filtro da rua */}
            <div className="flex gap-2 px-4 py-2 overflow-x-auto shrink-0 scrollbar-none border-b border-gray-50">
              {FILTERS.map(f => {
                const count = selected.residents.filter(r => residentsForFilter(r, f.key, delinquentIds)).length
                if (count === 0 && f.key !== 'todos') return null
                return (
                  <button key={f.key} onClick={() => setSheetFilter(f.key)}
                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border-2 transition"
                    style={sheetFilter === f.key
                      ? { backgroundColor: f.color, borderColor: f.color, color: 'white' }
                      : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#374151' }
                    }>
                    {f.label} <span className="font-bold">{count}</span>
                  </button>
                )
              })}
            </div>

            {/* Lista */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {sheetResidents.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">Nenhum morador nesta categoria.</p>
              )}
              {sheetResidents.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
                    style={{ backgroundColor: r.type === 'member' ? '#0f7a4d' : r.type === 'guest' ? '#c2620a' : '#1a3f6f' }}>
                    {r.full_name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-gray-800 truncate">{r.full_name}</p>
                      {delinquentIds.has(r.id) && (
                        <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-semibold shrink-0">Inad.</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {r.type === 'member' ? 'Associado' : r.type === 'guest' ? 'Visitante' : 'Dependente'}
                      {r.unit ? ` · Apto ${r.unit}` : ''}
                      {r.phone_primary ? ` · ${r.phone_primary}` : ''}
                    </p>
                    {(r.neighborhood_problems ?? []).length > 0 && (
                      <p className="text-[10px] text-amber-600 mt-0.5 truncate">
                        ⚠ {r.neighborhood_problems.slice(0, 2).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
