import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { loadDirectory, loadGuestState, loadInfoPages, loadRoom } from '@/lib/guest'
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

  const [directory, info, state] = await Promise.all([
    loadDirectory(ctx.property.id),
    loadInfoPages(ctx.property.id),
    loadGuestState(ctx.room.id),
  ])

  return (
    <GuestApp
      token={token}
      room={ctx.room}
      property={ctx.property}
      directory={directory}
      info={info}
      initialState={state}
    />
  )
}
