import { requireOperational, visibleDepartments } from '@/lib/auth'
import { loadAssignableStaff, loadBoard, loadChatRooms } from '@/lib/board'
import { sql } from '@/lib/db'
import Board from './Board'

export const dynamic = 'force-dynamic'

export default async function BoardPage() {
  const staff = await requireOperational()

  const [requests, chats, properties, assignable] = await Promise.all([
    loadBoard(staff),
    loadChatRooms(staff),
    staff.role === 'admin'
      ? sql<{ id: string; name: string }[]>`select id, name from properties order by name`
      : Promise.resolve([]),
    staff.property_id ? loadAssignableStaff(staff, staff.property_id) : Promise.resolve([]),
  ])

  return (
    <Board
      me={{ id: staff.id, name: staff.name, role: staff.role, department: staff.department }}
      visibleDepartments={visibleDepartments(staff)}
      properties={properties}
      assignable={assignable}
      initialRequests={requests}
      initialChats={chats}
    />
  )
}
