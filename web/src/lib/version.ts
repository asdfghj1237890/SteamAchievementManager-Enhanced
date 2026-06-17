/** True if `latest` is a strictly higher version than `current`. Tolerates a
 *  leading `v`; missing/NaN segments count as 0; a malformed `latest` is never
 *  reported as newer (so a bad file can't nag the user). */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string): number[] =>
    v.trim().replace(/^v/i, '').split('.').map((n) => {
      const x = parseInt(n, 10)
      return Number.isNaN(x) ? 0 : x
    })
  const a = parse(latest)
  const b = parse(current)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** Lifecycle of the in-app update check. */
export type UpdateStatus = 'idle' | 'ok' | 'error'

/** What the update indicator should display. */
export type UpdateView = 'available' | 'current' | 'error' | 'none'

/** Decide what the update indicator should show. A known current version with a
 *  *failed* check is reported as `error`, never `current`, so a network/GitHub
 *  outage is never shown to the user as "up to date". `current` is reported only
 *  after a successful check whose comparison found nothing newer. */
export function updateView(status: UpdateStatus, update: { isNew: boolean } | null): UpdateView {
  if (update?.isNew) return 'available'
  if (status === 'error') return 'error'
  if (status === 'ok' && update) return 'current'
  return 'none'
}
