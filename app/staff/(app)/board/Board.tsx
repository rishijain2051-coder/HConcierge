'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { rupees } from '@/lib/money'
import { formatAge, minutesRemaining, since, slaState } from '@/lib/sla'
import { DEPARTMENTS, departmentLabel, STATUS_LABEL, type BoardRequest, type ChatMessage, type RequestStatus } from '@/lib/types'
import type { ChatRoom } from '@/lib/board'
import { assign, openThread, reply, updateStatus } from './actions'

// The board is pushed, not polled — see /api/staff/board/live. This is the
// seatbelt: it covers a dropped stream, and it is what knocks on the server to
// run the escalation sweep, which is time-based and so has nothing to notify it.
const POLL_MS = 60_000

type Me = { id: string; name: string; role: string; department: string }

export default function Board({
  me,
  visibleDepartments,
  properties,
  assignable,
  initialRequests,
  initialChats,
}: {
  me: Me
  visibleDepartments: string[]
  properties: { id: string; name: string }[]
  assignable: { id: string; name: string; department: string }[]
  initialRequests: BoardRequest[]
  initialChats: ChatRoom[]
}) {
  const [requests, setRequests] = useState(initialRequests)
  const [chats, setChats] = useState(initialChats)
  const [property, setProperty] = useState<string>('')
  const [dept, setDept] = useState<string>('')
  const [view, setView] = useState<'requests' | 'messages'>('requests')
  const [openId, setOpenId] = useState<string | null>(null)
  const [chatRoom, setChatRoom] = useState<{ id: string; number: string } | null>(null)
  const [alerts, setAlerts] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [stale, setStale] = useState(false)

  const seen = useRef(new Set(initialRequests.map((r) => r.id)))
  // setInterval fires whether or not the last request came back. Without this
  // guard a slow network makes polls overlap, and overlapping polls exhaust the
  // database pool until the whole app stops responding.
  const inFlight = useRef(false)
  const chime = useRef<(() => void) | null>(null)

  const canFilterDepartment = visibleDepartments.length === 0


  // Declared above `apply`, which calls it: read the other way round it
  // captured a stale `alerts` and could chime after the toggle was off.
  const announce = useCallback((arrived: BoardRequest[]) => {
    if (!alerts) return
    chime.current?.()
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const r of arrived.slice(0, 3)) {
        const what = r.items.length ? r.items.map((i) => `${i.qty}× ${i.name}`).join(', ') : r.note || 'New request'
        new Notification(`Room ${r.room_number} — ${departmentLabel(r.department)}`, {
          body: what,
          tag: r.id,
        })
      }
    }
  }, [alerts])

  // One landing point for new data, whether it was pushed or fetched.
  const apply = useCallback(
    (data: { requests: BoardRequest[]; chats: ChatRoom[] }) => {
      setRequests(data.requests)
      setChats(data.chats)
      setStale(false)

      const arrived = data.requests.filter((r) => !seen.current.has(r.id))
      for (const r of data.requests) seen.current.add(r.id)
      if (arrived.length > 0) announce(arrived)
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
        window.location.href = '/staff/login'
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
  }, [property, apply])


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

  const overdue = filtered.filter((r) => slaState(r, new Date(now)) === 'late').length
  const unreadTotal = chats.reduce((s, c) => s + c.unread, 0)
  const openRequest = requests.find((r) => r.id === openId) ?? null

  async function act(id: string, status: RequestStatus, reason?: string) {
    // Move the card immediately; the next poll is the source of truth.
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    const res = await updateStatus(id, status, reason)
    if (!res.ok) alert(res.error)
    refresh()
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="border-line flex rounded-xl border p-0.5">
          {(
            [
              ['requests', `Requests${columns.new.length ? ` · ${columns.new.length}` : ''}`],
              ['messages', `Messages${unreadTotal ? ` · ${unreadTotal}` : ''}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`rounded-[9px] px-3 py-1.5 text-[13px] font-semibold transition ${
                view === id ? 'bg-ink text-white' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {properties.length > 0 && (
          <select
            value={property}
            onChange={(e) => setProperty(e.target.value)}
            className="border-line bg-surface rounded-xl border px-3 py-2 text-[13px] font-medium"
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
          <div className="flex flex-wrap gap-1.5">
            <Chip on={dept === ''} onClick={() => setDept('')}>
              All teams
            </Chip>
            {DEPARTMENTS.map((d) => {
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

        <div className="ml-auto flex items-center gap-2.5">
          {overdue > 0 && (
            <span className="bg-late-soft text-late rounded-full px-2.5 py-1 text-[12px] font-semibold">
              {overdue} overdue
            </span>
          )}
          {stale && <span className="text-warn text-[12px] font-medium">Reconnecting…</span>}
          {!alerts ? (
            <button
              onClick={enableAlerts}
              className="border-line hover:border-ink rounded-xl border px-3 py-2 text-[13px] font-semibold"
            >
              🔔 Turn on alerts
            </button>
          ) : (
            <span className="text-ok text-[12px] font-medium">🔔 Alerts on</span>
          )}
        </div>
      </div>

      {view === 'requests' ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <Column title="New" tone="late" count={columns.new.length} empty="Nothing waiting. Good.">
            {columns.new.map((r) => (
              <Card key={r.id} r={r} now={now} onOpen={setOpenId} onAct={act} />
            ))}
          </Column>
          <Column title="Working" tone="warn" count={columns.working.length} empty="Nothing in progress.">
            {columns.working.map((r) => (
              <Card key={r.id} r={r} now={now} onOpen={setOpenId} onAct={act} />
            ))}
          </Column>
          <Column title="Finished · last 4h" tone="ok" count={columns.done.length} empty="Nothing finished yet.">
            {columns.done.map((r) => (
              <Card key={r.id} r={r} now={now} onOpen={setOpenId} onAct={act} />
            ))}
          </Column>
        </div>
      ) : (
        <Messages chats={chats} onOpen={(c) => setChatRoom({ id: c.room_id, number: c.room_number })} />
      )}

      {openRequest && (
        <Drawer onClose={() => setOpenId(null)} title={`Room ${openRequest.room_number}`}>
          <RequestDetail
            r={openRequest}
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

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-[13px] font-medium transition ${
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
  onOpen,
  onAct,
}: {
  r: BoardRequest
  now: number
  onOpen: (id: string) => void
  onAct: (id: string, s: RequestStatus) => void
}) {
  const state = slaState(r, new Date(now))
  const left = minutesRemaining(r, new Date(now))
  const stripe = { late: 'bg-late', warn: 'bg-warn', ok: 'bg-ok', done: 'bg-line' }[state]
  const summary = r.items.length
    ? r.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`).join(', ')
    : r.note || 'Request'

  return (
    <article
      className={`border-line relative overflow-hidden rounded-xl border pl-2.5 transition ${
        state === 'late' ? 'bg-late-soft' : 'bg-surface'
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} />
      <button onClick={() => onOpen(r.id)} className="w-full px-2.5 py-2.5 text-left">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[17px] leading-none font-semibold tabular-nums">{r.room_number}</span>
          <span className="text-faint text-[11px] font-medium">
            #{r.ref} · {formatAge(r.created_at, new Date(now))}
          </span>
        </div>
        {/* A guest can type 500 characters without a space. Below lg the grid
            has no explicit columns, so one such note sized the whole board to
            max-content and gave it 4,800px of sideways scroll. */}
        <p className="mt-1.5 text-[13px] leading-snug break-words">{summary}</p>
        {r.note && r.items.length > 0 && (
          <p className="text-muted mt-1 text-[12px] break-words italic">“{r.note}”</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Tag>{departmentLabel(r.department)}</Tag>
          {r.total_paise > 0 && <Tag>{rupees(r.total_paise)}</Tag>}
          {r.scheduled_for && (
            <Tag tone="warn">
              for {new Date(r.scheduled_for).toLocaleString([], { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}
            </Tag>
          )}
          {r.escalated_at && <Tag tone="late">Escalated</Tag>}
          {r.unread_messages > 0 && <Tag tone="warn">💬 {r.unread_messages}</Tag>}
          {r.status !== 'new' && r.status !== 'done' && r.status !== 'cancelled' && (
            <Tag>{r.assigned_name ? r.assigned_name.split(' ')[0] : STATUS_LABEL[r.status]}</Tag>
          )}
          {r.status === 'cancelled' && <Tag>Cancelled</Tag>}
        </div>

        {state !== 'done' && (
          <p className={`mt-1.5 text-[11px] font-medium ${state === 'late' ? 'text-late' : 'text-muted'}`}>
            {left > 0 ? `${left} min left of ${r.sla_minutes}` : `${Math.abs(left)} min over`}
          </p>
        )}
      </button>

      {r.status !== 'done' && r.status !== 'cancelled' && (
        <div className="border-line flex gap-1.5 border-t px-2.5 py-2">
          {r.status === 'new' && <Action onClick={() => onAct(r.id, 'ack')}>Accept</Action>}
          {r.status === 'ack' && <Action onClick={() => onAct(r.id, 'in_progress')}>Start</Action>}
          <Action primary onClick={() => onAct(r.id, 'done')}>
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

function Action({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition ${
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
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="bg-surface relative flex h-full w-full max-w-md flex-col shadow-2xl">
        <div className="border-line flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-ink p-1 text-xl leading-none">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function RequestDetail({
  r,
  me,
  assignable,
  now,
  onAct,
  onChat,
  onRefresh,
}: {
  r: BoardRequest
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
          #{r.ref} · {r.property_name} · {departmentLabel(r.department)}
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

      {r.note && (
        <div className="bg-warn-soft rounded-xl px-3 py-2.5">
          <p className="text-warn text-[11px] font-semibold tracking-wide uppercase">Note from the guest</p>
          <p className="mt-1 text-[14px]">{r.note}</p>
        </div>
      )}

      {r.scheduled_for && (
        <p className="text-[14px]">
          <span className="text-muted">Scheduled for </span>
          <span className="font-semibold">{new Date(r.scheduled_for).toLocaleString()}</span>
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
                    {s.name} — {departmentLabel(s.department)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      <button onClick={onChat} className="border-line hover:border-ink w-full rounded-xl border px-3 py-2.5 text-[14px] font-semibold">
        💬 Message Room {r.room_number}
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
            className="text-faint hover:text-late w-full text-center text-[12px] font-medium underline"
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

function Messages({ chats, onOpen }: { chats: ChatRoom[]; onOpen: (c: ChatRoom) => void }) {
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
              <span className="text-faint shrink-0 text-[11px]">{since(c.last_at)}</span>
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
  const bottom = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setMessages(await openThread(roomId))
  }, [roomId])

  useEffect(() => {
    load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [load])

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
    <div className="flex h-full flex-col">
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

      <form onSubmit={send} className="border-line flex gap-2 border-t p-3">
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
          className="bg-ink shrink-0 rounded-xl px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-30"
        >
          Send
        </button>
      </form>
    </div>
  )
}
