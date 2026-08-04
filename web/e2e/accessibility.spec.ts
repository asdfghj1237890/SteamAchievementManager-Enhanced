import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'

async function expectAccessible(page: ConstructorParameters<typeof AxeBuilder>[0]['page']) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
  }))).toEqual([])
}

test('@a11y library has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  await expectAccessible(page)
})

test('@a11y game detail has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/#/game/487120')
  await expect(page.getByRole('heading', { name: 'Nebula Drift' })).toBeVisible()
  await expectAccessible(page)
})

test('@a11y statistics has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/#/game/487120/stats')
  await expect(page.getByText('Total Races')).toBeVisible()
  await expectAccessible(page)
})

test('@a11y settings has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expectAccessible(page)
})
