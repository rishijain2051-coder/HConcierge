/**
 * The handful of facts the public site states about itself.
 *
 * One file because they are repeated: the origin appears in canonical tags, in
 * the sitemap and in robots; the reply promise appears on the form, on the
 * thank-you page and beside the sticky button; the WhatsApp number is both
 * where an enquiry is sent and where the privacy policy tells somebody to
 * write about their data. Three copies of any of those is three chances to
 * change two of them.
 */

/**
 * Canonical origin. Read from Vercel when it is there so a preview deployment
 * does not advertise production URLs, and hard-coded otherwise because
 * `metadataBase` cannot be relative and a wrong origin in a canonical tag is
 * worse than a missing one.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  : 'https://hconcierge.vercel.app'

export const SITE_NAME = 'HConcierge'
export const BUILDER = 'Draveta Technologies'
export const BUILDER_URL = 'https://draveta.vercel.app'

/**
 * Where an enquiry lands.
 *
 * **Never render this.** It is the destination, not a published contact
 * detail: on the page it is an address for scrapers and cold callers, and a
 * `wa.me/` link exposes it just as completely as printing the digits does -
 * the number is in the href either way. The contact form is the only channel
 * the site offers, and this constant should appear nowhere but lib/enquiries.ts.
 */
export const ENQUIRY_WHATSAPP = '+91 93521 87266'

/**
 * What we promise about answering, and the only promise on the public site.
 *
 * It is about replying to an enquiry - something Draveta controls - and not
 * about anything the product does in a hotel. Target times inside HConcierge
 * are set by each property, so the marketing site has no business quoting one.
 */
export const REPLY_PROMISE = 'We reply within one working day.'

export const LAST_UPDATED = '19 September 2026'
