import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser'
import { DecodeHintType, BarcodeFormat } from '@zxing/library'
import { X, Camera, Zap, ZapOff } from 'lucide-react'

export type ScanMode = 'barcode' | 'qrcode'

interface BarcodeScannerProps {
  onScan: (code: string) => void
  onClose: () => void
  scanMode?: ScanMode
}

const SCAN_ERRORS = new Set(['NotFoundException', 'ChecksumException', 'FormatException', 'ReedSolomonException'])

const barcodeHints = new Map()
barcodeHints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF,
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
])
barcodeHints.set(DecodeHintType.TRY_HARDER, true)

const qrcodeHints = new Map()
qrcodeHints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.AZTEC,
])
qrcodeHints.set(DecodeHintType.TRY_HARDER, true)

export function BarcodeScannerModal({ onScan, onClose, scanMode = 'barcode' }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(true)
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader(scanMode === 'qrcode' ? qrcodeHints : barcodeHints)

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        streamRef.current = stream

        const track = stream.getVideoTracks()[0]
        const caps = track.getCapabilities() as any
        if (caps.torch) setTorchAvailable(true)

        const controls = await reader.decodeFromStream(stream, videoRef.current!, (result, err) => {
          if (result) {
            setScanning(false)
            controls.stop()
            stream.getTracks().forEach((t) => t.stop())
            onScan(result.getText())
            return
          }
          if (err && !SCAN_ERRORS.has(err.name)) {
            if (err.name === 'NotAllowedError') {
              setError('Permissão de câmera negada. Permita o acesso nas configurações.')
              controls.stop()
            } else if (err.name === 'NotFoundError') {
              setError('Nenhuma câmera encontrada neste dispositivo.')
              controls.stop()
            } else if (err.name === 'NotReadableError' || err.name === 'AbortError') {
              setError('Câmera em uso por outro aplicativo.')
              controls.stop()
            }
          }
        })
        controlsRef.current = controls
      } catch (err: any) {
        if (err?.name === 'NotAllowedError') {
          setError('Permissão de câmera negada. Permita o acesso nas configurações.')
        } else if (err?.name === 'NotFoundError') {
          setError('Nenhuma câmera encontrada neste dispositivo.')
        } else {
          setError('Não foi possível acessar a câmera.')
        }
      }
    }

    start()

    return () => {
      controlsRef.current?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as any] })
      setTorchOn((v) => !v)
    } catch {
      setTorchAvailable(false)
    }
  }

  const handleClose = () => {
    controlsRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80">
      <div className="relative w-full max-w-sm mx-4">
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 z-10 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {torchAvailable && (
          <button
            onClick={toggleTorch}
            className={`absolute top-3 left-3 z-10 rounded-full p-1.5 transition ${
              torchOn ? 'bg-yellow-400 text-black' : 'bg-black/60 text-white hover:bg-black/80'
            }`}
          >
            {torchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
          </button>
        )}

        <div className="bg-black rounded-2xl overflow-hidden shadow-2xl">
          <div className="relative">
            <video
              ref={videoRef}
              className="w-full"
              style={{ aspectRatio: '1/1', objectFit: 'cover' }}
              autoPlay
              muted
              playsInline
            />
            {scanning && !error && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className={`border-2 border-white/80 rounded-lg relative ${scanMode === 'qrcode' ? 'w-48 h-48' : 'w-52 h-32'}`}>
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-[#26619c] rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-[#26619c] rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-[#26619c] rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-[#26619c] rounded-br-lg" />
                  {scanMode !== 'qrcode' && <div className="absolute inset-x-0 top-1/2 h-0.5 bg-[#26619c]/70 animate-pulse" />}
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
                <p className="text-white text-sm">{scanMode === 'qrcode' ? 'Aponte para o QR Code' : 'Aponte para o código de barras da etiqueta'}</p>
                <p className="text-white/40 text-xs mt-1">O código será lido automaticamente</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
