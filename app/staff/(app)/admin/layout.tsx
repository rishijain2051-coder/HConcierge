import Link from 'next/link'
import { requireManager } from '@/lib/auth'
import { adminOverview } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Managers get the panel too, scoped to their own property — otherwise the
  // sign-in screen's promise that a duty manager can reset a password is a lie.
  const staff = await requireManager()
  const stats = await adminOverview(staff)

  const tabs = [
    ...(staff.role === 'platform' ? [{ href: '/staff/admin/organisations', label: 'Organisations' }] : []),
    { href: '/staff/admin', label: 'Staff' },
    ...(staff.role === 'staff' ? [] : [{ href: '/staff/admin/properties', label: 'Properties' }]),
    { href: '/staff/admin/catalog', label: 'Directory' },
    { href: '/staff/admin/escalation', label: 'Escalation' },
    { href: '/staff/admin/info', label: 'Hotel info' },
    { href: '/staff/admin/audit', label: 'Activity' },
  ]

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <div className="border-line mb-6 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <nav className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="text-muted hover:bg-paper hover:text-ink rounded-lg px-3 py-1.5 text-[13px] font-medium transition"
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
