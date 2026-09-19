import Link from 'next/link'

import { REPLY_PROMISE, SITE_NAME, SITE_URL } from '@/lib/site'
import DemoStage from './DemoStage'
import StaffSignInLink from './StaffSignInLink'
import StickyCta from './StickyCta'
import { SiteFooter, SiteHeader } from '@/components/SiteChrome'
import {
  IconAlarm,
  IconArrowRight,
  IconBell,
  IconChat,
  IconCheck,
  IconDining,
  IconHome,
  IconInfo,
  IconMenu,
  IconPhoneOff,
  IconReceipt,
} from '@/components/icons'

/**
 * One capability. A rule above it rather than a box around it: a page with
 * twenty bordered cards reads as a brochure, and the border is doing the same
 * job the grid gap already does.
 *
 * `span` lets the grid be a bento rather than a row of identical thirds. The
 * spans are chosen so every row fills exactly - an empty cell at the end of a
 * bento is a planning mistake, not a design.
 */
function Cell({
  icon: Icon,
  title,
  span = '',
  children,
}: {
  icon: typeof IconBell
  title: string
  span?: string
  children: React.ReactNode
}) {
  // A cell twice as wide with the same 46ch of prose in it is not a wide cell,
  // it is a normal one with a hole beside it. So the lead cell puts its title
  // and its paragraph side by side: the inner halves land exactly on the outer
  // columns, because the inner gap is the outer gap.
  const wide = span !== ''
  return (
    <div className={`reveal border-line border-t pt-4 ${span}`}>
      <Icon size={17} className="text-faint" />
      <div className={wide ? 'lg:grid lg:grid-cols-2 lg:gap-x-8' : ''}>
        <h3 className="mt-2.5 text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
        <p className={`text-muted mt-1.5 max-w-[46ch] text-[14px] leading-relaxed ${wide ? 'lg:mt-2.5' : ''}`}>
          {children}
        </p>
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <div className="min-h-dvh">
      {/* Structured data, so a search result can carry the product's name and
          what it is rather than the first 30 words of the hero. Static, built
          from lib/site.ts - nothing here comes from a request. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: SITE_NAME,
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web',
            url: SITE_URL,
            description:
              'In-room hotel guest requests without the phone call. Every request routes to the team that does it, carries its own target time, and escalates itself when that time is missed.',
            audience: { '@type': 'Audience', audienceType: 'Hotels' },
            publisher: { '@type': 'Organization', name: 'Draveta Technologies', url: 'https://draveta.vercel.app' },
          }),
        }}
      />
      <SiteHeader />

      <main>
        {/* Hero. Headline, one short line, one thing to do. Everything else
            that used to live here has a section of its own further down. */}
        <section className="mx-auto max-w-[1240px] px-4 pt-10 pb-12 sm:px-6 sm:pt-16">
          <h1 className="font-display max-w-[16ch] text-[clamp(2.75rem,7.4vw,5.25rem)] leading-[0.94] tracking-[-0.03em] text-balance">
            Reception stops being a <span className="text-[var(--brand)] italic">switchboard</span>.
          </h1>

          <div className="mt-7 flex flex-wrap items-end justify-between gap-6">
            <p className="text-muted max-w-[46ch] text-[17px] leading-[1.55]">
              Guests ask from their own phone. Every request routes to the team that does it, and escalates itself
              when it runs late.
            </p>
            {/* Both of them above the fold, and in that order: the demo is
                what convinces, the form is what we want. Somebody who already
                knows should not have to scroll the whole page to find a way
                to say so. */}
            <div id="hero-cta" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <a
                  href="#demo"
                  className="bg-ink ease-glide inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] font-semibold text-white transition duration-300 hover:opacity-90 active:translate-y-[1px]"
                >
                  Try the working demo
                  <IconArrowRight size={15} />
                </a>
                <Link
                  href="/contact"
                  className="border-line hover:border-ink ease-glide inline-flex items-center gap-2 rounded-full border px-5 py-3 text-[14px] font-semibold transition duration-300 active:translate-y-[1px]"
                >
                  Talk to us about your hotel
                </Link>
              </div>
              <p className="text-faint text-[13px]">{REPLY_PROMISE} No card details, ever.</p>
            </div>
          </div>
        </section>

        <section id="demo" className="scroll-mt-4 pb-20 sm:pb-28">
          <DemoStage />
        </section>

        {/* Bento. Deliberately uneven: the lead cell is twice the width of its
            neighbour. Eight capabilities, eight cells, rows of 2+1 then 1+1+1
            twice, so every row fills and none of it ends on a hole. */}
        <section id="guest" className="border-line scroll-mt-4 border-t">
          <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 sm:py-24">
            <h2 className="font-display reveal max-w-[20ch] text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.02em]">
              What the guest gets, without installing anything.
            </h2>
            <p className="text-muted reveal mt-4 max-w-[64ch] text-[15px] leading-relaxed">
              A QR card on the desk opens in whatever browser the phone already has. No app, no account, no
              password. The card identifies the room; a four-digit code from the front desk proves it is this guest,
              this stay.
            </p>

            <div className="mt-12 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              <Cell icon={IconChat} title="An AI Concierge that cannot make things up" span="lg:col-span-2">
                The whole hotel as a conversation made of buttons. It asks which team can help, then shows that
                team&rsquo;s entire list. No typing on the way down, and nothing behind it that could invent a price
                the kitchen never set or promise a service the property does not run.
              </Cell>
              <Cell icon={IconBell} title="Or one tap, from the menu">
                Towels, a charger, the room made up, the tap that drips.
              </Cell>

              <Cell icon={IconDining} title="Room service with a basket">
                The full list, with portion sizes, choices and a running total before anything is sent.
              </Cell>
              <Cell icon={IconAlarm} title="Asked for now, or for seven o&rsquo;clock">
                Scheduled work waits for its hour before its clock starts, so nothing escalates before anyone could
                have begun.
              </Cell>
              <Cell icon={IconCheck} title="Watched, as it moves">
                Sent, Accepted, then the step that fits the team: Cooking, Tidying, Arranging. It updates as the
                staff member touches it.
              </Cell>

              <Cell icon={IconInfo} title="The hotel, answered">
                Wi-Fi and its password, breakfast hours, the pool, house rules. Written by the hotel, edited by the
                hotel.
              </Cell>
              <Cell icon={IconPhoneOff} title="And a person, without the call">
                One message box reaches the desk for the thing no menu covers. A real person answers it, from the
                board.
              </Cell>
              <Cell icon={IconReceipt} title="The bill, and never a card">
                Every charge as it is posted. Asking to settle puts the room and its balance on the board: no card
                details are taken anywhere in the product, and none ever will be.
              </Cell>
            </div>
          </div>
        </section>

        {/* Split, with the heading holding its place while the list moves. A
            different shape from the bento above on purpose. */}
        <section id="reception" className="border-line scroll-mt-4 border-t">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-20">
            <div className="lg:sticky lg:top-12 lg:self-start">
              <h2 className="font-display text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.02em]">
                What reception sees instead of a ringing phone.
              </h2>
              <p className="text-muted mt-4 text-[15px] leading-relaxed">
                One board per property, live. Requests land on it as they are sent, ordered by how close each is to
                its target rather than by when it was typed.
              </p>
            </div>

            <dl className="divide-line divide-y">
              {[
                [
                  IconMenu,
                  'The board',
                  'Every open request, grouped by team, each with the room, what was asked for, who took it and how long it has left. Housekeeping sees housekeeping. A manager sees all of it.',
                ],
                [
                  IconAlarm,
                  'An alarm that will not stop',
                  'A new request rings until somebody accepts it. Not a chime, not once: a full ring every few seconds. Accepting is what silences it.',
                ],
                [
                  IconCheck,
                  'Accept from the lock screen',
                  'A push notification carrying an Accept button, so a duty manager clears a request without opening anything. For a phone with no app open, the same job list arrives as a WhatsApp link.',
                ],
                [
                  IconChat,
                  'Reply to the room',
                  'A message panel beside the board, with the lines the desk sends most already written and still editable before they go.',
                ],
                [
                  IconHome,
                  'Rooms, codes and cards',
                  'Check in, check out, reissue a code, print the QR cards. Every room shows what it has open and what it owes, and checking out invalidates every device that stay used.',
                ],
                [
                  IconReceipt,
                  'A receipt on the roll',
                  'Through the browser print dialog, or as raw ESC/POS to a thermal printer. The same paper either way, down to how the rupee sign is drawn.',
                ],
              ].map(([Icon, title, body]) => {
                const Ico = Icon as typeof IconBell
                return (
                  <div key={title as string} className="reveal flex gap-5 py-6 first:pt-0">
                    <Ico size={17} className="text-faint mt-0.5 shrink-0" />
                    <div>
                      <dt className="text-[15px] font-semibold tracking-[-0.01em]">{title as string}</dt>
                      <dd className="text-muted mt-1.5 max-w-[58ch] text-[14px] leading-relaxed">
                        {body as string}
                      </dd>
                    </div>
                  </div>
                )
              })}
            </dl>
          </div>
        </section>

        {/* A rail, not cards: these four are one sequence and the line between
            them is the content. */}
        <section className="border-line border-t">
          <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 sm:py-24">
            <h2 className="font-display reveal max-w-[22ch] text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.02em]">
              And what happens when nobody picks it up.
            </h2>
            <p className="text-muted reveal mt-4 max-w-[64ch] text-[15px] leading-relaxed">
              This is the part a phone call cannot do. Every item carries its own target, because a towel is not a
              biryani, and the hotel sets the clock. None of it needs anyone to be watching a screen.
            </p>

            <ol className="relative mt-12 grid gap-y-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-8">
              {/* The rail itself, behind the four markers. */}
              <span
                aria-hidden
                className="bg-line absolute top-[7px] right-0 left-0 hidden h-px lg:block"
              />
              {[
                ['On time', 'The countdown runs on the board and nobody is troubled.', 'bg-ok'],
                ['Running close', 'At a share of the target the hotel chooses, the card turns amber on every board that can see it.', 'bg-warn'],
                [
                  'Late',
                  'The target passes, the card goes red, and the guest is told so on their own screen rather than left guessing.',
                  'bg-late',
                ],
                [
                  'Escalated',
                  'A rung fires: the team lead, then a manager, then whoever the hotel named, by WhatsApp or SMS, with the room and the wait in the message.',
                  'bg-ink',
                ],
              ].map(([title, body, tone]) => (
                <li key={title} className="reveal relative lg:pr-6">
                  <span className={`block h-[15px] w-[15px] rounded-full ${tone} ring-paper ring-4`} />
                  <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
                  <p className="text-muted mt-1.5 text-[14px] leading-relaxed">{body}</p>
                </li>
              ))}
            </ol>

            <p className="text-faint reveal mt-10 max-w-[64ch] text-[13.5px] leading-relaxed">
              The ladder is per team and per property, written on a screen rather than in code: how many minutes
              past, who it reaches, and whether it fires only when nobody has accepted yet.
            </p>
          </div>
        </section>

        <section id="setup" className="border-line scroll-mt-4 border-t">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-16 sm:px-6 sm:py-24 md:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] md:gap-16">
            <div>
              <h2 className="font-display max-w-[16ch] text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.02em]">
                Standing it up takes an afternoon.
              </h2>
              <p className="text-muted mt-4 max-w-[52ch] text-[15px] leading-relaxed">
                There is no app for guests to install, no hardware in the rooms, and nothing to replace at the front
                desk. The phones stay on the nightstands. They just stop being the way anyone asks for a towel.
              </p>
              <p className="text-muted mt-4 max-w-[52ch] text-[15px] leading-relaxed">
                One account can run several properties, each with its own directory, teams, targets and staff, and
                every change anyone makes is written down and readable afterwards.
              </p>
            </div>

            {/* Numbered because the order is the instruction, not decoration. */}
            <ol className="divide-line divide-y">
              {[
                [
                  'Load the property',
                  'Menu, rooms, rates, target times and staff. Two properties, a full directory each, from one file.',
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

        {/* The close. It used to offer only "Staff sign in", which is a door
            for somebody who already has an account - the one visitor this page
            is not written for. */}
        <section className="border-line border-t">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-end justify-between gap-6 px-4 py-14 sm:px-6">
            <div>
              <p className="font-display max-w-[24ch] text-[clamp(1.5rem,2.6vw,2rem)] leading-[1.1] tracking-[-0.02em]">
                Put it on your own directory.
              </p>
              <p className="text-muted mt-2 max-w-[48ch] text-[15px] leading-relaxed">
                Send us your room list and your menu and we will show you the board running on them.{' '}
                {REPLY_PROMISE}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                href="/contact"
                className="bg-ink ease-glide inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] font-semibold text-white transition duration-300 hover:opacity-90 active:translate-y-[1px]"
              >
                Talk to us about your hotel
                <IconArrowRight size={15} />
              </Link>
              <StaffSignInLink className="border-line hover:border-ink ease-glide inline-flex items-center gap-2 rounded-full border px-5 py-3 text-[14px] font-semibold transition duration-300">
                Staff sign in
              </StaffSignInLink>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />

      {/* Mobile only, and only once the hero button has gone by. */}
      <StickyCta />
    </div>
  )
}
