import Link from 'next/link'
import { departmentLabel, homeFor, requireStaff } from '@/lib/auth'
import { logout } from '../login/actions'

export const dynamic = 'force-dynamic'

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff()

  // HConcierge runs the product, not a front desk: no board, no rooms, no shift.
  const nav =
    staff.role === 'platform'
      ? [{ href: '/staff/admin/organisations', label: 'Manage' }]
      : [
          { href: '/staff/board', label: 'Board' },
          { href: '/staff/rooms', label: 'Rooms' },
          { href: '/staff/history', label: 'History' },
          ...(staff.role === 'staff' ? [] : [{ href: '/staff/admin', label: 'Manage' }]),
        ]

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-surface border-line sticky top-0 z-40 border-b no-print">
        {/* One row on a monitor. On a phone the same three groups do not fit
            across 375px, so the nav drops to its own scrolling rail underneath
            rather than pushing the whole app into sideways scroll. */}
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 px-4 py-2 sm:gap-x-5 sm:py-2.5">
          <Link href={homeFor(staff)} className="order-1 text-[15px] font-semibold tracking-tight">
            HConcierge
          </Link>

          <nav className="no-scrollbar order-3 -mx-4 flex w-full items-center gap-1 overflow-x-auto px-4 pb-0.5 sm:order-2 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0 sm:pb-0">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-muted hover:bg-paper hover:text-ink rounded-lg px-3 py-2 text-[13px] font-medium whitespace-nowrap transition sm:py-1.5"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="order-2 ml-auto flex items-center gap-3 sm:order-3">
            <div className="hidden text-right sm:block">
              <p className="text-[13px] leading-tight font-medium">{staff.name}</p>
              <p className="text-faint text-[11px] leading-tight">
                {staff.role === 'platform'
                  ? staff.organisation_name
                    ? `HConcierge · ${staff.organisation_name}`
                    : 'HConcierge · every organisation'
                  : `${staff.property_name ?? staff.organisation_name ?? ''} · ${departmentLabel(staff.department)}`}
              </p>
            </div>
            {/* No `title` here: it replaced the visible word as the accessible
                name, so "Password" was not what anything announced or matched. */}
            <Link
              href="/staff/password"
              className="text-faint hover:text-ink -mx-1.5 rounded-lg px-1.5 py-2 text-[12px] font-medium"
            >
              Password
            </Link>
            <form action={logout}>
              <button className="border-line text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-[12px] font-medium">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  )
}
