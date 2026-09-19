import { requireInOrganisation } from '@/lib/auth'
import { listProperties } from '@/lib/admin'
import { listTeams } from '@/lib/departments'
import { listPromotions } from '@/lib/promotions'
import PromotionsManager from './PromotionsManager'

export const dynamic = 'force-dynamic'

export default async function AdminPromotionsPage({ searchParams }: PageProps<'/staff/admin/promotions'>) {
  const me = await requireInOrganisation()
  const { property } = await searchParams
  const properties = await listProperties(me)

  const selected =
    (typeof property === 'string' && properties.some((p) => p.id === property) ? property : null) ??
    me.property_id ??
    properties[0]?.id

  if (!selected) return <p className="text-faint py-16 text-center text-sm">Add a property first.</p>

  const [promotions, teams] = await Promise.all([
    listPromotions(me, selected),
    listTeams(me.organisation_id),
  ])

  return (
    <PromotionsManager
      propertyId={selected}
      properties={properties.length > 1 ? properties.map((p) => ({ id: p.id, name: p.name })) : []}
      promotions={promotions}
      teams={teams.filter((t) => t.active).map((t) => ({ value: t.slug, label: t.name }))}
    />
  )
}
