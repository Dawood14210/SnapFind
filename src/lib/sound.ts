/**
 * Snapfind — Web Audio sound helper (Phase 4 snapshot prompt).
 *
 * A short beep when a snapshot window opens. The AudioContext is created
 * lazily on first use (browsers require a user gesture for audio to start,
 * so the first beep after a tap works; background beeps are best-effort).
 */

export function playBeep(frequency = 880, durationMs = 250, volume = 0.3): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000)
    osc.start()
    osc.stop(ctx.currentTime + durationMs / 1000)
  } catch {
    // Audio not available (e.g. autoplay blocked) — the prompt also shows a
    // countdown and vibrates, so the window is still noticeable.
  }
}

/** Two short buzzes for the window-open prompt. */
export function playWindowBeep(): void {
  playBeep(660, 200, 0.35)
  setTimeout(() => playBeep(990, 200, 0.35), 250)
}
