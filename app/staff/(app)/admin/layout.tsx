import Link from 'next/link'
import { redirect } from 'next/navigation'
import { enterOrganisation, requireManager, requirePlatform } from '@/lib/auth'
import { adminOverview } from '@/lib/admin'

export const dynamic = 'force-dynamic'

async function leaveOrganisation(): Promise<void> {
  'use server'
  await requirePlatform()
  await enterOrganisation(null)
  redirect('/staff/admin/organisations')
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Managers get the panel too, scoped to their own property — otherwise the
  // sign-in screen's promise that a duty manager can reset a password is a lie.
  const staff = await requireManager()
  const stats = await adminOverview(staff)

  // HConcierge picks a customer first. Everything else in the panel belongs to
  // one organisation, so it only appears once you are inside one.
  const choosing = staff.role === 'platform' && !staff.organisation_id

  const tabs = choosing
    ? [{ href: '/staff/admin/organisations', label: 'Organisations' }]
    : [
        { href: '/staff/admin', label: 'Staff' },
        // Properties is admin-level; a manager who clicked it was bounced to
        // the board with no explanation.
        ...(staff.role === 'manager'
          ? []
          : [
              { href: '/staff/admin/properties', label: 'Properties' },
              // Teams are organisation-wide, like properties, so they sit on
              // the same side of the manager line.
              { href: '/staff/admin/teams', label: 'Teams' },
            ]),
        { href: '/staff/admin/catalog', label: 'Directory' },
        { href: '/staff/admin/escalation', label: 'Escalation' },
        { href: '/staff/admin/info', label: 'Hotel info' },
        { href: '/staff/admin/replies', label: 'Quick replies' },
        { href: '/staff/admin/import', label: 'Import' },
        { href: '/staff/admin/audit', label: 'Activity' },
      ]

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      {staff.role === 'platform' && staff.organisation_id && (
        <div className="bg-paper border-line mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5">
          <form action={leaveOrganisation}>
            <button className="text-muted hover:text-ink text-[13px] font-medium">&larr; All organisations</button>
          </form>
          <p className="text-[13px]">
            <span className="text-faint">Working inside</span>{' '}
            <span className="font-semibold">{staff.organisation_name}</span>
          </p>
        </div>
      )}

      <div className="border-line mb-6 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        {/* These wrap to three cramped rows on a phone. A rail keeps them on
            one line and keeps the panel's own content above the fold. */}
        <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="text-muted hover:bg-paper hover:text-ink rounded-lg px-3 py-2 text-[13px] font-medium whitespace-nowrap transition sm:py-1.5"
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <p className="text-faint text-[12px] tabular-nums">
          {staff.role === 'staff' ? '' : `${stats.properties} propert${stats.properties === 1 ? 'y' : 'ies'} · `}
          {stats.rooms} rooms · {stats.occupied} occupied · {stats.staff} staff · {stats.items} directory items
        </p>
      </div>
      {children}
    </div>
  )
}
