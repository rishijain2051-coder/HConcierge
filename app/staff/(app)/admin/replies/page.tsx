import { requireInOrganisation } from '@/lib/auth'
import { listProperties, listQuickReplies } from '@/lib/admin'
import RepliesManager from './RepliesManager'

export const dynamic = 'force-dynamic'

export default async function AdminRepliesPage({ searchParams }: PageProps<'/staff/admin/replies'>) {
  const me = await requireInOrganisation()
  const { property } = await searchParams
  const properties = await listProperties(me)

  const selected =
    (typeof property === 'string' && properties.some((p) => p.id === property) ? property : null) ??
    me.property_id ??
    properties[0]?.id

  if (!selected) return <p className="text-faint py-16 text-center text-sm">Add a property first.</p>

  return (
    <RepliesManager
      propertyId={selected}
      properties={properties.length > 1 ? properties.map((p) => ({ id: p.id, name: p.name })) : []}
      replies={await listQuickReplies(me, selected)}
    />
  )
}
