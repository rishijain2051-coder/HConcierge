import type { Metadata } from 'next'
import Link from 'next/link'

import { REPLY_PROMISE } from '@/lib/site'
import { Breadcrumbs, SiteFooter, SiteHeader } from '@/components/SiteChrome'
import { IconArrowRight } from '@/components/icons'

/**
 * Where the form lands.
 *
 * `noindex` on purpose, and it is not an oversight: a thank-you page in a
 * search result is a page somebody reaches without having sent anything, which
 * makes every sentence on it a lie. It is also the conversion URL, so keeping
 * it out of the index keeps the number honest.
 */
export const metadata: Metadata = {
  title: 'Thank you',
  description: 'Your enquiry has reached us.',
  // Self-canonical rather than inheriting the root's, which points at `/`.
  alternates: { canonical: '/thank-you' },
  robots: { index: false, follow: true },
}

export default function ThankYouPage() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-[1240px] px-4 pt-6 sm:px-6">
        <Breadcrumbs trail={[{ label: 'Talk to us', href: '/contact' }, { label: 'Thank you' }]} />

        <div className="max-w-[46rem] pt-10 pb-4 lg:pt-16">
          <h1 className="font-display max-w-[14ch] text-[clamp(2rem,5vw,3.2rem)] leading-[1.02] tracking-[-0.02em]">
            That has reached us.
          </h1>
          <p className="text-muted mt-5 max-w-[52ch] text-[16px] leading-relaxed">
            {REPLY_PROMISE} A person reads it, not an autoresponder, and the reply comes from whoever can actually
            answer the question you asked.
          </p>

          <div className="border-line mt-10 border-t pt-8">
            <h2 className="text-[15px] font-semibold">What happens next</h2>
            <ol className="mt-4 grid gap-5 sm:grid-cols-3">
              {[
                ['We read it', 'Your room count and your teams tell us what the board will look like.'],
                ['We build your directory', 'Your menu, your prices, your target times. Send a PDF and we will do it.'],
                ['You see it running', 'On a real phone and a real board, before anything is printed.'],
              ].map(([t, d], i) => (
                <li key={t} className="border-line border-t pt-3">
                  <span className="text-faint text-[12px] font-semibold tabular-nums">0{i + 1}</span>
                  <p className="mt-1 text-[14px] font-semibold">{t}</p>
                  <p className="text-muted mt-1 text-[14px] leading-relaxed">{d}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/#demo"
              className="bg-ink inline-flex items-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold text-white transition hover:opacity-90"
            >
              Have another look at the demo
              <IconArrowRight size={15} />
            </Link>
            <Link
              href="/contact"
              className="border-line text-muted hover:text-ink inline-flex items-center rounded-xl border px-4 py-3 text-[14px] font-semibold transition"
            >
              Send us something else
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
