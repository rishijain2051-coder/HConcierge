'use server'

import { redirect } from 'next/navigation'
import { sql } from '@/lib/db'
import { audit } from '@/lib/audit'
import {
  attemptLogin,
  homeFor,
  endSession,
  getStaff,
  hashPassword,
  passwordProblem,
  startSession,
  verifyPassword,
} from '@/lib/auth'

export type FormState = { error?: string }

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const username = String(form.get('username') ?? '').trim()
  const password = String(form.get('password') ?? '')
  if (!username || !password) return { error: 'Enter your username and password.' }

  const result = await attemptLogin(username, password)
  if (!result.ok) return { error: result.error }

  await startSession(result.staff.id)
  await audit({ staffId: result.staff.id, actor: username, action: 'staff.login' })

  // redirect throws by design - it must be outside any try/catch.
  redirect(homeFor(result.staff))
}

export async function logout(): Promise<void> {
  const staff = await getStaff()
  if (staff) await audit({ staffId: staff.id, actor: staff.name, action: 'staff.logout' })
  await endSession()
  redirect('/staff/login')
}

export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await getStaff()
  if (!staff) redirect('/staff/login')

  const current = String(form.get('current') ?? '')
  const next = String(form.get('next') ?? '')
  const confirm = String(form.get('confirm') ?? '')

  if (next !== confirm) return { error: 'The two new passwords do not match.' }
  const problem = passwordProblem(next)
  if (problem) return { error: problem }

  const [row] = await sql<{ password_hash: string }[]>`
    select password_hash from staff where id = ${staff.id}`
  if (!row || !verifyPassword(current, row.password_hash)) {
    return { error: 'Your current password is not right.' }
  }
  if (verifyPassword(next, row.password_hash)) {
    return { error: 'Choose a password you have not used here before.' }
  }

  await sql`
    update staff set password_hash = ${hashPassword(next)} where id = ${staff.id}`
  await audit({
    propertyId: staff.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'staff.password_changed',
  })

  redirect(homeFor(staff))
}
