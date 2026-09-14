import Link from 'next/link'
import { requireOperational } from '@/lib/auth'
import { sql } from '@/lib/db'
import { scopeTo } from '@/lib/scope'
import { baseUrl } from '@/lib/qr'
import Rooms, { type RoomRow } from './Rooms'

export const dynamic = 'force-dynamic'

export default async function RoomsPage({ searchParams }: PageProps<'/staff/rooms'>) {
  const staff = await requireOperational()
  const { property } = await searchParams
  const selected = typeof property === 'string' ? property : ''


  const [rooms, properties, base] = await Promise.all([
    sql<RoomRow[]>`
      select r.id, r.number, r.floor, r.room_type, r.token, r.occupied, r.guest_name,
             r.checked_in_at, r.checkout_at, r.property_id, p.name as property_name,
             r.access_code, r.code_attempts, r.code_locked_until, r.settle_requested_at,
             (select count(*)::int from requests q
               where q.room_id = r.id and q.status in ('new','ack','in_progress')) as open_requests,
             coalesce((select sum(f.amount_paise)::int from folio_entries f
                        where f.room_id = r.id and f.voided_at is null and f.settled_at is null), 0)
               as balance_paise
        from rooms r join properties p on p.id = r.property_id
       where ${scopeTo(staff, sql`r.property_id`, selected || null)}
       order by p.name, r.floor nulls last, r.number`,
    sql<{ id: string; name: string }[]>`
      select id, name from properties where ${scopeTo(staff, sql`id`)} order by name`,
    baseUrl(),
  ])

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">Rooms</h1>
          <p className="text-muted mt-1 text-sm">
            Each room has its own QR code. Print it, put it on the desk, and the room can reach you without the phone.
          </p>
        </div>
        <Link
          href={selected ? `/staff/rooms/print?property=${selected}` : '/staff/rooms/print'}
          className="bg-ink rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90"
        >
          Print QR cards
        </Link>
      </div>

      <Rooms
        rooms={rooms}
        base={base}
        canEdit={staff.role !== 'staff'}
        properties={staff.role === 'admin' ? properties : []}
        selectedProperty={selected}
        defaultPropertyId={staff.property_id ?? properties[0]?.id ?? ''}
      />
    </div>
  )
}
