/**
 * One shared collator for every name sort. `String.prototype.localeCompare` resolves
 * the locale and builds a collator on each call, which adds up when a sort comparator
 * runs tens of thousands of times (1000 achievements ≈ 10k comparisons per re-sort).
 * No options, so the ordering is exactly what `localeCompare` produced before.
 */
const collator = new Intl.Collator()

export const compareNames = (a: string, b: string): number => collator.compare(a, b)
