import { describe, expect, it, vi } from 'vitest'
import { EXCLUDED_CRATES, verifyAuditExceptions } from '../../scripts/verify-audit-exceptions.mjs'
import workflow from '../../../.github/workflows/test.yml?raw'

const clean = { status: 0, stdout: 'app v0.1.0 (local)\nserde_with v3.21.0\n' }

describe('Rust advisory exception reachability', () => {
  it('checks both lockfile graphs on both release targets, including build and dev dependencies', () => {
    const run = vi.fn(() => clean)
    verifyAuditExceptions(run)
    expect(run).toHaveBeenCalledTimes(4)
    for (const manifest of ['web/steam-core/Cargo.toml', 'web/src-tauri/Cargo.toml']) {
      for (const target of ['x86_64-pc-windows-msvc', 'aarch64-apple-darwin']) {
        expect(run).toHaveBeenCalledWith('cargo', expect.arrayContaining([
          '--locked', '--manifest-path', manifest, '--target', target, '--workspace',
          '--all-features', '--edges', 'normal,build,dev', '--prefix', 'none', '--format', '{p}',
        ]), expect.objectContaining({ encoding: 'utf8' }))
      }
    }
  })

  it.each(EXCLUDED_CRATES)('fails if %s becomes reachable', (name) => {
    const run = vi.fn(() => ({ status: 0, stdout: `${clean.stdout}${name} v0.4.45 (*)\n` }))
    expect(() => verifyAuditExceptions(run)).toThrow(`Advisory exception became reachable`)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('also detects a package that becomes reachable only on macOS', () => {
    const run = vi.fn((_command: string, args: string[]) => args.includes('aarch64-apple-darwin')
      ? { status: 0, stdout: `${clean.stdout}chrono v0.4.45\n` } : clean)
    expect(() => verifyAuditExceptions(run)).toThrow('aarch64-apple-darwin: chrono')
  })

  it.each([
    { status: 101, stdout: '', stderr: 'lockfile needs to be updated' },
    { status: null, stdout: '', error: new Error('cargo not found') },
    { status: null, stdout: clean.stdout, signal: 'SIGTERM' },
  ])('fails closed when cargo cannot produce the graph: %j', (result) => {
    expect(() => verifyAuditExceptions(() => result)).toThrow('Cannot verify')
  })

  it.each(['', '\n', 'unrecognised cargo output\n'])('rejects empty or unreadable output: %j', (stdout) => {
    expect(() => verifyAuditExceptions(() => ({ status: 0, stdout }))).toThrow(/Empty|Unreadable/)
  })

  it('runs the guard before both strict lockfile audits in CI', () => {
    const auditJob = workflow.slice(workflow.indexOf('\n  rust-security:'))
    const guard = auditJob.indexOf('node web/scripts/verify-audit-exceptions.mjs')
    expect(guard).toBeGreaterThan(0)
    for (const manifest of ['steam-core', 'src-tauri']) {
      expect(auditJob.indexOf(`cargo audit --deny warnings --file web/${manifest}/Cargo.lock`)).toBeGreaterThan(guard)
    }
    expect(auditJob.indexOf('node-version: 26.12.1')).toBeLessThan(guard)
  })
})
