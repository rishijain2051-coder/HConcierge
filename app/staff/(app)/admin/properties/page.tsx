import { requireAdmin } from '@/lib/auth'
import { listProperties } from '@/lib/admin'
import PropertyManager from './PropertyManager'

export const dynamic = 'force-dynamic'

export default async function AdminPropertiesPage() {
  const me = await requireAdmin()
  return <PropertyManager properties={await listProperties(me)} />
}
