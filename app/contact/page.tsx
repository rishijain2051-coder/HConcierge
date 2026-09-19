import type { Metadata } from 'next'

import { REPLY_PROMISE } from '@/lib/site'
import { Breadcrumbs, SiteFooter, SiteHeader } from '@/components/SiteChrome'
import { submitEnquiry } from './actions'
import SendButton from './SendButton'

export const metadata: Metadata = {
  title: 'Talk to us about your hotel',
  description:
    'Tell us the hotel and how many rooms it has, and we will show you HConcierge running on your own directory. We reply within one working day.',
  alternates: { canonical: '/contact' },
  // A page-level openGraph block replaces the parent's rather than merging
  // with it, which silently drops the shared card image. Named here on purpose.
  openGraph: {
    url: '/contact',
    images: ['/opengraph-image'],
    title: 'Talk to us about your hotel · HConcierge',
    description: 'Tell us the hotel and how many rooms it has. We reply within one working day.',
  },
}

export default async function ContactPage({ searchParams }: PageProps<'/contact'>) {
  const { e } = await searchParams
  const error = typeof e === 'string' ? e : null

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-[1240px] px-4 pt-6 sm:px-6">
        <Breadcrumbs trail={[{ label: 'Talk to us' }]} />

        <div className="grid gap-12 pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-20 lg:pt-14">
          <div>
            <h1 className="font-display max-w-[16ch] text-[clamp(2rem,5vw,3.2rem)] leading-[1.02] tracking-[-0.02em]">
              Tell us about the hotel.
            </h1>
            <p className="text-muted mt-5 max-w-[52ch] text-[16px] leading-relaxed">
              We will set HConcierge up on your own directory - your menu, your prices, your teams - and show you
              the board with it running. Nothing is installed on anybody&rsquo;s phone and no card details are taken
              at any point.
            </p>

            {/* The promise, stated once and kept in lib/site.ts so the
                thank-you page cannot quietly say something different. */}
            <p className="border-line mt-8 border-t pt-6 text-[15px] font-semibold">{REPLY_PROMISE}</p>
            <p className="text-muted mt-2 max-w-[48ch] text-[14px] leading-relaxed">
              Five fields, and only two of them are required. Tell us as little or as much as you like - the room
              count and the message are what let us come back with something useful rather than a brochure.
            </p>

            <dl className="mt-10 grid gap-6 sm:grid-cols-2">
              {[
                ['What it costs to try', 'Nothing. The demo runs on a copy of your directory, not on your guests.'],
                ['How long setup takes', 'An afternoon. Rooms, teams, the directory, then print the cards.'],
                ['What we need from you', 'Your room list and your menu. A PDF or a spreadsheet is fine.'],
                ['Who sees guest data', 'Only the hotel. We never take a payment or store a card.'],
              ].map(([q, a]) => (
                <div key={q} className="border-line border-t pt-3">
                  <dt className="text-[14px] font-semibold">{q}</dt>
                  <dd className="text-muted mt-1 text-[14px] leading-relaxed">{a}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="lg:sticky lg:top-8 lg:self-start">
            <form action={submitEnquiry} className="bg-surface border-line rounded-2xl border p-5 sm:p-6">
              {error && (
                <p className="bg-late-soft text-late mb-4 rounded-xl px-3.5 py-2.5 text-[13px] font-medium">
                  {error}
                </p>
              )}

              <Input name="name" label="Your name" autoComplete="name" required placeholder="Rishi Bhandari" />
              <Input name="hotel" label="Hotel" autoComplete="organization" required placeholder="RN Grand, Pune" />
              <Input
                name="rooms"
                label="How many rooms"
                type="number"
                min={1}
                max={10000}
                placeholder="22"
                hint="Roughly is fine. It tells us what the board will look like."
              />
              <Input
                name="contact"
                label="Email or phone"
                required
                placeholder="you@hotel.com"
                hint="Whichever you would rather we used. We only use it to reply."
              />

              <label className="mb-4 block">
                <span className="mb-1.5 block text-[13px] font-medium">Anything else</span>
                <textarea
                  name="message"
                  rows={4}
                  maxLength={1200}
                  placeholder="We have a restaurant and a spa, and reception takes about forty calls a day…"
                  className="border-line bg-paper focus:border-ink placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-[14px] outline-none transition-colors"
                />
              </label>

              {/* Left empty by people, filled by bots. Hidden from assistive
                  technology as well as from sight, because a screen reader
                  announcing "Company" would make a person fill it in. */}
              <div aria-hidden className="absolute h-0 w-0 overflow-hidden">
                <label>
                  Company
                  <input type="text" name="company" tabIndex={-1} autoComplete="off" />
                </label>
              </div>

              <SendButton />

              <p className="text-faint mt-3 text-center text-[12px] leading-relaxed">
                {REPLY_PROMISE} What you send here is used to answer you and nothing else - see the{' '}
                <a href="/privacy" className="underline decoration-from-font underline-offset-2">
                  privacy policy
                </a>
                .
              </p>
            </form>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}

function Input({
  name,
  label,
  hint,
  ...rest
}: {
  name: string
  label: string
  hint?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      <input
        name={name}
        {...rest}
        className="border-line bg-paper focus:border-ink placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-[14px] outline-none transition-colors"
      />
      {hint && <span className="text-faint mt-1 block text-[12px]">{hint}</span>}
    </label>
  )
}
