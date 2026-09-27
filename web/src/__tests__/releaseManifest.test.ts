/// <reference types="node" />
// tsconfig.app.json (which covers src/) has no "types" array — src/ is browser code and
// should not see Node's ambient globals by default. This file is a Node-side test (it
// spawns the CLI and touches the filesystem), so it opts in locally, the same way
// src/vite-env.d.ts opts src/ into `import.meta.env` via `/// <reference types="vite/client" />`.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildLatestJson,
  compareVersions,
  formatLatestJson,
  formatPubDate,
  shouldWriteVersion,
  stripOneTrailingNewline,
} from '../../scripts/release-manifest.mjs'

// This module replaces inline jq/bash in .github/workflows/release.yml (the "Stage
// release assets, updater manifest, and checksums" step and the bump-latest-json job).
// Getting it wrong silently breaks in-app updates for every user, and it used to only be
// exercised by cutting a real release — hence a dedicated, offline test file. See
// web/src/__tests__/tauriConfig.test.ts for the precedent of a test under src/ reading
// files outside src/.

describe('stripOneTrailingNewline', () => {
  it('strips exactly one trailing newline', () => {
    expect(stripOneTrailingNewline('abc\n')).toBe('abc')
  })

  it('leaves a signature with no trailing newline unchanged', () => {
    expect(stripOneTrailingNewline('abc')).toBe('abc')
  })

  it('strips only ONE of two trailing newlines, matching jq rtrimstr', () => {
    expect(stripOneTrailingNewline('abc\n\n')).toBe('abc\n')
  })

  it('does not strip beyond the "\\n" suffix — a trailing "\\r" is left in place', () => {
    expect(stripOneTrailingNewline('abc\r\n')).toBe('abc\r')
  })

  it('leaves the empty string unchanged', () => {
    expect(stripOneTrailingNewline('')).toBe('')
  })
})

describe('buildLatestJson', () => {
  const args = {
    version: '1.2.3',
    pubDate: '2026-01-02T03:04:05Z',
    notes: 'https://example.com/notes',
    winUrl: 'https://example.com/win.exe',
    winSig: 'winsig\n',
    macUrl: 'https://example.com/mac.tar.gz',
    macSig: 'macsig',
  }

  it('produces the exact top-level key order the jq filter used', () => {
    expect(Object.keys(buildLatestJson(args))).toEqual(['version', 'pub_date', 'notes', 'platforms'])
  })

  it('produces the exact platform key order and names', () => {
    expect(Object.keys(buildLatestJson(args).platforms)).toEqual(['windows-x86_64', 'darwin-aarch64'])
  })

  it('strips a trailing newline from each raw .sig file content', () => {
    const manifest = buildLatestJson(args)
    expect(manifest.platforms['windows-x86_64'].signature).toBe('winsig')
    expect(manifest.platforms['darwin-aarch64'].signature).toBe('macsig')
  })

  it('maps fields to the right platform and key names', () => {
    const manifest = buildLatestJson(args)
    expect(manifest).toEqual({
      version: '1.2.3',
      pub_date: '2026-01-02T03:04:05Z',
      notes: 'https://example.com/notes',
      platforms: {
        'windows-x86_64': { url: 'https://example.com/win.exe', signature: 'winsig' },
        'darwin-aarch64': { url: 'https://example.com/mac.tar.gz', signature: 'macsig' },
      },
    })
  })
})

describe('formatLatestJson', () => {
  it('matches jq -n\'s 2-space pretty-print, including the trailing newline', () => {
    const args = {
      version: '1.2.3',
      pubDate: '2026-01-02T03:04:05Z',
      notes: 'https://example.com/notes',
      winUrl: 'https://example.com/win.exe',
      winSig: 'winsig\n',
      macUrl: 'https://example.com/mac.tar.gz',
      macSig: 'macsig',
    }
    const expected = `{
  "version": "1.2.3",
  "pub_date": "2026-01-02T03:04:05Z",
  "notes": "https://example.com/notes",
  "platforms": {
    "windows-x86_64": {
      "url": "https://example.com/win.exe",
      "signature": "winsig"
    },
    "darwin-aarch64": {
      "url": "https://example.com/mac.tar.gz",
      "signature": "macsig"
    }
  }
}
`
    expect(formatLatestJson(buildLatestJson(args))).toBe(expected)
  })
})

describe('formatPubDate', () => {
  it('formats as YYYY-MM-DDTHH:MM:SSZ with no milliseconds', () => {
    expect(formatPubDate(new Date('2026-09-25T13:28:43.123Z'))).toBe('2026-09-25T13:28:43Z')
  })

  it('matches the shape produced by `date -u +%Y-%m-%dT%H:%M:%SZ`', () => {
    expect(formatPubDate(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})

describe('compareVersions / shouldWriteVersion', () => {
  it('treats "1.10.0" as greater than "1.9.0" (numeric, not lexical, segment compare)', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(shouldWriteVersion('1.10.0', '1.9.0')).toBe(true)
  })

  it('writes when the new version equals the current version', () => {
    expect(shouldWriteVersion('1.4.1', '1.4.1')).toBe(true)
  })

  it('refuses a downgrade', () => {
    expect(shouldWriteVersion('1.4.0', '1.4.1')).toBe(false)
  })

  it('writes a clear major/minor bump', () => {
    expect(shouldWriteVersion('2.0.0', '1.99.99')).toBe(true)
  })

  it('writes against the "0.0.0" fallback used when latest.json is missing/has no version', () => {
    expect(shouldWriteVersion('1.0.0', '0.0.0')).toBe(true)
  })

  it('throws on anything that is not a plain x.y.z version instead of guessing an order', () => {
    for (const bad of ['1.4.1-rc1', 'v1.4.1', '', '1..2', 'null']) {
      expect(() => compareVersions(bad, '1.0.0')).toThrow(/not a plain x\.y\.z version/)
      expect(() => shouldWriteVersion('1.0.0', bad)).toThrow(/not a plain x\.y\.z version/)
    }
  })
})

const scriptPath = fileURLToPath(new URL('../../scripts/release-manifest.mjs', import.meta.url))

describe('CLI (build subcommand)', () => {
  it('reads .sig files by path and writes the manifest to stdout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-manifest-test-'))
    try {
      const winSigPath = join(dir, 'win.sig')
      const macSigPath = join(dir, 'mac.sig')
      writeFileSync(winSigPath, 'winsig\n')
      writeFileSync(macSigPath, 'macsig')

      const result = spawnSync(
        process.execPath,
        [
          scriptPath,
          'build',
          '--version',
          '1.2.3',
          '--notes',
          'https://example.com/notes',
          '--win-url',
          'https://example.com/win.exe',
          '--win-sig',
          winSigPath,
          '--mac-url',
          'https://example.com/mac.tar.gz',
          '--mac-sig',
          macSigPath,
          '--pub-date',
          '2026-01-02T03:04:05Z',
        ],
        { encoding: 'utf8' },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toBe(
        formatLatestJson(
          buildLatestJson({
            version: '1.2.3',
            pubDate: '2026-01-02T03:04:05Z',
            notes: 'https://example.com/notes',
            winUrl: 'https://example.com/win.exe',
            winSig: readFileSync(winSigPath, 'utf8'),
            macUrl: 'https://example.com/mac.tar.gz',
            macSig: readFileSync(macSigPath, 'utf8'),
          }),
        ),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('CLI (check-version subcommand)', () => {
  const checkVersion = (next: string, current: string) =>
    spawnSync(process.execPath, [scriptPath, 'check-version', '--new', next, '--current', current], {
      encoding: 'utf8',
    })

  // release.yml matches stdout exactly ("write" / "refuse") and treats anything else,
  // including a run that printed nothing, as a failed step.
  it('prints "write" and exits 0 when the new version should be written', () => {
    const result = checkVersion('1.4.1', '1.4.0')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('write\n')
  })

  it('prints "refuse" and exits 0 for a downgrade', () => {
    const result = checkVersion('1.4.0', '1.4.1')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('refuse\n')
  })

  it('exits non-zero and prints no decision for a version it cannot compare', () => {
    const result = checkVersion('1.4.1-rc1', '1.4.0')
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
  })
})
