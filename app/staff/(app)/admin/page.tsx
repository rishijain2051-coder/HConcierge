import { requireInOrganisation } from '@/lib/auth'
import { listProperties, listStaff } from '@/lib/admin'
import StaffManager from './StaffManager'

export const dynamic = 'force-dynamic'

export default async function AdminStaffPage() {
  const me = await requireInOrganisation()
  const [staff, properties] = await Promise.all([listStaff(me), listProperties(me)])

  return (
    <StaffManager
      me={{ id: me.id, role: me.role, propertyId: me.property_id }}
      staff={staff}
      properties={properties.map((p) => ({ id: p.id, name: p.name }))}
    />
  )
}
