export const SECTOR_COLORS = {
  caixa:      '#0f7a4d',
  encomendas: '#c2620a',
  moradores:  '#1a3f6f',
  ordens:     '#6d28d9',
  chat:       '#0d7490',
  config:     '#475569',
} as const

export type Sector = keyof typeof SECTOR_COLORS
