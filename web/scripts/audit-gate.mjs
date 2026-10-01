#!/usr/bin/env node
// CI gate around `npm audit`.
//
// Plain `npm audit` fails on every advisory, including ones this repo has reviewed and
// deliberately accepted. Dismissing an alert in GitHub's Dependabot UI does not affect
// `npm audit` — that reads the npm advisory database — so an acceptance has to be recorded
// here too. Anything not on ALLOWED still fails the build.

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * GHSA ids reviewed and accepted, each with the reason it does not apply here.
 *
 * Empty on purpose: nothing is currently accepted. GHSA-qwww-vcr4-c8h2 (react-router RSC
 * Mode CSRF) used to sit here while the app was pinned to react-router-dom 7.18.2; moving
 * to react-router 8.3.0 fixed it outright, so it was dropped rather than kept as an
 * exception. Prefer fixing over allow-listing.
 */
const ALLOWED = new Map()

// A GHSA id as the last path segment of the advisory URL; a trailing slash, query, or
// fragment after it is tolerated.
const GHSA_URL = /\/(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})\/*(?:[?#].*)?$/

/**
 * The id an advisory is tracked (and allow-listed) under: its GHSA id when the URL carries
 * one, otherwise the URL itself, otherwise package name + npm advisory number. The
 * fallbacks exist so an advisory this script cannot identify still blocks instead of
 * being skipped.
 * @param {any} via an advisory entry from a vulnerability's `via` list
 * @returns {string}
 */
function advisoryKey(via) {
  const url = typeof via?.url === 'string' ? via.url : ''
  return GHSA_URL.exec(url)?.[1] ?? (url || `${via?.name ?? '?'}#${via?.source ?? '?'}`)
}

/**
 * Whether parsed `npm audit --json` output is the report this script can read:
 * auditReportVersion 2, with `vulnerabilities` an object keyed by package name. An array
 * is refused explicitly — it is an 'object' too, and an empty one would read as a clean run.
 * @param {any} report
 * @returns {boolean}
 */
export function isAuditReport(report) {
  return (
    !!report &&
    report.auditReportVersion === 2 &&
    !!report.vulnerabilities &&
    typeof report.vulnerabilities === 'object' &&
    !Array.isArray(report.vulnerabilities)
  )
}

/**
 * How many vulnerable packages the report says it has: the ones it lists, or its own
 * `metadata.vulnerabilities.total` counter when that is higher.
 * @param {{ vulnerabilities: Record<string, any>, metadata?: any }} report
 * @returns {number}
 */
function reportedCount(report) {
  const total = Number(report.metadata?.vulnerabilities?.total)
  return Math.max(Object.keys(report.vulnerabilities).length, total > 0 ? total : 0)
}

/**
 * Evaluates a parsed `npm audit --json` report against the allow-list. Pure: no I/O, so
 * it is unit-tested in web/src/__tests__/auditGate.test.ts.
 * @param {{ vulnerabilities: Record<string, any>, metadata?: any }} report
 * @param {Map<string, string>} [allowed] advisory id -> reason it was accepted
 * @returns {{
 *   ok: boolean,
 *   found: Map<string, { name?: string, severity?: string, title?: string }>,
 *   blocking: string[],
 *   accepted: string[],
 *   stale: string[],
 *   unreadable: boolean,
 * }}
 */
export function evaluateAudit(report, allowed = ALLOWED) {
  /** @type {Map<string, {name?: string, severity?: string, title?: string}>} */
  const found = new Map()
  const entries = Object.entries(report.vulnerabilities)
  for (const [pkg, vuln] of entries) {
    if (!Array.isArray(vuln?.via)) {
      found.set(`${pkg} (no advisory list)`, { name: pkg, severity: vuln?.severity })
      continue
    }
    for (const via of vuln.via) {
      // A `via` entry is either an advisory object or the name of another vulnerable package;
      // only the objects carry the advisory itself.
      if (typeof via === 'string') continue
      const key = advisoryKey(via)
      if (found.has(key)) continue
      found.set(key, { name: via?.name, severity: via?.severity, title: via?.title })
    }
  }

  const ids = [...found.keys()]
  const blocking = ids.filter((id) => !allowed.has(id))
  // Vulnerable packages — listed, or only counted in the report's own metadata — but not
  // one advisory read out of them: the report is in a shape this script does not
  // understand, which must not count as a clean run.
  const unreadable = reportedCount(report) > 0 && found.size === 0
  return {
    ok: blocking.length === 0 && !unreadable,
    found,
    blocking,
    accepted: ids.filter((id) => allowed.has(id)),
    stale: [...allowed.keys()].filter((id) => !found.has(id)),
    unreadable,
  }
}

function runCli() {
  const res = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  if (res.error) {
    console.error(`Could not run npm audit: ${res.error.message}`)
    process.exit(1)
  }

  // `npm audit` exits non-zero whenever it finds anything, so the exit code says nothing about
  // whether the run itself worked. Unparsable output is the real failure signal.
  let report
  try {
    report = JSON.parse(res.stdout)
  } catch {
    console.error('npm audit did not return JSON:')
    console.error(res.stdout || res.stderr || '(no output)')
    process.exit(1)
  }

  if (!isAuditReport(report)) {
    console.error('Unexpected npm audit report shape:')
    console.error(JSON.stringify(report)?.slice(0, 500))
    process.exit(1)
  }

  const { ok, found, blocking, accepted, stale, unreadable } = evaluateAudit(report)

  for (const ghsa of accepted) {
    console.log(`accepted: ${ghsa} — ${ALLOWED.get(ghsa)}`)
  }
  for (const ghsa of stale) {
    console.log(`note: ${ghsa} is allow-listed but npm audit no longer reports it; drop it.`)
  }

  if (ok) {
    console.log(`npm audit gate passed (${found.size} advisory/advisories, all accepted).`)
    process.exit(0)
  }

  if (unreadable) {
    const count = reportedCount(report)
    console.error(`\nnpm audit gate failed — ${count} vulnerable package(s) reported, but no advisory`)
    console.error('could be read from the report. Run `npm audit` and check the report shape.')
    process.exit(1)
  }

  console.error(`\nnpm audit gate failed — ${blocking.length} advisory/advisories not accepted:`)
  for (const ghsa of blocking) {
    const info = found.get(ghsa)
    console.error(`  ${ghsa}  ${info?.name ?? '?'}  (${info?.severity ?? '?'})  ${info?.title ?? ''}`)
  }
  console.error('\nFix the dependency, or add the id to ALLOWED in scripts/audit-gate.mjs with')
  console.error('a written reason once it has been reviewed and judged not to apply here.')
  process.exit(1)
}

// Guard so importing this module (e.g. from tests) never runs `npm audit` as a side
// effect — only running the file directly does. Both sides go through realpath: argv[1]
// is not symlink-resolved, import.meta.url is.
const isMain =
  !!process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isMain) {
  runCli()
}
