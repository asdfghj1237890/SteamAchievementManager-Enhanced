import { describe, expect, it } from 'vitest'
import { IDLE_INSTALL, applyDownloadEvent, installBusy, progressPct } from '../updater'

describe('applyDownloadEvent', () => {
  it('walks idle → downloading → installing, accumulating bytes', () => {
    const started = applyDownloadEvent(IDLE_INSTALL, { event: 'Started', data: { contentLength: 1000 } })
    expect(started).toEqual({ phase: 'downloading', received: 0, total: 1000 })
    const mid = applyDownloadEvent(started, { event: 'Progress', data: { chunkLength: 400 } })
    const late = applyDownloadEvent(mid, { event: 'Progress', data: { chunkLength: 350 } })
    expect(late).toEqual({ phase: 'downloading', received: 750, total: 1000 })
    expect(progressPct(late)).toBe(75)
    const done = applyDownloadEvent(late, { event: 'Finished' })
    expect(done.phase).toBe('installing')
    expect(installBusy(started) && installBusy(done)).toBe(true)
    expect(installBusy(IDLE_INSTALL)).toBe(false)
  })

  it('reports no percentage while the size is unknown, and never more than 100', () => {
    const unknown = applyDownloadEvent(IDLE_INSTALL, { event: 'Started', data: {} })
    expect(unknown.total).toBeNull()
    expect(progressPct(applyDownloadEvent(unknown, { event: 'Progress', data: { chunkLength: 5 } }))).toBeNull()
    const over = { phase: 'downloading' as const, received: 1200, total: 1000 }
    expect(progressPct(over)).toBe(100)
  })
})
