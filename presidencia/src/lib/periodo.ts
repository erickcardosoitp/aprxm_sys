export type PeriodoKey = 'mes' | 'trimestre' | 'semestre' | 'ano'

export const PERIODOS: { key: PeriodoKey; label: string }[] = [
  { key: 'mes', label: 'Mês' },
  { key: 'trimestre', label: 'Trimestre' },
  { key: 'semestre', label: 'Semestre' },
  { key: 'ano', label: 'Ano' },
]
