import * as SunCalc from 'suncalc'
export function freshForSos(atMs: number, nowMs: number): boolean {
  return Number.isFinite(atMs) && nowMs >= atMs && nowMs - atMs <= 30_000
}
export function holdForSos(send: () => void): () => void {
  const timer = setTimeout(send, 2000)
  return () => clearTimeout(timer)
}
export function outsideDaylight(nowMs: number, lat: number, lng: number): boolean {
  return SunCalc.getPosition(new Date(nowMs), lat, lng).altitude < 0
}
