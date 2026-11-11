/** Server-clock countdown; reaching zero does not itself confirm a tag. */
export function tagSecondsLeft(createdAt: string, nowMs: number): number {
  const created = Date.parse(createdAt)
  if (!Number.isFinite(created)) return 0
  return Math.max(0, Math.ceil((created + 10_000 - nowMs) / 1000))
}
