import { expect, test } from './fixtures'

test('@smoke renders the main routes and demo data', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  await expect(page.getByTestId('library-screen')).toBeVisible()
  await expect(page.getByTestId('library-game-487120')).toBeVisible()

  await page.getByTestId('library-game-487120').click()
  await expect(page).toHaveURL(/#\/game\/487120$/)
  await expect(page.getByRole('heading', { name: 'Nebula Drift' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Search achievements…' })).toBeVisible()

  await page.getByRole('button', { name: 'Statistics' }).click()
  await expect(page).toHaveURL(/#\/game\/487120\/stats$/)
  await expect(page.getByText('Total Races')).toBeVisible()

  await page.getByTestId('settings-toggle').click()
  await expect(page).toHaveURL(/#\/settings$/)
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
})

test('@smoke survives an unknown route by returning to the library', async ({ page }) => {
  await page.goto('/#/not-a-real-route')
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
})

test('@smoke remains usable at the minimum supported window size', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  await expect(page.getByTestId('settings-toggle')).toBeVisible()

  await page.getByTestId('sidebar-game-487120').click()
  await expect(page.getByRole('heading', { name: 'Nebula Drift' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
})
