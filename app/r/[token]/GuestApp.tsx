'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rupees } from '@/lib/money'
import { formatAge, minutesRemaining } from '@/lib/sla'
import { GUEST_STATUS_LABEL, type Category, type GuestRequest, type GuestState, type InfoPage, type Item, type Property, type Room } from '@/lib/types'
import { IconBell, IconChat, IconDining, IconHome, IconInfo } from '@/components/icons'
import { cancelRequest, submitCart, submitFreeform } from './actions'
import GuestChat from './GuestChat'

type Chosen = { group: string; name: string; price_paise: number }
type CartEntry = { key: string; item: Item; qty: number; modifiers: Chosen[]; note: string }
type Tab = 'home' | 'dining' | 'services' | 'info' | 'chat'

const POLL_MS = 5000

const cartKey = (item: Item, mods: Chosen[], note: string) =>
  [item.id, ...mods.map((m) => `${m.group}:${m.name}`).sort(), note].join('|')

const entryUnit = (e: CartEntry) => e.item.price_paise + e.modifiers.reduce((s, m) => s + m.price_paise, 0)

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
  const [state, setState] = useState(initialState)
  const [cart, setCart] = useState<CartEntry[]>([])
  const [sheetItem, setSheetItem] = useState<Item | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const inFlight = useRef(false)

  const dining = useMemo(() => directory.filter((c) => c.kind === 'fnb'), [directory])
  const services = useMemo(() => directory.filter((c) => c.kind !== 'fnb'), [directory])
  const cartCount = cart.reduce((s, e) => s + e.qty, 0)
  const cartTotal = cart.reduce((s, e) => s + entryUnit(e) * e.qty, 0)
  const openRequests = state.requests.filter((r) => r.status !== 'done' && r.status !== 'cancelled')
  const unreadFromStaff = state.messages.filter((m) => m.sender === 'staff').length

  const refresh = useCallback(async () => {
    // Overlapping polls are what exhausts the connection pool; skip a tick
    // rather than stack a second request on top of a slow one.
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch(`/api/guest/${token}/state`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (res.ok) setState(await res.json())
    } catch {
      // Hotel wifi drops. Keep the last known state on screen and try again.
    } finally {
      inFlight.current = false
    }
  }, [token])

  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  // Ticks the "12m ago" labels without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  function addToCart(item: Item, modifiers: Chosen[] = [], note = '', qty = 1) {
    const key = cartKey(item, modifiers, note)
    setCart((prev) => {
      const found = prev.find((e) => e.key === key)
      if (found) return prev.map((e) => (e.key === key ? { ...e, qty: e.qty + qty } : e))
      return [...prev, { key, item, qty, modifiers, note }]
    })
    setToast({ text: `${item.name} added`, tone: 'ok' })
  }

  function tapItem(item: Item) {
    if (item.modifier_groups?.length || item.needs_time || item.price_paise > 0) setSheetItem(item)
    else addToCart(item)
  }

  return (
    <div
      className="mx-auto flex min-h-dvh max-w-2xl flex-col"
      style={{ ['--brand' as string]: property.brand_color, ['--brand-soft' as string]: `${property.brand_color}12` }}
    >
      <header className="bg-surface border-line sticky top-0 z-30 border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <p className="text-ink truncate text-[15px] font-semibold">{property.name}</p>
            <p className="text-muted text-xs">
              Room {room.number}
              {room.room_type ? ` · ${room.room_type}` : ''}
            </p>
          </div>
          <button
            onClick={() => setCartOpen(true)}
            disabled={cartCount === 0}
            className="brand-bg relative rounded-full px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-30"
          >
            Basket
            {cartCount > 0 && (
              <span className="text-ink absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-bold shadow ring-1 ring-black/10">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 pb-28">
        {tab === 'home' && (
          <Home
            room={room}
            property={property}
            directory={directory}
            state={state}
            now={now}
            token={token}
            onTap={tapItem}
            onGo={setTab}
            onToast={setToast}
            onRefresh={refresh}
          />
        )}
        {tab === 'dining' && <Catalog categories={dining} onTap={tapItem} emptyHint="The kitchen menu is being updated." />}
        {tab === 'services' && <Catalog categories={services} onTap={tapItem} emptyHint="No services listed yet." />}
        {tab === 'info' && <Info pages={info} property={property} />}
        {tab === 'chat' && <GuestChat token={token} messages={state.messages} onSent={refresh} />}
      </main>

      <nav className="bg-surface/95 border-line fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur">
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
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${
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
            addToCart(sheetItem, mods, note, qty)
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

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
          <div
            className={`rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-lg ${
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

/* ------------------------------------------------------------------ home */

function Home({
  room,
  property,
  directory,
  state,
  now,
  token,
  onTap,
  onGo,
  onToast,
  onRefresh,
}: {
  room: Room
  property: Property
  directory: Category[]
  state: GuestState
  now: number
  token: string
  onTap: (i: Item) => void
  onGo: (t: Tab) => void
  onToast: (t: { text: string; tone: 'ok' | 'bad' }) => void
  onRefresh: () => void
}) {
  const [freeform, setFreeform] = useState('')
  const [sending, setSending] = useState(false)

  // One shortcut per kind of need, taken from the top of each section, so this
  // stays correct when the hotel edits its own directory.
  const quick = useMemo(() => {
    const picks = directory
      .filter((c) => c.kind === 'amenity' || c.kind === 'front_desk')
      .map((c) => c.items.find((i) => i.available))
      .filter((i): i is Item => Boolean(i))
    return picks.slice(0, 6)
  }, [directory])

  const open = state.requests.filter((r) => r.status !== 'done' && r.status !== 'cancelled')
  const recent = state.requests.filter((r) => r.status === 'done' || r.status === 'cancelled').slice(0, 4)

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
    <div className="space-y-6 px-4 pt-5">
      <section>
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
          {greeting()}
          {room.guest_name ? `, ${room.guest_name.replace(/^(Mr\.|Ms\.|Mrs\.|Dr\.)\s*/, '')}` : ''}
        </h1>
        <p className="text-muted mt-1 text-sm">
          Anything you need, ask here instead of the phone. Someone will see it straight away.
        </p>
      </section>

      {open.length > 0 && (
        <section>
          <SectionTitle>Happening now</SectionTitle>
          <div className="space-y-2">
            {open.map((r) => (
              <RequestCard key={r.id} request={r} now={now} token={token} onChanged={onRefresh} onToast={onToast} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Ask for something</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          {quick.map((item) => (
            <button
              key={item.id}
              onClick={() => onTap(item)}
              className="bg-surface border-line hover:border-ink/20 rounded-[14px] border p-3.5 text-left transition active:scale-[0.98]"
            >
              <p className="text-[15px] leading-snug font-medium">{item.name}</p>
              <p className="text-faint mt-1 text-xs">
                {item.price_paise > 0 ? rupees(item.price_paise) : `about ${item.sla_minutes} min`}
              </p>
            </button>
          ))}
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <button
            onClick={() => onGo('dining')}
            className="brand-soft-bg brand-border brand-text rounded-[14px] border px-3.5 py-3 text-sm font-semibold"
          >
            Room service menu →
          </button>
          <button
            onClick={() => onGo('services')}
            className="brand-soft-bg brand-border brand-text rounded-[14px] border px-3.5 py-3 text-sm font-semibold"
          >
            All services →
          </button>
        </div>
      </section>

      <section>
        <SectionTitle>Something else?</SectionTitle>
        <div className="bg-surface border-line rounded-[14px] border p-3">
          <textarea
            value={freeform}
            onChange={(e) => setFreeform(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Tell us in your own words — we read every one."
            className="placeholder:text-faint w-full resize-none bg-transparent text-[15px] outline-none"
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={sendFreeform}
              disabled={!freeform.trim() || sending}
              className="brand-bg rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-30"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </section>

      {state.folio_total_paise > 0 && (
        <section>
          <SectionTitle>Your bill so far</SectionTitle>
          <div className="bg-surface border-line flex items-center justify-between rounded-[14px] border px-4 py-3.5">
            <div>
              <p className="text-[17px] font-semibold">{rupees(state.folio_total_paise)}</p>
              <p className="text-faint text-xs">Charged to Room {room.number}, settled at checkout</p>
            </div>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <SectionTitle>Earlier</SectionTitle>
          <div className="space-y-2">
            {recent.map((r) => (
              <RequestCard key={r.id} request={r} now={now} token={token} onChanged={onRefresh} onToast={onToast} />
            ))}
          </div>
        </section>
      )}

      <p className="text-faint pt-2 pb-6 text-center text-xs">
        {property.phone ? `Prefer to call? ${property.phone}` : 'We are here around the clock.'}
      </p>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-muted mb-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase">{children}</h2>
}

function RequestCard({
  request,
  now,
  token,
  onChanged,
  onToast,
}: {
  request: GuestRequest
  now: number
  token: string
  onChanged: () => void
  onToast: (t: { text: string; tone: 'ok' | 'bad' }) => void
}) {
  const [busy, setBusy] = useState(false)
  const live = request.status !== 'done' && request.status !== 'cancelled'
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
    <div className={`bg-surface border-line rounded-[14px] border p-3.5 ${live ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium">{title}</p>
          <p className="text-faint mt-0.5 text-xs">
            #{request.ref} · {formatAge(request.created_at, new Date(now))} ago
            {request.total_paise > 0 ? ` · ${rupees(request.total_paise)}` : ''}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            request.status === 'done'
              ? 'bg-ok-soft text-ok'
              : request.status === 'cancelled'
                ? 'bg-paper text-faint'
                : 'brand-soft-bg brand-text'
          }`}
        >
          {GUEST_STATUS_LABEL[request.status]}
        </span>
      </div>

      {live && (
        <div className="mt-2.5 flex items-center justify-between">
          <p className="text-muted text-xs">
            {left > 0 ? `Expected in about ${left} min` : 'Taking longer than usual — we have flagged it'}
          </p>
          {(request.status === 'new' || request.status === 'ack') && (
            <button onClick={cancel} disabled={busy} className="text-faint hover:text-late text-xs font-medium underline">
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- catalog */

function Catalog({
  categories,
  onTap,
  emptyHint,
}: {
  categories: Category[]
  onTap: (i: Item) => void
  emptyHint: string
}) {
  const [active, setActive] = useState(categories[0]?.id ?? '')
  const current = categories.find((c) => c.id === active) ?? categories[0]

  if (!current) return <p className="text-muted px-4 pt-10 text-center text-sm">{emptyHint}</p>

  return (
    <div>
      <div className="bg-paper/95 border-line sticky top-[60px] z-20 border-b backdrop-blur">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2.5">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition ${
                c.id === current.id
                  ? 'bg-ink border-ink text-white'
                  : 'bg-surface border-line text-muted'
              }`}
            >
              {c.icon ? `${c.icon} ` : ''}
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4">
        <h2 className="text-[19px] font-semibold tracking-tight">{current.name}</h2>
        <div className="divide-line mt-1 divide-y">
          {current.items.map((item) => (
            <ItemRow key={item.id} item={item} onTap={onTap} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ItemRow({ item, onTap }: { item: Item; onTap: (i: Item) => void }) {
  return (
    <button
      onClick={() => item.available && onTap(item)}
      disabled={!item.available}
      className="flex w-full items-start justify-between gap-4 py-3.5 text-left disabled:opacity-40"
    >
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
            <span className="text-ink font-semibold">
              {rupees(item.price_paise)}
              {item.unit ? ` ${item.unit}` : ''}
            </span>
          ) : (
            'Complimentary'
          )}
          <span> · about {item.sla_minutes} min</span>
        </p>
      </div>
      <span
        className={`mt-0.5 shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
          item.available ? 'brand-border brand-text' : 'border-line text-faint'
        }`}
      >
        {item.available ? 'Add' : 'Unavailable'}
      </span>
    </button>
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
      {item.description && <p className="text-muted -mt-1 mb-4 text-sm">{item.description}</p>}

      {groups.map((g) => (
        <div key={g.name} className="mb-5">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[13px] font-semibold">{g.name}</p>
            <p className="text-faint text-[11px]">
              {(g.min ?? 0) > 0 ? 'Required' : `Optional · up to ${g.max ?? 1}`}
            </p>
          </div>
          <div className="space-y-1.5">
            {g.options.map((o) => {
              const on = picked.some((p) => p.group === g.name && p.name === o.name)
              return (
                <button
                  key={o.name}
                  onClick={() => toggle(g, o)}
                  className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-[15px] transition ${
                    on ? 'brand-border brand-soft-bg' : 'border-line bg-surface'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`grid h-4 w-4 place-items-center rounded-full border ${on ? 'brand-border' : 'border-line'}`}
                    >
                      {on && <span className="brand-bg h-2 w-2 rounded-full" />}
                    </span>
                    {o.name}
                  </span>
                  {o.price_paise > 0 && <span className="text-muted text-[13px]">+{rupees(o.price_paise)}</span>}
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
          className="border-line bg-surface placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-[var(--brand)]"
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="border-line flex items-center gap-1 rounded-full border p-1">
          <Step label="−" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} />
          <span className="w-7 text-center text-[15px] font-semibold tabular-nums">{qty}</span>
          <Step label="+" onClick={() => setQty((q) => Math.min(20, q + 1))} disabled={qty >= 20} />
        </div>
        <button
          onClick={() => onAdd(picked, note, qty)}
          className="brand-bg flex-1 rounded-full px-4 py-3 text-[15px] font-semibold text-white"
        >
          Add{unit > 0 ? ` · ${rupees(unit * qty)}` : ''}
        </button>
      </div>
    </Sheet>
  )
}

function Step({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-ink grid h-8 w-8 place-items-center rounded-full text-lg leading-none disabled:opacity-25"
    >
      {label}
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
                  <p className="text-faint mt-1 text-xs">
                    {entryUnit(e) > 0 ? rupees(entryUnit(e) * e.qty) : 'Complimentary'}
                  </p>
                </div>
                <div className="border-line flex shrink-0 items-center gap-1 rounded-full border p-0.5">
                  <Step label="−" onClick={() => setQty(e.key, e.qty - 1)} />
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">{e.qty}</span>
                  <Step label="+" onClick={() => setQty(e.key, Math.min(20, e.qty + 1))} />
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
                className="border-line bg-surface w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-[var(--brand)]"
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
              className="border-line bg-surface placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-[var(--brand)]"
            />
          </div>

          {total > 0 && (
            <div className="border-line mt-4 flex items-center justify-between border-t pt-3">
              <span className="text-muted text-sm">Charged to your room</span>
              <span className="text-[17px] font-semibold">{rupees(total)}</span>
            </div>
          )}

          <button
            onClick={send}
            disabled={busy || (needsTime && !when)}
            className="brand-bg mt-4 w-full rounded-full px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-40"
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

/* ------------------------------------------------------------------ info */

function Info({ pages, property }: { pages: InfoPage[]; property: Property }) {
  const [open, setOpen] = useState<string | null>(pages[0]?.id ?? null)

  return (
    <div className="px-4 pt-5">
      <h1 className="text-[22px] font-semibold tracking-tight">{property.name}</h1>
      {property.address && <p className="text-muted mt-0.5 text-sm">{property.address}</p>}

      <div className="mt-5 space-y-2">
        {pages.map((p) => (
          <div key={p.id} className="bg-surface border-line overflow-hidden rounded-[14px] border">
            <button
              onClick={() => setOpen(open === p.id ? null : p.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
            >
              <span className="flex items-center gap-2.5 text-[15px] font-medium">
                {p.icon && <span className="text-lg">{p.icon}</span>}
                {p.title}
              </span>
              <span className={`text-faint transition-transform ${open === p.id ? 'rotate-180' : ''}`}>⌄</span>
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={ref}
        className="bg-surface relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[22px] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[22px] sm:pb-5"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="text-[19px] leading-tight font-semibold tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-ink -mt-1 p-1 text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
