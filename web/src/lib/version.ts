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
