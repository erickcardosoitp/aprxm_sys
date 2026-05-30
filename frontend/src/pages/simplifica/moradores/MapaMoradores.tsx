import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, RefreshCw, Users } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import api from '../../../services/api'
import { SECTOR_COLORS } from '../theme'
import type { Resident } from '../../../types'

interface MapPoint {
  cep: string
  street: string
  members: number
  guests: number
  lat: number
  lng: number
}

interface StreetSheet {
  street: string
  cep: string
  total: number
  residents: Resident[]
}

async function geocodeCep(cep: string): Promise<{ lat: number; lng: number } | null> {
  const clean = cep.replace(/\D/g, '')
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`)
    if (!r.ok) return null
    const d = await r.json()
    const lat = d?.location?.coordinates?.latitude
    const lng = d?.location?.coordinates?.longitude
    if (!lat || !lng) return null
    return { lat: parseFloat(lat), lng: parseFloat(lng) }
  } catch { return null }
}

function MapView({ points, onStreetClick }: { points: MapPoint[]; onStreetClick: (p: MapPoint) => void }) {
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const color = SECTOR_COLORS.moradores

  useEffect(() => {
    if (!divRef.current || points.length === 0) return
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }

    const center: [number, number] = [
      points.reduce((s, p) => s + p.lat, 0) / points.length,
      points.reduce((s, p) => s + p.lng, 0) / points.length,
    ]
    const map = L.map(divRef.current, { zoomControl: true }).setView(center, 15)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    points.forEach(p => {
      const total = p.members + p.guests
      const radius = 12 + Math.min(Math.sqrt(total) * 4, 30)
      const circle = L.circleMarker([p.lat, p.lng], {
        radius,
        color: color,
        fillColor: color,
        fillOpacity: 0.75,
        weight: 2,
      })
      circle.bindTooltip(
        `<b>${p.street || p.cep}</b><br/>${total} morador(es)`,
        { permanent: false, direction: 'top' }
      )
      circle.on('click', () => onStreetClick(p))
      circle.addTo(map)

      // Label com o número
      L.divIcon({
        html: `<div style="color:white;font-size:11px;font-weight:bold;text-align:center;line-height:${radius * 2}px">${total}</div>`,
        iconSize: [radius * 2, radius * 2],
        iconAnchor: [radius, radius],
        className: '',
      })
    })

    return () => { map.remove(); mapRef.current = null }
  }, [points])

  return <div ref={divRef} className="w-full h-full" />
}

interface Props { onClose: () => void }

export function MapaMoradores({ onClose }: Props) {
  const color = SECTOR_COLORS.moradores
  const [points, setPoints] = useState<MapPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [sheet, setSheet] = useState<StreetSheet | null>(null)
  const [loadingResidents, setLoadingResidents] = useState(false)

  const load = async () => {
    setLoading(true)
    setProgress(0)
    setPoints([])
    try {
      const res = await api.get<{ cep: string; street: string; members: number; guests: number }[]>('/residents/map-data')
      const data = res.data.filter(d => d.cep)
      const resolved: MapPoint[] = []

      // Geocodifica em lotes de 4 em paralelo
      const BATCH = 4
      for (let i = 0; i < data.length; i += BATCH) {
        const batch = data.slice(i, i + BATCH)
        const geos = await Promise.all(batch.map(d => geocodeCep(d.cep)))
        batch.forEach((d, j) => {
          if (geos[j]) resolved.push({ ...d, ...geos[j]! })
        })
        setProgress(Math.round(Math.min((i + BATCH) / data.length * 100, 100)))
      }
      setPoints(resolved)
    } catch { /* silent */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleStreetClick = async (p: MapPoint) => {
    setSheet({ street: p.street || p.cep, cep: p.cep, total: p.members + p.guests, residents: [] })
    setLoadingResidents(true)
    try {
      const r = await api.get<Resident[]>('/residents', { params: { cep: p.cep } })
      setSheet(s => s ? { ...s, residents: r.data } : null)
    } catch { /* silent */ } finally { setLoadingResidents(false) }
  }

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

      {/* Loading */}
      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500 p-8">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: color }} />
          <p className="text-sm">Geocodificando endereços… {progress}%</p>
          <div className="w-48 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: color }} />
          </div>
        </div>
      )}

      {/* Sem dados */}
      {!loading && points.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-400 p-8">
          <Users className="w-12 h-12" />
          <p className="text-sm text-center">Nenhum morador com endereço cadastrado encontrado.</p>
          <button onClick={load} className="text-sm font-semibold underline mt-2" style={{ color }}>Tentar novamente</button>
        </div>
      )}

      {/* Mapa */}
      {!loading && points.length > 0 && (
        <div className="flex-1 relative">
          <MapView points={points} onStreetClick={handleStreetClick} />

          {/* Legenda */}
          <div className="absolute bottom-4 left-4 z-[1000] bg-white/90 rounded-xl shadow px-3 py-2 text-xs text-gray-600">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span>= 1 rua</span>
            </div>
            <p className="text-gray-400">Toque para ver moradores</p>
          </div>
        </div>
      )}

      {/* Sheet de rua selecionada */}
      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setSheet(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-white rounded-t-2xl w-full max-h-[60vh] flex flex-col"
            onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <p className="font-semibold text-gray-900 text-sm">{sheet.street}</p>
                <p className="text-xs text-gray-400">{sheet.total} morador(es) · CEP {sheet.cep}</p>
              </div>
              <button onClick={() => setSheet(null)} className="text-gray-400 text-xl">×</button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {loadingResidents && (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: color }} />
                </div>
              )}
              {!loadingResidents && sheet.residents.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, white)` }}>
                    <span className="text-xs font-bold" style={{ color }}>{r.full_name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{r.full_name}</p>
                    <p className="text-xs text-gray-500">
                      {r.type === 'member' ? 'Associado' : r.type === 'dependent' ? 'Dependente' : 'Visitante'}
                      {r.unit ? ` · Casa/Apto ${r.unit}` : ''}
                      {r.phone_primary ? ` · ${r.phone_primary}` : ''}
                    </p>
                  </div>
                </div>
              ))}
              {!loadingResidents && sheet.residents.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">Nenhum morador encontrado para este CEP.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
