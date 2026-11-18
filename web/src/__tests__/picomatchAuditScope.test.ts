import { describe, expect, it } from 'vitest'
import { evaluateAudit, validatePicomatchToolingException } from '../../scripts/audit-gate.mjs'

const id = 'GHSA-fc5q-39xc-vjpf'
const now = new Date('2026-11-18T00:00:00Z')
const advisory = { name: 'picomatch', url: `https://github.com/advisories/${id}` }
const report = () => ({ vulnerabilities: { picomatch: { via: [advisory], nodes: ['node_modules/picomatch'] } } })
const lock = () => ({ lockfileVersion: 3, packages: { 'node_modules/picomatch': { version: '4.0.7', dev: true } } })

describe('temporary picomatch tooling advisory scope', () => {
  it('accepts only the reviewed development-only version before expiry', () => {
    expect(() => validatePicomatchToolingException(report(), lock(), now)).not.toThrow()
  })

  it.each([false, undefined])('blocks a production or unclassified locked copy: dev=%s', (dev) => {
    const value = { lockfileVersion: 3, packages: { 'node_modules/picomatch': { version: '4.0.7', dev } } }
    expect(() => validatePicomatchToolingException(report(), value, now)).toThrow('dev-only version 4.0.7')
  })

  it('also blocks a nested production copy omitted from the audit node list', () => {
    const value = lock()
    const packages: Record<string, unknown> = value.packages
    packages['node_modules/other/node_modules/picomatch'] = { version: '4.0.7' }
    expect(() => validatePicomatchToolingException(report(), value, now)).toThrow('dev-only version 4.0.7')
  })

  it.each(['4.0.6', '4.0.8'])('requires a new review for another vulnerable version: %s', (version) => {
    const value = lock()
    value.packages['node_modules/picomatch'].version = version
    expect(() => validatePicomatchToolingException(report(), value, now)).toThrow('dev-only version 4.0.7')
  })

  it.each([{}, { lockfileVersion: 3, packages: [] }, { lockfileVersion: 3, packages: {} }, { lockfileVersion: 2, packages: lock().packages }])('blocks unreadable or missing lock data: %j', (value) => {
    expect(() => validatePicomatchToolingException(report(), value, now)).toThrow()
  })

  it.each([{ nodes: [] as string[] }, { nodes: ['node_modules/unknown'] }, { nodes: ['../picomatch'] }])('blocks incomplete or mismatched advisory node paths: %j', ({ nodes }) => {
    const value = report()
    value.vulnerabilities.picomatch.nodes = nodes
    expect(() => validatePicomatchToolingException(value, lock(), now)).toThrow('reviewed tooling scope')
  })

  it('does not extend the exception to another package using the same advisory id', () => {
    const value = { vulnerabilities: { other: { via: [advisory], nodes: ['node_modules/picomatch'] } } }
    expect(() => validatePicomatchToolingException(value, lock(), now)).toThrow('reviewed tooling scope')
  })

  it('requires an actual matching advisory', () => {
    expect(() => validatePicomatchToolingException({ vulnerabilities: {} }, lock(), now)).toThrow('No picomatch advisory')
  })

  it.each([new Date('2026-12-01T16:00:00Z'), new Date('2026-12-02T00:00:00Z'), new Date('invalid')])('blocks at or after expiry, or when the clock is invalid: %s', (date) => {
    expect(() => validatePicomatchToolingException(report(), lock(), date)).toThrow('expired')
  })

  it('keeps unrelated advisories blocking even with the proposed exception', () => {
    const value = report()
    value.vulnerabilities.picomatch.via.push({ name: 'picomatch', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' })
    expect(evaluateAudit(value, new Map([[id, 'reviewed fixture']])).blocking).toEqual(['GHSA-aaaa-bbbb-cccc'])
  })
})
