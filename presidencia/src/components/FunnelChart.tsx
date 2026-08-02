interface FunnelStage {
  label: string
  value: number
}

interface FunnelChartProps {
  title: string
  stages: FunnelStage[]
  legenda?: string
}

// Rampa violeta sequencial claro->escuro por etapa (maior->menor), spec §Componentes.
const RAMPA = ['#A594F5', '#7C6DEC', '#4F3FE0', '#241259']

export function FunnelChart({ title, stages, legenda }: FunnelChartProps) {
  const max = Math.max(1, ...stages.map((s) => s.value))

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {legenda && <p className="mt-0.5 text-[11px] text-ink-muted">{legenda}</p>}
      <div className="mt-3 space-y-1.5">
        {stages.map((stage, i) => {
          const widthPct = Math.max(18, (stage.value / max) * 100)
          // "% do total" (proporcao), nao "taxa de conversao" -- visitante nao
          // vira associado com o tempo, sao categorias distintas de morador,
          // nao um funil temporal. Rotular como "conversao" seria enganoso.
          const propDoTotal = max > 0 ? (stage.value / max) * 100 : null
          return (
            <div key={stage.label} className="flex items-center gap-2">
              <div className="flex-1">
                <div
                  className="flex h-9 items-center justify-between rounded-md px-3 text-white transition-all"
                  style={{ width: `${widthPct}%`, backgroundColor: RAMPA[Math.min(i, RAMPA.length - 1)], minWidth: '160px' }}
                >
                  <span className="text-xs font-medium">{stage.label}</span>
                  <span className="text-sm font-bold">{stage.value.toLocaleString('pt-BR')}</span>
                </div>
              </div>
              <span className="w-14 shrink-0 text-right text-[11px] font-medium text-ink-muted">
                {propDoTotal !== null ? `${propDoTotal.toFixed(0)}%` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
