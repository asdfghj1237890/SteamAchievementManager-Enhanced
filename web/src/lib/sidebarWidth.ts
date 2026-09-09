/**
 * The sidebar's live width is a CSS custom property on <html>, not a React prop: the
 * drag handle writes it directly on every mousemove, and only the final value is
 * committed to app state (and persisted) on mouseup. That keeps a drag from
 * re-rendering the whole tree and writing localStorage 60+ times a second.
 */
export const SIDEBAR_WIDTH_VAR = '--sidebar-w'

export function applySidebarWidth(px: number): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty(SIDEBAR_WIDTH_VAR, `${px}px`)
}
