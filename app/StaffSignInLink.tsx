'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

const HREF = '/staff/login'

/* motion-organic is a barrel over 25 transitions, 15 text effects, a Web Audio
   engine and an SVG morpher. Statically imported it was the largest thing on
   the marketing page, downloaded and parsed by every visitor before first
   paint, to decorate one link that most of them never click.

   So it is fetched on the first sign of intent - hover, focus, or the
   pointerdown that precedes the click - and the handler below uses it only if
   it has already arrived. A cold click is an ordinary link: no stall waiting
   on a module, and navigating without the bubble is the faster outcome
   anyway. */
let motion: typeof import('motion-organic') | null = null
let warming: Promise<void> | null = null
const warm = () =>
  (warming ??= import('motion-organic').then((m) => {
    motion = m
  }))

/** The package's .d.ts stops at the base class and declares neither of these,
 *  though every transition has them. Narrower than reaching for `any`. */
type Tunable = {
  setOrigin(x: number, y: number): void
  baseSpring: { stiffness: number; damping: number; precision: number }
}

/* The knob. Stock is 100/22, which is overdamped and crawls to a stop — a
   second to cover and two round trip. The fastest shipped preset ('snappy',
   180/20) still took 666ms just to cover. This is stiffer and just under
   critical damping, and the looser precision cuts the long tail where the
   blob is technically still settling but nothing is visibly moving. */
const SPRING = { stiffness: 320, damping: 30, precision: 0.02 }

const FADE_MS = 160

/* marketing/brand/logo-lockup-invert.svg, inlined. It lives outside public/
   so it is not servable, and a transition this short cannot wait on a
   request anyway — this has to paint on the first frame. Only change from
   the file on disk: the wordmark's font-family points at the variable
   next/font actually defines, since the literal 'Instrument Sans' does not
   match the scoped family name it generates. */
const LOCKUP = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 64" width="100%" height="100%">
  <rect width="64" height="64" rx="15" fill="#faf8f5"/>
  <rect x="17" y="18" width="6.5" height="28" rx="3.25" fill="#1c1917"/>
  <rect x="40.5" y="18" width="6.5" height="28" rx="3.25" fill="#1c1917"/>
  <rect x="23.5" y="29" width="17" height="6" fill="#1c1917" opacity="0.45"/>
  <rect x="23.5" y="29" width="10.5" height="6" fill="#1c1917"/>
  <text x="80" y="41" fill="#faf8f5"
        font-family="var(--font-sans-stack), 'Segoe UI', system-ui, sans-serif"
        font-size="27" font-weight="600" letter-spacing="-0.8">HConcierge</text>
</svg>`

/** Sits one layer above the blob and clears with it. Built by hand for the
 *  same reason the blob is: it has to outlive the React tree it was clicked
 *  from. Decorative — the route change is what a screen reader announces. */
function showLoadingCard() {
  const card = document.createElement('div')
  card.setAttribute('aria-hidden', 'true')
  Object.assign(card.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '10000', // the blob's svg sits at 9999
    display: 'grid',
    placeContent: 'center',
    justifyItems: 'center',
    gap: '1.25rem',
    opacity: '0',
    transition: `opacity ${FADE_MS}ms linear`,
    pointerEvents: 'none',
  })

  const logo = document.createElement('div')
  logo.style.width = 'clamp(240px, 40vw, 400px)'
  logo.innerHTML = LOCKUP

  const note = document.createElement('p')
  note.textContent = 'Loading…'
  Object.assign(note.style, {
    margin: '0',
    fontFamily: 'var(--font-sans-stack), system-ui, sans-serif',
    fontSize: '14px',
    letterSpacing: '0.01em',
    color: 'rgb(250 248 245 / 0.65)',
  })

  card.append(logo, note)
  document.body.appendChild(card)
  requestAnimationFrame(() => {
    card.style.opacity = '1'
  })
  return card
}

/** The one door from the marketing page into the back of house. Both the
 *  header and the footer link go through here so they open the same way. */
export default function StaffSignInLink({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const router = useRouter()

  return (
    <Link
      href={HREF}
      className={className}
      onPointerEnter={warm}
      onPointerDown={warm}
      onFocus={warm}
      onClick={(e) => {
        // New tab, new window, middle click: the browser owns those, not us.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        // Not warm yet - let the browser follow the link.
        if (!motion) return
        // LiquidBlobTransition overrides trigger() and so never reaches the
        // base class's reduced-motion check. It has to happen here or the
        // blob bubbles for people who asked it not to.
        if (motion.isReducedMotionPreferred()) return

        e.preventDefault()
        const { clientX, clientY } = e

        // Deliberately not owned by React. This page unmounts the moment the
        // route swaps, and anything tied to that lifecycle would be torn down
        // mid-cover — cutting to the login screen instead of clearing off it.
        // Both of these live on document.body and clear up after themselves.
        const blob = new motion.LiquidBlobTransition({ color: '#1c1917' })
        const tuned = blob as unknown as Tunable
        Object.assign(tuned.baseSpring, SPRING)
        const card = showLoadingCard()

        void blob
          .trigger(e.nativeEvent, () => {
            router.push(HREF)
            // One way, not a round trip. trigger() grows the blob out of the
            // click and then shrinks it back into that same point, which
            // reads as a bubble rather than as travel. Moving the origin to
            // the far corner here — at full occlusion, so the jump is not
            // visible — makes the second half drain away instead of rewind.
            tuned.setOrigin(window.innerWidth - clientX, window.innerHeight - clientY)
            // Go out with the blob, not after it, or the wordmark is left
            // hanging over the login screen.
            card.style.opacity = '0'
          })
          .then(() => {
            card.remove()
            blob.destroy()
          })
      }}
    >
      {children}
    </Link>
  )
}
