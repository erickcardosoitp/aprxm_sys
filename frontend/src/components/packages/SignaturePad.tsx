import { useRef } from 'react'
import ReactSignatureCanvas from 'react-signature-canvas'

interface SignaturePadProps {
  onSave: (dataUrl: string) => void
  onClear?: () => void
}

export function SignaturePad({ onSave, onClear }: SignaturePadProps) {
  const canvasRef = useRef<ReactSignatureCanvas>(null)

  const handleSave = () => {
    if (!canvasRef.current || canvasRef.current.isEmpty()) return
    const dataUrl = canvasRef.current.getTrimmedCanvas().toDataURL('image/png')
    onSave(dataUrl)
  }

  const handleClear = () => {
    canvasRef.current?.clear()
    onClear?.()
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-gray-700">Assinatura do Recebedor</p>
      <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden bg-white">
        <ReactSignatureCanvas
          ref={canvasRef}
          canvasProps={{
            className: 'w-full',
            style: { width: '100%', height: '160px', touchAction: 'none' },
          }}
          penColor="#1e293b"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleClear}
          className="flex-1 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
        >
          Limpar
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition"
        >
          Confirmar Assinatura
        </button>
      </div>
    </div>
  )
}
