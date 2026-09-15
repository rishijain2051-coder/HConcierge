import { requireInOrganisation } from '@/lib/auth'
import { listAudit, listAuditActions } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : null)

/** Readable stems, so the filter is not a list of dotted internals. */
const GROUPS: { value: string; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'request', label: 'Requests' },
  { value: 'message', label: 'Messages' },
  { value: 'room', label: 'Rooms & check-ins' },
  { value: 'staff', label: 'Staff accounts' },
  { value: 'item', label: 'Directory items' },
  { value: 'category', label: 'Directory sections' },
  { value: 'info_page', label: 'Hotel info pages' },
  { value: 'property', label: 'Properties' },
  { value: 'folio', label: 'Charge exports' },
]

export default async function AdminAuditPage({ searchParams }: PageProps<'/staff/admin/audit'>) {
  const me = await requireInOrganisation()
  const params = await searchParams
  const action = one(params.action)
  const days = Number(one(params.days) ?? 7) || 7

  const [rows, known] = await Promise.all([listAudit(me, { action, days }), listAuditActions(me)])
  const groups = GROUPS.filter((g) => g.value === '' || known.some((k) => k.startsWith(g.value)))

  return (
    <section>
      <h1 className="font-display text-[clamp(1.6rem,3vw,2rem)] leading-[1.1] tracking-[-0.02em]">Activity</h1>
      <p className="text-muted mt-1.5 max-w-[70ch] text-[14px]">
        Who did what, and when. Guest actions appear as the room number; staff actions as the person. Nothing here can
        be edited or removed from inside the app.
      </p>

      <form className="bg-surface border-line my-5 grid grid-cols-2 items-end gap-2 rounded-2xl border p-3 sm:flex sm:flex-wrap">
        <label>
          <span className="text-muted mb-1 block text-[11px] font-semibold">Show</span>
          <select
            name="action"
            defaultValue={action ?? ''}
            className="border-line bg-surface w-full rounded-lg border px-2.5 py-1.5 text-[13px] sm:w-auto"
          >
            {groups.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-muted mb-1 block text-[11px] font-semibold">Period</span>
          <select
            name="days"
            defaultValue={String(days)}
            className="border-line bg-surface w-full rounded-lg border px-2.5 py-1.5 text-[13px] sm:w-auto"
          >
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        <button className="bg-ink col-span-2 min-h-11 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white sm:col-span-1 sm:min-h-0">
          Apply
        </button>
      </form>

      <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
        {rows.map((r) => {
          const detail = Object.entries(r.meta ?? {})
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
            .join(' · ')
          return (
            <div key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="text-faint shrink-0 text-[12px] tabular-nums sm:w-[10.5rem]">
                {new Date(r.created_at).toLocaleString([], {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
              <span className="shrink-0 truncate text-[13px] font-medium sm:w-[11rem]">{r.actor}</span>
              <span className="text-muted shrink-0 font-mono text-[12px] sm:w-[11rem]">{r.action}</span>
              <span className="text-faint min-w-0 flex-1 truncate text-[12px]">{detail}</span>
              {r.property_name && (
                <span className="text-faint shrink-0 text-[11px]">{r.property_name}</span>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-faint px-4 py-16 text-center text-sm">Nothing recorded in this period.</p>
        )}
      </div>

      {rows.length >= 300 && (
        <p className="text-faint mt-3 text-[12px]">Showing the most recent 300. Narrow the period to see further back.</p>
      )}
    </section>
  )
}
