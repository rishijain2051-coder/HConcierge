import { redirect } from 'next/navigation'
import { getStaff } from '@/lib/auth'
import AuthForm from '../AuthForm'
import { login } from './actions'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await getStaff()) redirect('/staff/board')

  return (
    <AuthForm
      action={login}
      title="HConcierge"
      subtitle="Sign in to see what your rooms need."
      submitLabel="Sign in"
      fields={[
        { name: 'username', label: 'Username', type: 'text', autoComplete: 'username', autoFocus: true },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
      ]}
      footer="Forgotten your password? Your duty manager can reset it."
    />
  )
}
