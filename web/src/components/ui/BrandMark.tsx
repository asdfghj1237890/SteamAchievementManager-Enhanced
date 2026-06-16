// The app's brand mark — a mini of the trophy app icon (gold trophy on a deep-red
// squircle). Kept in sync with src-tauri/app-icon.svg. Fixed colors (not the theme
// accent) so it always reads as the product logo.
export default function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden
      style={{ flex: '0 0 auto', display: 'block' }}
    >
      <rect width="48" height="48" rx="12" fill="#7a2230" />
      <g transform="translate(24,23) scale(0.17)" fill="#f3bd47">
        <path d="M-75,-90 L75,-90 C75,-25 48,10 0,12 C-48,10 -75,-25 -75,-90 Z" />
        <path d="M-72,-84 C-110,-82 -116,-30 -70,-12" fill="none" stroke="#f3bd47" strokeWidth="16" strokeLinecap="round" />
        <path d="M72,-84 C110,-82 116,-30 70,-12" fill="none" stroke="#f3bd47" strokeWidth="16" strokeLinecap="round" />
        <path d="M-13,12 L13,12 L9,42 L-9,42 Z" />
        <path d="M-22,42 L22,42 L18,56 L-18,56 Z" />
        <path d="M-42,58 L42,58 L54,92 L-54,92 Z" />
      </g>
    </svg>
  )
}
