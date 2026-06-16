import type { CSSProperties } from 'react'

// Shared style primitives, ported from the design's inline style objects.
// Color/size values reference the CSS custom properties set on .dc-root.

export const segBase: CSSProperties = {
  padding: '7px 13px', borderRadius: 'var(--radius)', border: '1px solid var(--bd)',
  background: 'transparent', color: 'var(--t2)', cursor: 'pointer', fontSize: '12.5px',
  fontWeight: 600, fontFamily: 'inherit', lineHeight: 1.2, transition: 'all .15s',
}

export const segOn: CSSProperties = {
  ...segBase, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff',
  boxShadow: '0 2px 10px -3px var(--accent)',
}

export const ghost: CSSProperties = { ...segBase, padding: '7px 12px', color: 'var(--t1)' }

export const ckBase: CSSProperties = {
  width: '22px', height: '22px', flex: '0 0 auto', borderRadius: '6px', display: 'flex',
  alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '13px',
  fontWeight: 800, transition: 'all .15s', border: '1.5px solid var(--t3)', color: '#fff',
}

export const CARD_BASE: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '10px', padding: 'var(--cardpad)',
  borderRadius: 'var(--radius-lg)', border: '1px solid var(--bd)', background: 'var(--s2)',
  position: 'relative', transition: 'border-color .15s, transform .12s', boxShadow: 'var(--elev)',
}

/** Striped gradient cover placeholder, parameterized by hue (matches the design). */
export const coverGradient = (hue: number, stripeStep = 14, stripeWidth = 3): string =>
  `repeating-linear-gradient(118deg, rgba(255,255,255,.07) 0 ${stripeWidth}px, transparent ${stripeWidth}px ${stripeStep}px), ` +
  `linear-gradient(135deg, hsl(${hue} 54% 48%), hsl(${(hue + 34) % 360} 58% 36%))`
