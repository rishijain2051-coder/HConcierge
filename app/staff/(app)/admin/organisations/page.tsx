import { requirePlatform } from '@/lib/auth'
import { listOrganisations } from '@/lib/organisations'
import OrganisationManager from './OrganisationManager'

export const dynamic = 'force-dynamic'

export default async function AdminOrganisationsPage() {
  const me = await requirePlatform()
  return <OrganisationManager organisations={await listOrganisations(me)} />
}
