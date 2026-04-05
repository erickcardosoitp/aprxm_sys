import { useRef, useState, useEffect } from 'react'
import ReactSignatureCanvas from 'react-signature-canvas'
import { Check, RotateCcw, PenLine } from 'lucide-react'

interface SignaturePadProps {
  label?: string
  onSave: (dataUrl: string) => void
  onClear?: () => void
  onUpload?: (dataUrl: string) => Promise<string>
}

export function SignaturePad({ label = 'Assinatura', onSave, onClear, onUpload }: SignaturePadProps) {
  const canvasRef = useRef<ReactSignatureCanvas>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isEmpty, setIsEmpty] = useState(true)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current?.getCanvas()
      const container = containerRef.current
      if (!canvas || !container) return
      const ratio = window.devicePixelRatio || 1
      const w = container.clientWidth
      canvas.width = w * ratio
      canvas.height = 150 * ratio
      canvas.style.width = `${w}px`
      canvas.style.height = '150px'
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(ratio, ratio)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [editing])

  const handleSave = async () => {
    const pad = canvasRef.current
    if (!pad || pad.isEmpty()) return
    setSaved(false)
    setUploading(true)
    try {
      const dataUrl = pad.getTrimmedCanvas().toDataURL('image/png')
      let finalUrl = dataUrl
      if (onUpload) {
        finalUrl = await onUpload(dataUrl)
      }
      onSave(finalUrl)
      setPreviewUrl(finalUrl)
      setSaved(true)
      setEditing(false)
    } finally {
      setUploading(false)
    }
  }

  const handleClear = () => {
    canvasRef.current?.clear()
    setSaved(false)
    setIsEmpty(true)
    setPreviewUrl(null)
    setEditing(false)
    onClear?.()
  }

  // If saved and not editing, show preview
  if (saved && previewUrl && !editing) {
    return (
      <div className="flex flex-col gap-2">
        {label && <p className="text-xs font-medium text-gray-600">{label}</p>}
        <div className="relative border-2 border-green-400 rounded-lg overflow-hidden bg-white">
          <img
            src={previewUrl}
            alt="Assinatura"
            className="w-full h-[100px] object-contain bg-white"
          />
          <div className="absolute top-2 right-2 bg-green-500 text-white rounded-full p-0.5">
            <Check className="w-3 h-3" />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center justify-center gap-1.5 flex-1 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Limpar
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center justify-center gap-1.5 flex-1 py-2 text-sm rounded-lg border border-[#26619c] text-[#26619c] hover:bg-blue-50 transition"
          >
            <PenLine className="w-3.5 h-3.5" />
            Refazer
          </button>
        </div>
        <p className="text-xs text-green-600 flex items-center gap-1">
          <Check className="w-3 h-3" /> Assinatura confirmada
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {label && <p className="text-xs font-medium text-gray-600">{label}</p>}

      <div
        ref={containerRef}
        className={`relative border-2 rounded-lg overflow-hidden bg-white transition ${
          saved ? 'border-green-400' : isEmpty ? 'border-dashed border-gray-300' : 'border-[#26619c]/40'
        }`}
        style={{ touchAction: 'none' }}
      >
        <ReactSignatureCanvas
          ref={canvasRef}
          canvasProps={{
            style: { display: 'block', width: '100%', height: '150px', touchAction: 'none' },
          }}
          penColor="#1e293b"
          onBegin={() => { setSaved(false); setIsEmpty(false) }}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-xs text-gray-400">Assine aqui</p>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center justify-center gap-1.5 flex-1 py-2.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Limpar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isEmpty || uploading}
          className="flex items-center justify-center gap-1.5 flex-1 py-2.5 text-sm rounded-lg bg-[#26619c] hover:bg-[#1a4f87] text-white transition disabled:opacity-40 active:bg-[#1a4f87]"
        >
          <Check className="w-3.5 h-3.5" />
          {uploading ? 'Salvando…' : 'Confirmar'}
        </button>
      </div>

      {!saved && !isEmpty && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          ⚠ Clique em "Confirmar" para salvar a assinatura
        </p>
      )}
    </div>
  )
}
