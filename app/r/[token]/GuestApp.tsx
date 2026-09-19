'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hotelTime, wallClockNow } from '@/lib/clock'
import { rupees } from '@/lib/money'
import { minutesRemaining, notDueYet, since } from '@/lib/sla'
import { useLive } from '@/lib/use-live'
import {
  guestStep,
  guestSteps,
  type Category,
  type GuestPromotion,
  type GuestRequest,
  type GuestState,
  type InfoPage,
  type Item,
  type Property,
  type Room,
} from '@/lib/types'
import {
  IconArrowRight,
  IconBell,
  IconChevron,
  IconClose,
  IconDining,
  IconHome,
  IconInfo,
  IconMinus,
  IconPlus,
  IconReceipt,
} from '@/components/icons'
import { askToSettle, cancelRequest, submitCart, submitFreeform } from './actions'
import Concierge from './Concierge'
import ItemRow, { isSimple, Stepper } from './ItemRow'
import { useDialog } from './useDialog'

type Chosen = { group: string; name: string; price_paise: number }
type CartEntry = { key: string; item: Item; qty: number; modifiers: Chosen[]; note: string }
type Tab = 'home' | 'dining' | 'services' | 'info'
type Toast = { text: string; tone: 'ok' | 'bad' }

const cartKey = (item: Item, mods: Chosen[], note: string) =>
  [item.id, ...mods.map((m) => `${m.group}:${m.name}`).sort(), note].join('|')

const entryUnit = (e: CartEntry) => e.item.price_paise + e.modifiers.reduce((s, m) => s + m.price_paise, 0)

/**
 * The example note, in the language of the team who will read it. One
 * placeholder read "No onion, extra napkins, leave outside the door" on every
 * item in the hotel — including the wake-up call.
 */
const NOTE_HINT: Record<string, string> = {
  fnb: 'No onion, extra spicy, no ice…',
  housekeeping: 'Leave it outside the door, knock twice…',
  maintenance: 'It only happens in the evening…',
  front_desk: 'Anything we should know…',
}

function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function GuestApp({
  token,
  room,
  property,
  directory,
  info,
  promotions,
  initialState,
  serverNow,
}: {
  token: string
  room: Room
  property: Property
  directory: Category[]
  info: InfoPage[]
  promotions: GuestPromotion[]
  initialState: GuestState
  // The server's clock. Threaded down to useClock and greeting so the first
  // client render matches the server-rendered HTML instead of re-reading the
  // clock and tripping hydration.
  serverNow: number
}) {
  const [tab, setTab] = useState<Tab>('home')
  // Which section of each catalogue is open. Held here rather than inside
  // Catalog, which unmounts on every tab change — so a guest reading the
  // desserts went to check a message and came back to the starters.
  const [section, setSection] = useState<Record<string, string>>({})
  const [cart, setCart] = useState<CartEntry[]>([])
  const [sheetItem, setSheetItem] = useState<Item | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [billOpen, setBillOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  // Everything from the desk after this is unread. Set when the guest looks.
  const [chatSeenAt, setChatSeenAt] = useState(serverNow)

  // Pushed from the server the moment anything in this room changes.
  const { state, refresh, gone } = useLive<GuestState>({
    initial: initialState,
    streamUrl: `/api/guest/${token}/live`,
    pollUrl: `/api/guest/${token}/state`,
  })

  const dining = useMemo(() => directory.filter((c) => c.kind === 'fnb'), [directory])
  const services = useMemo(() => directory.filter((c) => c.kind !== 'fnb'), [directory])

  // How many of each item are in the basket, so a row can show its own count
  // without every row reading the whole cart.
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of cart) map.set(e.item.id, (map.get(e.item.id) ?? 0) + e.qty)
    return map
  }, [cart])

  const cartCount = cart.reduce((s, e) => s + e.qty, 0)
  const cartTotal = cart.reduce((s, e) => s + entryUnit(e) * e.qty, 0)
  const unreadFromStaff = state.messages.filter(
    (m) => m.sender === 'staff' && new Date(m.created_at).getTime() > chatSeenAt,
  ).length

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const bump = useCallback((item: Item, by: number) => {
    const key = cartKey(item, [], '')
    setCart((prev) => {
      const found = prev.find((e) => e.key === key)
      if (!found) return by > 0 ? [...prev, { key, item, qty: by, modifiers: [], note: '' }] : prev
      const qty = Math.min(20, found.qty + by)
      return qty <= 0 ? prev.filter((e) => e.key !== key) : prev.map((e) => (e.key === key ? { ...e, qty } : e))
    })
  }, [])

  const addConfigured = useCallback((item: Item, modifiers: Chosen[], note: string, qty: number) => {
    const key = cartKey(item, modifiers, note)
    setCart((prev) => {
      const found = prev.find((e) => e.key === key)
      if (found) return prev.map((e) => (e.key === key ? { ...e, qty: Math.min(20, e.qty + qty) } : e))
      return [...prev, { key, item, qty, modifiers, note }]
    })
    setToast({ text: `${item.name} added`, tone: 'ok' })
  }, [])

  // A plain item counts up in place; one with choices has to be configured.
  const tapItem = useCallback((item: Item) => (isSimple(item) ? bump(item, 1) : setSheetItem(item)), [bump])

  const chooseSection = useCallback(
    (kind: string, id: string) => setSection((prev) => ({ ...prev, [kind]: id })),
    [],
  )

  const openBill = useCallback(() => setBillOpen(true), [])
  const openCart = useCallback(() => setCartOpen(true), [])
  const markChatSeen = useCallback(() => setChatSeenAt(Date.now()), [])

  if (gone) {
    return (
      <div
        className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 text-center"
        style={{ ['--brand' as string]: property.brand_color }}
      >
        <h1 className="font-display text-[clamp(1.8rem,7vw,2.4rem)] leading-[1.05] tracking-[-0.02em]">
          This stay has ended
        </h1>
        <p className="text-muted mt-3 text-[15px] leading-relaxed">
          Room {room.number} has been checked out, so this phone is signed out. If you are still with us, scan the
          card on the desk and enter your code again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="brand-bg ease-glide mx-auto mt-7 rounded-full px-6 py-3 text-[15px] font-semibold text-white transition duration-300 active:scale-[0.98]"
        >
          Start again
        </button>
        {property.phone && <p className="text-faint mt-6 text-[13px]">Front desk — {property.phone}</p>}
      </div>
    )
  }

  return (
    <div
      className="mx-auto flex min-h-svh max-w-2xl flex-col"
      style={{ ['--brand' as string]: property.brand_color, ['--brand-soft' as string]: `${property.brand_color}12` }}
    >
      {/* Opaque on a phone, frosted on a desktop.
          A `backdrop-filter` under a sticky or fixed layer is re-run over
          everything behind it on every scrolled frame, and the menu stacks
          three of them — this header, the category rail below it, and the
          nav at the bottom. A desktop GPU does that for nothing; a handset
          drops frames and the scroll goes sticky under the thumb, which is
          the single biggest reason this screen felt rusty on a phone. What
          is lost is a translucency nobody can see once the bar is opaque. */}
      <header className="bg-surface pointer-fine:bg-surface/85 pointer-fine:backdrop-blur-xl sticky top-0 z-30">
        <div className="border-line flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-ink truncate text-[15px] leading-tight font-semibold tracking-[-0.01em]">
              {property.name}
            </p>
            <p className="text-faint text-[12px]">
              Room {room.number}
              {room.room_type ? ` · ${room.room_type}` : ''}
            </p>
          </div>

          <BillChip total={state.folio_total_paise} onOpen={() => setBillOpen(true)} />
        </div>
      </header>

      <main className={`flex-1 ${cartCount > 0 ? 'pb-40' : 'pb-24'}`}>
        {tab === 'home' && (
          <Home
            room={room}
            property={property}
            directory={directory}
            state={state}
            token={token}
            counts={counts}
            onTap={tapItem}
            onBump={bump}
            onToast={setToast}
            onRefresh={refresh}
            serverNow={serverNow}
          />
        )}
        {tab === 'dining' && (
          <Catalog
            kind="dining"
            categories={dining}
            active={section.dining ?? ''}
            onActive={chooseSection}
            counts={counts}
            onTap={tapItem}
            onBump={bump}
            emptyHint="The kitchen menu is being updated."
          />
        )}
        {tab === 'services' && (
          <Catalog
            kind="services"
            categories={services}
            active={section.services ?? ''}
            onActive={chooseSection}
            counts={counts}
            onTap={tapItem}
            onBump={bump}
            emptyHint="No services listed yet."
          />
        )}
        {tab === 'info' && <Info pages={info} property={property} />}
      </main>

      {cartCount > 0 && (
        <BasketBar count={cartCount} total={cartTotal} onOpen={() => setCartOpen(true)} />
      )}

      <nav className="bg-surface pointer-fine:bg-surface/90 pointer-fine:backdrop-blur-xl border-line fixed inset-x-0 bottom-0 z-30 border-t">
        <div className="mx-auto flex max-w-2xl pb-[env(safe-area-inset-bottom)]">
          {(
            [
              ['home', 'Home', IconHome],
              ['dining', 'Dining', IconDining],
              ['services', 'Services', IconBell],
              ['info', 'Hotel', IconInfo],
            ] as const
          ).map(([id, label, Ico]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`ease-glide relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors duration-300 ${
                tab === id ? 'brand-text' : 'text-faint'
              }`}
            >
              <Ico size={19} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* The same hotel behind a different door, for the guests who would
          rather be asked what they want than go looking for it. It carries the
          desk's unread replies now that the tab bar no longer has a Chat tab,
          and it lifts clear of the basket bar when there is one. */}
      <Concierge
        token={token}
        directory={directory}
        info={info}
        promotions={promotions}
        state={state}
        counts={counts}
        unread={unreadFromStaff}
        raised={cartCount > 0}
        cartCount={cartCount}
        cartTotal={cartTotal}
        onOpenCart={openCart}
        onTap={tapItem}
        onBump={bump}
        onOpenBill={openBill}
        onRefresh={refresh}
        onChatSeen={markChatSeen}
      />

      {sheetItem && (
        <ItemSheet
          item={sheetItem}
          onClose={() => setSheetItem(null)}
          onAdd={(mods, note, qty) => {
            addConfigured(sheetItem, mods, note, qty)
            setSheetItem(null)
          }}
        />
      )}

      {cartOpen && (
        <CartSheet
          token={token}
          timezone={property.timezone}
          cart={cart}
          total={cartTotal}
          onClose={() => setCartOpen(false)}
          onChange={setCart}
          onDone={(msg) => {
            setCart([])
            setCartOpen(false)
            setTab('home')
            setToast({ text: msg, tone: 'ok' })
            refresh()
          }}
          onError={(text) => setToast({ text, tone: 'bad' })}
        />
      )}

      {billOpen && (
        <BillSheet
          token={token}
          room={room}
          state={state}
          onClose={() => setBillOpen(false)}
          onToast={setToast}
          onRefresh={refresh}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-32 z-[70] flex justify-center px-4"
        >
          <div
            className={`rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-float)] ${
              toast.tone === 'ok' ? 'bg-ink' : 'bg-late'
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ header + bars */

function BillChip({ total, onOpen }: { total: number; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="ease-glide flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_9%,transparent)] transition duration-300 active:scale-[0.97]"
    >
      <IconReceipt size={14} className="text-faint" />
      <span className="text-[13px] font-semibold tabular-nums">{total > 0 ? rupees(total) : 'Bill'}</span>
    </button>
  )
}

/**
 * The basket, always in view.
 *
 * The old flow made you open a sheet to find out what you had done. The count
 * and the total live down here instead, so the menu can be read in one pass.
 */
function BasketBar({ count, total, onOpen }: { count: number; total: number; onOpen: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.65rem)] z-30 px-3">
      <button
        onClick={onOpen}
        className="bg-ink ease-glide mx-auto flex w-full max-w-2xl items-center gap-3 rounded-full py-3 pr-5 pl-4 text-white shadow-[var(--shadow-float)] transition duration-300 active:scale-[0.985]"
      >
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/20 px-1.5 text-[12px] font-bold tabular-nums">
          {count}
        </span>
        <span className="flex-1 text-left text-[14px] font-semibold tracking-[-0.01em]">
          {total > 0 ? rupees(total) : 'Nothing to pay'}
        </span>
        <IconArrowRight size={15} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ home */

function Home({
  room,
  property,
  directory,
  state,
  token,
  counts,
  onTap,
  onBump,
  onToast,
  onRefresh,
  serverNow,
}: {
  room: Room
  property: Property
  directory: Category[]
  state: GuestState
  token: string
  counts: Map<string, number>
  onTap: (i: Item) => void
  onBump: (i: Item, by: number) => void
  onToast: (t: Toast) => void
  onRefresh: () => void
  serverNow: number
}) {
  const [freeform, setFreeform] = useState('')
  const [sending, setSending] = useState(false)

  // The clock only matters while there is something to timestamp, and it lives
  // here so a tick re-renders the trackers rather than the whole app. Read
  // before it is used: a render that calls Date.now() itself is not a function
  // of its props, and React is right to complain.
  const now = useClock(state.requests.length > 0, serverNow)

  // A finished order stays on the tracker for a few minutes, so the guest
  // actually sees it reach "Delivered" instead of it vanishing into Earlier.
  const justDone = (r: GuestRequest) =>
    r.status === 'done' && r.completed_at != null && now - new Date(r.completed_at).getTime() < 180_000
  const open = state.requests.filter((r) => (r.status !== 'done' && r.status !== 'cancelled') || justDone(r))
  const recent = state.requests
    .filter((r) => (r.status === 'done' || r.status === 'cancelled') && !justDone(r))
    .slice(0, 4)

  // One shortcut per kind of need, taken from the top of each section, so this
  // stays correct when the hotel edits its own directory.
  const quick = useMemo(
    () =>
      directory
        .filter((c) => c.kind === 'amenity' || c.kind === 'front_desk')
        .map((c) => c.items.find((i) => i.available))
        .filter((i): i is Item => Boolean(i))
        .slice(0, 6),
    [directory],
  )

  async function sendFreeform() {
    const text = freeform.trim()
    if (!text || sending) return
    setSending(true)
    const res = await submitFreeform(token, text)
    setSending(false)
    if (res.ok) {
      setFreeform('')
      onToast({ text: 'Sent to the front desk', tone: 'ok' })
      onRefresh()
    } else {
      onToast({ text: res.error, tone: 'bad' })
    }
  }

  return (
    <div className="space-y-8 px-4 pt-7">
      <h1 className="text-[28px] leading-[1.08] font-semibold tracking-[-0.03em] text-balance">
        {greeting(new Date(now))}
        {room.guest_name ? `, ${room.guest_name.replace(/^(Mr\.|Ms\.|Mrs\.|Dr\.)\s*/, '')}` : ''}
      </h1>

      {open.length > 0 && (
        <div className="space-y-3">
          {open.map((r) => (
            <OrderTracker
              key={r.id}
              request={r}
              now={now}
              timezone={property.timezone}
              token={token}
              onChanged={onRefresh}
              onToast={onToast}
            />
          ))}
        </div>
      )}

      {/* No label above this. Six tiles with a name, a time and a + on each say
          what they are; a heading reading "Ask for something" said it again. */}
      <div className="grid grid-cols-2 gap-2.5">
        {quick.map((item) => (
          <QuickTile key={item.id} item={item} qty={counts.get(item.id) ?? 0} onTap={onTap} onBump={onBump} />
        ))}
      </div>

      <div>
        <textarea
          value={freeform}
          onChange={(e) => setFreeform(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Or ask for anything else, in your own words."
          className="placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--brand)] ease-glide w-full resize-none rounded-[18px] bg-transparent px-3.5 py-3 text-[15px] leading-relaxed shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_9%,transparent)] transition duration-300 outline-none"
        />
        {freeform.trim() && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={sendFreeform}
              disabled={sending}
              className="brand-bg ease-glide rounded-full px-4 py-2 text-[13px] font-semibold text-white transition duration-300 active:scale-[0.97] disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        )}
      </div>

      {/* The one label left on this screen. Faded rows at the foot of a page
          are ambiguous without it; everything above says what it is. */}
      {recent.length > 0 && (
        <div>
          <h2 className="text-faint mb-2.5 text-[12px]">Earlier</h2>
          <div className="space-y-1.5">
            {recent.map((r) => (
              <ClosedCard key={r.id} request={r} now={now} />
            ))}
          </div>
        </div>
      )}

      <p className="text-faint pb-4 text-center text-[12px]">
        {property.phone ? `Prefer to call? ${property.phone}` : 'We are here around the clock.'}
      </p>
    </div>
  )
}

/** Ticks the "12m ago" labels without re-fetching, and only while it matters. */
function useClock(active: boolean, serverNow: number) {
  // Seeded, not read. This hook is server-rendered too, so reading the clock
  // here produced one value in the HTML and another at hydration, and every
  // age label derived from it became a mismatch. The tick below corrects it a
  // moment later.
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    const t = setInterval(tick, 30_000)
    // A phone that has been in a pocket wakes up with a clock half a minute
    // stale, which reads as an ETA going up. Re-read it on the way back.
    const onVisible = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
  return now
}



/* --------------------------------------------------------------- tracking */

/**
 * Where the order actually is.
 *
 * The rail is the whole point: a status word tells you nothing about how much
 * is left, four beats with a filled line tell you at a glance. It moves the
 * instant the kitchen touches it — the state behind it is pushed, not polled.
 */
function OrderTracker({
  request,
  now,
  timezone,
  token,
  onChanged,
  onToast,
}: {
  request: GuestRequest
  now: number
  timezone: string
  token: string
  onChanged: () => void
  onToast: (t: Toast) => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // What the beats are called depends on who has it: a kitchen prepares, a
  // housekeeper walks, an engineer fixes, the desk arranges.
  const steps = guestSteps(request.department)
  const step = guestStep(request.status)
  const left = minutesRemaining(request, new Date(now))
  // Nothing is running late before the hour the guest picked. The countdown
  // used to start when they booked, so a wake-up call ordered at midnight for
  // seven promised "About 10 min to go" and then said it had been flagged.
  const waiting = notDueYet(request, new Date(now))
  const title = request.items.length
    ? request.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`).join(', ')
    : request.note || 'Request'

  async function cancel() {
    setBusy(true)
    const res = await cancelRequest(token, request.id)
    setBusy(false)
    if (res.ok) onChanged()
    else onToast({ text: res.error ?? 'Could not cancel', tone: 'bad' })
  }

  return (
    <article className="card rise px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The reference and the age sit under the title, not in a tracked
              all-caps line above it. A heading does not need announcing. */}
          <p className="text-[16px] leading-snug font-semibold tracking-[-0.01em] break-words">{title}</p>
          <p className="text-faint mt-0.5 text-[12px]">
            #{request.ref} · {since(request.created_at, new Date(now))}
            {/* The hour they asked for, on the hotel's clock. Without it a
                guest whose phone is on another zone has nothing to check. */}
            {request.scheduled_for && ` · for ${hotelTime(request.scheduled_for, timezone)}`}
          </p>
        </div>
        {request.total_paise > 0 && (
          <p className="text-muted shrink-0 text-[13px] font-semibold tabular-nums">
            {rupees(request.total_paise)}
          </p>
        )}
      </div>

      <div className="relative mt-5">
        <div className="bg-line absolute top-[5px] right-[10%] left-[10%] h-[2px] rounded-full" />
        <div
          className="brand-bg ease-glide absolute top-[5px] left-[10%] h-[2px] origin-left rounded-full transition-transform duration-[900ms]"
          style={{ width: '80%', transform: `scaleX(${step / (steps.length - 1)})` }}
        />
        <ol className="relative flex justify-between">
          {steps.map((label, i) => {
            const done = i <= step
            const current = i === step && request.status !== 'done'
            return (
              <li
                key={label}
                aria-current={current ? 'step' : undefined}
                className="flex w-1/4 flex-col items-center gap-1.5"
              >
                <span className="relative grid h-3 w-3 place-items-center">
                  {current && (
                    <span
                      className="brand-bg absolute inset-0 rounded-full"
                      style={{ animation: 'hc-pulse 2.2s var(--ease-glide) infinite' }}
                    />
                  )}
                  <span
                    className={`ease-glide relative h-3 w-3 rounded-full transition-all duration-500 ${
                      done ? 'brand-bg scale-100' : 'bg-line scale-[0.6]'
                    }`}
                  />
                </span>
                <span
                  className={`text-center text-[10px] leading-tight font-medium tracking-[0.01em] ${
                    done ? 'text-ink' : 'text-faint'
                  }`}
                >
                  {label}
                </span>
                {done && !current && <span className="sr-only">done</span>}
              </li>
            )
          })}
        </ol>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-muted text-[12.5px]">
          {request.status === 'done'
            ? `${steps[3]} — thank you`
            : waiting
              ? 'Booked for the time you picked'
              : left > 0
                ? `About ${left} min to go`
                : 'Taking longer than usual — we have flagged it'}
        </p>
        {(request.status === 'new' || request.status === 'ack') &&
          (confirming ? (
            <span className="flex shrink-0 items-center gap-2.5 text-[12px] font-medium">
              <span className="text-muted">Withdraw it?</span>
              <button
                onClick={cancel}
                disabled={busy}
                className="text-late ease-glide underline transition duration-200 disabled:opacity-40"
              >
                Yes
              </button>
              <button onClick={() => setConfirming(false)} className="text-faint ease-glide underline transition">
                Keep
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-faint hover:text-late ease-glide shrink-0 text-[12px] font-medium underline transition duration-200"
            >
              Cancel
            </button>
          ))}
      </div>
    </article>
  )
}

function ClosedCard({ request, now }: { request: GuestRequest; now: number }) {
  const title = request.items.length
    ? request.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`).join(', ')
    : request.note || 'Request'

  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <p className="text-muted min-w-0 flex-1 truncate text-[14px] break-words">{title}</p>
      <p className="text-faint shrink-0 text-[12px]">
        {request.status === 'done' ? guestSteps(request.department)[3] : 'Cancelled'} ·{' '}
        {since(request.created_at, new Date(now))}
      </p>
    </div>
  )
}

/* --------------------------------------------------------------- catalog */

const Catalog = memo(function Catalog({
  kind,
  categories,
  active,
  onActive,
  counts,
  onTap,
  onBump,
  emptyHint,
}: {
  kind: string
  categories: Category[]
  active: string
  onActive: (kind: string, id: string) => void
  counts: Map<string, number>
  onTap: (i: Item) => void
  onBump: (i: Item, by: number) => void
  emptyHint: string
}) {
  const current = categories.find((c) => c.id === active) ?? categories[0]

  if (!current) return <p className="text-muted px-4 pt-10 text-center text-sm">{emptyHint}</p>

  return (
    <div>
      <div className="bg-paper pointer-fine:bg-paper/85 pointer-fine:backdrop-blur-xl border-line sticky top-[57px] z-20 border-b">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2.5">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => onActive(kind, c.id)}
              className={`ease-glide shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition duration-300 ${
                c.id === current.id
                  ? 'bg-ink text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.16)]'
                  : 'bg-surface text-muted shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_7%,transparent)]'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-2">
        <div className="divide-line divide-y">
          {current.items.map((item) => (
            <ItemRow key={item.id} item={item} qty={counts.get(item.id) ?? 0} onTap={onTap} onBump={onBump} />
          ))}
        </div>
      </div>
    </div>
  )
})

function QuickTile({
  item,
  qty,
  onTap,
  onBump,
}: {
  item: Item
  qty: number
  onTap: (i: Item) => void
  onBump: (i: Item, by: number) => void
}) {
  return (
    <div className="bg-surface ease-glide flex flex-col rounded-[18px] p-3.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_6%,transparent)] transition duration-300">
      <button onClick={() => onTap(item)} className="flex-1 text-left">
        <span className="block text-[14.5px] leading-snug font-medium text-balance">{item.name}</span>
      </button>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-faint text-[11.5px]">
          {item.price_paise > 0 ? rupees(item.price_paise) : `about ${item.sla_minutes} min`}
        </span>
        {isSimple(item) ? (
          <Stepper qty={qty} onAdd={() => onBump(item, 1)} onSub={() => onBump(item, -1)} label={item.name} />
        ) : (
          <button
            onClick={() => onTap(item)}
            aria-label={`Open ${item.name}`}
            className="brand-border brand-text ease-glide grid h-9 w-9 shrink-0 place-items-center rounded-full border transition duration-300 active:scale-[0.92]"
          >
            <IconPlus size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ item sheet */

function ItemSheet({
  item,
  onClose,
  onAdd,
}: {
  item: Item
  onClose: () => void
  onAdd: (mods: Chosen[], note: string, qty: number) => void
}) {
  const groups = item.modifier_groups ?? []
  const [picked, setPicked] = useState<Chosen[]>(() =>
    // Pre-select the first option of any group that demands one, so a guest
    // never hits "required" on a choice they did not know they had to make.
    groups.flatMap((g) =>
      (g.min ?? 0) > 0 && g.options[0]
        ? [{ group: g.name, name: g.options[0].name, price_paise: g.options[0].price_paise }]
        : [],
    ),
  )
  const [note, setNote] = useState('')
  const [qty, setQty] = useState(1)

  const unit = item.price_paise + picked.reduce((s, m) => s + m.price_paise, 0)

  function toggle(group: { name: string; min?: number; max: number }, option: { name: string; price_paise: number }) {
    setPicked((prev) => {
      const inGroup = prev.filter((p) => p.group === group.name)
      const already = inGroup.find((p) => p.name === option.name)
      const others = prev.filter((p) => p.group !== group.name)
      if (already) {
        // A required group cannot be emptied by tapping its own answer. It used
        // to let you, keep Add enabled, and refuse the whole order on send with
        // no way back into the line to fix it.
        if ((group.min ?? 0) > 0 && inGroup.length <= (group.min ?? 0)) return prev
        return [...others, ...inGroup.filter((p) => p.name !== option.name)]
      }
      if ((group.max ?? 1) <= 1) return [...others, { group: group.name, ...option }]
      if (inGroup.length >= (group.max ?? 1)) return prev
      return [...others, ...inGroup, { group: group.name, ...option }]
    })
  }

  return (
    <Sheet onClose={onClose} title={item.name}>
      {item.description && <p className="text-muted -mt-1 mb-5 text-sm leading-relaxed">{item.description}</p>}

      {groups.map((g) => (
        <div key={g.name} className="mb-5">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[13px] font-semibold">{g.name}</p>
            <p className="text-faint text-[12px]">
              {picked.filter((p) => p.group === g.name).length >= (g.max ?? 1) && (g.max ?? 1) > 1
                ? `That is all ${g.max} — tap one off to swap`
                : (g.min ?? 0) > 0
                  ? 'Required'
                  : `Up to ${g.max ?? 1}`}
            </p>
          </div>
          <div className="space-y-1.5">
            {g.options.map((o) => {
              const on = picked.some((p) => p.group === g.name && p.name === o.name)
              const full = !on && picked.filter((p) => p.group === g.name).length >= (g.max ?? 1) && (g.max ?? 1) > 1
              return (
                <button
                  key={o.name}
                  onClick={() => toggle(g, o)}
                  aria-pressed={on}
                  disabled={full}
                  className={`ease-glide flex w-full items-center justify-between rounded-[16px] px-3.5 py-2.5 text-left text-[15px] transition duration-300 disabled:opacity-35 ${
                    on
                      ? 'brand-soft-bg shadow-[inset_0_0_0_1.5px_var(--brand)]'
                      : 'bg-surface shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_8%,transparent)]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`ease-glide grid h-4 w-4 place-items-center rounded-full transition duration-300 ${
                        on
                          ? 'shadow-[inset_0_0_0_1.5px_var(--brand)]'
                          : 'shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-ink)_18%,transparent)]'
                      }`}
                    >
                      {on && <span className="brand-bg h-2 w-2 rounded-full" />}
                    </span>
                    {o.name}
                  </span>
                  {o.price_paise > 0 && (
                    <span className="text-muted text-[13px] tabular-nums">+{rupees(o.price_paise)}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="mb-5">
        <p className="mb-2 text-[13px] font-semibold">Anything to add?</p>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder={NOTE_HINT[item.department] ?? 'Anything we should know…'}
          className="bg-surface placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--brand)] ease-glide w-full rounded-[16px] px-3.5 py-2.5 text-[15px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_8%,transparent)] transition duration-300 outline-none"
        />
      </div>

      {item.needs_time && (
        <p className="text-muted mb-4 text-[13px] leading-relaxed">
          We will ask what time when you send this.
        </p>
      )}

      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-full p-1 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_10%,transparent)]">
          <SheetStep
            icon={<IconMinus size={16} />}
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            label={`One fewer ${item.name}`}
          />
          <span className="w-7 text-center text-[15px] font-semibold tabular-nums">{qty}</span>
          <SheetStep
            icon={<IconPlus size={16} />}
            onClick={() => setQty((q) => Math.min(20, q + 1))}
            disabled={qty >= 20}
            label={`One more ${item.name}`}
          />
        </div>
        <button
          onClick={() => onAdd(picked, note, qty)}
          className="brand-bg ease-glide flex-1 rounded-full px-4 py-3 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] transition duration-300 active:scale-[0.98]"
        >
          Add{unit > 0 ? ` · ${rupees(unit * qty)}` : ''}
        </button>
      </div>
    </Sheet>
  )
}

function SheetStep({
  icon,
  onClick,
  disabled,
  label,
}: {
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="text-ink ease-glide grid h-8 w-8 place-items-center rounded-full transition duration-200 active:scale-90 disabled:opacity-25"
    >
      {icon}
    </button>
  )
}

/* ------------------------------------------------------------ cart sheet */

function CartSheet({
  token,
  timezone,
  cart,
  total,
  onClose,
  onChange,
  onDone,
  onError,
}: {
  token: string
  timezone: string
  cart: CartEntry[]
  total: number
  onClose: () => void
  onChange: (c: CartEntry[]) => void
  onDone: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [note, setNote] = useState('')
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const timed = cart.filter((e) => e.item.needs_time)
  const needsTime = timed.length > 0
  // A wake-up call for yesterday is a typo the server already refuses. The
  // picker should not offer it in the first place — and the floor is the
  // hotel's clock, not the phone's, or a guest still on home time is offered
  // hours the hotel has already lived through and refused the ones it has not.
  //
  // Read once when the basket opens, which is safe here: this sheet only
  // mounts on a tap, never during SSR, so there is no server HTML for it to
  // disagree with. Seeding it from `serverNow` would instead put the floor as
  // far in the past as the guest spent reading the menu.
  const [earliest] = useState(() => wallClockNow(timezone))

  function setQty(key: string, qty: number) {
    onChange(qty <= 0 ? cart.filter((e) => e.key !== key) : cart.map((e) => (e.key === key ? { ...e, qty } : e)))
  }

  async function send() {
    if (busy) return
    setBusy(true)
    const res = await submitCart(
      token,
      cart.map((e) => ({
        itemId: e.item.id,
        qty: e.qty,
        modifiers: e.modifiers.map((m) => ({ group: m.group, name: m.name })),
        note: e.note || null,
      })),
      // Sent as the bare wall clock the picker gave us. Resolving it here
      // would pin it to the phone's zone; the server reads it in the hotel's.
      { note: note || null, scheduledFor: when || null },
    )
    setBusy(false)
    if (res.ok) {
      onDone(res.refs.length > 1 ? `Sent — ${res.refs.length} teams are on it` : 'Sent to the team')
    } else {
      onError(res.error)
    }
  }

  return (
    <Sheet onClose={onClose} title="Your basket">
      {cart.length === 0 ? (
        <p className="text-muted py-6 text-center text-sm">Nothing here yet.</p>
      ) : (
        <>
          <div className="divide-line divide-y">
            {cart.map((e) => (
              <div key={e.key} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">{e.item.name}</p>
                  {e.modifiers.length > 0 && (
                    <p className="text-muted mt-0.5 text-[13px]">{e.modifiers.map((m) => m.name).join(', ')}</p>
                  )}
                  {e.note && <p className="text-faint mt-0.5 text-[13px] italic">“{e.note}”</p>}
                  <p className="text-faint mt-1 text-xs tabular-nums">
                    {entryUnit(e) > 0 ? rupees(entryUnit(e) * e.qty) : 'Complimentary'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center rounded-full p-0.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_10%,transparent)]">
                  <SheetStep
                    icon={<IconMinus size={15} />}
                    onClick={() => setQty(e.key, e.qty - 1)}
                    label={`One fewer ${e.item.name}`}
                  />
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">{e.qty}</span>
                  <SheetStep
                    icon={<IconPlus size={15} />}
                    onClick={() => setQty(e.key, Math.min(20, e.qty + 1))}
                    label={`One more ${e.item.name}`}
                  />
                </div>
              </div>
            ))}
          </div>

          {needsTime && (
            <div className="mt-4">
              {/* "Hotel time" is not decoration. A traveller's phone is often
                  still on home time, the input itself shows no zone at all,
                  and the guest is the only one who can catch it being wrong. */}
              <label className="mb-1.5 block text-[13px] font-semibold">
                What time? <span className="text-faint font-normal">· hotel time</span>
              </label>
              <input
                type="datetime-local"
                value={when}
                min={earliest}
                onChange={(e) => setWhen(e.target.value)}
                className="bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--brand)] ease-glide w-full rounded-[16px] px-3.5 py-2.5 text-[15px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_8%,transparent)] transition duration-300 outline-none"
              />
              {/* An asterisk is a form convention, not an explanation. Name
                  what the time is for and the requirement explains itself. */}
              <p className="text-faint mt-1.5 text-[12px]">
                Needed for {timed.map((e) => e.item.name.toLowerCase()).join(' and ')}.
              </p>
            </div>
          )}

          <div className="mt-4">
            <label className="mb-1.5 block text-[13px] font-semibold">Note for the team</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Knock twice, the baby is asleep…"
              className="bg-surface placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--brand)] ease-glide w-full rounded-[16px] px-3.5 py-2.5 text-[15px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_8%,transparent)] transition duration-300 outline-none"
            />
          </div>

          {total > 0 && (
            <div className="border-line mt-4 flex items-center justify-between border-t pt-3">
              <span className="text-muted text-sm">Charged to your room</span>
              <span className="text-[18px] font-semibold tabular-nums">{rupees(total)}</span>
            </div>
          )}

          <button
            onClick={send}
            disabled={busy || (needsTime && !when)}
            className="brand-bg ease-glide mt-4 w-full rounded-full px-4 py-3.5 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] transition duration-300 active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? 'Sending…' : needsTime && !when ? 'Choose a time first' : 'Send to the team'}
          </button>
          <p className="text-faint mt-2.5 text-center text-xs">
            Nothing is charged now — it goes on your room bill and settles at checkout.
          </p>
        </>
      )}
    </Sheet>
  )
}

/* ------------------------------------------------------------ bill sheet */

/**
 * The bill, before the conversation about it.
 *
 * No card is taken here and none ever will be. "Ask to settle" puts the room
 * and its balance on the front desk's board, so somebody walks up with a card
 * machine rather than the guest queueing in the lobby at seven in the morning.
 */
function BillSheet({
  token,
  room,
  state,
  onClose,
  onToast,
  onRefresh,
}: {
  token: string
  room: Room
  state: GuestState
  onClose: () => void
  onToast: (t: Toast) => void
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const asked = Boolean(state.settle_requested_at)

  async function settle() {
    if (busy) return
    setBusy(true)
    const res = await askToSettle(token)
    setBusy(false)
    if (res.ok) {
      onToast({ text: 'The front desk has been told', tone: 'ok' })
      onRefresh()
    } else {
      onToast({ text: res.error, tone: 'bad' })
    }
  }

  return (
    <Sheet onClose={onClose} title="Your bill">
      {/* The figure is the heading. It had a tracked all-caps line above it,
          a three-line explainer below it, and a Total row further down
          repeating the same number. */}
      <p className="font-display -mt-1 text-[46px] leading-none tracking-[-0.03em] tabular-nums">
        {rupees(state.folio_total_paise)}
      </p>
      <p className="text-muted mt-2 mb-6 text-[13px]">Charged to Room {room.number}, nothing taken yet.</p>

      {state.folio.length === 0 ? (
        <p className="text-muted py-8 text-center text-sm">Nothing has been charged to your room yet.</p>
      ) : (
        <ul className="divide-line divide-y">
          {state.folio.map((line) => (
            <li
              key={line.id}
              className="flex items-baseline justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-[14.5px] leading-snug font-medium break-words">{line.description}</p>
                <p className="text-faint mt-0.5 text-[11px]">
                  {new Date(line.created_at).toLocaleString([], {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {line.ref ? ` · #${line.ref}` : ''}
                </p>
              </div>
              <p className="shrink-0 text-[14.5px] font-semibold tabular-nums">{rupees(line.amount_paise)}</p>
            </li>
          ))}
        </ul>
      )}

      {state.folio_total_paise > 0 && (
        <>
          {asked ? (
            <div className="brand-soft-bg mt-4 rounded-[18px] px-4 py-3.5">
              <p className="brand-text text-[13.5px] font-semibold">Someone is on their way</p>
              <p className="text-muted mt-1 text-[12.5px] leading-relaxed">
                The front desk has your balance and will come to you to settle it. You can keep ordering in the
                meantime — anything new is added to this bill.
              </p>
            </div>
          ) : (
            <button
              onClick={settle}
              disabled={busy}
              className="brand-bg ease-glide mt-5 w-full rounded-full px-5 py-3 text-[15px] font-semibold text-white transition duration-300 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? 'Telling the front desk…' : 'Ask to settle this'}
            </button>
          )}

          <p className="text-faint mt-3 text-center text-[11.5px]">
            Paid at the desk, by card or cash. We never ask for card details.
          </p>
        </>
      )}
    </Sheet>
  )
}

/* ------------------------------------------------------------------ info */

function Info({ pages, property }: { pages: InfoPage[]; property: Property }) {
  const [open, setOpen] = useState<string | null>(pages[0]?.id ?? null)

  return (
    <div className="px-4 pt-6">
      <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em]">{property.name}</h1>
      {property.address && <p className="text-muted mt-1 text-sm leading-relaxed">{property.address}</p>}

      {/* Rules divide these, not a card each. The seeded emoji beside every
          title said the same thing as the title. */}
      <div className="divide-line mt-6 divide-y">
        {pages.map((p) => (
          <div key={p.id}>
            <button
              onClick={() => setOpen(open === p.id ? null : p.id)}
              aria-expanded={open === p.id}
              className="flex w-full items-center justify-between gap-3 py-3.5 text-left"
            >
              <span className="text-[15px] font-medium">{p.title}</span>
              <IconChevron
                size={16}
                className={`text-faint ease-glide shrink-0 transition-transform duration-500 ${
                  open === p.id ? 'rotate-180' : ''
                }`}
              />
            </button>
            {open === p.id && (
              <p className="text-muted pb-4 text-[14px] leading-relaxed whitespace-pre-line">{p.body}</p>
            )}
          </div>
        ))}
      </div>
      <div className="h-8" />
    </div>
  )
}

/* ----------------------------------------------------------------- sheet */

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref, onClose)

  return (
    /* Above the concierge panel (z-55), not below it: a third of this hotel's
       items need choices, and every one of them opened this sheet behind an
       opaque panel and looked like a dead button. */
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div
        className="bg-scrim pointer-fine:backdrop-blur-[2px] absolute inset-0"
        style={{ animation: 'hc-fade-in 300ms var(--ease-glide) both' }}
        onClick={onClose}
      />
      <div
        ref={ref}
        tabIndex={-1}
        style={{ animation: 'hc-sheet-in 460ms var(--ease-glide) both' }}
        className="bg-surface relative max-h-[88dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[28px] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-float)] sm:rounded-[28px] sm:pb-5"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-faint hover:text-ink bg-paper ease-glide -mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full transition duration-200 active:scale-90"
          >
            <IconClose size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
