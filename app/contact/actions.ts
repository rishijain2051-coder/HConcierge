'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { createEnquiry } from '@/lib/enquiries'
import { allow, clientKeyFrom } from '@/lib/limit'

/**
 * The one public, unauthenticated write in the product, so it is fenced twice.
 *
 * A form that sends a WhatsApp message to a real phone is a doorbell anyone on
 * the internet can press, and a script can press it faster than a person can
 * mute it - hence the ceiling here, before anything reaches the database or
 * the gateway. lib/limit.ts is per-instance and says so in its own header;
 * that blunts one source and is not a substitute for a firewall rule, which is
 * exactly the caveat that already applies to the guest endpoints.
 *
 * The honeypot is the cheaper half. `company` is hidden from people and left
 * empty by them; a bot fills every field it finds. Anything that arrives with
 * it set is dropped silently and sent to the thank-you page, because telling a
 * bot why it failed is how it learns to pass.
 */
export async function submitEnquiry(form: FormData) {
  const trap = String(form.get('company') ?? '')
  if (trap) redirect('/thank-you')

  const key = clientKeyFrom(await headers())
  if (!allow(`enquiry:${key}`, 3, 5)) {
    redirect('/contact?e=' + encodeURIComponent('That is a lot of enquiries at once. Please try again shortly.'))
  }

  const res = await createEnquiry({
    name: String(form.get('name') ?? ''),
    hotel: String(form.get('hotel') ?? ''),
    rooms: String(form.get('rooms') ?? ''),
    contact: String(form.get('contact') ?? ''),
    message: String(form.get('message') ?? ''),
  })

  if (!res.ok) redirect('/contact?e=' + encodeURIComponent(res.error))
  redirect('/thank-you')
}
