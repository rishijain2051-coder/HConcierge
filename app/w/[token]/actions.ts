'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { staffFromLinkToken } from '@/lib/auth'
import { setRequestStatus } from '@/lib/board'
import type { RequestStatus } from '@/lib/types'

/**
 * Accept or finish a job from the WhatsApp link, with no session.
 *
 * Same shape as app/staff/(app)/board/actions.ts — resolve the actor, then hand
 * off to lib/board — except the actor comes from the signed token rather than a
 * cookie. The token is re-verified here rather than trusted from the render: a
 * form field is whatever the client says it is, so this reads it fresh and the
 * staff row is re-checked for `active` and a verified phone.
 *
 * `setRequestStatus` still owns every rule — property, department, the legal
 * transition table, the folio charge on `done`, and the audit row. Nothing about
 * authorisation is re-implemented here, and nothing about it is weaker because
 * the request arrived from a chat.
 *
 * Returns nothing, because a plain `<form action={…}>` takes a void action and
 * this page carries no client JavaScript to read a result with. A refusal comes
 * back as `?e=` and is rendered above the list; success just re-renders, and the
 * row shows its new state.
 */
export async function actOnJob(form: FormData) {
  const token = String(form.get('token') ?? '')
  const requestId = String(form.get('request') ?? '')
  const next = String(form.get('next') ?? '') as RequestStatus

  const staff = next === 'ack' || next === 'done' ? await staffFromLinkToken(token) : null
  if (staff) {
    const result = await setRequestStatus(staff, requestId, next)
    if (!result.ok) {
      redirect(`/w/${token}?e=${encodeURIComponent(result.error ?? 'That did not work.')}`)
    }
  }

  // An expired or forged token falls through to here and the page renders its
  // own expired state — there is nothing to tell the person that the page does
  // not already say better.
  //
  // force-dynamic already means nothing is cached; this is what re-renders the
  // list in the same round trip.
  revalidatePath(`/w/${token}`)
}
