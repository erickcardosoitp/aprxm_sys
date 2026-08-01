export type UnidadeKey = 'todos' | 'congonha' | 'vaz_lobo'

export const UNIDADES: { key: UnidadeKey; label: string; nomeAssociacao: string | null }[] = [
  { key: 'todos', label: 'Todos', nomeAssociacao: null },
  { key: 'congonha', label: 'Congonha', nomeAssociacao: 'Associação de Moradores de Congonha' },
  { key: 'vaz_lobo', label: 'Vaz Lobo', nomeAssociacao: 'Associação de Moradores de Vaz Lobo' },
]

export function nomeAssociacaoFor(key: UnidadeKey): string | null {
  return UNIDADES.find((u) => u.key === key)?.nomeAssociacao ?? null
}
