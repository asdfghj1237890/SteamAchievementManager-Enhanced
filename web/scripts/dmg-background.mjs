// Render src-tauri/dmg/background.svg into the Retina-aware background.tiff that
// the macOS .dmg window uses (bundle.macOS.dmg.background in tauri.conf.json).
// The TIFF holds a 1x (660×400) and a 2x (1320×800) image so Finder picks the sharp
// one on Retina displays. macOS only (tiffutil); uses Playwright's bundled Chromium.
//   node scripts/dmg-background.mjs
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = new URL('../src-tauri/dmg/', import.meta.url).pathname
const svg = readFileSync(join(DIR, 'background.svg'), 'utf8')
const width = Number(svg.match(/width="(\d+)"/)[1])
const height = Number(svg.match(/height="(\d+)"/)[1])

const tmp = mkdtempSync(join(tmpdir(), 'dmg-bg-'))
const browser = await chromium.launch()
try {
  for (const scale of [1, 2]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale })
    await page.setContent(`<body style="margin:0">${svg}</body>`)
    await page.screenshot({ path: join(tmp, `bg@${scale}x.png`), omitBackground: false })
    await page.close()
  }
} finally {
  await browser.close()
}

execFileSync('tiffutil', [
  '-cathidpicheck', join(tmp, 'bg@1x.png'), join(tmp, 'bg@2x.png'),
  '-out', join(DIR, 'background.tiff'),
])
rmSync(tmp, { recursive: true })
console.log(`wrote ${join(DIR, 'background.tiff')}`)
