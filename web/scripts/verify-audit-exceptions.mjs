#!/usr/bin/env node
// Lockfiles include inactive optional/platform dependencies. An advisory exception
// is valid here only while its package stays out of every supported target graph.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SUPPORTED_TARGETS = ['x86_64-pc-windows-msvc', 'aarch64-apple-darwin']
export const MANIFESTS = ['web/steam-core/Cargo.toml', 'web/src-tauri/Cargo.toml']
export const EXCLUDED_CRATES = [
  'proc-macro-error', 'gdkwayland-sys', 'gdk', 'atk', 'gdkx11-sys', 'gtk',
  'atk-sys', 'gdkx11', 'gdk-sys', 'gtk3-macros', 'gtk-sys', 'glib',
  // serde_with's optional chrono feature is not enabled by this application.
  'chrono',
]

export function verifyAuditExceptions(runCargo = spawnSync) {
  for (const manifest of MANIFESTS) {
    for (const target of SUPPORTED_TARGETS) {
      const result = runCargo('cargo', [
        'tree', '--locked', '--manifest-path', manifest, '--target', target,
        '--workspace', '--all-features', '--edges', 'normal,build,dev',
        '--prefix', 'none', '--format', '{p}',
      ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      if (result.error || result.signal || result.status !== 0) {
        throw new Error(`Cannot verify ${manifest} on ${target}: ${result.error?.message ?? result.stderr ?? result.signal ?? result.status}`)
      }
      if (typeof result.stdout !== 'string' || !result.stdout.trim()) {
        throw new Error(`Empty dependency graph for ${manifest} on ${target}`)
      }
      const packages = new Set(result.stdout.trim().split(/\r?\n/).map((line) => {
        const match = /^([A-Za-z0-9_-]+) v\d[^\s]*(?:\s.*)?$/.exec(line)
        if (!match) throw new Error(`Unreadable dependency graph for ${manifest} on ${target}: ${line}`)
        return match[1]
      }))
      const reachable = EXCLUDED_CRATES.filter((name) => packages.has(name))
      if (reachable.length) {
        throw new Error(`Advisory exception became reachable in ${manifest} on ${target}: ${reachable.join(', ')}`)
      }
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyAuditExceptions()
    console.log('Advisory exceptions remain outside both supported target graphs (including build and dev dependencies).')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
