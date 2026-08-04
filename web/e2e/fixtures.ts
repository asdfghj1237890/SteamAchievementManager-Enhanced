import { expect, test as base } from '@playwright/test'

export const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`)
    })
    await page.addInitScript(() => {
      localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    })
    await use(errors)
    expect(errors, 'browser runtime errors').toEqual([])
  }, { auto: true }],
})

export { expect } from '@playwright/test'
