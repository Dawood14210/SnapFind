import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabase } from '@/api/client'
import { submitSnapshot } from '@/api'
import type { SubmitSnapshotResult } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import { STORAGE_BUCKET } from '@shared/constants'

interface CameraCaptureProps {
  roomId: string
  windowIndex: number
  /** Task id for photo tasks (bonus window 0); null for regular windows. */
  taskId?: string | null
  userId: string
  onCancel: () => void
  onDone: (result: SubmitSnapshotResult) => void
}

type Phase = 'camera' | 'preview' | 'sending' | 'done'

/**
 * Camera capture for a snapshot window (Phase 4).
 *
 * getUserMedia (environment camera, no file picker), draws the frame on a
 * canvas with the longest side at most 1024 px, JPEG quality 0.7, one
 * retake. Uploads to the caller's own folder in the private snapshots
 * bucket, then calls submit_snapshot (server validates the window timing
 * and awards the points).
 */
export default function CameraCapture({
  roomId,
  windowIndex,
  taskId = null,
  userId,
  onCancel,
  onDone,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [phase, setPhase] = useState<Phase>('camera')
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SubmitSnapshotResult | null>(null)

  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play()
      }
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [])

  useEffect(() => {
    startCamera()
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [startCamera])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    // Longest side at most 1024 px, JPEG 0.7.
    const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    setDataUrl(canvas.toDataURL('image/jpeg', 0.7))
    setPhase('preview')
  }

  const retake = () => {
    setDataUrl(null)
    setError(null)
    setPhase('camera')
    startCamera()
  }

  const submit = async () => {
    if (!dataUrl) return
    setPhase('sending')
    setError(null)
    try {
      const imagePath = `${roomId}/${userId}/${windowIndex}.jpg`
      const { error: uploadError } = await getSupabase().storage
        .from(STORAGE_BUCKET)
        .upload(imagePath, dataUrl, { contentType: 'image/jpeg' })
      if (uploadError) throw new Error(uploadError.message)
      const snapshot = await submitSnapshot({
        room_id: roomId,
        window_index: windowIndex,
        task_id: taskId,
        image_path: imagePath,
        taken_at: new Date().toISOString(),
      })
      setResult(snapshot)
      setPhase('done')
    } catch (err) {
      setError(friendlyError(err))
      setPhase('preview')
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between p-4">
        <button
          onClick={onCancel}
          className="rounded-lg bg-white/10 px-3 py-1 text-sm font-semibold text-white"
        >
          Cancel
        </button>
        <p className="text-sm font-semibold text-white">Snapshot window {windowIndex}</p>
        <span className="w-12" />
      </div>

      {error && (
        <p className="mx-4 mb-2 rounded-lg bg-red-900/80 px-3 py-2 text-sm font-medium text-red-100">
          {error}
        </p>
      )}

      {phase === 'camera' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="max-h-[60vh] w-full max-w-md rounded-2xl object-contain"
          />
          <button
            onClick={capture}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow active:scale-95"
            aria-label="Capture photo"
          >
            <span className="h-16 w-16 rounded-full border-4 border-slate-800" />
          </button>
          <p className="text-sm text-white/70">Frame the hiding spot, then capture.</p>
        </div>
      )}

      {phase === 'preview' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
          {dataUrl && (
            <img src={dataUrl} alt="Captured snapshot" className="max-h-[55vh] w-full max-w-md rounded-2xl object-contain" />
          )}
          <div className="flex gap-3">
            <button
              onClick={retake}
              className="rounded-xl bg-white/15 px-6 py-3 font-semibold text-white active:scale-95"
            >
              Retake
            </button>
            <button
              onClick={submit}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white shadow active:scale-95"
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {phase === 'sending' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-lg font-bold text-white">Sending snapshot…</p>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
          <p className="text-2xl font-black text-white">
            {result.late ? 'Late — 0 points' : `On time! +${result.points_awarded} points`}
          </p>
          <button
            onClick={() => onDone(result)}
            className="rounded-xl bg-emerald-600 px-8 py-3 text-base font-bold text-white shadow active:scale-95"
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}
