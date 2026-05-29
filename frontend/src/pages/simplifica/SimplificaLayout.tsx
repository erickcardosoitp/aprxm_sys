import { Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useEffect } from 'react'

export default function SimplificaLayout() {
  const simplificaEnabled = useAuthStore((s) => s.simplificaEnabled)
  const navigate = useNavigate()

  useEffect(() => {
    if (simplificaEnabled === false) navigate('/', { replace: true })
  }, [simplificaEnabled])

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Outlet />
    </div>
  )
}
