'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { IconClose, IconMenu } from '@/components/icons'
import { logout } from '../login/actions'

type Item = { href: string; label: string }

/**
 * The phone navigation.
 *
 * A reception monitor has room for the brand, four destinations, who is signed
 * in and two account controls on one line. A 375px phone does not: the same row
 * pushed the whole app into sideways scroll, and the compromise — a second row
 * of tabs — spent a third of the board's vertical space on chrome that is
 * looked at twice a shift.
 *
 * So below sm this collapses to one button, and everything that was crowding
 * the header lives behind it with room to be tapped properly.
 */
export default function StaffNav({
  items,
  name,
  subtitle,
}: {
  items: Item[]
  name: string
  subtitle: string
}) {
  const [open, setOpen] = useState(false)
  const path = usePathname()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Menu"
        aria-expanded={open}
        className="text-muted hover:text-ink -ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-lg transition active:scale-90 sm:hidden"
      >
        <IconMenu size={20} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex sm:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div
            className="bg-scrim absolute inset-0"
            style={{ animation: 'hc-fade-in 240ms var(--ease-glide) both' }}
            onClick={() => setOpen(false)}
          />

          <nav
            className="bg-surface relative flex h-full w-[17rem] max-w-[82%] flex-col shadow-[var(--shadow-lift)]"
            style={{
              animation: 'hc-drawer-in 380ms var(--ease-glide) both',
              ['--drawer-from' as string]: '-8%',
            }}
          >
            <div className="border-line flex items-start justify-between gap-3 border-b px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold tracking-tight">{name}</p>
                <p className="text-faint mt-0.5 text-[12px] leading-tight">{subtitle}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-faint hover:text-ink -mt-1 -mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-90"
              >
                <IconClose size={16} />
              </button>
            </div>

            {/* These navigate without unmounting the layout, so each one closes
                the panel on the way out rather than leaving it over the screen
                it just opened. */}
            <div className="flex-1 overflow-y-auto p-2">
              {items.map((n) => {
                const here = path === n.href || path.startsWith(`${n.href}/`)
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    aria-current={here ? 'page' : undefined}
                    className={`flex min-h-12 items-center rounded-xl px-3 text-[15px] font-medium transition ${
                      here ? 'bg-paper text-ink' : 'text-muted hover:bg-paper/60'
                    }`}
                  >
                    {n.label}
                  </Link>
                )
              })}
            </div>

            <div className="border-line space-y-2 border-t p-2">
              <Link
                href="/staff/password"
                onClick={() => setOpen(false)}
                className="text-muted hover:bg-paper/60 flex min-h-12 items-center rounded-xl px-3 text-[15px] font-medium transition"
              >
                Password
              </Link>
              <Link
                href="/staff/phone"
                onClick={() => setOpen(false)}
                className="text-muted hover:bg-paper/60 flex min-h-12 items-center rounded-xl px-3 text-[15px] font-medium transition"
              >
                Phone
              </Link>
              <form action={logout}>
                <button className="border-line text-muted hover:text-ink min-h-12 w-full rounded-xl border px-3 text-[15px] font-medium">
                  Sign out
                </button>
              </form>
            </div>
          </nav>
        </div>
      )}
    </>
  )
}
