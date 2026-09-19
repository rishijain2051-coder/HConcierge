import { requireOperational, visibleDepartments } from '@/lib/auth'
import { listTeams } from '@/lib/departments'
import { loadAssignableStaff, loadBoard, loadChatRooms } from '@/lib/board'
import { sql } from '@/lib/db'
import { pushPublicKey, subscriptionCount } from '@/lib/push'
import Board from './Board'

export const dynamic = 'force-dynamic'

export default async function BoardPage() {
  const staff = await requireOperational()

  // The clock has to start from the server's reading, not the phone's. This is
  // a force-dynamic server component - one render per request - and the purity
  // rule is written for client components that re-render.
  // eslint-disable-next-line react-hooks/purity
  const serverNow = Date.now()

  const [requests, chats, properties, assignable, teams, subscribed] = await Promise.all([
    loadBoard(staff),
    loadChatRooms(staff),
    staff.role === 'admin'
      ? sql<{ id: string; name: string }[]>`select id, name from properties order by name`
      : Promise.resolve([]),
    staff.property_id ? loadAssignableStaff(staff, staff.property_id) : Promise.resolve([]),
    listTeams(staff.organisation_id),
    subscriptionCount(staff.id),
  ])

  return (
    <Board
      me={{ id: staff.id, name: staff.name, role: staff.role, department: staff.department }}
      visibleDepartments={visibleDepartments(staff)}
      teams={teams.map((t) => ({ value: t.slug, label: t.name, active: t.active }))}
      properties={properties}
      assignable={assignable}
      initialRequests={requests}
      initialChats={chats}
      serverNow={serverNow}
      pushKey={pushPublicKey()}
      pushSubscribed={subscribed > 0}
    />
  )
}
