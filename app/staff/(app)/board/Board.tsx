'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { hotelTime } from '@/lib/clock'
import { rupees } from '@/lib/money'
import { formatAge, minutesRemaining, needsAttention, notDueYet, since, slaState } from '@/lib/sla'
import { STATUS_LABEL, teamLabel, type BoardRequest, type ChatMessage, type RequestStatus } from '@/lib/types'
import type { ChatRoom } from '@/lib/board'
import { IconAlarm, IconChat, IconChevron, IconClose } from '@/components/icons'
import { assign, openThread, quickReplies, reply, updateStatus } from './actions'

// The board is pushed, not polled — see /api/staff/board/live. This is the
// seatbelt: it covers a dropped stream, and it is what knocks on the server to
// run the escalation sweep, which is time-based and so has nothing to notify it.
const POLL_MS = 60_000

// How often the amber alert rings again while a request sits unaccepted. Short
// enough that it is an alarm, long enough that a desk can hold a conversation
// between two of them.
const RING_MS = 20_000

type Me = { id: string; name: string; role: string; department: string }

export default function Board({
  me,
  visibleDepartments,
  teams,
  properties,
  assignable,
  initialRequests,
  initialChats,
  serverNow,
}: {
  me: Me
  visibleDepartments: string[]
  // Every team, not only the open ones: a request routed to a team that has
  // since been closed still has to say which team it was.
  teams: { value: string; label: string; active: boolean }[]
  properties: { id: string; name: string }[]
  assignable: { id: string; name: string; department: string }[]
  initialRequests: BoardRequest[]
  initialChats: ChatRoom[]
  // The server's clock, so the first client render agrees with the HTML it is
  // hydrating. See the useState below.
  serverNow: number
}) {
  const router = useRouter()
  const [requests, setRequests] = useState(initialRequests)
  const [chats, setChats] = useState(initialChats)
  const [property, setProperty] = useState<string>('')
  const [dept, setDept] = useState<string>('')
  const [view, setView] = useState<'requests' | 'messages'>('requests')
  const [openId, setOpenId] = useState<string | null>(null)
  const [chatRoom, setChatRoom] = useState<{ id: string; number: string } | null>(null)
  const [alerts, setAlerts] = useState(false)
  // Which alert has been silenced, held as the ids it was made of rather than
  // as a boolean. Silence then lasts exactly as long as that alert does: the
  // next one rings, and so does this one the moment another room joins it. An
  // alarm a single click turns off for the rest of a shift is a fire alarm with
  // the battery taken out.
  const [silenced, setSilenced] = useState<string | null>(null)
  // Seeded from the server, not from Date.now().
  //
  // Every age label on this board is derived from this value, and a client
  // component is server-rendered too. Reading the clock here read it twice —
  // once server-side, once at hydration — so any card sitting on a rounding
  // boundary rendered "just now" in the HTML and "1m" in the browser, and
  // React threw the whole tree away and rebuilt it. The interval below takes
  // over a moment later, so the only cost is that the first paint can be up to
  // one tick stale, which is invisible at minute granularity.
  const [now, setNow] = useState(serverNow)
  const [stale, setStale] = useState(false)

  const seen = useRef(new Set(initialRequests.map((r) => r.id)))
  // Which cards get the arrival animation. Emptied a beat later so a card that
  // arrived earlier does not replay it when it moves between columns.
  const [landing, setLanding] = useState<ReadonlySet<string>>(new Set())
  // A status change is a round trip. Without this, Done on a phone takes two
  // taps before the card visibly moves and both of them are sent.
  const [acting, setActing] = useState<ReadonlySet<string>>(new Set())
  // setInterval fires whether or not the last request came back. Without this
  // guard a slow network makes polls overlap, and overlapping polls exhaust the
  // database pool until the whole app stops responding.
  const inFlight = useRef(false)
  const chime = useRef<(() => void) | null>(null)

  const canFilterDepartment = visibleDepartments.length === 0
  // The hotel's own name for a team, not the humanised slug.
  const nameOf = useCallback((slug: string) => teamLabel(teams, slug), [teams])

  // Read through a ref, not a dependency. `announce` feeds `apply`, which the
  // live stream and the poll both depend on — so with `alerts` in the closure,
  // hitting the alerts button closed the EventSource and opened a new one,
  // losing whatever was pushed in between.
  const alertsOn = useRef(alerts)
  useEffect(() => {
    alertsOn.current = alerts
  }, [alerts])

  // Declared above `apply`, which calls it: read the other way round it
  // captured a stale `alerts` and could chime after the toggle was off.
  const announce = useCallback(
    (arrived: BoardRequest[]) => {
    if (!alertsOn.current) return
    chime.current?.()
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const r of arrived.slice(0, 3)) {
        const what = r.items.length ? r.items.map((i) => `${i.qty}× ${i.name}`).join(', ') : r.note || 'New request'
        new Notification(`Room ${r.room_number} — ${nameOf(r.department)}`, {
          body: what,
          tag: r.id,
        })
      }
      }
    },
    [nameOf],
  )

  // One landing point for new data, whether it was pushed or fetched.
  const apply = useCallback(
    (data: { requests: BoardRequest[]; chats: ChatRoom[] }) => {
      setRequests(data.requests)
      setChats(data.chats)
      setStale(false)

      const arrived = data.requests.filter((r) => !seen.current.has(r.id))
      for (const r of data.requests) seen.current.add(r.id)
      if (arrived.length > 0) {
        announce(arrived)
        const ids = arrived.map((r) => r.id)
        setLanding(new Set(ids))
        setTimeout(() => setLanding(new Set()), 1000)
      }
    },
    [announce],
  )

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch(`/api/staff/board${property ? `?property=${property}` : ''}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (res.status === 401) {
        // A shift can outlive a session. Route rather than assigning location:
        // the drawer, the stream and the poll all unmount on the way out.
        router.push('/staff/login')
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      apply((await res.json()) as { requests: BoardRequest[]; chats: ChatRoom[] })
    } catch {
      // A reception PC on hotel wifi will drop. Say so rather than showing a
      // frozen board as if it were live.
      setStale(true)
    } finally {
      inFlight.current = false
    }
  }, [property, apply, router])

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  // The live channel. A guest's order lands on the screen as it is written.
  useEffect(() => {
    const url = `/api/staff/board/live${property ? `?property=${property}` : ''}`
    let source: EventSource | null = new EventSource(url)
    let failures = 0

    source.onmessage = (e) => {
      failures = 0
      try {
        apply(JSON.parse(e.data))
      } catch {
        // A truncated frame is not worth blanking the board for.
      }
    }
    // EventSource retries forever by itself, including against a server with
    // no listener to give. Three strikes and the poll above carries it.
    source.onerror = () => {
      if (++failures >= 3) {
        source?.close()
        source = null
      }
    }

    return () => source?.close()
  }, [property, apply])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  async function enableAlerts() {
    // A short square-ish blip from the Web Audio API — no asset to host, and it
    // cuts through a noisy lobby better than a soft chime.
    if (!chime.current) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      chime.current = () => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(880, ctx.currentTime)
        osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.11)
        gain.gain.setValueAtTime(0.001, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32)
        osc.connect(gain).connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.34)
      }
      // Browsers only let audio start inside a user gesture, which this is.
      await ctx.resume().catch(() => {})
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
    setAlerts(true)
    chime.current?.()
  }

  const filtered = useMemo(
    () => (dept ? requests.filter((r) => r.department === dept) : requests),
    [requests, dept],
  )

  const columns = useMemo(
    () => ({
      new: filtered.filter((r) => r.status === 'new'),
      working: filtered.filter((r) => r.status === 'ack' || r.status === 'in_progress'),
      done: filtered.filter((r) => r.status === 'done' || r.status === 'cancelled'),
    }),
    [filtered],
  )

  /**
   * The amber alert: a request nobody has accepted that has already eaten into
   * the time it was promised in.
   *
   * Read off `requests` and not `filtered`, deliberately. An alarm that goes
   * quiet because somebody left a team filter on is an alarm nobody can rely
   * on, and the filter is a view of the board rather than a claim about what
   * is happening in the hotel.
   */
  const ringing = useMemo(
    () => requests.filter((r) => needsAttention(r, new Date(now))),
    [requests, now],
  )

  // Keeps ringing. The blip in `announce` says something arrived; this says
  // something is *still* sitting there, and it repeats until somebody accepts
  // it — because the arrival blip is the one that was missed.
  //
  // Keyed on the ids rather than the array: `now` ticks every 15s and would
  // otherwise restart the interval before it ever got to fire.
  const alarmKey = useMemo(() => ringing.map((r) => r.id).join(','), [ringing])
  const muted = silenced === alarmKey

  useEffect(() => {
    if (ringing.length === 0 || !alerts || muted) return
    // Twice, a beat apart. One blip is an arrival; two is a nag.
    const ring = () => {
      chime.current?.()
      setTimeout(() => chime.current?.(), 420)
    }
    ring()
    const t = setInterval(ring, RING_MS)
    return () => clearInterval(t)
  }, [alarmKey, ringing.length, alerts, muted])

  // The board lives in a background tab on a reception PC as often as not, and
  // a tab says nothing unless its title does. The clean title is captured
  // before the count is ever written into it, or the second run would count
  // the first run's prefix as part of the name.
  const baseTitle = useRef<string | null>(null)
  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title
    document.title = ringing.length > 0 ? `(${ringing.length}) waiting · ${baseTitle.current}` : baseTitle.current
  }, [ringing.length])

  const overdue = filtered.filter((r) => slaState(r, new Date(now)) === 'late').length
  const unreadTotal = chats.reduce((s, c) => s + c.unread, 0)
  const openRequest = requests.find((r) => r.id === openId) ?? null

  async function act(id: string, status: RequestStatus, reason?: string) {
    if (acting.has(id)) return
    // Move the card immediately; the next poll is the source of truth.
    setActing((prev) => new Set(prev).add(id))
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    const res = await updateStatus(id, status, reason)
    if (!res.ok) alert(res.error)
    await refresh()
    setActing((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4">
      {/* Four groups that sit on one line on a monitor. On a phone the order
          is rewritten rather than left to wrap where it falls: view and alerts
          together on top, then the property, then the teams as a rail. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="border-line order-1 flex rounded-xl border p-0.5">
          {(
            [
              ['requests', `Requests${columns.new.length ? ` · ${columns.new.length}` : ''}`],
              ['messages', `Messages${unreadTotal ? ` · ${unreadTotal}` : ''}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`rounded-[9px] px-3 py-2 text-[13px] font-semibold whitespace-nowrap transition sm:py-1.5 ${
                view === id ? 'bg-ink text-white' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {properties.length > 1 && (
          <select
            value={property}
            onChange={(e) => setProperty(e.target.value)}
            className="border-line bg-surface order-3 w-full rounded-xl border px-3 py-2 text-[13px] font-medium sm:order-2 sm:w-auto"
          >
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        {canFilterDepartment && (
          <div className="no-scrollbar order-4 -mx-4 flex w-full gap-1.5 overflow-x-auto px-4 sm:order-3 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0">
            <Chip on={dept === ''} onClick={() => setDept('')}>
              All teams
            </Chip>
            {teams.filter((t) => t.active).map((d) => {
              const count = requests.filter((r) => r.department === d.value && r.status !== 'done' && r.status !== 'cancelled').length
              return (
                <Chip key={d.value} on={dept === d.value} onClick={() => setDept(d.value)}>
                  {d.label}
                  {count > 0 && <span className="ml-1.5 opacity-60">{count}</span>}
                </Chip>
              )
            })}
          </div>
        )}

        <div className="order-2 ml-auto flex items-center gap-2.5 sm:order-4">
          {overdue > 0 && (
            <span className="bg-late-soft text-late rounded-full px-2.5 py-1 text-[12px] font-semibold">
              {overdue} overdue
            </span>
          )}
          {stale && <span className="text-warn text-[12px] font-medium">Reconnecting…</span>}
          <button
            onClick={() => (alerts ? setAlerts(false) : enableAlerts())}
            aria-pressed={alerts}
            aria-label={alerts ? 'Alerts on' : 'Turn on alerts'}
            className={`flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-semibold transition sm:min-h-0 ${
              alerts ? 'border-ok text-ok' : 'border-line hover:border-ink'
            }`}
          >
            <IconAlarm size={15} on={alerts} />
            <span className="hidden sm:inline">{alerts ? 'Alerts on' : 'Turn on alerts'}</span>
          </button>
        </div>
      </div>

      {/* Amber, and it does not have a close button: the only thing that
          clears it is accepting the work, which is what the button on each row
          does. The sound can be silenced; the alert cannot. */}
      {ringing.length > 0 && (
        <div role="alert" aria-live="assertive" className="border-warn/35 bg-warn-soft mb-4 rounded-2xl border p-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="bg-warn absolute inset-0 rounded-full" />
              <span
                className="bg-warn absolute inset-0 rounded-full"
                style={{ animation: 'hc-pulse 1.8s var(--ease-glide) infinite' }}
              />
            </span>
            <p className="text-warn text-[14px] font-semibold tracking-[-0.01em]">
              {ringing.length === 1
                ? 'A request is past its time and nobody has accepted it'
                : `${ringing.length} requests are past their time and nobody has accepted them`}
            </p>
            {/* Without the sound this is a banner on a screen nobody is looking
                at, so the offer to turn it on lives here as well as in the
                toolbar — this is the moment it matters. */}
            <button
              onClick={() => (alerts ? setSilenced(muted ? null : alarmKey) : enableAlerts())}
              aria-pressed={alerts ? muted : undefined}
              className="border-warn/40 text-warn hover:bg-warn/10 ml-auto flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition sm:min-h-0 sm:py-1.5"
            >
              <IconAlarm size={15} on={alerts && !muted} />
              {!alerts ? 'Turn on the sound' : muted ? 'Silenced' : 'Silence'}
            </button>
          </div>

          <ul className="mt-3 grid gap-1.5">
            {ringing.slice(0, 4).map((r) => (
              <li
                key={r.id}
                className="bg-surface/70 border-warn/20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2"
              >
                <span className="text-[14px] font-semibold">Room {r.room_number}</span>
                <span className="text-muted text-[13px]">
                  {nameOf(r.department)} · {formatAge(r.created_at, new Date(now))} old, target {r.sla_minutes}m
                </span>
                <button
                  onClick={() => act(r.id, 'ack')}
                  disabled={acting.has(r.id)}
                  className="bg-ink border-ink ml-auto min-h-11 shrink-0 rounded-lg border px-3.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-55 sm:min-h-0 sm:py-1.5"
                >
                  {acting.has(r.id) ? 'Accepting…' : 'Accept'}
                </button>
              </li>
            ))}
          </ul>
          {ringing.length > 4 && (
            <p className="text-warn mt-2 text-[12px] font-medium">
              And {ringing.length - 4} more in New.
            </p>
          )}
        </div>
      )}

      {view === 'requests' ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <Column title="New" tone="late" count={columns.new.length} empty="Nothing waiting. Good.">
            {columns.new.map((r) => (
              <Card key={r.id} r={r} now={now} landing={landing.has(r.id)} busy={acting.has(r.id)} team={nameOf(r.department)} onOpen={setOpenId} onAct={act} />
            ))}
          </Column>
          <Column title="Working" tone="warn" count={columns.working.length} empty="Nothing in progress.">
            {columns.working.map((r) => (
              <Card key={r.id} r={r} now={now} landing={landing.has(r.id)} busy={acting.has(r.id)} team={nameOf(r.department)} onOpen={setOpenId} onAct={act} />
            ))}
          </Column>
          <Column title="Finished · last 4h" tone="ok" count={columns.done.length} empty="Nothing finished yet.">
            {columns.done.map((r) => (
              <Card key={r.id} r={r} now={now} landing={landing.has(r.id)} busy={acting.has(r.id)} team={nameOf(r.department)} onOpen={setOpenId} onAct={act} />
            ))}
          </Column>
        </div>
      ) : (
        <Messages chats={chats} now={now} onOpen={(c) => setChatRoom({ id: c.room_id, number: c.room_number })} />
      )}

      {openRequest && (
        <Drawer onClose={() => setOpenId(null)} title={`Room ${openRequest.room_number}`}>
          <RequestDetail
            r={openRequest}
            team={nameOf(openRequest.department)}
            nameOf={nameOf}
            me={me}
            assignable={assignable}
            now={now}
            onAct={act}
            onChat={() => {
              setChatRoom({ id: openRequest.room_id, number: openRequest.room_number })
              setOpenId(null)
            }}
            onRefresh={refresh}
          />
        </Drawer>
      )}

      {chatRoom && chatRoom.id && (
        <Drawer onClose={() => setChatRoom(null)} title={`Room ${chatRoom.number}`}>
          <Thread roomId={chatRoom.id} onSent={refresh} />
        </Drawer>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- pieces */

/**
 * "Sunita R." rather than "Sunita", because a card that only ever showed the
 * first word made two people called Sunita the same person until you opened
 * the drawer to find out which one.
 */
function shortName(full: string) {
  const [first, ...rest] = full.trim().split(/\s+/)
  const last = rest[rest.length - 1]
  return last ? `${first} ${last[0]}.` : first
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`shrink-0 rounded-xl border px-3 py-2 text-[13px] font-medium whitespace-nowrap transition ${
        on ? 'bg-ink border-ink text-white' : 'border-line bg-surface text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function Column({
  title,
  count,
  tone,
  empty,
  children,
}: {
  title: string
  count: number
  tone: 'late' | 'warn' | 'ok'
  empty: string
  children: React.ReactNode
}) {
  const dot = { late: 'bg-late', warn: 'bg-warn', ok: 'bg-ok' }[tone]
  return (
    <section className="bg-surface border-line rounded-2xl border p-3">
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <span className="text-faint text-[13px] tabular-nums">{count}</span>
      </div>
      <div className="space-y-2">
        {count === 0 ? <p className="text-faint px-1 py-6 text-center text-[13px]">{empty}</p> : children}
      </div>
    </section>
  )
}

function Card({
  r,
  now,
  landing,
  busy,
  team,
  onOpen,
  onAct,
}: {
  r: BoardRequest
  now: number
  landing: boolean
  busy: boolean
  team: string
  onOpen: (id: string) => void
  onAct: (id: string, s: RequestStatus) => void
}) {
  const state = slaState(r, new Date(now))
  const left = minutesRemaining(r, new Date(now))
  // How long until a scheduled request is due, or null once it is. formatAge
  // is the same minutes-to-"7h 10m" formatter the age labels use, read the
  // other way round: from now, to the hour the guest picked.
  const until =
    r.scheduled_for && notDueYet(r, new Date(now))
      ? formatAge(new Date(now), new Date(r.scheduled_for))
      : null
  const stripe = { late: 'bg-late', warn: 'bg-warn', ok: 'bg-ok', done: 'bg-line' }[state]
  const summary = r.items.length
    ? r.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`).join(', ')
    : r.note || 'Request'

  return (
    <article
      className={`border-line relative overflow-hidden rounded-xl border pl-2.5 transition ${
        state === 'late' ? 'bg-late-soft' : 'bg-surface'
      }`}
      style={landing ? { animation: 'hc-card-in 420ms var(--ease-glide) both' } : undefined}
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} />
      {/* Spans, not divs and paragraphs: a button may only contain phrasing
          content, and the invalid nesting left this — the card's whole purpose
          — announcing itself as an unlabelled button. */}
      <button
        onClick={() => onOpen(r.id)}
        aria-label={`Room ${r.room_number}, request ${r.ref}: ${summary}`}
        className="w-full px-2.5 py-2.5 text-left"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[17px] leading-none font-semibold tabular-nums">{r.room_number}</span>
          <span className="text-faint text-[11px] font-medium">
            #{r.ref} · {formatAge(r.created_at, new Date(now))}
          </span>
        </span>
        {/* One basket of towels, a room clean and a toiletries kit joined with
            commas read as one long sentence, and the housekeeper had to parse
            where each job ended. More than one thing is a list.

            A guest can also type 500 characters without a space. Below lg the
            grid has no explicit columns, so one such note sized the whole board
            to max-content and gave it 4,800px of sideways scroll — hence
            `break-words` on every branch here. */}
        {r.items.length > 1 ? (
          <span className="mt-1.5 block space-y-0.5">
            {r.items.map((i) => (
              <span key={i.id} className="flex gap-1.5 text-[13px] leading-snug break-words">
                <span className="text-faint select-none">·</span>
                <span>
                  {i.qty > 1 && <span className="font-semibold tabular-nums">{i.qty}× </span>}
                  {i.name}
                  {i.modifiers.length > 0 && (
                    <span className="text-muted"> · {i.modifiers.map((m) => m.name).join(', ')}</span>
                  )}
                </span>
              </span>
            ))}
          </span>
        ) : (
          <span className="mt-1.5 block text-[13px] leading-snug break-words">{summary}</span>
        )}
        {r.note && r.items.length > 0 && (
          <span className="text-muted mt-1 block text-[12px] break-words italic">“{r.note}”</span>
        )}

        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <Tag>{team}</Tag>
          {r.total_paise > 0 && <Tag>{rupees(r.total_paise)}</Tag>}
          {/* The property's clock, not the reader's: a group admin has Mumbai
              and Pune on one board, and a reception laptop can be set to
              anything at all. */}
          {r.scheduled_for && <Tag tone="warn">for {hotelTime(r.scheduled_for, r.property_timezone)}</Tag>}
          {r.escalated_at && <Tag tone="late">Escalated</Tag>}
          {r.unread_messages > 0 && (
            <Tag tone="warn">
              <IconChat size={11} className="mr-1 inline align-[-1px]" />
              {r.unread_messages}
            </Tag>
          )}
          {r.status !== 'new' && r.status !== 'done' && r.status !== 'cancelled' && (
            <Tag>{r.assigned_name ? shortName(r.assigned_name) : STATUS_LABEL[r.status]}</Tag>
          )}
          {r.status === 'cancelled' && <Tag>Cancelled</Tag>}
        </span>

        {state !== 'done' && (
          <span className={`mt-1.5 block text-[11px] font-medium ${state === 'late' ? 'text-late' : 'text-muted'}`}>
            {/* A request booked for seven has no countdown running at midnight,
                and this read "430 min left of 10". What a shift wants off a
                scheduled row is how long it has, not a budget nobody spent. */}
            {until
              ? until === 'just now'
                ? 'due now'
                : `due in ${until}`
              : left > 0
                ? `${left} min left of ${r.sla_minutes}`
                : left === 0
                  ? 'due now'
                  : `${Math.abs(left)} min over`}
          </span>
        )}
      </button>

      {r.status !== 'done' && r.status !== 'cancelled' && (
        <div className="border-line flex gap-1.5 border-t px-2.5 py-2">
          {r.status === 'new' && (
            <Action busy={busy} onClick={() => onAct(r.id, 'ack')}>
              Accept
            </Action>
          )}
          {r.status === 'ack' && (
            <Action busy={busy} onClick={() => onAct(r.id, 'in_progress')}>
              Start
            </Action>
          )}
          <Action primary busy={busy} onClick={() => onAct(r.id, 'done')}>
            Done
          </Action>
        </div>
      )}
    </article>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'late' }) {
  const cls =
    tone === 'late' ? 'bg-late-soft text-late' : tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-paper text-muted'
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

/** Housekeeping taps these in a corridor: 44px is the floor on a touch screen,
 *  and it is wasted height on a reception monitor. */
function Action({
  children,
  onClick,
  primary,
  busy,
}: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
  busy?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`min-h-11 flex-1 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition disabled:opacity-40 sm:min-h-0 ${
        primary ? 'bg-ink text-white hover:opacity-90' : 'border-line text-muted hover:text-ink border'
      }`}
    >
      {children}
    </button>
  )
}

/* --------------------------------------------------------------- drawer */

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    // On a phone this fills the screen, and without the lock the board went on
    // scrolling underneath it — you closed the drawer somewhere else entirely.
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="bg-scrim absolute inset-0"
        style={{ animation: 'hc-fade-in 240ms var(--ease-glide) both' }}
        onClick={onClose}
      />
      <div
        className="bg-surface relative flex h-full w-full max-w-md flex-col shadow-[var(--shadow-lift)]"
        style={{ animation: 'hc-drawer-in 380ms var(--ease-glide) both' }}
      >
        <div className="border-line flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-faint hover:text-ink -mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-90"
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function RequestDetail({
  r,
  team,
  nameOf,
  me,
  assignable,
  now,
  onAct,
  onChat,
  onRefresh,
}: {
  r: BoardRequest
  team: string
  nameOf: (slug: string) => string
  me: Me
  assignable: { id: string; name: string; department: string }[]
  now: number
  onAct: (id: string, s: RequestStatus, reason?: string) => void
  onChat: () => void
  onRefresh: () => void
}) {
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const live = r.status !== 'done' && r.status !== 'cancelled'

  return (
    <div className="space-y-5 p-4">
      <div>
        <p className="text-faint text-[12px]">
          #{r.ref} · {r.property_name} · {team}
        </p>
        <p className="mt-1 text-[15px] font-medium">
          {r.guest_name ?? 'Guest'}
          {r.room_floor ? ` · Floor ${r.room_floor}` : ''}
        </p>
        <p className="text-muted mt-0.5 text-[13px]">
          Raised {since(r.created_at, new Date(now))} · target {r.sla_minutes} min ·{' '}
          <span className={slaState(r, new Date(now)) === 'late' ? 'text-late font-semibold' : ''}>
            {STATUS_LABEL[r.status]}
          </span>
        </p>
      </div>

      {r.items.length > 0 && (
        <div className="border-line divide-line divide-y rounded-xl border">
          {r.items.map((i) => (
            <div key={i.id} className="flex justify-between gap-3 px-3 py-2.5">
              <div>
                <p className="text-[14px] font-medium">
                  {i.qty}× {i.name}
                </p>
                {i.modifiers.length > 0 && (
                  <p className="text-muted mt-0.5 text-[12px]">{i.modifiers.map((m) => m.name).join(', ')}</p>
                )}
                {i.note && <p className="text-warn mt-0.5 text-[12px] font-medium">“{i.note}”</p>}
              </div>
              {i.unit_price_paise > 0 && (
                <p className="text-muted shrink-0 text-[13px] tabular-nums">{rupees(i.unit_price_paise * i.qty)}</p>
              )}
            </div>
          ))}
          {r.total_paise > 0 && (
            <div className="bg-paper flex justify-between px-3 py-2.5 text-[14px] font-semibold">
              <span>To the room bill</span>
              <span className="tabular-nums">{rupees(r.total_paise)}</span>
            </div>
          )}
        </div>
      )}

      {/* The guest's own words, quoted and attributed — not a tracked
          all-caps label sitting on top of them. */}
      {r.note && (
        <div className="bg-warn-soft rounded-xl px-3.5 py-3">
          <p className="text-[14px] leading-relaxed">“{r.note}”</p>
          <p className="text-warn mt-1.5 text-[12px] font-medium">— {r.guest_name ?? 'the guest'}</p>
        </div>
      )}

      {r.scheduled_for && (
        <p className="text-[14px]">
          <span className="text-muted">Scheduled for </span>
          <span className="font-semibold">{hotelTime(r.scheduled_for, r.property_timezone)}</span>
        </p>
      )}

      {live && (
        <>
          <div className="flex gap-2">
            {r.status === 'new' && <Action onClick={() => onAct(r.id, 'ack')}>Accept</Action>}
            {r.status !== 'in_progress' && r.status !== 'new' && (
              <Action onClick={() => onAct(r.id, 'in_progress')}>Start</Action>
            )}
            <Action primary onClick={() => onAct(r.id, 'done')}>
              Mark done
            </Action>
          </div>

          {me.role !== 'staff' && assignable.length > 0 && (
            <div>
              <label className="text-muted mb-1.5 block text-[12px] font-semibold">Assigned to</label>
              <select
                defaultValue={r.assigned_to ?? ''}
                onChange={async (e) => {
                  await assign(r.id, e.target.value || null)
                  onRefresh()
                }}
                className="border-line bg-surface w-full rounded-xl border px-3 py-2 text-[14px]"
              >
                <option value="">Nobody yet</option>
                {assignable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {nameOf(s.department)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      <button
        onClick={onChat}
        className="border-line hover:border-ink flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-3 text-[14px] font-semibold"
      >
        <IconChat size={15} />
        Message Room {r.room_number}
      </button>

      {live &&
        (cancelling ? (
          <div className="border-late-soft bg-late-soft space-y-2 rounded-xl p-3">
            <label className="text-late block text-[12px] font-semibold">Why is this being cancelled?</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
              placeholder="Kitchen closed, guest checked out…"
              className="border-line bg-surface w-full rounded-lg border px-3 py-2 text-[14px] outline-none"
            />
            <div className="flex gap-2">
              <Action onClick={() => setCancelling(false)}>Keep it</Action>
              <Action
                primary
                onClick={() => {
                  onAct(r.id, 'cancelled', reason || 'Cancelled by staff')
                  setCancelling(false)
                }}
              >
                Cancel request
              </Action>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCancelling(true)}
            className="text-faint hover:text-late w-full py-2 text-center text-[12px] font-medium underline"
          >
            Cancel this request
          </button>
        ))}

      {r.cancel_reason && (
        <p className="text-muted text-[13px]">
          <span className="font-semibold">Cancelled:</span> {r.cancel_reason}
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- messages */

function Messages({ chats, now, onOpen }: { chats: ChatRoom[]; now: number; onOpen: (c: ChatRoom) => void }) {
  if (chats.length === 0) {
    return (
      <div className="bg-surface border-line rounded-2xl border px-4 py-16 text-center">
        <p className="text-muted text-sm">No conversations yet.</p>
        <p className="text-faint mt-1 text-xs">Guest messages land here the moment they are sent.</p>
      </div>
    )
  }
  return (
    <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
      {chats.map((c) => (
        <button key={c.room_id} onClick={() => onOpen(c)} className="hover:bg-paper flex w-full gap-3 px-4 py-3 text-left transition">
          <span className="w-12 shrink-0 text-[15px] font-semibold tabular-nums">{c.room_number}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate text-[13px] font-medium">{c.guest_name ?? 'Guest'}</span>
              <span className="text-faint shrink-0 text-[11px]">{since(c.last_at, new Date(now))}</span>
            </span>
            <span className={`mt-0.5 block truncate text-[13px] ${c.unread > 0 ? 'text-ink font-medium' : 'text-muted'}`}>
              {c.last_sender === 'staff' ? 'You: ' : ''}
              {c.last_body}
            </span>
          </span>
          {c.unread > 0 && (
            <span className="bg-ink mt-1 grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[11px] font-bold text-white">
              {c.unread}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

function Thread({ roomId, onSent }: { roomId: string; onSent: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [canned, setCanned] = useState<{ id: string; label: string; body: string }[]>([])
  const [repliesOpen, setRepliesOpen] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setMessages(await openThread(roomId))
  }, [roomId])

  useEffect(() => {
    // `load` sets state after an await, not synchronously; the rule reads the
    // call, not the await. The guard is the part that matters: switching rooms
    // quickly used to let the previous room's reply land in this thread.
    let live = true
    const poll = async () => {
      const next = await openThread(roomId)
      if (live) setMessages(next)
    }
    poll()
    const t = setInterval(poll, 6000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [roomId])

  useEffect(() => {
    let live = true
    quickReplies(roomId).then((rs) => {
      if (live) setCanned(rs)
    })
    return () => {
      live = false
    }
  }, [roomId])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    const res = await reply(roomId, text)
    setBusy(false)
    if (res.ok) {
      setDraft('')
      await load()
      onSent()
    } else {
      alert(res.error)
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex-1 space-y-2.5 p-4">
        {messages === null ? (
          <p className="text-faint text-center text-[13px]">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-faint text-center text-[13px]">No messages with this room yet. Say hello.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === 'staff' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[85%]">
                <div
                  className={`rounded-2xl px-3 py-2 text-[14px] leading-snug whitespace-pre-line ${
                    m.sender === 'staff' ? 'bg-ink rounded-br-md text-white' : 'bg-paper border-line rounded-bl-md border'
                  }`}
                >
                  {m.body}
                </div>
                <p className={`text-faint mt-0.5 text-[11px] ${m.sender === 'staff' ? 'text-right' : ''}`}>
                  {m.sender === 'staff' && m.staff_name ? `${m.staff_name} · ` : ''}
                  {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottom} />
      </div>

      {/* Pinned: on a thread long enough to scroll, the reply box used to
          scroll away with the messages. */}
      <div className="border-line bg-surface sticky bottom-0 border-t">
        {/* These used to be one horizontally scrolling row with the scrollbar
            hidden, so the fourth reply onwards was off the edge with nothing to
            say it existed — unreachable entirely with a mouse and no sideways
            wheel. And the sentence being sent lived only in `title`, so you
            could not read what you were about to say to a guest without
            hovering and waiting.

            Now: a disclosure that stays out of the way until wanted, and the
            body on screen rather than in a tooltip. */}
        {canned.length > 0 && (
          <div className="border-line border-b">
            <button
              type="button"
              onClick={() => setRepliesOpen((o) => !o)}
              aria-expanded={repliesOpen}
              className="text-muted hover:text-ink flex w-full items-center justify-between gap-2 px-3 py-2.5 text-[12px] font-semibold transition"
            >
              <span>Quick replies · {canned.length}</span>
              <IconChevron size={14} className={repliesOpen ? 'rotate-180 transition' : 'transition'} />
            </button>
            {repliesOpen && (
              <div className="max-h-56 overflow-y-auto px-3 pb-3">
                <div className="grid gap-1.5">
                  {canned.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        setDraft(q.body)
                        setRepliesOpen(false)
                      }}
                      className="border-line hover:border-ink hover:bg-paper rounded-xl border px-3 py-2 text-left transition"
                    >
                      <span className="block text-[12px] font-semibold">{q.label}</span>
                      <span className="text-muted mt-0.5 block text-[12px] leading-snug">{q.body}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <form onSubmit={send} className="flex gap-2 p-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply to the room…"
            maxLength={1000}
            className="border-line bg-surface focus:border-ink flex-1 rounded-xl border px-3 py-2.5 text-[14px] outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy}
            className="bg-ink min-h-11 shrink-0 rounded-xl px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-30"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
