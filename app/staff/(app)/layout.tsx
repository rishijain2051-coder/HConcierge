import Link from 'next/link'
import { homeFor, requireStaff } from '@/lib/auth'
import { teamLabels } from '@/lib/departments'
import { logout } from '../login/actions'
import { Wordmark } from '@/components/Logo'
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
  // The team name comes from the hotel's own list, so somebody on a team this
  // customer invented reads as that team rather than as its slug.
  const labels = await teamLabels(staff.organisation_id)
  const team = staff.department === 'all' ? 'All teams' : (labels.get(staff.department) ?? staff.department)
  const subtitle =
    staff.role === 'platform'
      ? staff.organisation_name
        ? `HConcierge · ${staff.organisation_name}`
        : 'HConcierge · every organisation'
      : `${staff.property_name ?? staff.organisation_name ?? ''} · ${team}`

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-surface border-line sticky top-0 z-40 border-b no-print">
        {/* One row either way. On a monitor it carries everything; on a phone
            the destinations and the account controls move behind the button on
            the left, and the header costs one line instead of two. */}
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-2 sm:gap-5 sm:py-2.5">
          <StaffNav items={nav} name={staff.name} subtitle={subtitle} />

          <Link href={homeFor(staff)} className="text-[15px] font-semibold tracking-tight">
            <Wordmark />
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
            {/* The subtitle is what gives way when the row runs short of
                width. Between sm and lg it wrapped onto a third line and shoved
                the account controls out of alignment; the name never wraps.
                Nothing is lost by dropping it - the phone drawer heads itself
                with the same line, and a reception monitor is well past lg. */}
            <div className="text-right whitespace-nowrap">
              <p className="text-[13px] leading-tight font-medium">{staff.name}</p>
              <p className="text-faint hidden text-[11px] leading-tight lg:block">{subtitle}</p>
            </div>
            {/* No `title` here: it replaced the visible word as the accessible
                name, so "Password" was not what anything announced or matched. */}
            <Link
              href="/staff/password"
              className="text-faint hover:text-ink -mx-1.5 rounded-lg px-1.5 py-2 text-[12px] font-medium"
            >
              Password
            </Link>
            {/* Without this the verification page had no way in at all: a manager
                could send the code from Manage → Staff and the person holding the
                phone had nowhere to type it. */}
            <Link
              href="/staff/phone"
              className="text-faint hover:text-ink -mx-1.5 rounded-lg px-1.5 py-2 text-[12px] font-medium"
            >
              Phone
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
