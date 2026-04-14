import { useRef, useState, useEffect } from 'react'
import { Camera, FolderOpen, X, ZapOff } from 'lucide-react'

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'idle' | 'choose' | 'camera'>('idle')
  const [camError, setCamError] = useState(false)

  // Start camera stream
  useEffect(() => {
    if (mode !== 'camera') return
    setCamError(false)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      })
      .catch(() => setCamError(true))

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [mode])

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setMode('idle')
    setCamError(false)
  }

  const captureFrame = async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    stopCamera()
    setLoading(true)
    try {
      const blob = await new Promise<Blob>((res) =>
        canvas.toBlob((b) => res(b!), 'image/jpeg', 0.9)
      )
      const file = new File([blob], `foto_${Date.now()}.jpg`, { type: 'image/jpeg' })
      await processFile(file)
    } finally {
      setLoading(false)
    }
  }

  const processFile = async (file: File) => {
    setLoading(true)
    try {
      const url = onUpload ? await onUpload(file) : URL.createObjectURL(file)
      setPreview(url)
      onCapture({ url, label, taken_at: new Date().toISOString() })
    } finally {
      setLoading(false)
      setMode('idle')
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  if (preview) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <div className="relative w-full h-40 rounded-lg overflow-hidden border border-gray-200">
          <img src={preview} alt={label} className="w-full h-full object-cover" />
          <button type="button" onClick={() => setPreview(null)}
            className="absolute top-2 right-2 bg-white/80 rounded-full p-1 hover:bg-white">
            <X className="w-4 h-4 text-gray-700" />
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'camera') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {camError ? (
          <div className="flex flex-col items-center gap-3 p-6 border-2 border-dashed border-red-300 rounded-lg text-red-500">
            <ZapOff className="w-8 h-8" />
            <p className="text-sm text-center">Câmera não disponível.<br />Use a opção de arquivo.</p>
            <button type="button" onClick={() => { setMode('choose'); setCamError(false) }}
              className="text-xs underline text-red-400">Voltar</button>
          </div>
        ) : (
          <div className="relative w-full rounded-lg overflow-hidden border border-gray-200 bg-black">
            <video ref={videoRef} className="w-full h-48 object-cover" playsInline muted autoPlay />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-3">
              <button type="button" onClick={stopCamera}
                className="bg-white/80 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-white">
                Cancelar
              </button>
              <button type="button" onClick={captureFrame} disabled={loading}
                className="bg-[#26619c] text-white px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-[#1a4f87] disabled:opacity-50">
                {loading ? 'Enviando…' : 'Capturar'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (mode === 'choose') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMode('camera')}
            className="flex flex-col items-center justify-center gap-2 h-28 border-2 border-dashed border-[#26619c]/50 rounded-xl text-[#26619c] hover:bg-blue-50 transition">
            <Camera className="w-7 h-7" />
            <span className="text-xs font-medium">Câmera</span>
          </button>
          <button type="button" onClick={() => { setMode('idle'); fileInputRef.current?.click() }}
            className="flex flex-col items-center justify-center gap-2 h-28 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:bg-gray-50 transition">
            <FolderOpen className="w-7 h-7" />
            <span className="text-xs font-medium">Arquivo</span>
          </button>
        </div>
        <button type="button" onClick={() => setMode('idle')}
          className="text-xs text-gray-400 hover:text-gray-600 text-center">Cancelar</button>
        <input ref={fileInputRef} type="file" accept="image/*"
          className="hidden" onChange={handleFileChange} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-gray-700">{label}</p>
      <button type="button" onClick={() => setMode('choose')} disabled={loading}
        className="w-full h-40 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-[#26619c]/50 hover:text-[#26619c] transition">
        <Camera className="w-8 h-8" />
        <span className="text-sm">{loading ? 'Enviando…' : 'Tirar/Selecionar foto'}</span>
      </button>
    </div>
  )
}
