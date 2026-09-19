import type { Metadata } from 'next'

import { BUILDER } from '@/lib/site'
import LegalPage, { Rows, Section } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'What HConcierge stores, who controls it, and what it never collects. No card details, no biometric data, no analytics or advertising trackers.',
  alternates: { canonical: '/privacy' },
  // A page-level openGraph block replaces the parent's rather than merging
  // with it, which silently drops the shared card image. Named here on purpose.
  openGraph: {
    url: '/privacy',
    images: ['/opengraph-image'],
    title: 'Privacy policy · HConcierge',
    description: 'What HConcierge stores, who controls it, and what it never collects.',
  },
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro="HConcierge is software a hotel runs for its own guests. This page says what it stores, who decides what happens to it, and the several things it deliberately never collects."
    >
      <Section title="Who is responsible for what">
        <p>
          When a hotel uses HConcierge, <strong className="text-ink">the hotel is the data fiduciary</strong> for
          everything its guests and staff put into it. They decide what the directory says, who works the board,
          how long a stay lasts and when a record is removed.
        </p>
        <p>
          {BUILDER} builds and operates the software on the hotel&rsquo;s behalf, as a data processor. We act on
          the hotel&rsquo;s instructions. If you are a guest and you want something corrected or deleted, the
          fastest route is the front desk of the hotel you stayed at - they can do it from their own screen,
          immediately. You can also write to us and we will pass it on.
        </p>
        <p>
          For an enquiry sent through this website, there is no hotel in the middle: {BUILDER} is the fiduciary
          for that, and the only thing it is used for is replying to you.
        </p>
      </Section>

      <Section title="What is collected">
        <Rows
          rows={[
            [
              'A guest',
              'Room number, the name the desk checked you in under, what you asked for and when, anything you typed in a note or a message to reception, and charges posted to the room. Optionally a phone number, if the desk sent your welcome card by WhatsApp.',
            ],
            [
              'A staff member',
              'Username, display name, department, role, a hashed password, and optionally a phone number for job notifications. Sign-in times and failed attempts, so an account can be locked after five wrong tries.',
            ],
            [
              'An enquiry from this site',
              'Your name, the hotel, roughly how many rooms it has, one email address or phone number, and whatever you wrote in the message box.',
            ],
            [
              'Operational records',
              'An audit log of staff actions that move money or change access - settling a bill, issuing a code, creating an account - so a hotel can answer its own questions later.',
            ],
          ]}
        />
      </Section>

      <Section title="What is never collected">
        <p>
          These are not omissions from a list. They are properties of the product, and the ones that are load
          bearing are enforced in code rather than in policy.
        </p>
        <Rows
          rows={[
            [
              'Card and payment details',
              'HConcierge never takes a payment and has no field to type a card into. Asking to settle a bill puts the room and its balance on reception’s board so a person walks over with a card machine. No card number, expiry, CVV or UPI handle passes through this product at any point.',
            ],
            [
              'Biometric data',
              'No fingerprints, no face or voice templates, no retina or iris scans, no gait or keystroke biometrics - none of it is collected, derived, inferred, stored or shared, and none of it is accepted from any other system. There is no camera, microphone or scanner access anywhere in the product. A guest signs in with a printed code, which is a thing you can change; a face is not.',
            ],
            [
              'Analytics and advertising',
              'No analytics product, no advertising pixel, no session recorder, no third-party script of any kind. Nothing here profiles a guest, builds an advertising audience, or follows anybody to another site.',
            ],
            [
              'Location',
              'The product never requests a device location. It knows which room a link belongs to because the card is in that room.',
            ],
            [
              'Passport, ID and government numbers',
              'Check-in identity documents are the hotel’s own process and its own system. There is no field for one here.',
            ],
          ]}
        />
      </Section>

      <Section title="Cookies">
        <p>
          Two, both strictly necessary, neither optional. A staff session cookie, which is what keeps somebody
          signed in to the board; and a guest cookie that keeps a stay open on the phone that entered the
          four-digit code, tied to that check-in so it stops working when the guest checks out.
        </p>
        <p>
          There are no analytics, advertising, or third-party cookies on this site or in the product. The cookie
          notice records your choice in your browser&rsquo;s own storage rather than in a cookie.
        </p>
      </Section>

      <Section title="Where it is stored, and who else can see it">
        <p>Data is held in India and processed by three suppliers, all under their own contracts.</p>
        <Rows
          rows={[
            ['Supabase', 'The database, in the Mumbai (ap-south-1) region. Everything above lives here.'],
            ['Vercel', 'Hosting and delivery, served from the Mumbai (bom1) region.'],
            [
              'WhatsApp (Meta)',
              'Only when a hotel switches on notifications, or a welcome card is sent to a guest’s own number. The message carries the room, what was asked for and a link; it is delivered by WhatsApp under their terms.',
            ],
          ]}
        />
        <p>
          Nothing is sold, rented or shared for anyone else&rsquo;s marketing. There is no data broker in this
          product and there will not be one.
        </p>
      </Section>

      <Section title="How long it is kept">
        <p>
          A guest&rsquo;s access ends at checkout: the code is cleared and every device that used it is signed
          out that moment. The hotel keeps the request and billing history for as long as its own records
          require, and can delete a room&rsquo;s history from its admin screens.
        </p>
        <p>
          Enquiries from this site are kept while we are talking to you and for a reasonable period afterwards.
          Ask and we will delete yours.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Under India&rsquo;s Digital Personal Data Protection Act, 2023, you may ask what is held about you, ask
          for it to be corrected or erased, withdraw a consent you gave, and complain to the Data Protection
          Board of India. Where the GDPR applies to a stay, the equivalent rights apply.
        </p>
        <p>
          For anything you gave a hotel, ask the hotel first - they hold it and can act on it at once. For
          anything you sent through this website, write to us.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Staff passwords are stored hashed, never in readable form. A guest needs two things at once: the
          permanent QR card, which is physically inside the room, and the four-digit code the desk issues for
          that stay - five wrong codes lock the room for fifteen minutes. Connections are encrypted in transit.
        </p>
        <p>
          No system is perfect. If you think you have found a weakness in this one, please tell us on the number
          below rather than anywhere public, and we will fix it.
        </p>
      </Section>

      <Section title="Changes, and how to reach us">
        <p>
          If this policy changes in a way that matters, the date at the top changes with it. Material changes to
          how a hotel&rsquo;s data is handled are raised with that hotel directly.
        </p>
        <p>
          Questions, corrections, deletions and security reports all reach a person through the{' '}
          <a href="/contact" className="text-ink font-medium underline decoration-from-font underline-offset-2">
            contact form
          </a>
          . Say what it is about and we will come back to you.
        </p>
      </Section>
    </LegalPage>
  )
}
