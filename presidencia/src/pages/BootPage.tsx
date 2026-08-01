import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInicio } from '../lib/api'
import { setInicioCache } from '../lib/prefetchCache'

const LABELS = [
  'Carregando moradores...',
  'Carregando financeiro...',
  'Carregando pacotes e ordens de serviço...',
  'Consolidando indicadores...',
]

export function BootPage() {
  const [labelIndex, setLabelIndex] = useState(0)
  const [done, setDone] = useState(false)
  const navigate = useNavigate()
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const tick = setInterval(() => {
      setLabelIndex((i) => (i < LABELS.length - 1 ? i + 1 : i))
    }, 700)

    getInicio()
      .then((res) => setInicioCache(res))
      .catch(() => {})
      .finally(() => {
        clearInterval(tick)
        setDone(true)
        setTimeout(() => navigate('/inicio', { replace: true }), 300)
      })

    return () => clearInterval(tick)
  }, [navigate])

  const progress = done ? 100 : Math.round(((labelIndex + 1) / LABELS.length) * 90)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-marque-900 p-4">
      <img src="/logo.png" alt="APRXM" className="h-10 w-auto object-contain" />
      <div className="w-full max-w-xs">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-marque-300 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-3 text-center text-sm text-marque-300/80">{LABELS[labelIndex]}</p>
      </div>
    </div>
  )
}
