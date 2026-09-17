import { requireInOrganisation } from '@/lib/auth'
import { listProperties } from '@/lib/admin'
import ImportManager from './ImportManager'

export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  const me = await requireInOrganisation()
  const properties = await listProperties(me)

  return (
    <ImportManager
      properties={properties.map((p) => ({ id: p.id, name: p.name }))}
      myPropertyId={me.property_id}
    />
  )
}
