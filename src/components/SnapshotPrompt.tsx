interface SnapshotPromptProps {
  secondsLeft: number
  windowIndex: number
  onOpenCamera: () => void
  onDismiss: () => void
}

/**
 * Full-screen snapshot-window prompt (Phase 4): 45-second countdown with a
 * sound and vibration (fired by the hook when a window opens). The hider
 * captures from here; dismissing is allowed — the window simply closes.
 */
export default function SnapshotPrompt({
  secondsLeft,
  windowIndex,
  onOpenCamera,
  onDismiss,
}: SnapshotPromptProps) {
  const closing = secondsLeft <= 10

  return (
    <div className="fixed inset-0 z-[55] flex flex-col items-center justify-center gap-6 bg-amber-950/95 p-8 text-center">
      <p className="text-sm font-bold uppercase tracking-widest text-amber-300">
        Snapshot window {windowIndex}
      </p>
      <p className={`text-8xl font-black tabular-nums ${closing ? 'text-red-400' : 'text-amber-200'}`}>
        {secondsLeft}
      </p>
      <p className="max-w-xs text-lg font-semibold text-amber-100">
        Snapshot time! Open the camera and capture your hiding spot.
      </p>
      <div className="flex flex-col gap-3">
        <button
          onClick={onOpenCamera}
          className="w-full rounded-xl bg-amber-500 py-4 text-base font-black text-amber-950 shadow active:scale-95"
        >
          SNAP NOW
        </button>
        <button
          onClick={onDismiss}
          className="w-full rounded-xl bg-white/10 py-3 text-sm font-semibold text-amber-100 active:scale-95"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
