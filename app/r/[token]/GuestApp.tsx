'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rupees } from '@/lib/money'
import { formatAge, minutesRemaining } from '@/lib/sla'
import { useLive } from '@/lib/use-live'
import {
  GUEST_STATUS_LABEL,
  GUEST_STEPS,
  guestStep,
  type Category,
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
  IconChat,
  IconDining,
  IconHome,
  IconInfo,
  IconMinus,
  IconPlus,
  IconReceipt,
} from '@/components/icons'
import { askToSettle, cancelRequest, submitCart, submitFreeform } from './actions'
import GuestChat from './GuestChat'

type Chosen = { group: string; name: string; price_paise: number }
type CartEntry = { key: string; item: Item; qty: number; modifiers: Chosen[]; note: string }
type Tab = 'home' | 'dining' | 'services' | 'info' | 'chat'
type Toast = { text: string; tone: 'ok' | 'bad' }

/** formatAge already says "just now", which does not take an "ago". */
const said = (from: string, now: number) => {
  const age = formatAge(from, new Date(now))
  return age === 'just now' ? age : `${age} ago`
}

const cartKey = (item: Item, mods: Chosen[], note: string) =>
  [item.id, ...mods.map((m) => `${m.group}:${m.name}`).sort(), note].join('|')

const entryUnit = (e: CartEntry) => e.item.price_paise + e.modifiers.reduce((s, m) => s + m.price_paise, 0)

/** A plain item can be counted from the row. One with choices has to be opened. */
const isSimple = (item: Item) => !item.modifier_groups?.length && !item.needs_time

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
  initialState,
}: {
  token: string
  room: Room
  property: Property
  directory: Category[]
  info: InfoPage[]
  initialState: GuestState
}) {
  const [tab, setTab] = useState<Tab>('home')
  const [cart, setCart] = useState<CartEntry[]>([])
  const [sheetItem, setSheetItem] = useState<Item | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [billOpen, setBillOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  // Pushed from the server the moment anything in this room changes.
  const { state, refresh } = useLive<GuestState>({
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
  const openRequests = state.requests.filter((r) => r.status !== 'done' && r.status !== 'cancelled')
  const unreadFromStaff = state.messages.filter((m) => m.sender === 'staff').length

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

  return (
    <div
      className="mx-auto flex min-h-dvh max-w-2xl flex-col"
      style={{ ['--brand' as string]: property.brand_color, ['--brand-soft' as string]: `${property.brand_color}12` }}
    >
      <header className="bg-surface/85 sticky top-0 z-30 backdrop-blur-xl">
        <div className="border-line flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-ink truncate text-[15px] leading-tight font-semibold tracking-[-0.01em]">
              {property.name}
            </p>
            <p className="text-faint text-[11px] tracking-[0.06em] uppercase">
              Room {room.number}
              {room.room_type ? ` · ${room.room_type}` : ''}
            </p>
          </div>

          <BillChip total={state.folio_total_paise} onOpen={() => setBillOpen(true)} />
        </div>
      </header>

      <main className="flex-1 pb-40">
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
            onGo={setTab}
            onToast={setToast}
            onRefresh={refresh}
            onBill={() => setBillOpen(true)}
          />
        )}
        {tab === 'dining' && (
          <Catalog
            categories={dining}
            counts={counts}
            onTap={tapItem}
            onBump={bump}
            emptyHint="The kitchen menu is being updated."
          />
        )}
        {tab === 'services' && (
          <Catalog
            categories={services}
            counts={counts}
            onTap={tapItem}
            onBump={bump}
            emptyHint="No services listed yet."
          />
        )}
        {tab === 'info' && <Info pages={info} property={property} />}
        {tab === 'chat' && <GuestChat token={token} messages={state.messages} onSent={refresh} />}
      </main>

      {cartCount > 0 && (
        <BasketBar count={cartCount} total={cartTotal} onOpen={() => setCartOpen(true)} />
      )}

      <nav className="bg-surface/90 border-line fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl pb-[env(safe-area-inset-bottom)]">
          {(
            [
              ['home', 'Home', IconHome, openRequests.length],
              ['dining', 'Dining', IconDining, 0],
              ['services', 'Services', IconBell, 0],
              ['info', 'Hotel', IconInfo, 0],
              ['chat', 'Chat', IconChat, unreadFromStaff],
            ] as const
          ).map(([id, label, Ico, badge]) => (
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
              {badge > 0 && id !== 'home' && (
                <span className="brand-bg absolute top-1.5 right-[22%] h-1.5 w-1.5 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </nav>

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
        <div className="pointer-events-none fixed inset-x-0 bottom-32 z-[60] flex justify-center px-4">
          <div
            className={`rise rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-float)] ${
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
      className="group ease-glide flex shrink-0 items-center gap-2 rounded-full bg-[color-mix(in_oklab,var(--color-ink)_4%,transparent)] py-1 pr-1 pl-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_7%,transparent)] transition duration-300 active:scale-[0.97]"
    >
      <span className="flex items-center gap-1.5">
        <IconReceipt size={14} className="text-faint" />
        <span className="text-[13px] font-semibold tabular-nums">
          {total > 0 ? rupees(total) : 'Bill'}
        </span>
      </span>
      <span className="bg-surface ease-glide grid h-7 w-7 place-items-center rounded-full shadow-[0_1px_2px_rgb(28_25_23/0.10)] transition duration-300 group-hover:translate-x-[1px] group-hover:-translate-y-px group-hover:scale-105">
        <IconArrowRight size={13} />
      </span>
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
      <div className="rise mx-auto max-w-2xl rounded-[24px] bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] p-1.5 shadow-[var(--shadow-float)] backdrop-blur-xl">
        <button
          onClick={onOpen}
          className="group bg-ink ease-glide flex w-full items-center gap-3 rounded-[18px] py-2.5 pr-2 pl-4 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] transition duration-300 active:scale-[0.985]"
        >
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/15 px-1.5 text-[12px] font-bold tabular-nums">
            {count}
          </span>
          <span className="flex-1 text-left text-[14px] font-semibold tracking-[-0.01em]">
            {total > 0 ? rupees(total) : 'Nothing to pay'}
            <span className="ml-1.5 text-[12px] font-normal text-white/55">
              {count === 1 ? '1 item' : `${count} items`}
            </span>
          </span>
          <span className="ease-glide grid h-8 w-8 place-items-center rounded-full bg-white/15 transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
            <IconArrowRight size={15} />
          </span>
        </button>
      </div>
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
  onGo,
  onToast,
  onRefresh,
  onBill,
}: {
  room: Room
  property: Property
  directory: Category[]
  state: GuestState
  token: string
  counts: Map<string, number>
  onTap: (i: Item) => void
  onBump: (i: Item, by: number) => void
  onGo: (t: Tab) => void
  onToast: (t: Toast) => void
  onRefresh: () => void
  onBill: () => void
}) {
  const [freeform, setFreeform] = useState('')
  const [sending, setSending] = useState(false)

  const open = state.requests.filter((r) => r.status !== 'done' && r.status !== 'cancelled')
  const recent = state.requests.filter((r) => r.status === 'done' || r.status === 'cancelled').slice(0, 4)

  // The clock only matters while something is in flight, and it lives here so
  // a tick re-renders the trackers rather than the whole app.
  const now = useClock(open.length > 0)

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
    <div className="space-y-7 px-4 pt-6">
      <section className="rise">
        <h1 className="text-[28px] leading-[1.08] font-semibold tracking-[-0.03em]">
          {greeting()}
          {room.guest_name ? `, ${room.guest_name.replace(/^(Mr\.|Ms\.|Mrs\.|Dr\.)\s*/, '')}` : ''}
        </h1>
        <p className="text-muted mt-1.5 max-w-[38ch] text-[14px] leading-relaxed">
          Anything you need, ask here instead of the phone. Someone will see it straight away.
        </p>
      </section>

      {open.length > 0 && (
        <section>
          <SectionTitle>Happening now</SectionTitle>
          <div className="space-y-3">
            {open.map((r, i) => (
              <OrderTracker
                key={r.id}
                request={r}
                now={now}
                token={token}
                delay={i * 70}
                onChanged={onRefresh}
                onToast={onToast}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Ask for something</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          {quick.map((item) => (
            <QuickTile key={item.id} item={item} qty={counts.get(item.id) ?? 0} onTap={onTap} onBump={onBump} />
          ))}
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <Jump label="Room service" onClick={() => onGo('dining')} />
          <Jump label="All services" onClick={() => onGo('services')} />
        </div>
      </section>

      <section>
        <SectionTitle>Something else?</SectionTitle>
        <div className="tray">
          <div className="plate p-3">
            <textarea
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Tell us in your own words — we read every one."
              className="placeholder:text-faint w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
            />
            <div className="mt-1 flex justify-end">
              <button
                onClick={sendFreeform}
                disabled={!freeform.trim() || sending}
                className="brand-bg ease-glide rounded-full px-4 py-2 text-[13px] font-semibold text-white transition duration-300 active:scale-[0.97] disabled:opacity-25"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Your bill</SectionTitle>
        <button onClick={onBill} className="group tray ease-glide block w-full text-left transition duration-300 active:scale-[0.99]">
          <div className="plate flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <p className="font-display text-[30px] leading-none tracking-[-0.02em] tabular-nums">
                {rupees(state.folio_total_paise)}
              </p>
              <p className="text-faint mt-1.5 text-[12px]">
                {state.settle_requested_at
                  ? 'The front desk is on the way to settle this'
                  : state.folio_total_paise > 0
                    ? `Charged to Room ${room.number} · nothing taken yet`
                    : 'Nothing charged to your room so far'}
              </p>
            </div>
            <span className="bg-paper ease-glide grid h-9 w-9 shrink-0 place-items-center rounded-full transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
              <IconArrowRight size={15} />
            </span>
          </div>
        </button>
      </section>

      {recent.length > 0 && (
        <section>
          <SectionTitle>Earlier</SectionTitle>
          <div className="space-y-2">
            {recent.map((r) => (
              <ClosedCard key={r.id} request={r} now={now} />
            ))}
          </div>
        </section>
      )}

      <p className="text-faint pt-1 pb-4 text-center text-[12px]">
        {property.phone ? `Prefer to call? ${property.phone}` : 'We are here around the clock.'}
      </p>
    </div>
  )
}

/** Ticks the "12m ago" labels without re-fetching, and only while it matters. */
function useClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-faint mb-2.5 text-[10px] font-semibold tracking-[0.18em] uppercase">{children}</h2>
  )
}

function Jump({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group brand-soft-bg ease-glide flex items-center justify-between gap-2 rounded-[18px] px-3.5 py-3 transition duration-300 active:scale-[0.98]"
    >
      <span className="brand-text text-[13.5px] font-semibold tracking-[-0.01em]">{label}</span>
      <span className="bg-surface/70 ease-glide brand-text grid h-6 w-6 place-items-center rounded-full transition duration-300 group-hover:translate-x-0.5">
        <IconArrowRight size={12} />
      </span>
    </button>
  )
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
  token,
  delay,
  onChanged,
  onToast,
}: {
  request: GuestRequest
  now: number
  token: string
  delay: number
  onChanged: () => void
  onToast: (t: Toast) => void
}) {
  const [busy, setBusy] = useState(false)
  const step = guestStep(request.status)
  const left = minutesRemaining(request, new Date(now))
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
    <article className="tray rise" style={{ ['--d' as string]: `${delay}ms` }}>
      <div className="plate px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-faint text-[10px] font-semibold tracking-[0.16em] uppercase">
              #{request.ref} · {said(request.created_at, now)}
            </p>
            <p className="mt-1 text-[16px] leading-snug font-semibold tracking-[-0.01em]">{title}</p>
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
            style={{ width: '80%', transform: `scaleX(${step / (GUEST_STEPS.length - 1)})` }}
          />
          <ol className="relative flex justify-between">
            {GUEST_STEPS.map((label, i) => {
              const done = i <= step
              const current = i === step && request.status !== 'done'
              return (
                <li key={label} className="flex w-1/4 flex-col items-center gap-1.5">
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
                </li>
              )
            })}
          </ol>
        </div>

        <div className="border-line mt-4 flex items-center justify-between gap-3 border-t pt-3">
          <p className="text-muted text-[12.5px]">
            {request.status === 'done'
              ? 'Delivered — thank you'
              : left > 0
                ? `About ${left} min to go`
                : 'Taking longer than usual — we have flagged it'}
          </p>
          {(request.status === 'new' || request.status === 'ack') && (
            <button
              onClick={cancel}
              disabled={busy}
              className="text-faint hover:text-late ease-glide shrink-0 text-[12px] font-medium underline transition duration-200 disabled:opacity-40"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

function ClosedCard({ request, now }: { request: GuestRequest; now: number }) {
  const title = request.items.length
    ? request.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`).join(', ')
    : request.note || 'Request'

  return (
    <div className="bg-surface/60 flex items-center justify-between gap-3 rounded-[16px] px-3.5 py-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_5%,transparent)]">
      <div className="min-w-0">
        <p className="text-muted truncate text-[14px]">{title}</p>
        <p className="text-faint mt-0.5 text-[11px]">
          #{request.ref} · {said(request.created_at, now)}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          request.status === 'done' ? 'bg-ok-soft text-ok' : 'bg-paper text-faint'
        }`}
      >
        {GUEST_STATUS_LABEL[request.status]}
      </span>
    </div>
  )
}

/* --------------------------------------------------------------- catalog */

const Catalog = memo(function Catalog({
  categories,
  counts,
  onTap,
  onBump,
  emptyHint,
}: {
  categories: Category[]
  counts: Map<string, number>
  onTap: (i: Item) => void
  onBump: (i: Item, by: number) => void
  emptyHint: string
}) {
  const [active, setActive] = useState(categories[0]?.id ?? '')
  const current = categories.find((c) => c.id === active) ?? categories[0]

  if (!current) return <p className="text-muted px-4 pt-10 text-center text-sm">{emptyHint}</p>

  return (
    <div>
      <div className="bg-paper/85 border-line sticky top-[57px] z-20 border-b backdrop-blur-xl">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2.5">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={`ease-glide shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition duration-300 ${
                c.id === current.id
                  ? 'bg-ink text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.16)]'
                  : 'bg-surface text-muted shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_7%,transparent)]'
              }`}
            >
              {c.icon ? `${c.icon} ` : ''}
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-5">
        <h2 className="text-[21px] leading-tight font-semibold tracking-[-0.02em]">{current.name}</h2>
        <div className="divide-line mt-1 divide-y">
          {current.items.map((item) => (
            <ItemRow key={item.id} item={item} qty={counts.get(item.id) ?? 0} onTap={onTap} onBump={onBump} />
          ))}
        </div>
      </div>
    </div>
  )
})

function ItemRow({
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
    <div className={`flex items-start justify-between gap-4 py-3.5 ${item.available ? '' : 'opacity-40'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {item.veg !== null && (
            <span
              aria-label={item.veg ? 'Vegetarian' : 'Non-vegetarian'}
              className={`inline-grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border ${
                item.veg ? 'border-ok' : 'border-late'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${item.veg ? 'bg-ok' : 'bg-late'}`} />
            </span>
          )}
          <p className="text-[15px] leading-snug font-medium">{item.name}</p>
        </div>
        {item.description && <p className="text-muted mt-0.5 line-clamp-2 text-[13px]">{item.description}</p>}
        <p className="text-faint mt-1 text-xs">
          {item.price_paise > 0 ? (
            <span className="text-ink font-semibold tabular-nums">
              {rupees(item.price_paise)}
              {item.unit ? ` ${item.unit}` : ''}
            </span>
          ) : (
            'Complimentary'
          )}
          <span> · about {item.sla_minutes} min</span>
        </p>
      </div>

      <div className="mt-0.5 shrink-0">
        {!item.available ? (
          <span className="text-faint px-1 text-[12px] font-medium">Unavailable</span>
        ) : isSimple(item) ? (
          <Stepper qty={qty} onAdd={() => onBump(item, 1)} onSub={() => onBump(item, -1)} label={item.name} />
        ) : (
          <button
            onClick={() => onTap(item)}
            className="brand-text brand-border ease-glide rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition duration-300 active:scale-[0.96]"
          >
            {qty > 0 ? `Add · ${qty} in basket` : 'Choose'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Counting up in place.
 *
 * At zero this is a single "＋" the width of a thumb. Tap it and it grows into
 * a counter, which is the whole point: you never have to open the basket to
 * find out what you already asked for.
 */
function Stepper({
  qty,
  onAdd,
  onSub,
  label,
}: {
  qty: number
  onAdd: () => void
  onSub: () => void
  label: string
}) {
  if (qty === 0) {
    return (
      <button
        onClick={onAdd}
        aria-label={`Add ${label}`}
        className="brand-border brand-text ease-glide grid h-9 w-9 place-items-center rounded-full border transition duration-300 active:scale-[0.92]"
      >
        <IconPlus size={16} />
      </button>
    )
  }

  return (
    <div className="brand-bg ease-glide flex items-center rounded-full p-0.5 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] transition duration-300">
      <button
        onClick={onSub}
        aria-label={`One fewer ${label}`}
        className="ease-glide grid h-8 w-8 place-items-center rounded-full transition duration-200 active:scale-90"
      >
        <IconMinus size={15} />
      </button>
      <span className="min-w-5 text-center text-[14px] font-bold tabular-nums">{qty}</span>
      <button
        onClick={onAdd}
        aria-label={`One more ${label}`}
        className="ease-glide grid h-8 w-8 place-items-center rounded-full transition duration-200 active:scale-90"
      >
        <IconPlus size={15} />
      </button>
    </div>
  )
}

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
    <div className="bg-surface ease-glide flex items-start justify-between gap-2 rounded-[18px] p-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_6%,transparent)] transition duration-300">
      <button onClick={() => onTap(item)} className="min-w-0 flex-1 text-left">
        <p className="text-[14.5px] leading-snug font-medium">{item.name}</p>
        <p className="text-faint mt-0.5 text-[11.5px]">
          {item.price_paise > 0 ? rupees(item.price_paise) : `about ${item.sla_minutes} min`}
        </p>
      </button>
      {isSimple(item) && (
        <Stepper qty={qty} onAdd={() => onBump(item, 1)} onSub={() => onBump(item, -1)} label={item.name} />
      )}
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

  function toggle(group: { name: string; max: number }, option: { name: string; price_paise: number }) {
    setPicked((prev) => {
      const inGroup = prev.filter((p) => p.group === group.name)
      const already = inGroup.find((p) => p.name === option.name)
      const others = prev.filter((p) => p.group !== group.name)
      if (already) return [...others, ...inGroup.filter((p) => p.name !== option.name)]
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
            <p className="text-faint text-[10px] font-semibold tracking-[0.14em] uppercase">
              {(g.min ?? 0) > 0 ? 'Required' : `Up to ${g.max ?? 1}`}
            </p>
          </div>
          <div className="space-y-1.5">
            {g.options.map((o) => {
              const on = picked.some((p) => p.group === g.name && p.name === o.name)
              return (
                <button
                  key={o.name}
                  onClick={() => toggle(g, o)}
                  className={`ease-glide flex w-full items-center justify-between rounded-[16px] px-3.5 py-2.5 text-left text-[15px] transition duration-300 ${
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
          placeholder="No onion, extra napkins, leave outside the door…"
          className="bg-surface placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--brand)] ease-glide w-full rounded-[16px] px-3.5 py-2.5 text-[15px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_8%,transparent)] transition duration-300 outline-none"
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-full p-1 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_10%,transparent)]">
          <SheetStep icon={<IconMinus size={16} />} onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} label="One fewer" />
          <span className="w-7 text-center text-[15px] font-semibold tabular-nums">{qty}</span>
          <SheetStep icon={<IconPlus size={16} />} onClick={() => setQty((q) => Math.min(20, q + 1))} disabled={qty >= 20} label="One more" />
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
  cart,
  total,
  onClose,
  onChange,
  onDone,
  onError,
}: {
  token: string
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
  const needsTime = cart.some((e) => e.item.needs_time)

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
      { note: note || null, scheduledFor: when ? new Date(when).toISOString() : null },
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
                  <SheetStep icon={<IconMinus size={15} />} onClick={() => setQty(e.key, e.qty - 1)} label="One fewer" />
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">{e.qty}</span>
                  <SheetStep icon={<IconPlus size={15} />} onClick={() => setQty(e.key, Math.min(20, e.qty + 1))} label="One more" />
                </div>
              </div>
            ))}
          </div>

          {needsTime && (
            <div className="mt-4">
              <label className="mb-1.5 block text-[13px] font-semibold">
                What time? <span className="text-late">*</span>
              </label>
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--brand)] ease-glide w-full rounded-[16px] px-3.5 py-2.5 text-[15px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_8%,transparent)] transition duration-300 outline-none"
              />
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
            {busy ? 'Sending…' : 'Send to the team'}
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
      <div className="tray -mt-1 mb-5">
        <div className="plate px-4 py-4">
          <p className="text-faint text-[10px] font-semibold tracking-[0.18em] uppercase">
            Room {room.number} · outstanding
          </p>
          <p className="font-display mt-2 text-[44px] leading-none tracking-[-0.03em] tabular-nums">
            {rupees(state.folio_total_paise)}
          </p>
          <p className="text-muted mt-2.5 max-w-[34ch] text-[12.5px] leading-relaxed">
            Everything you have asked for that carries a charge. Nothing has been taken from a card — the front desk
            settles this with you.
          </p>
        </div>
      </div>

      {state.folio.length === 0 ? (
        <p className="text-muted py-8 text-center text-sm">Nothing has been charged to your room yet.</p>
      ) : (
        <ul className="divide-line divide-y">
          {state.folio.map((line, i) => (
            <li
              key={line.id}
              className="rise flex items-baseline justify-between gap-4 py-3"
              style={{ ['--d' as string]: `${Math.min(i, 8) * 45}ms` }}
            >
              <div className="min-w-0">
                <p className="text-[14.5px] leading-snug font-medium">{line.description}</p>
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
          <div className="border-line mt-4 flex items-baseline justify-between border-t pt-3.5">
            <span className="text-[13px] font-semibold tracking-[-0.01em]">Total</span>
            <span className="text-[20px] font-semibold tabular-nums">{rupees(state.folio_total_paise)}</span>
          </div>

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
              className="group brand-bg ease-glide mt-4 flex w-full items-center gap-3 rounded-full py-2.5 pr-2 pl-5 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] transition duration-300 active:scale-[0.98] disabled:opacity-50"
            >
              <span className="flex-1 text-left text-[15px] font-semibold tracking-[-0.01em]">
                {busy ? 'Telling the front desk…' : 'Ask to settle this'}
              </span>
              <span className="ease-glide grid h-9 w-9 place-items-center rounded-full bg-white/18 transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
                <IconArrowRight size={15} />
              </span>
            </button>
          )}

          <p className="text-faint mt-3 text-center text-[11.5px] leading-relaxed">
            Payment is taken at the desk, by card or cash. HConcierge never asks for card details.
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

      <div className="mt-5 space-y-2">
        {pages.map((p, i) => (
          <div
            key={p.id}
            className="bg-surface rise overflow-hidden rounded-[18px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_6%,transparent)]"
            style={{ ['--d' as string]: `${Math.min(i, 8) * 45}ms` }}
          >
            <button
              onClick={() => setOpen(open === p.id ? null : p.id)}
              aria-expanded={open === p.id}
              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
            >
              <span className="flex items-center gap-2.5 text-[15px] font-medium">
                {p.icon && <span className="text-lg">{p.icon}</span>}
                {p.title}
              </span>
              <span
                className={`text-faint ease-glide transition-transform duration-500 ${open === p.id ? 'rotate-180' : ''}`}
              >
                ⌄
              </span>
            </button>
            {open === p.id && (
              <p className="text-muted border-line border-t px-4 py-3.5 text-[14px] leading-relaxed whitespace-pre-line">
                {p.body}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="h-6" />
    </div>
  )
}

/* ----------------------------------------------------------------- sheet */

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-[rgb(28_25_23/0.32)] backdrop-blur-[2px]"
        style={{ animation: 'hc-fade-in 300ms var(--ease-glide) both' }}
        onClick={onClose}
      />
      <div
        ref={ref}
        style={{ animation: 'hc-sheet-in 460ms var(--ease-glide) both' }}
        className="bg-surface relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-float)] sm:rounded-[28px] sm:pb-5"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-faint hover:text-ink bg-paper ease-glide -mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg leading-none transition duration-200 active:scale-90"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
