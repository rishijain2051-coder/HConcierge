'use client'

import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Makes an overlay behave like the modal it says it is.
 *
 * A dialog that sets aria-modal and then lets Tab wander the page behind it is
 * worse than one that never claimed to be modal at all. This keeps focus
 * inside the panel, closes on Escape, stops the page underneath scrolling, and
 * hands focus back to whatever opened it.
 *
 * Shared by the item/cart/bill sheets and the concierge panel — the second
 * overlay on this screen is exactly where a hand-rolled copy of this starts
 * drifting from the first.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const panel = ref.current
    const returnTo = document.activeElement as HTMLElement | null
    const inside = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])

    ;(inside()[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return
      const items = inside()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      returnTo?.focus()
    }
  }, [ref, onClose])
}
