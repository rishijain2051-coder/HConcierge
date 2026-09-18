import Link from 'next/link'

/**
 * Every unmatched URL that is not a room link — a mistyped staff path, a stale
 * bookmark. Room links have their own, better-informed page in
 * `app/r/[token]/not-found.tsx`, which is the one a guest will ever see; this
 * exists so the fallback is not Next.js's black-on-white default, which is the
 * one screen in the product that looks like somebody else's software.
 *
 * Deliberately says nothing about rooms or cards: whoever lands here typed
 * something, and guessing why would be wrong more often than right.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[22px] font-semibold tracking-tight">There is nothing at this address</h1>
      <p className="text-muted mt-2 text-sm leading-relaxed">
        The link may be out of date, or it may have a typo in it.
      </p>
      <Link
        href="/"
        className="border-line text-muted hover:text-ink mt-6 rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition"
      >
        Go to the start
      </Link>
    </div>
  )
}
