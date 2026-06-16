// Capture README screenshots of the web demo (fictional data) via the running
// dev server. Uses the system Edge (no browser download). Output: ../docs/screenshots.
//   node scripts/shots.mjs
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const OUT = '../docs/screenshots'
mkdirSync(OUT, { recursive: true })

// A demo game with rich achievements + stats (from src/data/games.ts).
const GAME = '503310'
const shots = [
  ['library', '/'],
  ['achievements', `/game/${GAME}`],
  ['statistics', `/game/${GAME}/stats`],
  ['settings', '/settings'],
]

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 })
// Force the UI to en-US so these README screenshots match its English copy —
// the app otherwise follows the host browser locale (zh-TW here). Persisted
// settings (`sam-settings-v1`) are read once at boot in makeInitialState().
await page.addInitScript(() => {
  localStorage.setItem('sam-settings-v1', JSON.stringify({ theme: 'dark', lang: 'en-US' }))
})
for (const [name, route] of shots) {
  await page.goto(`http://localhost:5173/#${route}`, { waitUntil: 'load' })
  await page.waitForTimeout(1500) // let demo data + bars settle
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('saved', name)
}
await browser.close()
