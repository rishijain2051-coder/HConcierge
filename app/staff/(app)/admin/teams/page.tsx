import { requireAdmin } from '@/lib/auth'
import { listTeams, teamUsage } from '@/lib/departments'
import TeamManager from './TeamManager'

export const dynamic = 'force-dynamic'

/** Teams belong to the organisation, so a manager running one property is not
 *  the right person to add or close one. `requireAdmin` is that line. */
export default async function AdminTeamsPage() {
  const me = await requireAdmin()
  const [teams, usage] = await Promise.all([listTeams(me.organisation_id), teamUsage(me.organisation_id)])
  return <TeamManager teams={teams} usage={Object.fromEntries(usage)} />
}
