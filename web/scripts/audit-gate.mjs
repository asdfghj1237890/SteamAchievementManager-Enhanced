#!/usr/bin/env node
// CI gate around `npm audit`.
//
// Plain `npm audit` fails on every advisory, including ones this repo has reviewed and
// deliberately accepted. Dismissing an alert in GitHub's Dependabot UI does not affect
// `npm audit` — that reads the npm advisory database — so an acceptance has to be recorded
// here too. Anything not on ALLOWED still fails the build.

import { spawnSync } from 'node:child_process'

/**
 * GHSA ids reviewed and accepted, each with the reason it does not apply here.
 *
 * Empty on purpose: nothing is currently accepted. GHSA-qwww-vcr4-c8h2 (react-router RSC
 * Mode CSRF) used to sit here while the app was pinned to react-router-dom 7.18.2; moving
 * to react-router 8.3.0 fixed it outright, so it was dropped rather than kept as an
 * exception. Prefer fixing over allow-listing.
 */
const ALLOWED = new Map()

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

if (!report || typeof report.vulnerabilities !== 'object') {
  console.error('Unexpected npm audit report shape:')
  console.error(JSON.stringify(report)?.slice(0, 500))
  process.exit(1)
}

/** @type {Map<string, {name?: string, severity?: string, title?: string}>} */
const found = new Map()
for (const vuln of Object.values(report.vulnerabilities)) {
  for (const via of vuln.via ?? []) {
    // A `via` entry is either an advisory object or the name of another vulnerable package;
    // only the objects carry the advisory itself.
    if (typeof via !== 'object' || typeof via.url !== 'string') continue
    const ghsa = via.url.split('/').pop()
    if (!ghsa?.startsWith('GHSA-') || found.has(ghsa)) continue
    found.set(ghsa, { name: via.name, severity: via.severity, title: via.title })
  }
}

const blocking = [...found].filter(([ghsa]) => !ALLOWED.has(ghsa))

for (const [ghsa] of [...found].filter(([g]) => ALLOWED.has(g))) {
  console.log(`accepted: ${ghsa} — ${ALLOWED.get(ghsa)}`)
}
for (const ghsa of ALLOWED.keys()) {
  if (!found.has(ghsa)) {
    console.log(`note: ${ghsa} is allow-listed but npm audit no longer reports it; drop it.`)
  }
}

if (blocking.length === 0) {
  console.log(`npm audit gate passed (${found.size} advisory/advisories, all accepted).`)
  process.exit(0)
}

console.error(`\nnpm audit gate failed — ${blocking.length} advisory/advisories not accepted:`)
for (const [ghsa, info] of blocking) {
  console.error(`  ${ghsa}  ${info.name ?? '?'}  (${info.severity ?? '?'})  ${info.title ?? ''}`)
}
console.error('\nFix the dependency, or add the id to ALLOWED in scripts/audit-gate.mjs with')
console.error('a written reason once it has been reviewed and judged not to apply here.')
process.exit(1)
