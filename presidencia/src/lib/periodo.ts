export type PeriodoKey = 'mes' | 'trimestre' | 'semestre' | 'ano'

export const PERIODOS: { key: PeriodoKey; label: string }[] = [
  { key: 'mes', label: 'Mês' },
  { key: 'trimestre', label: 'Trimestre' },
  { key: 'semestre', label: 'Semestre' },
  { key: 'ano', label: 'Ano' },
]

const MESES_ABREV = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
]
const MESES_CHEIO = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const MESES_POR_PERIODO: Record<PeriodoKey, number> = {
  mes: 1,
  trimestre: 3,
  semestre: 6,
  ano: 12,
}

function shiftYYYYMM(yyyymm: string, deltaMonths: number): [number, number] {
  const [y, m] = yyyymm.split('-').map(Number)
  const total = y * 12 + (m - 1) + deltaMonths
  return [Math.floor(total / 12), (total % 12) + 1]
}

export function periodoLabel(periodo: PeriodoKey, ate: string): string {
  const [y, m] = ate.split('-').map(Number)
  if (periodo === 'mes') return `${MESES_CHEIO[m - 1]} ${y}`
  if (periodo === 'ano') return `${y}`
  const n = MESES_POR_PERIODO[periodo]
  const [y0, m0] = shiftYYYYMM(ate, -(n - 1))
  return `${MESES_ABREV[m0 - 1]}-${y0} a ${MESES_ABREV[m - 1]}-${y}`
}
