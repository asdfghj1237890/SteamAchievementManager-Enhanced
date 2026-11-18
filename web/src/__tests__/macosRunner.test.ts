import { describe, expect, it } from 'vitest'
import { assertAppleSilicon } from '../../scripts/verify-macos-runner.mjs'
import testWorkflow from '../../../.github/workflows/test.yml?raw'
import releaseWorkflow from '../../../.github/workflows/release.yml?raw'

describe('Apple Silicon CI and release runners', () => {
  it('accepts native ARM64 macOS', () => {
    expect(() => assertAppleSilicon('darwin', 'arm64')).not.toThrow()
  })

  it.each([
    ['darwin', 'x64'], ['darwin', 'ia32'], ['linux', 'arm64'], ['win32', 'arm64'],
  ])('rejects an incompatible runner: %s/%s', (platform, arch) => {
    expect(() => assertAppleSilicon(platform, arch)).toThrow('Expected an Apple Silicon macOS runner')
  })

  it('uses the same pinned ARM64-capable image for native tests and release builds', () => {
    const native = testWorkflow.split('\n  native:')[1]?.split('\n  rust-security:')[0] ?? ''
    const release = releaseWorkflow.split('\n  build-macos:')[1]?.split('\n  release:')[0] ?? ''
    expect(native).toContain('os: [windows-latest, macos-15]')
    expect(native).toContain("if: runner.os == 'macOS'")
    expect(release).toContain('runs-on: macos-15')
    for (const job of [native, release]) {
      const guard = job.indexOf('node web/scripts/verify-macos-runner.mjs')
      expect(guard).toBeGreaterThan(0)
      expect(job.indexOf('node-version: 26.12.1')).toBeLessThan(guard)
      expect(job.indexOf('Install frontend dependencies')).toBeGreaterThan(guard)
    }
  })
})
