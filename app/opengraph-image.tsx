import { ImageResponse } from 'next/og'

/**
 * The card that appears when somebody pastes a link into WhatsApp.
 *
 * Drawn rather than stored: the site has no photography and never has had, so
 * a screenshot would be the only image in the product and would go stale the
 * first time the homepage changed. This is the same sentence the page leads
 * with, set on the same paper, and it cannot drift from a design it is built
 * out of.
 *
 * System fonts on purpose. Fetching EB Garamond here would put a network call
 * on the edge render of an image that is cached for a year, and the mark plus
 * the wording is what carries the brand at thumbnail size.
 */
export const alt = 'HConcierge - the hotel room that does not have to phone reception'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#faf8f5',
          color: '#1c1917',
          padding: 72,
          fontFamily: 'Georgia, serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, fontWeight: 600 }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#0F766E" strokeWidth="1.8">
            <path d="M4 19h16M6 19v-6a6 6 0 0 1 12 0v6M12 7V4" strokeLinecap="round" />
          </svg>
          HConcierge
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: '-0.02em', maxWidth: 960 }}>
            Reception stops being a switchboard.
          </div>
          <div style={{ fontSize: 30, lineHeight: 1.4, color: '#5f5852', maxWidth: 880 }}>
            Guests ask from their own phone. Every request routes to the team that does it, carries its own
            target time, and escalates itself when that time is missed.
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 24, color: '#78716c' }}>
          No app, no account, no card details. Built by Draveta Technologies.
        </div>
      </div>
    ),
    size,
  )
}
