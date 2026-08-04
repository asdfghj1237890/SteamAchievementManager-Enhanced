import { expect, test } from './fixtures'

test('filters games and completes an achievement save round trip', async ({ page }) => {
  await page.goto('/')
  const search = page.getByRole('textbox', { name: 'Search games…' })
  await search.fill('Nebula Drift')
  await expect(page.getByTestId('library-game-487120')).toBeVisible()
  await expect(page.getByTestId('library-game-503310')).toHaveCount(0)

  await page.getByTestId('library-game-487120').click()
  const achievement = page.getByRole('button', { name: /Ring Champion: Locked/ })
  await achievement.click()
  await expect(page.getByRole('button', { name: /Ring Champion: Pending unlock/ })).toBeVisible()

  await page.getByRole('button', { name: 'Save changes (1)' }).click()
  await expect(page.getByText('Wrote 1 changes to Steam')).toBeVisible()
  await expect(page.getByRole('button', { name: /Ring Champion: Unlocked/ })).toBeVisible()
})

test('edits a stat and persists appearance preferences', async ({ page }) => {
  await page.goto('/#/game/487120/stats')
  await expect(page.getByText('Total Races')).toBeVisible()
  await page.getByRole('button', { name: 'Enable value editing' }).click()

  const firstValue = page.getByRole('textbox', { name: 'Total Races' })
  await firstValue.fill('129')
  await expect(page.getByText('1 modified')).toBeVisible()

  await page.getByTestId('settings-toggle').click()
  await page.getByRole('button', { name: /Light/ }).click()
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('sam-settings-v1') ?? '{}').theme)).toBe('light')
})

test('supports keyboard navigation and achievement toggles', async ({ page }) => {
  await page.goto('/')
  const game = page.getByTestId('library-game-487120')
  await game.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Nebula Drift' })).toBeVisible()

  const achievement = page.getByRole('button', { name: /Maiden Voyage: Unlocked/ })
  await achievement.focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /Maiden Voyage: Pending lock/ })).toBeVisible()
})
