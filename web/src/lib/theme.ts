import type { CSSProperties } from 'react'
import type { Theme, ThemeTokens, StyleTokens } from '../types'

// ---- color tokens (ported verbatim from the design's T()) ----
const DARK: ThemeTokens = {
  appBg: '#0a0d12', win: '#0f141b', s0: '#0d1117', s1: '#11161e', s2: '#161d27', s3: '#1e2734',
  bd: 'rgba(255,255,255,.08)', bds: 'rgba(255,255,255,.045)', t1: '#e8eef6', t2: '#9aabbf', t3: '#647588',
  good: '#3ad07f', danger: '#ff6a6a', shadow: '0 1px 2px rgba(0,0,0,.45)',
}

const LIGHT: ThemeTokens = {
  appBg: '#e6eaf0', win: '#dde2e9', s0: '#f2f4f8', s1: '#ffffff', s2: '#ffffff', s3: '#eef1f6',
  bd: 'rgba(16,32,48,.12)', bds: 'rgba(16,32,48,.06)', t1: '#12202e', t2: '#506275', t3: '#8493a3',
  good: '#11a25c', danger: '#dc4b4b', shadow: '0 1px 3px rgba(20,40,70,.13)',
}

export const themeTokens = (theme: Theme): ThemeTokens => (theme === 'light' ? LIGHT : DARK)

// Only the "Slate" style survived the final design iteration (compact/soft were removed).
export const styleTokens = (): StyleTokens => ({
  radius: '10px', radiusLg: '14px', cardpad: '14px', gap: '12px', cardmin: '224px',
  meta: "'IBM Plex Mono',ui-monospace,monospace", elev: 'var(--shadow)',
})

// The app's single accent — the logo red (brightened from the trophy squircle's
// base so progress bars stay legible on the dark theme). Used for selection,
// progress, and primary buttons. Not user-configurable.
export const DEFAULT_ACCENT = '#cf3a50'

/** Build the CSS custom properties + base styles for the root container. */
export function rootCssVars(T: ThemeTokens, ST: StyleTokens, accent: string): CSSProperties {
  return {
    '--accent': accent,
    '--app-bg': T.appBg, '--win': T.win, '--s0': T.s0, '--s1': T.s1, '--s2': T.s2, '--s3': T.s3,
    '--bd': T.bd, '--bds': T.bds, '--t1': T.t1, '--t2': T.t2, '--t3': T.t3,
    '--good': T.good, '--danger': T.danger, '--shadow': T.shadow,
    '--radius': ST.radius, '--radius-lg': ST.radiusLg, '--cardpad': ST.cardpad,
    '--gap': ST.gap, '--cardmin': ST.cardmin, '--meta': ST.meta, '--elev': ST.elev,
  } as CSSProperties
}
