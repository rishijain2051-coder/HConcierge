'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { rupees } from '@/lib/money'
import {
  departmentLabel,
  guestStep,
  guestSteps,
  offerState,
  KIND_LABEL,
  type Category,
  type GuestPromotion,
  type GuestRequest,
  type GuestState,
  type InfoPage,
  type Item,
} from '@/lib/types'
import { IconArrowRight, IconChat, IconChevron, IconClose } from '@/components/icons'

import { claimOffer } from './actions'
import GuestChat from './GuestChat'
import ItemRow from './ItemRow'
import { useDialog } from './useDialog'

/**
 * The AI Concierge: a conversation made of buttons.
 *
 * Some guests will never touch a tab bar but will happily talk to a chatbot,
 * so this is the same hotel behind a different door: ask what they want, offer
 * what the hotel actually has, and let them tap their way down to an item.
 *
 * "AI Concierge" is the name a guest sees; PRODUCT.md, under Brand
 * Commitments, records what the two letters stand for here and why that
 * expansion stays out of the app. What matters in this file is the mechanism:
 * there is no model behind it, nothing here calls one, and there is no text
 * box on the way down. Every turn is a choice the hotel's own directory put
 * there, which is the point. A menu that cannot be asked a question it has no
 * answer to never invents one, never quotes a price the kitchen did not set,
 * and never promises a service this property does not run. It is also why it
 * needs no key, no budget and no review of what it said to a guest at 3am.
 *
 * Everything it offers is read from `directory` and `info`, so a hotel that
 * adds a category or renames a team gets it here without anybody touching this
 * file. The one screen that does take typing is the last one, where a real
 * person is on the other end and the whole point is to say something we did
 * not anticipate.
 */

type Screen =
  | { at: 'root' }
  | { at: 'food' }
  | { at: 'menu'; id: string }
  | { at: 'services' }
  | { at: 'team'; dept: string }
  | { at: 'offers' }
  | { at: 'info' }
  | { at: 'page'; id: string }
  | { at: 'else' }
  | { at: 'bill' }
  | { at: 'orders' }
  | { at: 'desk' }

type Line = { id: number; from: 'bot' | 'guest'; text: string }

const HELLO = 'Hi! How can I help you?'

/** What a request is called on screen: what was asked for, not its number. */
const titleOf = (r: GuestRequest) =>
  r.items.length > 0
    ? r.items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name)).join(', ')
    : (r.note ?? 'Request')

export default function Concierge({
  token,
  directory,
  info,
  promotions,
  state,
  counts,
  unread,
  raised,
  cartCount,
  cartTotal,
  onTap,
  onBump,
  onOpenBill,
  onSendCart,
  onRefresh,
  onChatSeen,
}: {
  token: string
  directory: Category[]
  info: InfoPage[]
  promotions: GuestPromotion[]
  state: GuestState
  counts: Map<string, number>
  /** Replies from the desk the guest has not looked at yet. */
  unread: number
  /** The basket bar is showing, so the button has to sit above it. */
  raised: boolean
  cartCount: number
  cartTotal: number
  onTap: (i: Item) => void
  onBump: (i: Item, by: number) => void
  onOpenBill: () => void
  /** Sends the basket. `null` when there was nothing in it to send. */
  onSendCart: () => Promise<{ ok: true; teams: number } | { ok: false; error: string } | null>
  onRefresh: () => void
  onChatSeen: () => void
}) {
  const [open, setOpen] = useState(false)
  const [screen, setScreen] = useState<Screen>({ at: 'root' })
  // Where Back goes. A stack rather than a parent lookup, because the same
  // screen is reachable from more than one place.
  const [trail, setTrail] = useState<Screen[]>([])
  const [lines, setLines] = useState<Line[]>([{ id: 0, from: 'bot', text: HELLO }])

  const panel = useRef<HTMLDivElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  const close = useCallback(() => setOpen(false), [])

  const dining = useMemo(() => directory.filter((c) => c.kind === 'fnb' && c.items.length > 0), [directory])
  const serviceCats = useMemo(
    () => directory.filter((c) => c.kind !== 'fnb' && c.items.length > 0),
    [directory],
  )

  /**
   * Services, grouped the way a guest asks for them: by the team that does the
   * work, not by the shelf the hotel files it on. "Housekeeping" then covers
   * towels, cleaning and laundry at once, which is three of this hotel's own
   * categories - so they stay as headings inside it rather than being flattened
   * into one long list with no shape.
   */
  const teams = useMemo(() => {
    const order: string[] = []
    const cats = new Map<string, Category[]>()
    for (const c of serviceCats) {
      for (const dept of new Set(c.items.filter((i) => i.available).map((i) => i.department))) {
        if (!cats.has(dept)) {
          cats.set(dept, [])
          order.push(dept)
        }
        cats.get(dept)!.push(c)
      }
    }
    return order.map((dept) => ({
      dept,
      label: departmentLabel(dept),
      groups: cats
        .get(dept)!
        .map((c) => ({ cat: c, items: c.items.filter((i) => i.department === dept) }))
        .filter((g) => g.items.length > 0),
    }))
  }, [serviceCats])

  const liveRequests = state.requests.filter((r) => r.status !== 'done' && r.status !== 'cancelled')

  /**
   * Claimed since this page loaded. The prop carries what was true when the
   * server rendered, so both are consulted: the server wins on a reload, and
   * this covers the rest of the session.
   *
   * ponytail: optimistic, and only for this device. A second phone in the same
   * room sees the claim on its next load rather than the moment it happens.
   * Push it through GuestState if that ever matters - it would cost a query on
   * every live push, which today it is not worth.
   */
  const [justClaimed, setJustClaimed] = useState<ReadonlySet<string>>(new Set())
  const [claiming, setClaiming] = useState<string | null>(null)

  // Eligibility is recomputed against the live balance rather than read off
  // the prop, so an offer unlocks the moment the meal that pays for it lands.
  const offers = useMemo(
    () =>
      promotions.map((p) => {
        const claimed = p.claimed || justClaimed.has(p.id)
        return { promo: p, claimed, ...offerState(p, state.folio_total_paise, claimed) }
      }),
    [promotions, justClaimed, state.folio_total_paise],
  )

  /** What the concierge says when it arrives at a screen. */
  const speak = useCallback(
    (s: Screen): string => {
      switch (s.at) {
        case 'root':
          return HELLO
        case 'food':
          return 'Here is what the kitchen has. Which menu?'
        case 'menu':
          return `${dining.find((c) => c.id === s.id)?.name ?? 'Menu'}. Tap anything to add it to your basket.`
        case 'services':
          return 'Which team should I ask?'
        case 'team':
          return `Here is everything ${teams.find((t) => t.dept === s.dept)?.label ?? 'this team'} can do.`
        case 'offers':
          return offers.length === 0
            ? 'There is nothing running just now.'
            : 'Here is what we have on at the moment.'
        case 'info':
          return 'What would you like to know?'
        case 'page':
          return info.find((p) => p.id === s.id)?.body ?? 'I do not have that one.'
        case 'else':
          return 'What else can I do for you?'
        case 'bill':
          return state.folio_total_paise > 0
            ? `Your room bill comes to ${rupees(state.folio_total_paise)} so far.`
            : 'Nothing has been charged to the room yet.'
        case 'orders':
          return liveRequests.length === 0
            ? 'Nothing is in progress right now.'
            : `You have ${liveRequests.length} ${liveRequests.length === 1 ? 'request' : 'requests'} with us.`
        case 'desk':
          return 'The front desk reads this one. Say anything you like.'
      }
    },
    [dining, teams, info, offers.length, state.folio_total_paise, liveRequests.length],
  )

  /** One turn: what the guest tapped, then the answer. */
  const go = useCallback(
    (next: Screen, said?: string) => {
      setTrail((t) => [...t, screen])
      setScreen(next)
      setLines((prev) => {
        const add: Line[] = []
        if (said) add.push({ id: nextId.current++, from: 'guest', text: said })
        add.push({ id: nextId.current++, from: 'bot', text: speak(next) })
        return [...prev, ...add]
      })
      if (next.at === 'desk') onChatSeen()
    },
    [screen, speak, onChatSeen],
  )

  const back = useCallback(() => {
    setTrail((t) => {
      if (t.length === 0) return t
      const to = t[t.length - 1]
      setScreen(to)
      setLines((prev) => [...prev, { id: nextId.current++, from: 'bot', text: speak(to) }])
      return t.slice(0, -1)
    })
  }, [speak])

  const restart = useCallback(() => {
    setTrail([])
    setScreen({ at: 'root' })
    setLines((prev) => [...prev, { id: nextId.current++, from: 'bot', text: HELLO }])
  }, [])

  /**
   * Sending the basket is a turn in the conversation, not an exit from it.
   * Closing the panel to hand the guest a form was the old shape and it threw
   * away the thread they had just built; now the answer arrives where they
   * asked, and the concierge goes back to the top ready for the next thing.
   */
  const [sending, setSending] = useState(false)
  const send = useCallback(async () => {
    if (sending) return
    setSending(true)
    const res = await onSendCart()
    setSending(false)
    if (!res) return // nothing in the basket, so nothing to say about it

    setLines((prev) => [
      ...prev,
      { id: nextId.current++, from: 'guest', text: 'Send to the team' },
      {
        id: nextId.current++,
        from: 'bot',
        text: res.ok
          ? `Done. ${res.teams > 1 ? `${res.teams} teams are` : 'The team is'} on it.`
          : res.error,
      },
    ])
    if (res.ok) restart()
  }, [sending, onSendCart, restart])

  /**
   * Taking one up. The server re-checks the threshold and owns the one-per-stay
   * rule, so this is free to be optimistic about the answer and wrong about
   * nothing that matters.
   */
  const claim = useCallback(
    async (promo: GuestPromotion) => {
      if (claiming) return
      setClaiming(promo.id)
      const res = await claimOffer(token, promo.id)
      setClaiming(null)

      const reply = !res.ok
        ? res.error
        : 'already' in res && res.already
          ? 'You have already taken that one up. The desk has it.'
          : `Done. I have let the desk know.${promo.fine_print ? ` ${promo.fine_print}` : ''}`

      setLines((prev) => [
        ...prev,
        { id: nextId.current++, from: 'guest', text: promo.title },
        { id: nextId.current++, from: 'bot', text: reply },
      ])
      if (res.ok) {
        setJustClaimed((prev) => new Set(prev).add(promo.id))
        // The claim raised a request, so the tracker on Home has one more row.
        onRefresh()
      }
    },
    [claiming, token, onRefresh],
  )

  // The newest turn, and the options that go with it, are what matters.
  useEffect(() => {
    if (open) foot.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [lines, open])

  return (
    <>
      <ConciergeButton unread={unread} raised={raised} onOpen={() => setOpen(true)} />
      {open && (
        <div
          className="fixed inset-0 z-[55] sm:flex sm:items-end sm:justify-end sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label="AI Concierge"
        >
          <div
            className="bg-scrim pointer-fine:backdrop-blur-[2px] absolute inset-0"
            style={{ animation: 'hc-fade-in 300ms var(--ease-glide) both' }}
            onClick={close}
          />

          <Panel panelRef={panel} onClose={close}>
            <header className="border-line flex shrink-0 items-center gap-3 border-b px-4 py-3">
              <span className="brand-bg grid h-9 w-9 shrink-0 place-items-center rounded-full text-white">
                <IconChat size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-tight font-semibold tracking-[-0.01em]">AI Concierge</p>
                <p className="text-faint text-[12px] leading-tight">Tap an option, no typing needed</p>
              </div>
              <button
                onClick={close}
                aria-label="Close"
                className="text-faint hover:text-ink bg-paper ease-glide grid h-8 w-8 shrink-0 place-items-center rounded-full transition duration-200 active:scale-90"
              >
                <IconClose size={15} />
              </button>
            </header>

            {/* The conversation so far. */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              {lines.map((l) => (
                <div key={l.id} className={`flex ${l.from === 'guest' ? 'justify-end' : 'justify-start'} mt-2 first:mt-0`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-snug break-words whitespace-pre-line ${
                      l.from === 'guest' ? 'brand-bg rounded-br-md text-white' : 'bg-paper rounded-bl-md'
                    }`}
                  >
                    {l.text}
                  </div>
                </div>
              ))}
              <div ref={foot} />
            </div>

            {/* And what can be said next. Always at the foot, always taps. */}
            <div className="border-line bg-surface shrink-0 border-t">
              <div className="border-line flex items-center gap-2 border-b px-4 py-2">
                {trail.length > 0 && (
                  <button
                    onClick={back}
                    className="text-muted hover:text-ink ease-glide -ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-[13px] font-medium transition duration-200"
                  >
                    <IconChevron size={14} className="rotate-90" />
                    Back
                  </button>
                )}
                <button
                  onClick={restart}
                  className="text-faint hover:text-ink ease-glide ml-auto rounded-full px-1.5 py-1 text-[12px] font-medium transition duration-200"
                >
                  Start over
                </button>
              </div>

              {screen.at === 'desk' ? (
                <div className="max-h-[58dvh] overflow-y-auto overscroll-contain">
                  <GuestChat token={token} messages={state.messages} onSent={onRefresh} embedded />
                </div>
              ) : (
                <div className="max-h-[42dvh] overflow-y-auto overscroll-contain px-4 py-3">
                  <Options
                    screen={screen}
                    dining={dining}
                    teams={teams}
                    info={info}
                    offers={offers}
                    claiming={claiming}
                    onClaim={claim}
                    requests={liveRequests}
                    counts={counts}
                    hasChat={state.messages.length > 0}
                    onGo={go}
                    onTap={onTap}
                    onBump={onBump}
                    onOpenBill={() => {
                      close()
                      onOpenBill()
                    }}
                  />
                </div>
              )}

              {/* The app's basket bar lives behind this panel, which on a phone
                  covers the whole screen - so anything added in here had no way
                  out. Same words, but it sends from here rather than handing
                  the guest off to a form. */}
              {cartCount > 0 && screen.at !== 'desk' && (
                <div className="border-line border-t px-3 py-2.5">
                  <button
                    onClick={send}
                    disabled={sending}
                    className="bg-ink ease-glide flex w-full items-center gap-3 rounded-full py-2.5 pr-4 pl-3 text-white transition duration-300 active:scale-[0.985] disabled:opacity-50"
                  >
                    <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/20 px-1.5 text-[12px] font-bold tabular-nums">
                      {cartCount}
                    </span>
                    <span className="flex-1 text-left text-[13.5px] font-semibold tracking-[-0.01em]">
                      {sending ? 'Sending…' : `Send to the team${cartTotal > 0 ? ` · ${rupees(cartTotal)}` : ''}`}
                    </span>
                    <IconArrowRight size={15} />
                  </button>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
    </>
  )
}

/**
 * Split out so the focus trap mounts with the panel rather than with the
 * button - the hook grabs focus and locks the page, which must not happen
 * while the concierge is merely sitting in the corner.
 */
function Panel({
  panelRef,
  onClose,
  children,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  useDialog(panelRef, onClose)
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      style={{ animation: 'hc-sheet-in 460ms var(--ease-glide) both' }}
      className="bg-surface relative flex h-full w-full flex-col overflow-hidden shadow-[var(--shadow-float)] sm:h-[min(38rem,84dvh)] sm:w-[25rem] sm:rounded-[28px]"
    >
      {children}
    </div>
  )
}

/* --------------------------------------------------------------- the button */

function ConciergeButton({
  unread,
  raised,
  onOpen,
}: {
  unread: number
  raised: boolean
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      aria-label={unread > 0 ? `AI Concierge, ${unread} new ${unread === 1 ? 'reply' : 'replies'}` : 'AI Concierge'}
      /* Clear of the tab bar, and clear of the basket bar as well when there
         is something in the basket - landing on top of it made the one button
         a guest most needs to reach unreachable. */
      className={`bg-ink ease-glide fixed right-4 z-40 flex items-center gap-2 rounded-full py-3 pr-4 pl-3.5 text-white shadow-[var(--shadow-float)] transition-all duration-300 active:scale-[0.96] ${
        raised
          ? 'bottom-[calc(env(safe-area-inset-bottom)+7.6rem)]'
          : 'bottom-[calc(env(safe-area-inset-bottom)+4.6rem)]'
      }`}
    >
      <IconChat size={17} />
      <span className="text-[14px] font-semibold tracking-[-0.01em]">AI Concierge</span>
      {unread > 0 && (
        <span className="bg-late absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold text-white tabular-nums">
          {unread}
        </span>
      )}
    </button>
  )
}

/* -------------------------------------------------------------- the options */

function Chip({ icon, label, onClick }: { icon?: string | null; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-paper hover:bg-surface ease-glide inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-left text-[14px] font-medium shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_9%,transparent)] transition duration-200 active:scale-[0.97]"
    >
      {icon && <span aria-hidden>{icon}</span>}
      {label}
    </button>
  )
}

function Options({
  screen,
  dining,
  teams,
  info,
  offers,
  claiming,
  onClaim,
  requests,
  counts,
  hasChat,
  onGo,
  onTap,
  onBump,
  onOpenBill,
}: {
  screen: Screen
  dining: Category[]
  teams: { dept: string; label: string; groups: { cat: Category; items: Item[] }[] }[]
  info: InfoPage[]
  offers: { promo: GuestPromotion; claimed: boolean; available: boolean; shortBy: number; note: string }[]
  claiming: string | null
  onClaim: (p: GuestPromotion) => void
  requests: GuestRequest[]
  counts: Map<string, number>
  hasChat: boolean
  onGo: (s: Screen, said?: string) => void
  onTap: (i: Item) => void
  onBump: (i: Item, by: number) => void
  onOpenBill: () => void
}) {
  const wrap = 'flex flex-wrap gap-2'
  const rows = (items: Item[]) => (
    <div className="divide-line divide-y">
      {items.map((i) => (
        <ItemRow key={i.id} item={i} qty={counts.get(i.id) ?? 0} onTap={onTap} onBump={onBump} />
      ))}
    </div>
  )

  switch (screen.at) {
    case 'root':
      return (
        <div className={wrap}>
          {dining.length > 0 && <Chip icon="🍽️" label="Food & drink" onClick={() => onGo({ at: 'food' }, 'Food & drink')} />}
          {teams.length > 0 && <Chip icon="🛎️" label="Services" onClick={() => onGo({ at: 'services' }, 'Services')} />}
          {offers.length > 0 && <Chip icon="🎁" label="Promotions" onClick={() => onGo({ at: 'offers' }, 'Promotions')} />}
          {info.length > 0 && <Chip icon="ℹ️" label="Information" onClick={() => onGo({ at: 'info' }, 'Information')} />}
          <Chip icon="💬" label="Anything else" onClick={() => onGo({ at: 'else' }, 'Anything else')} />
        </div>
      )

    case 'food':
      return (
        <div className={wrap}>
          {dining.map((c) => (
            <Chip key={c.id} icon={c.icon} label={c.name} onClick={() => onGo({ at: 'menu', id: c.id }, c.name)} />
          ))}
        </div>
      )

    case 'menu':
      return rows(dining.find((c) => c.id === screen.id)?.items ?? [])

    case 'services':
      return (
        <div className={wrap}>
          {teams.map((t) => (
            <Chip key={t.dept} label={t.label} onClick={() => onGo({ at: 'team', dept: t.dept }, t.label)} />
          ))}
        </div>
      )

    case 'team': {
      const team = teams.find((t) => t.dept === screen.dept)
      if (!team) return null
      return (
        <div className="space-y-4">
          {team.groups.map(({ cat, items }) => (
            <div key={cat.id}>
              <p className="text-faint mb-0.5 text-[12px] font-medium">
                {cat.icon ? `${cat.icon} ` : ''}
                {cat.name}
              </p>
              {rows(items)}
            </div>
          ))}
        </div>
      )
    }

    case 'offers':
      return (
        <div className="space-y-2.5">
          {offers.map(({ promo, available, note }) => (
            <div
              key={promo.id}
              className="bg-paper rounded-2xl p-3.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_9%,transparent)]"
            >
              {/* The headline is what they get, not what it is called: "15% off"
                  reads before the title does, and "Complimentary" is the whole
                  offer on a free one. */}
              <p className="text-faint text-[11px] font-semibold tracking-wide uppercase">
                {promo.kind === 'discount' && promo.percent_off
                  ? `${promo.percent_off}% off`
                  : KIND_LABEL[promo.kind]}
              </p>
              <p className="text-[14.5px] leading-snug font-semibold">{promo.title}</p>
              <p className="text-muted mt-1 text-[13px] leading-relaxed">{promo.description}</p>
              {promo.fine_print && <p className="text-faint mt-1 text-[11.5px]">{promo.fine_print}</p>}
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <span className={`text-[12px] font-medium ${available ? 'brand-text' : 'text-faint'}`}>{note}</span>
                {available && (
                  <button
                    onClick={() => onClaim(promo)}
                    disabled={claiming !== null}
                    className="brand-bg ease-glide shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-white transition duration-200 active:scale-[0.97] disabled:opacity-40"
                  >
                    {claiming === promo.id ? '…' : 'Claim'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )

    case 'info':
    case 'page':
      return (
        <div className={wrap}>
          {info
            .filter((p) => !(screen.at === 'page' && p.id === screen.id))
            .map((p) => (
              <Chip key={p.id} icon={p.icon} label={p.title} onClick={() => onGo({ at: 'page', id: p.id }, p.title)} />
            ))}
        </div>
      )

    case 'else':
      return (
        <div className={wrap}>
          <Chip icon="🧾" label="My bill" onClick={() => onGo({ at: 'bill' }, 'My bill')} />
          <Chip icon="📋" label="What I have asked for" onClick={() => onGo({ at: 'orders' }, 'What I have asked for')} />
          <Chip
            icon="💬"
            label={hasChat ? 'Read the front desk' : 'Message the front desk'}
            onClick={() => onGo({ at: 'desk' }, 'Message the front desk')}
          />
        </div>
      )

    case 'bill':
      return (
        <div className={wrap}>
          <Chip icon="🧾" label="Open my bill" onClick={onOpenBill} />
        </div>
      )

    case 'orders':
      if (requests.length === 0) {
        return (
          <div className={wrap}>
            <Chip icon="🛎️" label="Ask for something" onClick={() => onGo({ at: 'services' }, 'Services')} />
          </div>
        )
      }
      return (
        <div className="divide-line divide-y">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[14px]">{titleOf(r)}</span>
              <span className="text-faint shrink-0 text-[12px] font-medium">
                {guestSteps(r.department)[guestStep(r.status)]}
              </span>
            </div>
          ))}
        </div>
      )

    case 'desk':
      return null
  }
}
