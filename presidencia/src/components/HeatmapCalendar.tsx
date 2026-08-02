import { useMemo } from 'react'

export interface HeatmapPonto {
  data: string
  valor: number
}

interface HeatmapCalendarProps {
  serie: HeatmapPonto[]
  periodo: string
  formatter?: (v: number) => string
}

function formatBRLDefault(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

// Rampa violeta sequencial (pres-100 -> pres-900) calibrada contra a MEDIA
// historica do indicador, nao o min/max so' do mes visivel -- um dia "bom" em
// julho le a mesma intensidade que um dia "bom" em agosto.
const RAMPA = ['#F4F1FD', '#D9D0FA', '#A594F5', '#4F3FE0', '#241259']

function corPara(valor: number, media: number): string {
  if (media <= 0) return RAMPA[0]
  const razao = valor / media
  if (razao <= 0.1) return RAMPA[0]
  if (razao < 0.6) return RAMPA[1]
  if (razao < 1.0) return RAMPA[2]
  if (razao < 1.6) return RAMPA[3]
  return RAMPA[4]
}

export function HeatmapCalendar({ serie, periodo, formatter = formatBRLDefault }: HeatmapCalendarProps) {
  const media = useMemo(() => {
    if (serie.length === 0) return 0
    return serie.reduce((a, p) => a + p.valor, 0) / serie.length
  }, [serie])

  const porData = useMemo(() => {
    const m = new Map<string, number>()
    serie.forEach((p) => m.set(p.data, p.valor))
    return m
  }, [serie])

  if (serie.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">Calendário de calor — receita por dia</h2>
        <p className="text-sm text-ink-muted">Sem dados no período</p>
      </div>
    )
  }

  const datas = serie.map((p) => new Date(p.data + 'T00:00:00'))
  const meses = Array.from(new Set(datas.map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`))).sort()

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Calendário de calor — receita por dia</h2>
        <span className="text-[11px] text-ink-muted">média do período: {formatter(media)}</span>
      </div>

      {periodo === 'mes' ? (
        <CalendarioMensal mes={meses[0]} porData={porData} media={media} formatter={formatter} />
      ) : (
        <div className="space-y-1.5 overflow-x-auto">
          {meses.map((mesKey) => {
            const [ano, mesNum] = mesKey.split('-').map(Number)
            const diasNoMes = new Date(ano, mesNum, 0).getDate()
            const label = new Date(ano, mesNum - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
            return (
              <div key={mesKey} className="flex items-center gap-1.5">
                <span className="w-12 shrink-0 text-[10px] capitalize text-ink-muted">{label}</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: diasNoMes }, (_, i) => {
                    const dia = i + 1
                    const key = `${mesKey}-${String(dia).padStart(2, '0')}`
                    const valor = porData.get(key)
                    return (
                      <div
                        key={key}
                        title={valor !== undefined ? `${dia}/${mesNum}: ${formatter(valor)}` : undefined}
                        className="h-3 w-3 rounded-sm"
                        style={{ backgroundColor: valor !== undefined ? corPara(valor, media) : 'var(--color-surface-muted)' }}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1 text-[10px] text-ink-muted">
        <span>menos</span>
        {RAMPA.map((c) => <span key={c} className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c }} />)}
        <span>mais</span>
      </div>
    </div>
  )
}

function CalendarioMensal({ mes, porData, media, formatter }: { mes: string; porData: Map<string, number>; media: number; formatter: (v: number) => string }) {
  const [ano, mesNum] = mes.split('-').map(Number)
  const primeiroDia = new Date(ano, mesNum - 1, 1)
  const diasNoMes = new Date(ano, mesNum, 0).getDate()
  const offset = primeiroDia.getDay()
  const celulas: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: diasNoMes }, (_, i) => i + 1)]
  while (celulas.length % 7 !== 0) celulas.push(null)

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-ink-muted">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {celulas.map((dia, i) => {
          if (dia === null) return <div key={i} />
          const key = `${mes}-${String(dia).padStart(2, '0')}`
          const valor = porData.get(key)
          return (
            <div
              key={i}
              title={valor !== undefined ? `${dia}: ${formatter(valor)}` : String(dia)}
              className="flex aspect-square items-center justify-center rounded text-[10px]"
              style={{ backgroundColor: valor !== undefined ? corPara(valor, media) : 'var(--color-surface-muted)' }}
            >
              {dia}
            </div>
          )
        })}
      </div>
    </div>
  )
}
