import { describe, expect, it } from 'vitest'
import { DEFAULT_ACCENT, rootCssVars, styleTokens, themeTokens } from '../theme'

function luminance(hex: string): number {
  const normalized = /^#[a-f\d]{3}$/i.test(hex)
    ? `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}`
    : hex
  const rgb = normalized.match(/[a-f\d]{2}/gi)?.map((pair) => Number.parseInt(pair, 16) / 255) ?? []
  const linear = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('theme accessibility guardrails', () => {
  it.each(['dark', 'light'] as const)('%s secondary text meets WCAG AA on app surfaces', (theme) => {
    const tokens = themeTokens(theme)
    for (const surface of [tokens.s0, tokens.s1, tokens.s2]) {
      expect(contrast(tokens.t3, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['dark', 'light'] as const)('%s accent label meets WCAG AA', (theme) => {
    const vars = rootCssVars(themeTokens(theme), styleTokens(), DEFAULT_ACCENT) as Record<string, string>
    expect(contrast(vars['--accent-ink'], vars['--accent'])).toBeGreaterThanOrEqual(4.5)
  })
})
