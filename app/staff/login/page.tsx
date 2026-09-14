import { redirect } from 'next/navigation'
import { getStaff } from '@/lib/auth'
import StaffDoor from './StaffDoor'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await getStaff()) redirect('/staff/board')
  return <StaffDoor />
}
