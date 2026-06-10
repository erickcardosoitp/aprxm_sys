interface LoadingScreenProps {
  message?: string
  color?: string
}

export default function LoadingScreen({ message, color = '#1a1a2e' }: LoadingScreenProps) {
  return (
    <div
      className="fixed inset-0 z-[999] flex flex-col items-center justify-center gap-4"
      style={{ backgroundColor: color }}
    >
      <img src="/logo.png" alt="APRXM" className="h-12 w-auto object-contain" />
      <div className="w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      {message && (
        <p className="text-white/60 text-xs animate-pulse">{message}</p>
      )}
    </div>
  )
}
