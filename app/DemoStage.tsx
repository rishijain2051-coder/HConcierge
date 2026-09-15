'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rupees } from '@/lib/money'
import { WARN_AT } from '@/lib/sla'
import { DEMO_SECTIONS, DEPT_LABEL, type DemoDept, type DemoItem } from '@/lib/demo-data'
import {
  IconAlert,
  IconBell,
  IconChat,
  IconCheck,
  IconDining,
  IconHome,
  IconInfo,
  IconPlay,
  IconRestart,
} from '@/components/icons'

/**
 * The homepage demo is a working simulation of HConcierge's own logic, not a
 * recording. Requests really split by department, really inherit the slowest
 * item's target, really age, and really escalate when nobody accepts them.
 *
 * The only thing that is not real is the clock: one demo minute per real
 * second, so a ten-minute target burns down in ten seconds and a visitor can
 * watch a request go late without waiting for lunch.
 */

const MS_PER_DEMO_MINUTE = 1000
const LANES: DemoDept[] = ['housekeeping', 'fnb', 'front_desk', 'maintenance']

type Status = 'new' | 'ack' | 'done'
type Line = { name: string; qty: number }
type Ticket = {
  id: string
  ref: number
  dept: DemoDept
  lines: Line[]
  total: number
  sla: number
  status: Status
  bornAt: number
  escalated: boolean
}

type Basket = { item: DemoItem; qty: number }

function slaTone(t: Ticket, minute: number): 'ok' | 'warn' | 'late' | 'done' {
  if (t.status === 'done') return 'done'
  const elapsed = minute - t.bornAt
  if (elapsed >= t.sla) return 'late'
  if (elapsed >= t.sla * WARN_AT) return 'warn'
  return 'ok'
}

export default function DemoStage() {
  const [minute, setMinute] = useState(0)
  const [basket, setBasket] = useState<Basket[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [tab, setTab] = useState<'ask' | 'dining' | 'services'>('ask')
  const [folio, setFolio] = useState(0)
  const [escalation, setEscalation] = useState<{ ref: number; room: string; what: string; minutes: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [touched, setTouched] = useState(false)

  const laneRefs = useRef<Partial<Record<DemoDept, HTMLDivElement | null>>>({})
  const nextRef = useRef(1)
  // The autoplay script schedules send() on a timer, so send() cannot read the
  // basket or the clock from its own closure — by the time it fires, both are
  // several renders out of date. Mirror them.
  const basketRef = useRef<Basket[]>([])
  const minuteRef = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const reduced = useRef(false)
  const running = useRef(true)
  const stage = useRef<HTMLDivElement | null>(null)
  const board = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return () => timers.current.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    basketRef.current = basket
  }, [basket])
  useEffect(() => {
    minuteRef.current = minute
  }, [minute])

  // Kill the clock when the stage is off-screen or the tab is hidden. A pitch
  // page should not be burning a laptop battery three sections down.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => (running.current = e.isIntersecting), { threshold: 0.05 })
    io.observe(el)
    const onVis = () => (running.current = document.visibilityState === 'visible' && running.current)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      if (running.current && document.visibilityState === 'visible') setMinute((m) => m + 1)
    }, MS_PER_DEMO_MINUTE)
    return () => clearInterval(t)
  }, [])

  // Escalation is emergent, not scripted: anything still unaccepted past its
  // own target trips, exactly as lib/notify.ts does in the real product.
  useEffect(() => {
    // Driven by the minute timer above — an external clock, which is exactly
    // what an effect is for, even though the rule sees only the setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTickets((prev) => {
      let changed = false
      const next = prev.map((t) => {
        if (!t.escalated && t.status === 'new' && minute - t.bornAt >= t.sla) {
          changed = true
          setEscalation({
            ref: t.ref,
            room: '204',
            what: t.lines.map((l) => l.name).join(', '),
            minutes: minute - t.bornAt,
          })
          return { ...t, escalated: true }
        }
        return t
      })
      return changed ? next : prev
    })
  }, [minute])

  const fly = useCallback((dept: DemoDept, label: string) => {
    const lane = laneRefs.current[dept]
    const source = document.getElementById('demo-basket')
    if (!lane || !source) return
    // Read both rects now, not when the flight was scheduled: on a phone the
    // board is scrolled into view in between, which moves the target.
    const from = source.getBoundingClientRect()
    const to = lane.getBoundingClientRect()

    const ghost = document.createElement('div')
    ghost.textContent = label
    ghost.setAttribute('aria-hidden', 'true')
    ghost.style.cssText = [
      'position:fixed',
      `left:${from.left}px`,
      `top:${from.top}px`,
      `width:${Math.min(from.width, 240)}px`,
      'padding:10px 12px',
      'border-radius:12px',
      'background:#ffffff',
      'border:1px solid var(--color-line, #e7e2da)',
      'box-shadow:0 18px 40px -12px rgba(28,25,23,.35)',
      'font:500 13px/1.2 var(--font-sans-stack), system-ui, sans-serif',
      'color:#1c1917',
      'z-index:80',
      'pointer-events:none',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
    ].join(';')
    document.body.appendChild(ghost)

    const dx = to.left + 14 - from.left
    const dy = to.top + 52 - from.top

    const frames: Keyframe[] = reduced.current
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { transform: 'translate(0,0) scale(1)', filter: 'blur(0px)', opacity: 1, offset: 0 },
          {
            // Lift through the middle so the card travels an arc, not a ruler line.
            transform: `translate(${dx * 0.52}px, ${dy * 0.5 - 54}px) scale(.94)`,
            filter: 'blur(1.4px)',
            opacity: 1,
            offset: 0.55,
          },
          { transform: `translate(${dx}px, ${dy}px) scale(.9)`, filter: 'blur(0px)', opacity: 0, offset: 1 },
        ]

    ghost
      .animate(frames, {
        duration: reduced.current ? 220 : 700,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'forwards',
      })
      .finished.catch(() => {})
      .finally(() => ghost.remove())
  }, [])

  const add = useCallback((item: DemoItem, el?: HTMLElement | null) => {
    setTouched(true)
    setBasket((prev) => {
      const found = prev.find((b) => b.item.id === item.id)
      return found
        ? prev.map((b) => (b.item.id === item.id ? { ...b, qty: b.qty + 1 } : b))
        : [...prev, { item, qty: 1 }]
    })
    // A short nudge on the row itself, so the tap has a physical receipt.
    if (el && !reduced.current) {
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.985)' }, { transform: 'scale(1)' }], {
        duration: 260,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      })
    }
  }, [])

  const send = useCallback(() => {
    const basket = basketRef.current
    const minute = minuteRef.current
    if (basket.length === 0) return

    // On a phone the board sits below the fold, so the whole point of the
    // demo would happen where nobody can see it. Bring it up first.
    const panel = board.current
    let settle = 0
    if (panel) {
      const rect = panel.getBoundingClientRect()
      if (rect.top > window.innerHeight * 0.55 || rect.bottom < 0) {
        panel.scrollIntoView({ behavior: reduced.current ? 'auto' : 'smooth', block: 'center' })
        settle = reduced.current ? 0 : 460
      }
    }

    const byDept = new Map<DemoDept, Basket[]>()
    for (const b of basket) {
      const list = byDept.get(b.item.dept)
      if (list) list.push(b)
      else byDept.set(b.item.dept, [b])
    }

    const created: Ticket[] = []
    for (const [dept, entries] of byDept) {
      created.push({
        id: `${Date.now()}-${dept}`,
        ref: nextRef.current++,
        dept,
        lines: entries.map((e) => ({ name: e.item.name, qty: e.qty })),
        total: entries.reduce((s, e) => s + e.item.price * e.qty, 0),
        // The request inherits the slowest item in it — you are not done until
        // the whole tray arrives.
        sla: Math.max(...entries.map((e) => e.item.sla)),
        status: 'new',
        bornAt: minute,
        escalated: false,
      })
    }

    created.forEach((t, i) =>
      timers.current.push(
        setTimeout(
          () => fly(t.dept, t.lines.map((l) => `${l.qty > 1 ? `${l.qty}× ` : ''}${l.name}`).join(', ')),
          settle + i * 130,
        ),
      ),
    )
    timers.current.push(setTimeout(() => setTickets((prev) => [...prev, ...created]), settle + 430))
    basketRef.current = []
    setBasket([])
  }, [fly])

  const advance = useCallback((id: string) => {
    setTickets((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        if (t.status === 'new') return { ...t, status: 'ack' }
        if (t.status === 'ack') {
          // Charges post on completion, never on order — same rule as lib/folio.ts.
          if (t.total > 0) setFolio((f) => f + t.total)
          return { ...t, status: 'done' }
        }
        return t
      }),
    )
  }, [])

  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    basketRef.current = []
    minuteRef.current = 0
    setTickets([])
    setBasket([])
    setFolio(0)
    setEscalation(null)
    setMinute(0)
    setPlaying(false)
    nextRef.current = 1
  }, [])

  /** A 22-second version of a real evening, for visitors who will not tap. */
  const play = useCallback(() => {
    reset()
    setPlaying(true)
    setTouched(true)
    const at = (ms: number, fn: () => void) => {
      timers.current.push(setTimeout(fn, ms))
    }
    const byId = (id: string) => DEMO_SECTIONS.flatMap((sec) => sec.items).find((i) => i.id === id)!
    const onlyDept = (dept: DemoDept, patch: (t: Ticket) => Ticket) =>
      setTickets((prev) => prev.map((t) => (t.dept === dept ? patch(t) : t)))

    at(400, () => setTab('ask'))
    at(900, () => add(byId('towels')))
    at(1700, () => setTab('dining'))
    at(2300, () => add(byId('dosa')))
    at(3000, () => add(byId('chai')))
    at(4000, () => send())

    // The kitchen picks its ticket up. Housekeeping does not — and ten demo
    // minutes after it landed, the escalation fires on its own.
    at(6400, () => onlyDept('fnb', (t) => ({ ...t, status: 'ack' })))
    at(15500, () => onlyDept('housekeeping', (t) => ({ ...t, status: 'ack' })))
    at(18000, () =>
      onlyDept('housekeeping', (t) => {
        if (t.total > 0) setFolio((f) => f + t.total)
        return { ...t, status: 'done' }
      }),
    )
    at(21000, () =>
      onlyDept('fnb', (t) => {
        if (t.total > 0) setFolio((f) => f + t.total)
        return { ...t, status: 'done' }
      }),
    )
    at(22500, () => setPlaying(false))
  }, [add, send, reset])

  const section = DEMO_SECTIONS.find((s) => s.tab === tab)!
  const basketCount = basket.reduce((s, b) => s + b.qty, 0)
  const basketTotal = basket.reduce((s, b) => s + b.item.price * b.qty, 0)

  const hint = useMemo(() => {
    if (!touched) return 'Tap anything on the phone — this is the real menu.'
    if (basketCount > 0) return 'Now send it. Watch where each thing lands.'
    if (tickets.length === 0) return 'Add a towel and a dosa together, then send.'
    if (tickets.some((t) => t.escalated)) return 'Nobody accepted the towels in time, so it escalated itself.'
    if (tickets.some((t) => t.status !== 'done')) return 'You are reception now. Accept them, finish them.'
    return 'That is the whole loop. The phone never rang.'
  }, [touched, basketCount, tickets])

  return (
    <div ref={stage} className="mx-auto w-full max-w-[1240px] px-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted text-[13px]" aria-live="polite">
          {hint}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={play}
            disabled={playing}
            className="border-line hover:border-ink inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition disabled:opacity-40"
          >
            <IconPlay size={13} />
            {playing ? 'Playing…' : 'Play an evening'}
          </button>
          <button
            onClick={reset}
            className="text-faint hover:text-ink inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold transition"
          >
            <IconRestart size={13} />
            Reset
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[318px_1fr] lg:gap-6">
        <Phone
          tab={tab}
          setTab={setTab}
          section={section}
          onAdd={add}
          basketCount={basketCount}
          basketTotal={basketTotal}
          folio={folio}
          onSend={send}
        />

        <div className="min-w-0">
          <div ref={board} className="border-line bg-surface rounded-[20px] border p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-0.5">
              <div>
                <p className="text-[14px] font-semibold">Reception board</p>
                <p className="text-faint text-[12px]">Filtered by team — what each department sees</p>
              </div>
              <span className="text-faint inline-flex items-center gap-1.5 text-[11px] font-medium tabular-nums">
                <span className="bg-ok h-1.5 w-1.5 animate-pulse rounded-full" />
                {String(Math.floor(minute / 60)).padStart(2, '0')}:{String(minute % 60).padStart(2, '0')} elapsed
              </span>
            </div>

            {escalation && (
              <div className="bg-late-soft mb-3 flex items-start gap-2.5 rounded-xl px-3 py-2.5">
                <IconAlert size={15} className="text-late mt-px shrink-0" />
                <p className="text-late text-[12px] leading-snug">
                  <span className="font-semibold">WhatsApp sent to Priya Deshmukh, duty manager.</span>{' '}
                  Room {escalation.room} — {escalation.what} (#{escalation.ref}) is {escalation.minutes} min old, past
                  its target and still unaccepted.
                </p>
              </div>
            )}

            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {LANES.map((dept) => {
                const lane = tickets.filter((t) => t.dept === dept)
                return (
                  <div
                    key={dept}
                    ref={(el) => {
                      laneRefs.current[dept] = el
                    }}
                    className="bg-paper rounded-2xl p-2.5 sm:min-h-[178px]"
                  >
                    <div className="mb-2 flex items-baseline justify-between px-1">
                      <p className="text-[12px] font-semibold">{DEPT_LABEL[dept]}</p>
                      <span className="text-faint text-[11px] tabular-nums">{lane.length || ''}</span>
                    </div>
                    <div className="space-y-2">
                      {lane.length === 0 ? (
                        <p className="text-faint px-1 py-2.5 text-center text-[11px] sm:pt-8 sm:pb-0">
                          Nothing waiting
                        </p>
                      ) : (
                        lane.map((t) => (
                          <TicketCard key={t.id} t={t} minute={minute} onAdvance={() => advance(t.id)} />
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <p className="text-faint mt-3 px-1 text-[12px] leading-relaxed">
            Time runs at a minute per second here so you can watch a request go late. Everything else is the real
            thing: RN Grand&rsquo;s actual menu and prices, the actual target times, the actual routing, and the
            escalation firing on its own the moment a target is missed.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ phone */

function Phone({
  tab,
  setTab,
  section,
  onAdd,
  basketCount,
  basketTotal,
  folio,
  onSend,
}: {
  tab: 'ask' | 'dining' | 'services'
  setTab: (t: 'ask' | 'dining' | 'services') => void
  section: (typeof DEMO_SECTIONS)[number]
  onAdd: (i: DemoItem, el?: HTMLElement | null) => void
  basketCount: number
  basketTotal: number
  folio: number
  onSend: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-[318px] lg:mx-0">
      <div className="border-line bg-surface overflow-hidden rounded-[30px] border shadow-[0_30px_60px_-30px_rgba(28,25,23,.35)]">
        <div className="border-line flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-[13px] leading-tight font-semibold">RN Grand, Pune</p>
            <p className="text-faint text-[11px] leading-tight">Room 204 · Deluxe</p>
          </div>
          <button
            id="demo-basket"
            onClick={onSend}
            disabled={basketCount === 0}
            className="relative rounded-full bg-[var(--brand)] px-3 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-25"
          >
            {basketCount > 0 ? `Send ${basketCount}` : 'Basket'}
            {basketTotal > 0 && <span className="ml-1.5 font-normal opacity-80">{rupees(basketTotal)}</span>}
          </button>
        </div>

        <div className="no-scrollbar border-line flex gap-1.5 overflow-x-auto border-b px-3 py-2">
          {DEMO_SECTIONS.map((s) => (
            <button
              key={s.tab}
              onClick={() => setTab(s.tab)}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition ${
                s.tab === tab ? 'bg-ink text-white' : 'text-muted hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="divide-line h-[352px] divide-y overflow-y-auto">
          {section.items.map((item) => (
            <button
              key={item.id}
              onClick={(e) => onAdd(item, e.currentTarget)}
              className="hover:bg-paper flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left transition"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  {item.veg !== undefined && (
                    <span
                      className={`inline-grid h-3 w-3 shrink-0 place-items-center rounded-[2px] border ${
                        item.veg ? 'border-ok' : 'border-late'
                      }`}
                    >
                      <span className={`h-1 w-1 rounded-full ${item.veg ? 'bg-ok' : 'bg-late'}`} />
                    </span>
                  )}
                  <span className="text-[13px] leading-snug font-medium">{item.name}</span>
                </span>
                {item.note && <span className="text-faint mt-0.5 block text-[11px]">{item.note}</span>}
                <span className="text-faint mt-0.5 block text-[11px]">
                  {item.price > 0 ? <span className="text-ink font-semibold">{rupees(item.price)}</span> : 'Complimentary'}
                  <span> · {item.sla} min</span>
                </span>
              </span>
              <span className="text-[11px] font-semibold text-[var(--brand)]">Add</span>
            </button>
          ))}
        </div>

        {folio > 0 && (
          <div className="border-line flex items-center justify-between border-t px-4 py-2.5">
            <span className="text-faint text-[11px]">Charged to Room 204</span>
            <span className="text-[13px] font-semibold tabular-nums">{rupees(folio)}</span>
          </div>
        )}

        <div className="border-line text-faint grid grid-cols-5 border-t">
          {[
            [IconHome, 'Home'],
            [IconDining, 'Dining'],
            [IconBell, 'Services'],
            [IconInfo, 'Hotel'],
            [IconChat, 'Chat'],
          ].map(([Ico, label], i) => {
            const I = Ico as typeof IconHome
            const active = (i === 0 && tab === 'ask') || (i === 1 && tab === 'dining') || (i === 2 && tab === 'services')
            return (
              <span
                key={label as string}
                className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
                  active ? 'text-[var(--brand)]' : ''
                }`}
              >
                <I size={16} />
                {label as string}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ card */

function TicketCard({ t, minute, onAdvance }: { t: Ticket; minute: number; onAdvance: () => void }) {
  const tone = slaTone(t, minute)
  const elapsed = minute - t.bornAt
  const left = t.sla - elapsed
  const pct = Math.max(0, Math.min(100, (elapsed / t.sla) * 100))

  const bar = tone === 'late' ? 'bg-late' : tone === 'warn' ? 'bg-warn' : tone === 'done' ? 'bg-line' : 'bg-ok'

  return (
    <article
      className={`border-line overflow-hidden rounded-xl border transition-colors ${
        tone === 'late' ? 'bg-late-soft' : 'bg-surface'
      } ${t.status === 'done' ? 'opacity-55' : ''}`}
      style={{ animation: 'hc-card-in .42s cubic-bezier(.2,.8,.2,1) both' }}
    >
      <div className="px-2.5 pt-2.5 pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] leading-none font-semibold tabular-nums">204</span>
          <span className="text-faint text-[10px] font-medium tabular-nums">#{t.ref}</span>
        </div>
        <p className="mt-1.5 text-[12px] leading-snug">
          {t.lines.map((l) => `${l.qty > 1 ? `${l.qty}× ` : ''}${l.name}`).join(', ')}
        </p>
        {t.total > 0 && <p className="text-faint mt-1 text-[11px] tabular-nums">{rupees(t.total)}</p>}

        <div className="mt-2 flex items-center gap-2">
          <span className="bg-line/70 h-1 flex-1 overflow-hidden rounded-full">
            <span className={`block h-full rounded-full transition-[width] duration-700 ${bar}`} style={{ width: `${pct}%` }} />
          </span>
          <span
            className={`text-[10px] font-semibold tabular-nums ${
              tone === 'late' ? 'text-late' : tone === 'warn' ? 'text-warn' : 'text-faint'
            }`}
          >
            {t.status === 'done' ? 'done' : left > 0 ? `${left}m` : `+${Math.abs(left)}m`}
          </span>
        </div>

        {t.escalated && t.status !== 'done' && (
          <p className="text-late mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold">
            <IconAlert size={11} />
            Escalated
          </p>
        )}
      </div>

      {t.status !== 'done' && (
        <button
          onClick={onAdvance}
          className={`w-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
            t.status === 'new'
              ? 'border-line text-muted hover:text-ink border-t'
              : 'bg-ink text-white hover:opacity-90'
          }`}
        >
          {t.status === 'new' ? 'Accept' : 'Mark done'}
        </button>
      )}
      {t.status === 'done' && (
        <p className="text-ok border-line inline-flex w-full items-center justify-center gap-1 border-t py-1.5 text-[11px] font-semibold">
          <IconCheck size={11} />
          Done
        </p>
      )}
    </article>
  )
}
