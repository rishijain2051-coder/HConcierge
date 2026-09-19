import Link from 'next/link'
import { homeFor, requireStaff } from '@/lib/auth'
import AuthForm from '../AuthForm'
import { changePassword } from '../login/actions'

export const dynamic = 'force-dynamic'

export default async function PasswordPage() {
  const staff = await requireStaff()

  return (
    <AuthForm
      action={changePassword}
      title="Choose a new password"
      subtitle="Update the password on your account."
      submitLabel="Save password"
      // This screen sits outside the app shell, so it has no header to go back
      // through - and without this the only way out was the browser button.
      footer={
        <Link href={homeFor(staff)} className="hover:text-ink underline">
          Back to work
        </Link>
      }
      fields={[
        { name: 'current', label: 'Current password', type: 'password', autoComplete: 'current-password', autoFocus: true },
        {
          name: 'next',
          label: 'New password',
          type: 'password',
          autoComplete: 'new-password',
          hint: 'At least 10 characters, with a letter and a number.',
        },
        { name: 'confirm', label: 'New password again', type: 'password', autoComplete: 'new-password' },
      ]}
    />
  )
}
