#!/usr/bin/env node
// Builds the Tauri updater manifest (latest.json) and evaluates the release-tag
// version-compare guard used by .github/workflows/release.yml.
//
// This used to be inline jq/bash in the workflow, only ever exercised by cutting a real
// release — a mistake there (a signature with a stray newline, a platform key typo, a
// downgrade-guard bug) would silently break in-app updates for every user. Moved here so
// it has unit tests (web/src/__tests__/releaseManifest.test.ts) and can be run locally.
//
// Dependency-free on purpose: only Node builtins, so the release job needs no `npm ci`
// step just to run it.

import { readFileSync, realpathSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

/**
 * Strips exactly one trailing "\n" from `s`, matching jq's `rtrimstr("\n")` — a single
 * suffix removal, not a loop trim. Examples: "abc\n\n" -> "abc\n"; "abc\n" -> "abc";
 * "abc" -> "abc" (unchanged); "abc\r\n" -> "abc\r" (the "\r" is not part of the "\n"
 * suffix, so it is left in place).
 * @param {string} s
 * @returns {string}
 */
export function stripOneTrailingNewline(s) {
  return s.endsWith('\n') ? s.slice(0, -1) : s
}

/**
 * Builds the updater manifest object with the exact key order the jq filter in
 * release.yml produced (version, pub_date, notes, platforms.windows-x86_64,
 * platforms.darwin-aarch64), so `formatLatestJson` output matches jq's pretty-print
 * byte for byte.
 * @param {{
 *   version: string,
 *   pubDate: string,
 *   notes: string,
 *   winUrl: string,
 *   winSig: string,
 *   macUrl: string,
 *   macSig: string,
 * }} args
 */
export function buildLatestJson({ version, pubDate, notes, winUrl, winSig, macUrl, macSig }) {
  return {
    version,
    pub_date: pubDate,
    notes,
    platforms: {
      'windows-x86_64': { url: winUrl, signature: stripOneTrailingNewline(winSig) },
      'darwin-aarch64': { url: macUrl, signature: stripOneTrailingNewline(macSig) },
    },
  }
}

/**
 * Serializes to the same bytes `jq -n <filter> > latest.json` produced: 2-space indent,
 * no trailing whitespace on lines, exactly one trailing newline at end of file.
 * @param {unknown} obj
 * @returns {string}
 */
export function formatLatestJson(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`
}

/**
 * UTC timestamp as "YYYY-MM-DDTHH:MM:SSZ", matching `date -u +%Y-%m-%dT%H:%M:%SZ`
 * (no milliseconds).
 * @param {Date} [date]
 * @returns {string}
 */
export function formatPubDate(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Compares two plain `x.y.z` numeric version strings the way GNU `sort -V` orders them:
 * segment-wise numeric compare, so "1.10.0" sorts after "1.9.0" (unlike a lexical/string
 * compare). Missing trailing segments are treated as 0. Anything else (a pre-release
 * suffix, a leading "v", an empty string) throws rather than guessing an order.
 * @param {string} a
 * @param {string} b
 * @returns {number} <0 if a<b, 0 if equal, >0 if a>b
 */
export function compareVersions(a, b) {
  const as = parseVersion(a)
  const bs = parseVersion(b)
  const len = Math.max(as.length, bs.length)
  for (let i = 0; i < len; i++) {
    const d = (as[i] ?? 0) - (bs[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/** @param {string} v */
function parseVersion(v) {
  if (!/^\d+(\.\d+)*$/.test(v)) throw new Error(`not a plain x.y.z version: "${v}"`)
  return v.split('.').map(Number)
}

/**
 * Mirrors the bump-latest-json job's downgrade guard: write when `newV` equals `curV`,
 * or when `newV` sorts higher than `curV` under `sort -V`. Refuses to report "write" for
 * an older `newV`.
 * @param {string} newV
 * @param {string} curV
 * @returns {boolean}
 */
export function shouldWriteVersion(newV, curV) {
  return compareVersions(newV, curV) >= 0
}

function requireAll(values, names, usage) {
  for (const name of names) {
    if (!values[name]) {
      console.error(`release-manifest.mjs: missing --${name}\nusage: ${usage}`)
      process.exit(1)
    }
  }
}

function runBuild(rest) {
  const usage =
    'release-manifest.mjs build --version V --notes N --win-url U --win-sig PATH --mac-url U --mac-sig PATH [--pub-date D]'
  const { values } = parseArgs({
    args: rest,
    options: {
      version: { type: 'string' },
      notes: { type: 'string' },
      'win-url': { type: 'string' },
      'win-sig': { type: 'string' },
      'mac-url': { type: 'string' },
      'mac-sig': { type: 'string' },
      'pub-date': { type: 'string' },
    },
  })
  requireAll(values, ['version', 'notes', 'win-url', 'win-sig', 'mac-url', 'mac-sig'], usage)
  const manifest = buildLatestJson({
    version: values.version,
    pubDate: values['pub-date'] ?? formatPubDate(),
    notes: values.notes,
    winUrl: values['win-url'],
    winSig: readFileSync(values['win-sig'], 'utf8'),
    macUrl: values['mac-url'],
    macSig: readFileSync(values['mac-sig'], 'utf8'),
  })
  process.stdout.write(formatLatestJson(manifest))
}

function runCheckVersion(rest) {
  const usage = 'release-manifest.mjs check-version --new V --current V'
  const { values } = parseArgs({
    args: rest,
    options: {
      new: { type: 'string' },
      current: { type: 'string' },
    },
  })
  requireAll(values, ['new', 'current'], usage)
  // The decision goes to stdout and both outcomes exit 0; a non-zero exit means the
  // check itself failed (bad input). The workflow matches the word exactly, so a run
  // that printed nothing can never be read as "write".
  let write
  try {
    write = shouldWriteVersion(values.new, values.current)
  } catch (e) {
    console.error(`release-manifest.mjs: ${e.message}`)
    process.exit(1)
  }
  process.stdout.write(write ? 'write\n' : 'refuse\n')
}

function runCli(argv) {
  const [command, ...rest] = argv
  if (command === 'build') return runBuild(rest)
  if (command === 'check-version') return runCheckVersion(rest)
  console.error('usage: release-manifest.mjs <build|check-version> [options]')
  process.exit(1)
}

// Guard so importing this module (e.g. from tests) never runs the CLI as a side effect —
// only running the file directly does. Both sides go through realpath: argv[1] is not
// symlink-resolved, import.meta.url is.
const isMain =
  !!process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isMain) {
  runCli(process.argv.slice(2))
}
