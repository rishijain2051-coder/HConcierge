import Link from 'next/link'
import { homeFor, requireStaff } from '@/lib/auth'
import { sql } from '@/lib/db'
import AuthForm from '../AuthForm'
import { Wordmark } from '@/components/Logo'
import SendCode from './SendCode'
import { verifyPhone } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Verify the phone number on your own account.
 *
 * Sits outside the app shell, like the password screen, because it is a one-time
 * setup step rather than part of the working day. Until it is done, escalations
 * still arrive on that number — they just carry no one-tap link. See
 * WHATSAPP-TESTING-PLAN.md §5.
 */
export default async function PhonePage() {
  const staff = await requireStaff()
  const [row] = await sql<{ phone: string | null; phone_verified_at: Date | null }[]>`
    select phone, phone_verified_at from staff where id = ${staff.id}`

  const back = (
    <Link href={homeFor(staff)} className="hover:text-ink underline">
      Back to work
    </Link>
  )

  if (!row?.phone?.trim()) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12 text-center">
        <p className="text-muted mb-6 inline-flex justify-center text-[14px] font-semibold tracking-tight">
          <Wordmark />
        </p>
        <h1 className="font-display text-[clamp(1.9rem,4vw,2.4rem)] leading-[1.05] tracking-[-0.02em]">
          No number on file
        </h1>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          Ask a manager to add your phone number in Manage → Staff. Then come back here to verify
          it.
        </p>
        <p className="mt-6 text-[13px]">{back}</p>
      </main>
    )
  }

  if (row.phone_verified_at) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12 text-center">
        <p className="text-muted mb-6 inline-flex justify-center text-[14px] font-semibold tracking-tight">
          <Wordmark />
        </p>
        <h1 className="font-display text-[clamp(1.9rem,4vw,2.4rem)] leading-[1.05] tracking-[-0.02em]">
          {row.phone} is verified
        </h1>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          Job alerts to this number carry a link that opens your jobs without signing in. If the
          number changes, it has to be verified again.
        </p>
        <p className="mt-6 text-[13px]">{back}</p>
      </main>
    )
  }

  return (
    <>
      <AuthForm
        action={verifyPhone}
        title="Verify your phone"
        subtitle={`Enter the six digits sent to ${row.phone} on WhatsApp.`}
        submitLabel="Verify number"
        footer={back}
        fields={[
          {
            name: 'code',
            label: 'Six-digit code',
            type: 'text',
            autoComplete: 'one-time-code',
            autoFocus: true,
            hint: 'Until this is done, alerts still reach you — just without the one-tap link.',
          },
        ]}
      />
      <div className="mx-auto -mt-8 max-w-sm px-6 pb-12 text-[13px]">
        <SendCode phone={row.phone} />
      </div>
    </>
  )
}
