'use server'

import { redirect } from 'next/navigation'
import { getStaff, homeFor } from '@/lib/auth'
import { sendPhoneCode, submitPhoneCode } from '@/lib/staff-phone'
import type { FormState } from '../login/actions'

/**
 * The staff side of phone verification: someone already signed in types the code
 * that arrived on the handset.
 *
 * Both halves are self-service on purpose. A manager can start it from
 * Manage → Staff, but the person holding the phone can also do the whole thing
 * alone, which is what makes this survivable at a hotel where the admin set the
 * numbers up weeks ago and is not in the building.
 */
export async function verifyPhone(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await getStaff()
  if (!staff) redirect('/staff/login')

  const res = await submitPhoneCode(staff, String(form.get('code') ?? ''))
  if (!res.ok) return { error: res.error }
  redirect(homeFor(staff))
}

/** Ask for a code, or a fresh one. Throttled to one a minute in staff-phone.ts. */
export async function requestOwnCode(): Promise<FormState> {
  const staff = await getStaff()
  if (!staff) redirect('/staff/login')

  const res = await sendPhoneCode(staff.id)
  return res.ok ? {} : { error: res.error }
}
