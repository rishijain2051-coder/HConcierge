import { requireStaff } from '@/lib/auth'
import AuthForm from '../AuthForm'
import { changePassword } from '../login/actions'

export const dynamic = 'force-dynamic'

export default async function PasswordPage() {
  const staff = await requireStaff()

  return (
    <AuthForm
      action={changePassword}
      title="Choose a new password"
      subtitle={
        staff.must_change_password
          ? 'Your account still has the password it was set up with. Please change it before you carry on.'
          : 'Update the password on your account.'
      }
      submitLabel="Save password"
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
