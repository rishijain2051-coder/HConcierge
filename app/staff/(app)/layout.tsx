import Link from 'next/link'
import { departmentLabel, homeFor, requireStaff } from '@/lib/auth'
import { logout } from '../login/actions'
import StaffNav from './StaffNav'

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

  // Who is signed in and where. The header shows it on a monitor; on a phone it
  // heads the navigation panel, which is the first place it has ever fitted.
  const subtitle =
    staff.role === 'platform'
      ? staff.organisation_name
        ? `HConcierge · ${staff.organisation_name}`
        : 'HConcierge · every organisation'
      : `${staff.property_name ?? staff.organisation_name ?? ''} · ${departmentLabel(staff.department)}`

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-surface border-line sticky top-0 z-40 border-b no-print">
        {/* One row either way. On a monitor it carries everything; on a phone
            the destinations and the account controls move behind the button on
            the left, and the header costs one line instead of two. */}
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-2 sm:gap-5 sm:py-2.5">
          <StaffNav items={nav} name={staff.name} subtitle={subtitle} />

          <Link href={homeFor(staff)} className="text-[15px] font-semibold tracking-tight">
            HConcierge
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-muted hover:bg-paper hover:text-ink rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto hidden items-center gap-3 sm:flex">
            <div className="text-right">
              <p className="text-[13px] leading-tight font-medium">{staff.name}</p>
              <p className="text-faint text-[11px] leading-tight">{subtitle}</p>
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
