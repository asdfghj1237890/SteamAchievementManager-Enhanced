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
  signedVersion,
  stripOneTrailingNewline,
} from '../../scripts/release-manifest.mjs'

// This module replaces inline jq/bash in .github/workflows/release.yml (the "Stage
// release assets, updater manifest, and checksums" step and the bump-latest-json job).
// Getting it wrong silently breaks in-app updates for every user, and it used to only be
// exercised by cutting a real release — hence a dedicated, offline test file. See
// web/src/__tests__/tauriConfig.test.ts for the precedent of a test under src/ reading
// files outside src/.

// A .sig as the Tauri CLI writes it next to a signed updater package: base64 of minisign
// signature text, whose third line is the trusted comment. The two signature lines are
// placeholders — the script reads the comment, it does not verify anything.
const minisignText = (trustedComment: string, eol = '\n') =>
  [
    'untrusted comment: signature from tauri secret key',
    'c2lnbmF0dXJl',
    `trusted comment: ${trustedComment}`,
    'Z2xvYmFsIHNpZ25hdHVyZQ==',
    '',
  ].join(eol)
const encodeSig = (text: string) => Buffer.from(text, 'utf8').toString('base64')
const makeSig = (trustedComment: string) => encodeSig(minisignText(trustedComment))

const WIN_SIG = makeSig('timestamp:1790342845\tfile:SAM Enhanced_1.2.3_x64-setup.exe\tversion:1.2.3')
const MAC_SIG = makeSig('timestamp:1790342846\tfile:SAM Enhanced.app.tar.gz\tversion:1.2.3')
// What a Tauri CLI from before the version field existed produces.
const UNVERSIONED_SIG = makeSig('timestamp:1789003327\tfile:SAM Enhanced_1.2.3_x64-setup.exe')

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
    winSig: `${WIN_SIG}\n`,
    macUrl: 'https://example.com/mac.tar.gz',
    macSig: MAC_SIG,
  }

  it('produces the exact top-level key order the jq filter used', () => {
    expect(Object.keys(buildLatestJson(args))).toEqual(['version', 'pub_date', 'notes', 'platforms'])
  })

  it('produces the exact platform key order and names', () => {
    expect(Object.keys(buildLatestJson(args).platforms)).toEqual(['windows-x86_64', 'darwin-aarch64'])
  })

  it('strips a trailing newline from each raw .sig file content', () => {
    const manifest = buildLatestJson(args)
    expect(manifest.platforms['windows-x86_64'].signature).toBe(WIN_SIG)
    expect(manifest.platforms['darwin-aarch64'].signature).toBe(MAC_SIG)
  })

  it('maps fields to the right platform and key names', () => {
    const manifest = buildLatestJson(args)
    expect(manifest).toEqual({
      version: '1.2.3',
      pub_date: '2026-01-02T03:04:05Z',
      notes: 'https://example.com/notes',
      platforms: {
        'windows-x86_64': { url: 'https://example.com/win.exe', signature: WIN_SIG },
        'darwin-aarch64': { url: 'https://example.com/mac.tar.gz', signature: MAC_SIG },
      },
    })
  })

  // The manifest is unsigned; with requireSignedVersion the app only trusts its `version`
  // when the signature's trusted comment names the same one. A signature that cannot
  // satisfy that must never be published — it would strand every installed copy.
  it('refuses a signature with no version in its trusted comment, naming the platform', () => {
    expect(() => buildLatestJson({ ...args, winSig: UNVERSIONED_SIG })).toThrow(
      /windows-x86_64 signature has no "version:" field/,
    )
    expect(() => buildLatestJson({ ...args, macSig: UNVERSIONED_SIG })).toThrow(
      /darwin-aarch64 signature has no "version:" field/,
    )
  })

  it('refuses a signature that was signed for another version', () => {
    expect(() => buildLatestJson({ ...args, version: '1.2.4' })).toThrow(
      /windows-x86_64 signature was signed for version "1\.2\.3", not the release version "1\.2\.4"/,
    )
    const staleMac = makeSig('timestamp:1\tfile:SAM Enhanced.app.tar.gz\tversion:1.2.2')
    expect(() => buildLatestJson({ ...args, macSig: staleMac })).toThrow(
      /darwin-aarch64 signature was signed for version "1\.2\.2", not the release version "1\.2\.3"/,
    )
  })

  it('compares the signed version exactly, not by prefix', () => {
    const longer = makeSig('timestamp:1\tfile:a.exe\tversion:1.2.30')
    expect(() => buildLatestJson({ ...args, winSig: longer })).toThrow(/signed for version "1\.2\.30"/)
  })

  it('refuses a signature that is not a minisign signature at all', () => {
    expect(() => buildLatestJson({ ...args, winSig: 'winsig\n' })).toThrow(
      /windows-x86_64 signature is not base64/,
    )
    expect(() => buildLatestJson({ ...args, macSig: '' })).toThrow(
      /darwin-aarch64 signature is not base64/,
    )
  })
})

describe('signedVersion', () => {
  it('reads the version out of the trusted comment the Tauri CLI writes', () => {
    expect(signedVersion(WIN_SIG)).toBe('1.2.3')
    expect(signedVersion(MAC_SIG)).toBe('1.2.3')
  })

  it('accepts the one trailing newline the manifest strips', () => {
    expect(signedVersion(`${WIN_SIG}\n`)).toBe('1.2.3')
  })

  it('reads the version wherever the field sits in the comment', () => {
    expect(signedVersion(makeSig('version:2.0.0\ttimestamp:1\tfile:a.exe'))).toBe('2.0.0')
  })

  it('tolerates CRLF line endings inside the signature text', () => {
    const text = minisignText('timestamp:1\tfile:a.exe\tversion:1.2.3', '\r\n')
    expect(signedVersion(encodeSig(text))).toBe('1.2.3')
  })

  it('returns undefined when the trusted comment has no version field', () => {
    expect(signedVersion(UNVERSIONED_SIG)).toBeUndefined()
  })

  it('does not match a field that merely contains "version:"', () => {
    expect(signedVersion(makeSig('timestamp:1\tfile:app-version:2.zip'))).toBeUndefined()
  })

  it('throws on content that is not canonical base64', () => {
    for (const bad of ['', '\n', 'not base64!', 'winsig', `${WIN_SIG}\r\n`, `${WIN_SIG} `]) {
      expect(() => signedVersion(bad)).toThrow(/is not base64/)
    }
  })

  it('throws when the base64 does not decode to UTF-8 text', () => {
    expect(() => signedVersion(Buffer.from([0xff, 0xfe, 0xfd]).toString('base64'))).toThrow(
      /does not decode to UTF-8 text/,
    )
  })

  it('throws when the decoded text has no trusted comment on its third line', () => {
    const noTrusted = ['untrusted comment: signature from tauri secret key', 'c2lnbmF0dXJl', ''].join('\n')
    // The trusted comment is only trusted in its place: a "version:" on the untrusted
    // first line must not be picked up.
    const misplaced = ['trusted comment: version:1.2.3', 'c2lnbmF0dXJl', 'Z2xvYmFs', ''].join('\n')
    for (const text of [noTrusted, misplaced, 'version:1.2.3']) {
      expect(() => signedVersion(encodeSig(text))).toThrow(/is not minisign text with a "trusted comment:" line/)
    }
  })
})

describe('formatLatestJson', () => {
  it('matches jq -n\'s 2-space pretty-print, including the trailing newline', () => {
    const args = {
      version: '1.2.3',
      pubDate: '2026-01-02T03:04:05Z',
      notes: 'https://example.com/notes',
      winUrl: 'https://example.com/win.exe',
      winSig: `${WIN_SIG}\n`,
      macUrl: 'https://example.com/mac.tar.gz',
      macSig: MAC_SIG,
    }
    const expected = `{
  "version": "1.2.3",
  "pub_date": "2026-01-02T03:04:05Z",
  "notes": "https://example.com/notes",
  "platforms": {
    "windows-x86_64": {
      "url": "https://example.com/win.exe",
      "signature": "${WIN_SIG}"
    },
    "darwin-aarch64": {
      "url": "https://example.com/mac.tar.gz",
      "signature": "${MAC_SIG}"
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
  const build = (dir: string, winSig: string, macSig: string) => {
    const winSigPath = join(dir, 'win.sig')
    const macSigPath = join(dir, 'mac.sig')
    writeFileSync(winSigPath, winSig)
    writeFileSync(macSigPath, macSig)
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
    return { result, winSigPath, macSigPath }
  }

  it('reads .sig files by path and writes the manifest to stdout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-manifest-test-'))
    try {
      const { result, winSigPath, macSigPath } = build(dir, `${WIN_SIG}\n`, MAC_SIG)

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
      expect(JSON.parse(result.stdout).platforms['windows-x86_64'].signature).toBe(WIN_SIG)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // release.yml redirects stdout straight into latest.json under `set -e`: a refusal has
  // to be a non-zero exit with nothing on stdout, so no partial manifest can be published.
  it.each<[string, string, string, RegExp]>([
    [
      'a signature without a signed version',
      UNVERSIONED_SIG,
      MAC_SIG,
      /windows-x86_64 signature has no "version:" field/,
    ],
    [
      'a signature signed for another version',
      WIN_SIG,
      makeSig('timestamp:1\tfile:SAM Enhanced.app.tar.gz\tversion:1.2.2'),
      /darwin-aarch64 signature was signed for version "1\.2\.2"/,
    ],
    ['a file that is not a signature', 'winsig\n', MAC_SIG, /windows-x86_64 signature is not base64/],
  ])('exits non-zero and prints no manifest for %s', (_name, winSig, macSig, message) => {
    const dir = mkdtempSync(join(tmpdir(), 'release-manifest-test-'))
    try {
      const { result } = build(dir, winSig, macSig)
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toMatch(message)
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
