import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser'
import { X, Camera } from 'lucide-react'

interface BarcodeScannerProps {
  onScan: (code: string) => void
  onClose: () => void
}

export function BarcodeScannerModal({ onScan, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(true)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()

    reader.decodeFromVideoDevice(undefined, videoRef.current!, (result, err, controls) => {
      controlsRef.current = controls
      if (result) {
        setScanning(false)
        controls.stop()
        onScan(result.getText())
      }
      if (err && err.name !== 'NotFoundException' && err.name !== 'ChecksumException' && err.name !== 'FormatException') {
        setError('Não foi possível acessar a câmera.')
      }
    }).catch(() => {
      setError('Permissão de câmera negada ou dispositivo não disponível.')
    })

    return () => {
      controlsRef.current?.stop()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80">
      <div className="relative w-full max-w-sm mx-4">
        <button
          onClick={() => { controlsRef.current?.stop(); onClose() }}
          className="absolute top-3 right-3 z-10 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="bg-black rounded-2xl overflow-hidden shadow-2xl">
          <div className="relative">
            <video ref={videoRef} className="w-full" style={{ aspectRatio: '1/1', objectFit: 'cover' }} />
            {/* Scan overlay */}
            {scanning && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-52 h-32 border-2 border-white/80 rounded-lg relative">
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-[#26619c] rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-[#26619c] rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-[#26619c] rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-[#26619c] rounded-br-lg" />
                  {/* Scan line animation */}
                  <div className="absolute inset-x-0 top-1/2 h-0.5 bg-[#26619c]/70 animate-pulse" />
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-4 text-center">
            {error ? (
              <p className="text-red-400 text-sm">{error}</p>
            ) : (
              <>
                <Camera className="w-5 h-5 text-white/50 mx-auto mb-1" />
                <p className="text-white text-sm">Aponte a câmera para o código de barras da etiqueta</p>
                <p className="text-white/40 text-xs mt-1">O código será lido automaticamente</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
