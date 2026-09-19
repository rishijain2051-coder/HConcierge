import type { Metadata } from 'next'

import { BUILDER } from '@/lib/site'
import LegalPage, { Section } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of service',
  description:
    'The terms on which HConcierge is provided to a hotel: what the software does, what the hotel is responsible for, and the limits of both.',
  alternates: { canonical: '/terms' },
  // A page-level openGraph block replaces the parent's rather than merging
  // with it, which silently drops the shared card image. Named here on purpose.
  openGraph: {
    url: '/terms',
    images: ['/opengraph-image'],
    title: 'Terms of service · HConcierge',
    description: 'The terms on which HConcierge is provided to a hotel.',
  },
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      intro={`These terms cover HConcierge, software provided by ${BUILDER}. Using the product - as a hotel, as a member of its staff, or as a guest in one of its rooms - means accepting them.`}
    >
      <Section title="What the product is">
        <p>
          HConcierge lets a hotel guest send a request from their own phone instead of telephoning reception, and
          routes each request to the team that performs it. It is software. It does not perform the service
          requested, and it does not employ anybody who does.
        </p>
        <p>
          Every price, target time, menu item and hotel-information page a guest reads is written by the hotel
          and editable by the hotel. {BUILDER} does not set them, check them, or stand behind them.
        </p>
      </Section>

      <Section title="No payments, ever">
        <p>
          HConcierge takes no money. A charge posted against a room is a note for the hotel&rsquo;s own bill;
          asking to settle puts the room and its balance on reception&rsquo;s board so a person attends with a
          card machine. No card details are collected anywhere in the product, and no payment is processed by
          it. Settlement is entirely between the guest and the hotel.
        </p>
      </Section>

      <Section title="The hotel's responsibilities">
        <p>
          The hotel is responsible for the accuracy of its directory and its prices; for honouring what it
          offers, including any promotion a guest takes up; for who it gives staff accounts to and for removing
          them when somebody leaves; for issuing and revoking guest access at check-in and checkout; and for its
          own obligations to its guests under consumer, tax and data protection law.
        </p>
        <p>
          The four-digit code plus the room&rsquo;s printed card is a guest&rsquo;s sign-in. Handing either to
          the wrong person gives that person the room&rsquo;s bill and its thread with reception. Treat them
          accordingly.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          Do not attempt to reach a room, a property or a department the account in front of you is not entitled
          to; do not probe, scrape, overload or reverse engineer the service; do not use it to send anybody
          unlawful, abusive or misleading content; and do not resell or relabel it without a written agreement.
        </p>
        <p>
          Access that threatens the service or another customer can be suspended without notice. We will say why
          as soon as it is safe to.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          The product is provided as it stands. There is no uptime guarantee attached to these terms, and
          maintenance, supplier outages and faults will happen. A hotel that needs a contractual service level
          should ask for one in writing.
        </p>
        <p>
          A request raised here is not an emergency channel. In an emergency, telephone the hotel or the
          emergency services.
        </p>
      </Section>

      <Section title="Who owns what">
        <p>
          {BUILDER} owns the software, its design and the HConcierge name. The hotel keeps everything it puts
          in: its directory, its prices, its guest and staff records. Nothing in these terms transfers ownership
          of either, and we do not use a hotel&rsquo;s content to promote the product without its permission.
        </p>
        <p>
          If you believe something in this product infringes your rights, tell us on the number below with
          enough detail to find it, and we will look at it and act where the complaint is made out.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          To the extent the law allows, {BUILDER} is not liable for indirect or consequential loss, for lost
          profit or goodwill, or for any loss arising from what a hotel published in its own directory, from a
          service a hotel did or did not perform, or from access shared with the wrong person.
        </p>
        <p>
          Nothing here limits liability for fraud, for death or personal injury caused by negligence, or for
          anything else that cannot lawfully be limited.
        </p>
      </Section>

      <Section title="Changes, law and contact">
        <p>
          These terms may change; the date at the top moves when they do, and a change that materially affects a
          hotel is raised with that hotel. Continuing to use the product after a change means accepting it.
        </p>
        <p>
          These terms are governed by the laws of India, and the courts at Pune have exclusive jurisdiction over
          any dispute arising from them.
        </p>
        <p>
          Questions, and anything in the section above, reach us through the{' '}
          <a href="/contact" className="text-ink font-medium underline decoration-from-font underline-offset-2">
            contact form
          </a>
          . How data is handled is set out in the{' '}
          <a href="/privacy" className="text-ink font-medium underline decoration-from-font underline-offset-2">
            privacy policy
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  )
}
