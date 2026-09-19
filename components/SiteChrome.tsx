import Link from 'next/link'

import { BUILDER, BUILDER_URL, SITE_URL } from '@/lib/site'
import StaffSignInLink from '@/app/StaffSignInLink'
import CookieBanner from '@/components/CookieBanner'
import { IconArrowRight } from '@/components/icons'
import { Logo, Wordmark } from '@/components/Logo'

/**
 * The header, the footer and the crumb trail every public page wears.
 *
 * Pulled out of app/page.tsx once there was more than one page: a site with a
 * privacy policy you can only reach by typing its address is a site with no
 * privacy policy, and the way out of every page has to be the same shape or
 * the pages read as different sites.
 */

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-[1240px] items-center justify-between px-4 py-5 sm:px-6">
      <Link href="/" className="hover:opacity-80 transition" aria-label="HConcierge home">
        <Wordmark size={20} className="text-[15px] font-semibold tracking-tight" />
      </Link>
      <div className="flex items-center gap-5">
        <Link
          href="/contact"
          className="text-muted hover:text-ink hidden text-[13px] font-medium transition sm:inline"
        >
          Talk to us
        </Link>
        <StaffSignInLink className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-[13px] font-medium transition">
          Staff sign in
          <IconArrowRight size={14} />
        </StaffSignInLink>
      </div>
    </header>
  )
}

/**
 * Four columns of links rather than one line, now that there are pages to
 * point at. The product column is in-page anchors on the homepage, which is
 * the only place they resolve - hence the leading `/`, so they work from the
 * privacy policy too.
 */
export function SiteFooter() {
  return (
    <footer className="border-line mt-24 border-t">
      <div className="mx-auto max-w-[1240px] px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
              <Logo size={15} />
              HConcierge
            </span>
            <p className="text-faint mt-2 max-w-[28ch] text-[13px] leading-relaxed">
              The hotel room that does not have to phone reception.
            </p>
          </div>

          <FooterColumn title="The product">
            <FooterLink href="/#demo">See it working</FooterLink>
            <FooterLink href="/#guest">What the guest gets</FooterLink>
            <FooterLink href="/#reception">What reception sees</FooterLink>
            <FooterLink href="/#setup">Standing it up</FooterLink>
          </FooterColumn>

          {/* One channel, and no number. Where an enquiry is delivered is
              lib/site.ts's business and nobody else's - a phone number on a
              public page is an address for scrapers, and a wa.me link puts it
              in the markup just as plainly as printing it would. */}
          <FooterColumn title="Talk to us">
            <FooterLink href="/contact">Ask about your hotel</FooterLink>
            <FooterLink href="/#demo">Try it first</FooterLink>
          </FooterColumn>

          <FooterColumn title="Legal">
            <FooterLink href="/privacy">Privacy policy</FooterLink>
            <FooterLink href="/terms">Terms of service</FooterLink>
          </FooterColumn>
        </div>

        <div className="border-line text-faint mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-[13px]">
          <span>
            Built by{' '}
            <a
              href={BUILDER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink font-medium underline decoration-from-font underline-offset-2 transition"
            >
              {BUILDER}
            </a>
          </span>
          <span>No card details are taken anywhere in this product.</span>
        </div>
      </div>

      {/* Mounted here rather than in the root layout, deliberately. Every
          public page renders this footer and no app screen does - and a guest
          standing in a hotel room, whose only cookie is the one keeping their
          stay open, should not be handed a consent bar to dismiss. */}
      <CookieBanner />
    </footer>
  )
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-semibold">{title}</p>
      <ul className="mt-2 space-y-1.5">{children}</ul>
    </div>
  )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-faint hover:text-ink text-[13px] transition">
        {children}
      </Link>
    </li>
  )
}

/**
 * Where you are, and the way back up.
 *
 * Emits BreadcrumbList JSON-LD alongside the visible trail, because the two
 * have to agree and the only way to guarantee that is to build them from one
 * array. Google renders the trail in the result from this; the list on screen
 * is for the person who arrived on a legal page from a search and has no idea
 * what site they are on.
 */
export function Breadcrumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  const full = [{ label: 'Home', href: '/' }, ...trail]

  return (
    <>
      <script
        type="application/ld+json"
        // Static, built from the same array rendered below - no user input reaches it.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: full.map((c, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: c.label,
              ...(c.href ? { item: `${SITE_URL}${c.href === '/' ? '' : c.href}` } : {}),
            })),
          }),
        }}
      />
      <nav aria-label="Breadcrumb" className="text-faint text-[13px]">
        <ol className="flex flex-wrap items-center gap-1.5">
          {full.map((c, i) => (
            <li key={c.label} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              {c.href ? (
                <Link href={c.href} className="hover:text-ink transition">
                  {c.label}
                </Link>
              ) : (
                <span className="text-muted" aria-current="page">
                  {c.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  )
}
