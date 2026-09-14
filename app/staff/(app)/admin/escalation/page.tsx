import { requireInOrganisation } from '@/lib/auth'
import { listProperties } from '@/lib/admin'
import { getWarnThreshold, listEscalationCandidates, listEscalationRules } from '@/lib/escalation'
import EscalationManager from './EscalationManager'

export const dynamic = 'force-dynamic'

export default async function AdminEscalationPage({ searchParams }: PageProps<'/staff/admin/escalation'>) {
  const me = await requireInOrganisation()
  const { property } = await searchParams
  const properties = await listProperties(me)

  const selected =
    (typeof property === 'string' && properties.some((p) => p.id === property) ? property : null) ??
    me.property_id ??
    properties[0]?.id

  if (!selected) return <p className="text-faint py-16 text-center text-sm">Add a property first.</p>

  const [rules, candidates, warnAt] = await Promise.all([
    listEscalationRules(me, selected),
    listEscalationCandidates(me, selected),
    getWarnThreshold(selected),
  ])

  return (
    <EscalationManager
      propertyId={selected}
      properties={properties.length > 1 ? properties.map((p) => ({ id: p.id, name: p.name })) : []}
      rules={rules}
      candidates={candidates}
      warnAt={warnAt}
    />
  )
}
