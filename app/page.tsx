import DemoStage from './DemoStage'
import StaffSignInLink from './StaffSignInLink'
import { DIRECTORY_BREADTH, DIRECTORY_COUNT } from '@/lib/demo-data'
import {
  IconAlarm,
  IconAlert,
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
import { Logo, Wordmark } from '@/components/Logo'

/**
 * One capability, stated plainly.
 *
 * A rule under each rather than a card around it: twenty bordered boxes on one
 * page reads as a brochure, and the page is long enough that the furniture
 * would outweigh the content.
 */
function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof IconBell
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-line border-t pt-4">
      <Icon size={17} className="text-faint" />
      <h3 className="mt-2.5 text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="text-muted mt-1.5 text-[14px] leading-relaxed">{children}</p>
    </div>
  )
}

function Section({
  title,
  lead,
  children,
}: {
  title: string
  lead: string
  children: React.ReactNode
}) {
  return (
    <section className="border-line border-t">
      <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 sm:py-24">
        <h2 className="font-display max-w-[20ch] text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.02em]">
          {title}
        </h2>
        <p className="text-muted mt-4 max-w-[64ch] text-[15px] leading-relaxed">{lead}</p>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  )
}

const GRID = 'grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3'

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-4 py-5 sm:px-6">
        <Wordmark size={20} className="text-[15px] font-semibold tracking-tight" />
        <StaffSignInLink className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-[13px] font-medium transition">
          Staff sign in
          <IconArrowRight size={14} />
        </StaffSignInLink>
      </header>

      <main>
        <section className="mx-auto max-w-[1240px] px-4 pt-10 pb-12 sm:px-6 sm:pt-16">
          <h1 className="font-display max-w-[16ch] text-[clamp(2.75rem,7.4vw,5.25rem)] leading-[0.94] tracking-[-0.03em] text-balance">
            Reception stops being a <span className="text-[var(--brand)] italic">switchboard</span>.
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

        <Section
          title="What the guest gets, without installing anything."
          lead="A QR card on the desk opens in whatever browser the phone already has. There is no app, no account and no password — the card identifies the room, and a four-digit code from the front desk proves it is this guest, this stay."
        >
          <div className={GRID}>
            <Feature icon={IconBell} title="Ask in one tap">
              Towels, a charger, the room made up, the tap that drips. Every line is already routed and already
              carries the time it is allowed to take.
            </Feature>
            <Feature icon={IconDining} title="Order from the menu">
              The full room-service list with a basket, portion sizes and choices — no onion, extra spicy — and a
              running total before anything is sent.
            </Feature>
            <Feature icon={IconAlarm} title="Ask for it at a time">
              A wake-up call at seven, a car at four. Scheduled work waits for its hour before the clock on it
              starts, so nothing escalates hours before anyone could have begun.
            </Feature>
            <Feature icon={IconCheck} title="Watch it move">
              Sent, Accepted, then the step that fits the team — Cooking, Tidying, Arranging — then Done. It updates
              on the guest&rsquo;s screen as the staff member touches it, not on a refresh.
            </Feature>
            <Feature icon={IconChat} title="Or just talk to the AI Concierge">
              The same hotel as a conversation made of buttons: Food, Services, Promotions, Information. It asks
              which team, then shows that team&rsquo;s whole list. No typing, and nothing it can invent.
            </Feature>
            <Feature icon={IconInfo} title="The hotel, answered">
              Wi-Fi and its password, breakfast hours, pool and gym, house rules, what is worth walking to. Written
              by the hotel, edited by the hotel.
            </Feature>
            <Feature icon={IconReceipt} title="The bill, itemised, any time">
              Every charge as it is posted, with what it was for. A guest can ask to settle, which puts the room and
              its balance on the desk&rsquo;s board.
            </Feature>
            <Feature icon={IconAlert} title="And a person, when it matters">
              One message box reaches the desk directly, for the thing nothing on the menu covers. A real person
              answers it, from the board.
            </Feature>
          </div>

          <p className="text-faint mt-9 max-w-[64ch] text-[13.5px] leading-relaxed">
            No card details are taken anywhere in the product, and none ever will be. Settling a bill is a person
            walking up with a card machine — HConcierge only tells them to.
          </p>
        </Section>

        <Section
          title="What reception sees instead of a ringing phone."
          lead="One board per property, live. Requests arrive on it the moment a guest sends them, sorted by how close each is to its target rather than by when it happened to be typed."
        >
          <div className={GRID}>
            <Feature icon={IconMenu} title="The board">
              Every open request, grouped by team, each with the room, what was asked for, who took it and how long
              it has left. Housekeeping sees housekeeping; a manager sees all of it.
            </Feature>
            <Feature icon={IconAlarm} title="An alarm that will not stop">
              A new request rings on the board until somebody accepts it — not once, not a chime, a full ring every
              few seconds. Accepting it is what silences it.
            </Feature>
            <Feature icon={IconCheck} title="Accept from anywhere">
              A push notification with an Accept button on it, so a duty manager clears a request from the lock
              screen. For a phone with no app open, the same job list arrives as a WhatsApp link.
            </Feature>
            <Feature icon={IconChat} title="Reply to the room">
              A message panel beside the board, with the lines the desk sends most already written — on the way,
              breakfast hours, late checkout confirmed — editable before they go.
            </Feature>
            <Feature icon={IconHome} title="Rooms, codes and cards">
              Check in, check out, reissue a code, print the QR cards. Every room shows its open requests and what
              it owes, and checking out invalidates every device that stay used.
            </Feature>
            <Feature icon={IconReceipt} title="A receipt on the roll">
              The room&rsquo;s charges through the browser&rsquo;s print dialog, or as raw ESC/POS to a thermal
              printer — the same paper either way, down to how the rupee sign is drawn.
            </Feature>
          </div>
        </Section>

        <section className="border-line border-t">
          <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 sm:py-24">
            <h2 className="font-display max-w-[22ch] text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.02em]">
              And what happens when nobody picks it up.
            </h2>
            <p className="text-muted mt-4 max-w-[64ch] text-[15px] leading-relaxed">
              This is the part a phone call cannot do. Every item carries its own target — a towel is not a biryani
              — and the clock is the hotel&rsquo;s to set. Nothing here needs anyone to be watching the screen.
            </p>

            <ol className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['On time', 'The request sits on the board with its countdown running. Green, and nobody is troubled.'],
                [
                  'Running close',
                  'At a share of the target the hotel chooses, the card turns amber on every board that can see it.',
                ],
                [
                  'Late',
                  'The target passes. The card goes red and the request is marked late — on the guest’s screen too, honestly, rather than pretending.',
                ],
                [
                  'Escalated',
                  'A rung fires: the team lead, then a manager, then whoever the hotel named — by WhatsApp or SMS, with the room and the wait in the message.',
                ],
              ].map(([title, body], i) => (
                <li key={title} className="border-line border-t pt-4">
                  <span className="font-display text-faint block text-[22px] leading-none tabular-nums">
                    {i + 1}
                  </span>
                  <span className="mt-2.5 block text-[15px] font-semibold tracking-[-0.01em]">{title}</span>
                  <span className="text-muted mt-1.5 block text-[14px] leading-relaxed">{body}</span>
                </li>
              ))}
            </ol>

            <p className="text-faint mt-9 max-w-[64ch] text-[13.5px] leading-relaxed">
              The ladder is per team and per property, written on a screen rather than in code: how many minutes
              past, who it reaches, and whether it only fires if nobody has accepted yet.
            </p>
          </div>
        </section>

        <section className="border-line border-t">
          <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 sm:py-24">
            <h2 className="font-display max-w-[20ch] text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.02em]">
              All {DIRECTORY_COUNT} things a guest can already ask for.
            </h2>
            <p className="text-muted mt-4 max-w-[64ch] text-[15px] leading-relaxed">
              This is the directory the demo above is running on, loaded from one file. Each line knows which team
              owns it and how long it is allowed to take — and the hotel edits all of it, including the teams.
            </p>

            {/* Grouped by the team that owns the work. As one run of names it
                argued only "there are a lot of these", and on a phone it was a
                wall; the routing is the more interesting claim and it is free
                to show. */}
            <div className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {DIRECTORY_BREADTH.map((group) => (
                <div key={group.team} className="border-line border-t pt-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{group.team}</h3>
                    <span className="text-faint text-[12px] tabular-nums">{group.items.length}</span>
                  </div>
                  <p className="text-muted mt-2 text-[13.5px] leading-[1.85]">
                    {group.items.map((label, i) => (
                      <span key={label}>
                        {label}
                        {i < group.items.length - 1 && <span className="px-1.5 opacity-40">·</span>}
                      </span>
                    ))}
                  </p>
                </div>
              ))}
            </div>
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
              <p className="text-muted mt-4 max-w-[52ch] text-[15px] leading-relaxed">
                One account can run several properties, each with its own directory, teams, targets and staff — and
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

        <section className="border-line border-t">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-6 px-4 py-14 sm:px-6">
            <p className="font-display max-w-[24ch] text-[clamp(1.5rem,2.6vw,2rem)] leading-[1.1] tracking-[-0.02em]">
              Have a look at the desk side.
            </p>
            <StaffSignInLink className="bg-ink inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] font-semibold text-white transition hover:opacity-90">
              Staff sign in
              <IconArrowRight size={15} />
            </StaffSignInLink>
          </div>
        </section>
      </main>

      <footer className="border-line border-t">
        <div className="text-faint mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-[13px] sm:px-6">
          {/* The sentence is one flex child, not three: the gap-2 that spaces the
              mark from the text would otherwise open up mid-sentence either
              side of the link. */}
          <span className="inline-flex items-center gap-2">
            <Logo size={15} />
            <span>
              HConcierge — built by{' '}
              <a
                href="https://draveta.vercel.app"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-ink font-medium underline decoration-from-font underline-offset-2 transition"
              >
                Draveta Technologies
              </a>
            </span>
          </span>
          <StaffSignInLink className="hover:text-ink inline-flex items-center gap-1.5 font-medium transition">
            Staff sign in
            <IconArrowRight size={14} />
          </StaffSignInLink>
        </div>
      </footer>
    </div>
  )
}
