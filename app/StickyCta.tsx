'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { IconArrowRight } from '@/components/icons'

/**
 * The phone-only bar that appears once the hero's buttons have scrolled away.
 *
 * Phone only on purpose. On a laptop the header is always in view and already
 * carries "Talk to us"; a bar pinned over a long page there is something to
 * dismiss, not something to tap.
 *
 * It waits for the hero rather than appearing at a pixel count, because the
 * hero is `clamp()`-sized and its height is different on every handset. An
 * IntersectionObserver on the element itself is the only measurement that is
 * right on all of them, and it costs no scroll handler.
 *
 * It also stands off the bottom far enough to clear the cookie notice while
 * that is up - two bars stacked on a 375px screen is most of the content.
 */
export default function StickyCta() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const hero = document.getElementById('hero-cta')
    if (!hero) return
    const io = new IntersectionObserver(([entry]) => setShow(!entry.isIntersecting), { threshold: 0 })
    io.observe(hero)
    return () => io.disconnect()
  }, [])

  return (
    <div
      aria-hidden={!show}
      className={`fixed inset-x-0 bottom-0 z-30 p-3 sm:hidden ${
        show ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <Link
        href="/contact"
        tabIndex={show ? undefined : -1}
        className={`bg-ink ease-glide flex items-center justify-center gap-2 rounded-full px-5 py-3.5 text-[14px] font-semibold text-white shadow-[var(--shadow-float)] transition-all duration-300 active:scale-[0.98] ${
          show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
        }`}
      >
        Talk to us about your hotel
        <IconArrowRight size={15} />
      </Link>
    </div>
  )
}
