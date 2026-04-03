import { useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'

interface PhotoEntry {
  url: string
  label: string
  taken_at: string
}

interface PhotoCaptureProps {
  label: string
  onCapture: (entry: PhotoEntry) => void
  onUpload?: (file: File) => Promise<string>
}

export function PhotoCapture({ label, onCapture, onUpload }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleFile = async (file: File) => {
    setLoading(true)
    try {
      let url: string
      if (onUpload) {
        url = await onUpload(file)
      } else {
        // Local preview fallback (dev only)
        url = URL.createObjectURL(file)
      }
      setPreview(url)
      onCapture({ url, label, taken_at: new Date().toISOString() })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-gray-700">{label}</p>

      {preview ? (
        <div className="relative w-full h-40 rounded-lg overflow-hidden border border-gray-200">
          <img src={preview} alt={label} className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="absolute top-2 right-2 bg-white/80 rounded-full p-1 hover:bg-white"
          >
            <X className="w-4 h-4 text-gray-700" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="w-full h-40 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-brand-500 hover:text-brand-600 transition"
        >
          <Camera className="w-8 h-8" />
          <span className="text-sm">{loading ? 'Enviando…' : 'Tirar/Selecionar foto'}</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />
    </div>
  )
}
