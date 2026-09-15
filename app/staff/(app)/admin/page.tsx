import { requireInOrganisation } from '@/lib/auth'
import { listProperties, listStaff } from '@/lib/admin'
import { activeTeams } from '@/lib/departments'
import StaffManager from './StaffManager'

export const dynamic = 'force-dynamic'

export default async function AdminStaffPage() {
  const me = await requireInOrganisation()
  const [staff, properties, teams] = await Promise.all([
    listStaff(me),
    listProperties(me),
    activeTeams(me.organisation_id),
  ])

  return (
    <StaffManager
      me={{ id: me.id, role: me.role, propertyId: me.property_id }}
      staff={staff}
      properties={properties.map((p) => ({ id: p.id, name: p.name }))}
      teams={teams.map((t) => ({ value: t.slug, label: t.name }))}
    />
  )
}
