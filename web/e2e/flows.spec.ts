import { expect, test } from './fixtures'

test('adds a game by App ID, and rejects a non-numeric one inline', async ({ page }) => {
  await page.goto('/')
  const add = page.getByRole('textbox', { name: 'Add by App ID…' })

  await add.fill('abc')
  await add.press('Enter')
  await expect(add).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Enter a valid numeric App ID')).toBeVisible()

  // A known id just navigates there.
  await add.fill('503310')
  await add.press('Enter')
  await expect(page).toHaveURL(/#\/game\/503310$/)
  await expect(page.getByRole('heading', { name: 'Hollow Keep' })).toBeVisible()

  // An unknown id gets a provisional sidebar row and an error pane with a retry.
  await add.fill('999999')
  await add.press('Enter')
  await expect(page).toHaveURL(/#\/game\/999999$/)
  await expect(page.getByTestId('sidebar-game-999999')).toBeVisible()
  await expect(page.getByText('Game not found: 999999')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
})

test('bulk unlock asks for confirmation before marking every unprotected achievement', async ({ page }) => {
  await page.goto('/#/game/487120')
  await expect(page.getByRole('heading', { name: 'Nebula Drift' })).toBeVisible()

  await page.getByRole('button', { name: 'Unlock all' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Apply this bulk action to 11 achievement(s)?')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Unlock all' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Unlock all' }).click()
  // 6 were already unlocked and the protected one is skipped: 5 new pending unlocks.
  await expect(page.getByRole('button', { name: 'Save changes (5)' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ring Champion: Pending unlock/ })).toBeVisible()
  // The protected achievement keeps its "Protected" state and its lock.
  await expect(page.getByRole('button', { name: /Ranked Elite: Protected/ })).toBeVisible()
})

test("filters the sidebar by the player's own categories", async ({ page }) => {
  await page.goto('/')
  const categories = page.getByRole('combobox', { name: 'All categories' })

  await categories.selectOption('Racing')
  await expect(page.getByText('2 / 16 games')).toBeVisible()
  await expect(page.getByTestId('sidebar-game-487120')).toBeVisible()
  await expect(page.getByTestId('sidebar-game-533700')).toBeVisible()
  await expect(page.getByTestId('sidebar-game-503310')).toHaveCount(0)

  await categories.selectOption({ label: 'Uncategorized' })
  await expect(page.getByText('12 / 16 games')).toBeVisible()
  await expect(page.getByTestId('sidebar-game-487120')).toHaveCount(0)

  await categories.selectOption({ label: 'All categories' })
  await expect(page.getByText('16 / 16 games')).toBeVisible()
})

test('switches between cards and list, and re-sorts the achievements', async ({ page }) => {
  await page.goto('/#/game/487120')
  await expect(page.getByRole('heading', { name: 'Nebula Drift' })).toBeVisible()
  const first = page.locator('[data-testid^="achievement-"]').first()

  // Cards: the toggle is a button inside the card; the card itself has no role.
  await expect(first).toHaveAttribute('data-testid', 'achievement-g1_a0')
  await expect(first).not.toHaveAttribute('role', 'button')

  await page.getByRole('button', { name: 'List' }).click()
  await expect(first).toHaveAttribute('role', 'button')
  await expect(first).toHaveAttribute('aria-label', /^Maiden Voyage: Unlocked/)

  const sort = page.getByRole('combobox', { name: 'Sort by' })
  await sort.selectOption('name')
  await expect(first).toHaveAttribute('aria-label', /^Full Cargo/)
  await sort.selectOption('rarity')
  await expect(first).toHaveAttribute('aria-label', /^Ranked Elite/)
  await sort.selectOption('default')
  await expect(first).toHaveAttribute('data-testid', 'achievement-g1_a0')

  await page.getByRole('button', { name: 'Cards' }).click()
  await expect(first).not.toHaveAttribute('role', 'button')
})

test('reset all stats asks for confirmation and restores the saved values', async ({ page }) => {
  await page.goto('/#/game/487120/stats')
  await expect(page.getByText('Total Races')).toBeVisible()
  await page.getByRole('button', { name: 'Enable value editing' }).click()
  const races = page.getByRole('textbox', { name: 'Total Races' })
  await races.fill('129')
  await expect(page.getByText('1 modified')).toBeVisible()

  await page.getByRole('button', { name: 'Reset all stats' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Reset all stats to their last-saved values?')
  await dialog.getByRole('button', { name: 'Reset all stats' }).click()
  await expect(page.getByText('No changes')).toBeVisible()
  await expect(races).toHaveValue('128')
})
