import Link from 'next/link'
import { redirect } from 'next/navigation'
import { departmentLabel, requireStaff } from '@/lib/auth'
import { logout } from '../login/actions'

export const dynamic = 'force-dynamic'

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff()
  // A seeded account cannot reach the board until its password is its own.
  if (staff.must_change_password) redirect('/staff/password')

  const nav = [
    { href: '/staff/board', label: 'Board' },
    { href: '/staff/rooms', label: 'Rooms' },
    { href: '/staff/history', label: 'History' },
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-surface border-line sticky top-0 z-40 border-b no-print">
        <div className="mx-auto flex max-w-[1600px] items-center gap-5 px-4 py-2.5">
          <Link href="/staff/board" className="text-[15px] font-semibold tracking-tight">
            HConcierge
          </Link>

          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-muted hover:bg-paper hover:text-ink rounded-lg px-3 py-1.5 text-[13px] font-medium transition"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-[13px] leading-tight font-medium">{staff.name}</p>
              <p className="text-faint text-[11px] leading-tight">
                {staff.property_name ?? 'RN Hospitality'} · {departmentLabel(staff.department)}
              </p>
            </div>
            <Link
              href="/staff/password"
              className="text-faint hover:text-ink text-[12px] font-medium"
              title="Change password"
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
