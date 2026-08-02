import { useEffect, useState } from 'react'
import { useUnidade } from './UnidadeContext'
import { usePeriodo } from './PeriodoContext'
import { nomeAssociacaoFor } from './unidade'
import type { FreshnessInfo } from './api'

export function usePresidenciaData<T>(
  fetchFn: (unidade?: string | null, periodo?: string, ate?: string) => Promise<FreshnessInfo & { data: T }>,
) {
  const [data, setData] = useState<T | null>(null)
  const [freshness, setFreshness] = useState<FreshnessInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { unidade } = useUnidade()
  const { periodo, ate } = usePeriodo()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchFn(nomeAssociacaoFor(unidade), periodo, ate)
      .then((res) => {
        if (cancelled) return
        setData(res.data)
        setFreshness({ generated_at: res.generated_at, stale: res.stale })
      })
      .catch((err) => {
        if (cancelled) return
        const status = err?.response?.status
        const detail = err?.response?.data?.detail
        setError(status ? `Erro ${status}${detail ? `: ${detail}` : ''}` : `Falha de rede: ${err?.message ?? 'desconhecida'}`)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [unidade, periodo, ate])

  return { data, freshness, error, loading }
}

/** Variante pra telas informacionais/snapshot que nao usam o filtro global de
 * periodo do header (ex.: Moradores) -- so' refaz o fetch quando a unidade muda. */
export function usePresidenciaDataSemPeriodo<T>(
  fetchFn: (unidade?: string | null) => Promise<FreshnessInfo & { data: T }>,
) {
  const [data, setData] = useState<T | null>(null)
  const [freshness, setFreshness] = useState<FreshnessInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { unidade } = useUnidade()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchFn(nomeAssociacaoFor(unidade))
      .then((res) => {
        if (cancelled) return
        setData(res.data)
        setFreshness({ generated_at: res.generated_at, stale: res.stale })
      })
      .catch((err) => {
        if (cancelled) return
        const status = err?.response?.status
        const detail = err?.response?.data?.detail
        setError(status ? `Erro ${status}${detail ? `: ${detail}` : ''}` : `Falha de rede: ${err?.message ?? 'desconhecida'}`)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [unidade])

  return { data, freshness, error, loading }
}
