import { requireOperational, visibleDepartments } from '@/lib/auth'
import { listTeams } from '@/lib/departments'
import { sql } from '@/lib/db'
import { loadByDepartment, loadHistory, loadStats, type HistoryFilters } from '@/lib/history'
import { rupees } from '@/lib/money'
import { STATUS_LABEL, teamLabel, type RequestStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : null)

export default async function HistoryPage({ searchParams }: PageProps<'/staff/history'>) {
  const staff = await requireOperational()
  const params = await searchParams

  const filters: HistoryFilters = {
    propertyId: staff.role === 'admin' ? one(params.property) : staff.property_id,
    department: one(params.department),
    status: one(params.status),
    room: one(params.room),
    days: Number(one(params.days) ?? 7) || 7,
  }

  const [rows, stats, byDept, properties, teams] = await Promise.all([
    loadHistory(staff, filters),
    loadStats(staff, filters),
    loadByDepartment(staff, filters),
    staff.role === 'admin'
      ? sql<{ id: string; name: string }[]>`select id, name from properties order by name`
      : Promise.resolve([]),
    listTeams(staff.organisation_id),
  ])

  const slaRate = stats.done > 0 ? Math.round((stats.within_sla / stats.done) * 100) : null
  const csvHref = `/api/staff/folio.csv?days=${filters.days}${filters.propertyId ? `&property=${filters.propertyId}` : ''}`
  const mine = visibleDepartments(staff)
  const labels = teams.map((t) => ({ value: t.slug, label: t.name }))
  const open = teams.filter((t) => t.active).map((t) => ({ value: t.slug, label: t.name }))
  const departmentOptions = mine.length ? open.filter((d) => mine.includes(d.value)) : open

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">History</h1>
          <p className="text-muted mt-1 text-sm">
            Every request, how fast it was answered, and what it billed.
          </p>
        </div>
        <a
          href={csvHref}
          className="border-line hover:border-ink inline-flex min-h-11 items-center rounded-xl border px-4 py-2.5 text-[13px] font-semibold"
        >
          Export charges (CSV)
        </a>
      </div>

      {/* A plain GET form: no client JS, and every view is a shareable URL.
          Five controls of five different widths wrapped into a ragged block on
          a phone; two even columns until there is room for the row. */}
      <form className="bg-surface border-line mb-5 grid grid-cols-2 items-end gap-2 rounded-2xl border p-3 sm:flex sm:flex-wrap">
        {properties.length > 1 && (
          <Select name="property" label="Property" defaultValue={filters.propertyId ?? ''}>
            <option value="">All</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <Select name="days" label="Period" defaultValue={String(filters.days)}>
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
        <Select name="department" label="Team" defaultValue={filters.department ?? ''}>
          <option value="">All teams</option>
          {departmentOptions.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
        <Select name="status" label="Status" defaultValue={filters.status ?? ''}>
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as RequestStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <div>
          <label htmlFor="room" className="text-muted mb-1 block text-[11px] font-semibold">
            Room
          </label>
          <input
            id="room"
            name="room"
            defaultValue={filters.room ?? ''}
            placeholder="Any"
            className="border-line bg-surface w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none sm:w-24"
          />
        </div>
        <button className="bg-ink col-span-2 min-h-11 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white sm:col-span-1 sm:min-h-0">
          Apply
        </button>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Requests" value={String(stats.total)} />
        <Stat
          label="Answered on time"
          value={slaRate === null ? '-' : `${slaRate}%`}
          tone={slaRate === null ? undefined : slaRate >= 90 ? 'ok' : slaRate >= 70 ? 'warn' : 'late'}
          sub={`${stats.within_sla} of ${stats.done} completed`}
        />
        <Stat
          label="Picked up in"
          value={stats.avg_response === null ? '-' : `${stats.avg_response} min`}
          sub="average"
        />
        <Stat
          label="Finished in"
          value={stats.avg_resolve === null ? '-' : `${stats.avg_resolve} min`}
          sub="average"
        />
        <Stat label="Billed to rooms" value={rupees(stats.revenue_paise)} sub={`${stats.escalated} escalated`} />
      </div>

      {byDept.length > 0 && (
        <div className="bg-surface border-line mb-5 overflow-hidden rounded-2xl border">
          <div className="divide-line grid divide-y sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            {byDept.map((d) => {
              const rate = d.done > 0 ? Math.round((d.within_sla / d.done) * 100) : 0
              return (
                <div key={d.department} className="p-3.5">
                  <p className="text-[13px] font-semibold">{teamLabel(labels, d.department)}</p>
                  <p className="text-muted mt-1 text-[12px]">
                    {d.total} request{d.total === 1 ? '' : 's'} · {d.avg_resolve ?? '-'} min average
                  </p>
                  <div className="bg-paper mt-2 h-1.5 overflow-hidden rounded-full">
                    <div
                      className={`h-full ${rate >= 90 ? 'bg-ok' : rate >= 70 ? 'bg-warn' : 'bg-late'}`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <p className="text-faint mt-1 text-[11px]">
                    {d.done > 0 ? `${rate}% on time` : 'none finished yet'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="bg-surface border-line overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-muted bg-paper text-[11px] font-semibold tracking-wide uppercase">
              <tr>
                <Th>Ref</Th>
                <Th>Room</Th>
                <Th>What</Th>
                <Th>Team</Th>
                <Th>Raised</Th>
                <Th>Picked up</Th>
                <Th>Finished</Th>
                <Th>Status</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((r) => {
                // The same test as the on-time figure above the table, decided
                // once in SQL - see DUE_FROM in lib/history.ts.
                const late = r.status === 'done' && !r.on_time
                return (
                  <tr key={r.id} className="hover:bg-paper/60">
                    <Td className="text-faint tabular-nums">#{r.ref}</Td>
                    <Td className="font-semibold tabular-nums">{r.room_number}</Td>
                    <Td className="max-w-[22rem]">
                      <span className="block truncate">{r.summary ?? r.note ?? '-'}</span>
                      {r.assigned_name && <span className="text-faint text-[11px]">{r.assigned_name}</span>}
                    </Td>
                    <Td className="text-muted">{teamLabel(labels, r.department)}</Td>
                    <Td className="text-muted tabular-nums">
                      {new Date(r.created_at).toLocaleString([], {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </Td>
                    <Td className="tabular-nums">{r.response_minutes === null ? '-' : `${r.response_minutes} min`}</Td>
                    <Td className={`tabular-nums ${late ? 'text-late font-semibold' : ''}`}>
                      {r.resolve_minutes === null ? '-' : `${r.resolve_minutes} min`}
                    </Td>
                    <Td>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                          r.status === 'done'
                            ? 'bg-ok-soft text-ok'
                            : r.status === 'cancelled'
                              ? 'bg-paper text-faint'
                              : 'bg-warn-soft text-warn'
                        }`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.escalated_at && <span className="text-late ml-1 text-[11px]">escalated</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{r.total_paise > 0 ? rupees(r.total_paise) : '-'}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="text-faint px-4 py-14 text-center text-sm">Nothing matches those filters.</p>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'late' }) {
  const colour = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'late' ? 'text-late' : 'text-ink'
  return (
    <div className="bg-surface border-line rounded-2xl border p-3.5">
      <p className="text-muted text-[11px] font-semibold tracking-wide uppercase">{label}</p>
      <p className={`mt-1.5 text-[22px] leading-none font-semibold tabular-nums ${colour}`}>{value}</p>
      {sub && <p className="text-faint mt-1.5 text-[11px]">{sub}</p>}
    </div>
  )
}

function Select({
  name,
  label,
  defaultValue,
  children,
}: {
  name: string
  label: string
  defaultValue: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={name} className="text-muted mb-1 block text-[11px] font-semibold">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="border-line bg-surface w-full rounded-lg border px-2.5 py-1.5 text-[13px] sm:w-auto"
      >
        {children}
      </select>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-semibold whitespace-nowrap ${className}`}>{children}</th>
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>
}
