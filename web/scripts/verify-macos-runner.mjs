import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function assertAppleSilicon(platform = process.platform, arch = process.arch) {
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(`Expected an Apple Silicon macOS runner; got ${platform}/${arch}`)
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertAppleSilicon()
    console.log('Verified Apple Silicon macOS runner (darwin/arm64).')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
