import { requireManager } from '@/lib/auth'
import { listAdminInfoPages, listProperties } from '@/lib/admin'
import InfoManager from './InfoManager'

export const dynamic = 'force-dynamic'

export default async function AdminInfoPage({ searchParams }: PageProps<'/staff/admin/info'>) {
  const me = await requireManager()
  const { property } = await searchParams
  const properties = await listProperties(me)

  const selected =
    (typeof property === 'string' && properties.some((p) => p.id === property) ? property : null) ??
    me.property_id ??
    properties[0]?.id

  if (!selected) return <p className="text-faint py-16 text-center text-sm">Add a property first.</p>

  return (
    <InfoManager
      propertyId={selected}
      properties={me.role === 'admin' ? properties.map((p) => ({ id: p.id, name: p.name })) : []}
      pages={await listAdminInfoPages(me, selected)}
    />
  )
}
