import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { loadDirectory, loadGuestState, loadInfoPages, loadRoom } from '@/lib/guest'
import { hasGuestAccess } from '@/lib/guest-session'
import { livePromotions } from '@/lib/promotions'
import CodeGate from './CodeGate'
import GuestApp from './GuestApp'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps<'/r/[token]'>): Promise<Metadata> {
  const { token } = await params
  const ctx = await loadRoom(token)
  return {
    title: ctx ? `Room ${ctx.room.number} · ${ctx.property.name}` : 'HConcierge',
    // A room link should never end up in a search index or a referrer log.
    robots: { index: false, follow: false },
  }
}

export default async function GuestPage({ params }: PageProps<'/r/[token]'>) {
  const { token } = await params
  const ctx = await loadRoom(token)
  if (!ctx) notFound()

  // The QR is permanent and lives in the room, so it identifies the room but
  // proves nothing about who is holding it. The stay's code does that.
  if (!ctx.room.occupied) {
    return (
      <div
        className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 text-center"
        style={{ ['--brand' as string]: ctx.property.brand_color }}
      >
        <p className="text-muted text-[14px] font-semibold tracking-tight">{ctx.property.name}</p>
        <h1 className="font-display mt-2 text-[clamp(1.9rem,7vw,2.5rem)] leading-[1.05] tracking-[-0.02em]">
          Room {ctx.room.number} is not checked in
        </h1>
        <p className="text-muted mt-3 text-[15px] leading-relaxed">
          Once you have checked in, the front desk will give you a four-digit code for this room. Scan again then and
          you are straight in.
        </p>
        {ctx.property.phone && <p className="text-faint mt-6 text-[13px]">Front desk: {ctx.property.phone}</p>}
      </div>
    )
  }

  if (!(await hasGuestAccess(ctx.room))) {
    return <CodeGate token={token} room={ctx.room} property={ctx.property} />
  }

  // The clock has to start from the server's reading, not the phone's. This is
  // a force-dynamic server component - one render per request - and the purity
  // rule is written for client components that re-render.
  // eslint-disable-next-line react-hooks/purity
  const serverNow = Date.now()

  const [directory, info, state, promotions] = await Promise.all([
    loadDirectory(ctx.property.id),
    loadInfoPages(ctx.property.id),
    loadGuestState(ctx.room.id),
    livePromotions(ctx.room),
  ])

  return (
    <GuestApp
      token={token}
      room={ctx.room}
      property={ctx.property}
      directory={directory}
      info={info}
      promotions={promotions}
      initialState={state}
      serverNow={serverNow}
    />
  )
}
