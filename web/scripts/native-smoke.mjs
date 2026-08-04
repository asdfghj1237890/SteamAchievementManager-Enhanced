import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const defaultBinary = resolve(
  'src-tauri',
  'target',
  'debug',
  process.platform === 'win32' ? 'app.exe' : 'app',
)
const binary = process.env.SAM_NATIVE_BINARY
  ? resolve(process.env.SAM_NATIVE_BINARY)
  : defaultBinary

if (!existsSync(binary)) {
  console.error(`Native smoke binary not found: ${binary}`)
  console.error('Build it first: npm run tauri -- build --debug --no-bundle --ci')
  process.exit(2)
}

const result = spawnSync(binary, ['--steam-worker', 'invalid-smoke-mode', '1'], {
  encoding: 'utf8',
  timeout: 15_000,
})

if (result.error) {
  console.error(`Native smoke could not execute: ${result.error.message}`)
  process.exit(1)
}

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
if (result.status !== 1 || !output.includes('worker：未知模式 invalid-smoke-mode')) {
  console.error(`Unexpected native smoke result (status ${String(result.status)}):`)
  console.error(output.trim())
  process.exit(1)
}

console.log(`Native worker smoke passed: ${binary}`)
