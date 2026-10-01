import { describe, expect, it } from 'vitest'
import { evaluateAudit, isAuditReport } from '../../scripts/audit-gate.mjs'

// scripts/audit-gate.mjs is the CI gate around `npm audit`: anything it does not
// recognise has to fail the build, not slip through as "0 advisories, all accepted".
// These feed it report shapes directly — the CLI half runs `npm audit` against the
// registry, so it is exercised by CI rather than here.

const GHSA = 'GHSA-qwww-vcr4-c8h2'

/** An advisory object as `npm audit --json` (auditReportVersion 2) lists it under `via`. */
const advisory = (url: string | undefined, source = 1100000) => ({
  source,
  name: 'react-router',
  dependency: 'react-router',
  title: 'RSC Mode CSRF',
  url,
  severity: 'high',
  range: '<8.3.0',
})

/** A report with one directly vulnerable package and one that only depends on it. */
const report = (...via: unknown[]) => ({
  auditReportVersion: 2,
  vulnerabilities: {
    'react-router': { name: 'react-router', severity: 'high', via },
    'react-router-dom': { name: 'react-router-dom', severity: 'high', via: ['react-router'] },
  },
})

describe('evaluateAudit', () => {
  it('passes an empty report', () => {
    const result = evaluateAudit({ vulnerabilities: {} })
    expect(result.ok).toBe(true)
    expect(result.found.size).toBe(0)
    expect(result.blocking).toEqual([])
    expect(result.unreadable).toBe(false)
  })

  it('blocks a GHSA advisory that is not on the allow-list', () => {
    const result = evaluateAudit(report(advisory(`https://github.com/advisories/${GHSA}`)))
    expect(result.ok).toBe(false)
    expect(result.blocking).toEqual([GHSA])
    expect(result.found.get(GHSA)).toEqual({
      name: 'react-router',
      severity: 'high',
      title: 'RSC Mode CSRF',
    })
  })

  it('passes an advisory that is on the allow-list, and reports it as accepted', () => {
    const allowed = new Map([[GHSA, 'RSC Mode is not used']])
    const result = evaluateAudit(report(advisory(`https://github.com/advisories/${GHSA}`)), allowed)
    expect(result.ok).toBe(true)
    expect(result.blocking).toEqual([])
    expect(result.accepted).toEqual([GHSA])
    expect(result.stale).toEqual([])
  })

  it('still blocks the advisories next to an accepted one', () => {
    const other = 'GHSA-2222-3333-4444'
    const allowed = new Map([[GHSA, 'RSC Mode is not used']])
    const result = evaluateAudit(
      report(
        advisory(`https://github.com/advisories/${GHSA}`),
        advisory(`https://github.com/advisories/${other}`, 1100001),
      ),
      allowed,
    )
    expect(result.ok).toBe(false)
    expect(result.accepted).toEqual([GHSA])
    expect(result.blocking).toEqual([other])
  })

  it('counts an advisory once however many packages list it', () => {
    const url = `https://github.com/advisories/${GHSA}`
    const result = evaluateAudit({
      vulnerabilities: {
        a: { via: [advisory(url)] },
        b: { via: [advisory(url)] },
      },
    })
    expect([...result.found.keys()]).toEqual([GHSA])
  })

  it('lists allow-listed ids npm audit no longer reports as stale', () => {
    const result = evaluateAudit({ vulnerabilities: {} }, new Map([[GHSA, 'fixed upstream since']]))
    expect(result.ok).toBe(true)
    expect(result.stale).toEqual([GHSA])
  })

  // Used to be skipped entirely: the id was whatever followed the last "/", so a trailing
  // slash left an empty string that did not start with "GHSA-".
  it.each([
    `https://github.com/advisories/${GHSA}/`,
    `https://github.com/advisories/${GHSA}?utm_source=npm`,
    `https://github.com/advisories/${GHSA}/#details`,
  ])('still recognises the GHSA id in %s', (url) => {
    expect(evaluateAudit(report(advisory(url))).blocking).toEqual([GHSA])
    const allowed = new Map([[GHSA, 'RSC Mode is not used']])
    expect(evaluateAudit(report(advisory(url)), allowed).ok).toBe(true)
  })

  it('blocks an advisory whose URL carries no GHSA id, keyed by the URL', () => {
    const url = 'https://www.npmjs.com/advisories/1100000'
    const result = evaluateAudit(report(advisory(url)))
    expect(result.ok).toBe(false)
    expect(result.blocking).toEqual([url])
    expect(result.found.get(url)?.name).toBe('react-router')
  })

  it('does not let a GHSA id elsewhere in the URL stand in for the advisory', () => {
    const url = `https://example.com/${GHSA}/other`
    const allowed = new Map([[GHSA, 'RSC Mode is not used']])
    const result = evaluateAudit(report(advisory(url)), allowed)
    expect(result.ok).toBe(false)
    expect(result.blocking).toEqual([url])
  })

  it('blocks an advisory with no URL at all, keyed by package name and advisory number', () => {
    const result = evaluateAudit(report(advisory(undefined, 1100042)))
    expect(result.ok).toBe(false)
    expect(result.blocking).toEqual(['react-router#1100042'])
  })

  it('blocks a `via` entry that is neither a package name nor an advisory object', () => {
    const result = evaluateAudit(report(null))
    expect(result.ok).toBe(false)
    expect(result.blocking).toEqual(['?#?'])
  })

  it('blocks a vulnerable package that has no `via` list', () => {
    const result = evaluateAudit({
      vulnerabilities: {
        'react-router': { name: 'react-router', severity: 'high' },
        other: { via: [advisory(`https://github.com/advisories/${GHSA}`)] },
      },
    })
    expect(result.ok).toBe(false)
    expect(result.blocking).toEqual(['react-router (no advisory list)', GHSA])
  })

  it('blocks when packages are reported vulnerable but no advisory can be read', () => {
    const result = evaluateAudit({
      vulnerabilities: {
        a: { name: 'a', severity: 'high', via: ['b'] },
        b: { name: 'b', severity: 'high', via: ['a'] },
      },
    })
    expect(result.found.size).toBe(0)
    expect(result.blocking).toEqual([])
    expect(result.unreadable).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('blocks when the report counts vulnerable packages it does not list', () => {
    const result = evaluateAudit({
      auditReportVersion: 2,
      vulnerabilities: {},
      metadata: { vulnerabilities: { total: 3 } },
    })
    expect(result.found.size).toBe(0)
    expect(result.blocking).toEqual([])
    expect(result.unreadable).toBe(true)
    expect(result.ok).toBe(false)
  })
})

describe('isAuditReport', () => {
  // What npm 11 prints for a tree with nothing to report.
  const clean = {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  }

  it('accepts a clean report, which then passes the gate', () => {
    expect(isAuditReport(clean)).toBe(true)
    expect(evaluateAudit(clean).ok).toBe(true)
  })

  // typeof [] is 'object' and an empty array has no entries, so this used to pass as clean.
  it('refuses `vulnerabilities` as an array', () => {
    expect(isAuditReport({ ...clean, vulnerabilities: [] })).toBe(false)
  })

  it('refuses a report that is not auditReportVersion 2', () => {
    expect(isAuditReport({ ...clean, auditReportVersion: 3 })).toBe(false)
    expect(isAuditReport({ vulnerabilities: {} })).toBe(false)
  })
})
