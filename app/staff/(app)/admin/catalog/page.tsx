import { requireManager } from '@/lib/auth'
import { listCatalog, listProperties } from '@/lib/admin'
import CatalogManager from './CatalogManager'

export const dynamic = 'force-dynamic'

export default async function AdminCatalogPage({ searchParams }: PageProps<'/staff/admin/catalog'>) {
  const me = await requireManager()
  const { property } = await searchParams
  const properties = await listProperties(me)

  const selected =
    (typeof property === 'string' && properties.some((p) => p.id === property) ? property : null) ??
    me.property_id ??
    properties[0]?.id

  if (!selected) {
    return <p className="text-faint py-16 text-center text-sm">Add a property first.</p>
  }

  return (
    <CatalogManager
      propertyId={selected}
      properties={me.role === 'admin' ? properties.map((p) => ({ id: p.id, name: p.name })) : []}
      categories={await listCatalog(me, selected)}
    />
  )
}
