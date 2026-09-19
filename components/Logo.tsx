/**
 * The HConcierge mark: an H whose crossbar is a progress bar, part filled.
 *
 * Same geometry as app/icon.svg, which is the favicon and the apple-icon - one
 * logo drawn twice, because a favicon has to be a file and this has to be a
 * component, and neither can import the other. Change one, change the other.
 *
 * Two tones rather than `currentColor`, because the mark is a badge: the square
 * is ink and the glyph is paper at every size and on every background it is
 * used on. It is the wordmark beside it that takes the colour of its container.
 *
 * Where it belongs: surfaces where HConcierge is the one speaking - the staff
 * chrome, the sign-in door, the marketing page, its own error screens. Not on
 * anything a guest reads or a hotel hands over. The room page, the welcome card
 * and the folio receipt carry the property's name, the property's colour and
 * the property's phone number, and a supplier's logo on a hotel's paper is the
 * supplier's mistake.
 */
export function Logo({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={className}
      style={{ flex: 'none' }}
    >
      <rect width="64" height="64" rx="15" fill="var(--color-ink)" />
      <rect x="17" y="18" width="6.5" height="28" rx="3.25" fill="var(--color-paper)" />
      <rect x="40.5" y="18" width="6.5" height="28" rx="3.25" fill="var(--color-paper)" />
      {/* The bar: a track, and the part of it that has been cleared. */}
      <rect x="23.5" y="29" width="17" height="6" fill="var(--color-paper)" opacity="0.45" />
      <rect x="23.5" y="29" width="10.5" height="6" fill="var(--color-paper)" />
    </svg>
  )
}

/**
 * The mark and the name, locked up.
 *
 * Carries no type of its own - size, weight and colour come from whatever it
 * sits in, which is why the same component works in a 13px footer and above a
 * 40px heading without a variant for either.
 */
export function Wordmark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <Logo size={size} />
      HConcierge
    </span>
  )
}
