import Link from 'next/link'
import DemoStage from './DemoStage'
import { DIRECTORY_BREADTH } from '@/lib/demo-data'
import { IconArrowRight, IconPhoneOff } from '@/components/icons'
import { Logo, Wordmark } from '@/components/Logo'

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-4 py-5 sm:px-6">
        <Wordmark size={20} className="text-[15px] font-semibold tracking-tight" />
        <Link
          href="/staff/login"
          className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-[13px] font-medium transition"
        >
          Staff sign in
          <IconArrowRight size={14} />
        </Link>
      </header>

      <main>
        <section className="mx-auto max-w-[1240px] px-4 pt-10 pb-12 sm:px-6 sm:pt-16">
          <h1 className="font-display max-w-[16ch] text-[clamp(2.75rem,7.4vw,5.25rem)] leading-[0.94] tracking-[-0.03em] text-balance">
            Reception stops being a{' '}
            <span className="italic text-[var(--brand)]">switchboard</span>.
          </h1>

          <div className="mt-7 grid gap-6 md:grid-cols-[minmax(0,58ch)_auto] md:items-end md:justify-between">
            <p className="text-muted text-[17px] leading-[1.55]">
              A guest scans the card on their desk and asks from their own phone. Every request routes to the team
              that actually does it, carries its own target time, and escalates itself the moment that target is
              missed.
            </p>
            <p className="text-faint inline-flex items-center gap-2 text-[13px] md:pb-1">
              <IconPhoneOff size={15} />
              Nothing below is a video
            </p>
          </div>
        </section>

        <section className="pb-20 sm:pb-28">
          <DemoStage />
        </section>

        <section className="border-line border-t">
          <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 sm:py-24">
            <h2 className="font-display max-w-[20ch] text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.02em]">
              And this is what a guest can already ask for.
            </h2>
            <p className="text-muted mt-4 max-w-[62ch] text-[15px] leading-relaxed">
              Every line below is a real row in RN Grand&rsquo;s directory, loaded on day one. Each one knows which
              team owns it and how long it is allowed to take. None of it is a phone call.
            </p>

            {/* A river of real rows rather than a grid of cards: the point is the
                sheer count, and a list makes that argument better than tiles. */}
            <p className="text-muted mt-10 max-w-[104ch] text-[14px] leading-[2.1]">
              {DIRECTORY_BREADTH.map((label, i) => (
                <span key={label}>
                  <span className={i % 7 === 0 ? 'text-ink font-medium' : undefined}>{label}</span>
                  {i < DIRECTORY_BREADTH.length - 1 && <span className="px-2 opacity-40">·</span>}
                </span>
              ))}
            </p>
          </div>
        </section>

        <section className="border-line border-t">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-16 sm:px-6 sm:py-24 md:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] md:gap-16">
            <div>
              <h2 className="font-display max-w-[16ch] text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.02em]">
                Standing it up takes an afternoon.
              </h2>
              <p className="text-muted mt-4 max-w-[52ch] text-[15px] leading-relaxed">
                There is no app for guests to install, no hardware in the rooms, and nothing to replace at the front
                desk. The phones stay on the nightstands. They just stop being the way anyone asks for a towel.
              </p>
            </div>

            {/* Numbered because the order is the instruction, not decoration. */}
            <ol className="divide-line divide-y">
              {[
                [
                  'Load the property',
                  'Menu, rooms, rates, target times and staff. RN Grand and RN Suites both came from one file.',
                ],
                [
                  'Print the cards',
                  'One QR per room, straight from the Rooms screen. A new code is issued at every check-in, so last week’s guest cannot get back in.',
                ],
                [
                  'Sign your team in',
                  'Housekeeping sees housekeeping. The kitchen sees the kitchen. Managers see everything and get the escalations.',
                ],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-5 py-5 first:pt-0 last:pb-0">
                  <span className="font-display text-faint w-6 shrink-0 pt-0.5 text-[22px] leading-none tabular-nums">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold">{title}</span>
                    <span className="text-muted mt-1 block text-[14px] leading-relaxed">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="border-line border-t">
        <div className="text-faint mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-[13px] sm:px-6">
          <span className="inline-flex items-center gap-2">
            <Logo size={15} />
            HConcierge — built for RN Hospitality
          </span>
          <Link href="/staff/login" className="hover:text-ink inline-flex items-center gap-1.5 font-medium transition">
            Staff sign in
            <IconArrowRight size={14} />
          </Link>
        </div>
      </footer>
    </div>
  )
}
