import type { FreshnessInfo, InicioData } from './api'

let cached: (FreshnessInfo & { data: InicioData }) | null = null

export function setInicioCache(value: FreshnessInfo & { data: InicioData }) {
  cached = value
}

export function takeInicioCache(): (FreshnessInfo & { data: InicioData }) | null {
  const v = cached
  cached = null
  return v
}
