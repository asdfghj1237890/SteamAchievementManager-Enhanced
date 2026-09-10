import { expect, test } from './fixtures'

/**
 * Scale check against the synthetic 2,000-game / 500-achievement library
 * (`?mock=large`, see src/data/mockScale.ts). There are no stopwatch assertions —
 * those flake on shared runners; the budget is Playwright's expect timeout on each
 * step, which a pathological render (a non-virtualized list, an O(n) pass per
 * keystroke over 2,000 rows) would blow through.
 */
test('@perf stays responsive with a 2,000-game, 500-achievement library', async ({ page }) => {
  await page.goto('/?mock=large')
  await expect(page.getByText('2000 / 2000 games')).toBeVisible()

  const search = page.getByRole('textbox', { name: 'Search games…' })
  await search.fill('Synthetic Game 1999')
  await expect(page.getByText('1 / 2000 games')).toBeVisible()
  await expect(page.getByTestId('sidebar-game-9001999')).toBeVisible()
  await search.fill('')
  await expect(page.getByText('2000 / 2000 games')).toBeVisible()

  await page.getByTestId('sidebar-game-9000001').click()
  await expect(page.getByRole('heading', { name: 'Synthetic Game 0001' })).toBeVisible()
  await expect(page.getByText('Showing 500 / 500')).toBeVisible()

  const achSearch = page.getByRole('textbox', { name: 'Search achievements…' })
  await achSearch.fill('number 499 of')
  await expect(page.getByText('Showing 1 / 500')).toBeVisible()
  await page.getByRole('button', { name: /Achievement 499: Locked/ }).click()
  await expect(page.getByRole('button', { name: /Achievement 499: Pending unlock/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save changes (1)' })).toBeVisible()

  await achSearch.fill('')
  await expect(page.getByText('Showing 500 / 500')).toBeVisible()
  await page.getByRole('button', { name: 'Statistics' }).click()
  await expect(page.getByText('Stat 39')).toBeVisible()
})
