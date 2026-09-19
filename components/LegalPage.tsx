import { LAST_UPDATED } from '@/lib/site'
import { Breadcrumbs, SiteFooter, SiteHeader } from '@/components/SiteChrome'

/**
 * The shell both legal pages wear.
 *
 * A measure of about 68 characters and a real type scale, because these are
 * the two pages on the site somebody actually reads top to bottom, usually
 * because something has gone wrong. Legal text set in 11px grey is a dark
 * pattern with extra steps.
 */
export default function LegalPage({
  title,
  intro,
  children,
}: {
  title: string
  intro: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-[1240px] px-4 pt-6 sm:px-6">
        <Breadcrumbs trail={[{ label: title }]} />

        <article className="max-w-[68ch] pt-8 lg:pt-14">
          <h1 className="font-display text-[clamp(2rem,5vw,3rem)] leading-[1.04] tracking-[-0.02em]">{title}</h1>
          <p className="text-muted mt-4 text-[16px] leading-relaxed">{intro}</p>
          <p className="text-faint mt-3 text-[13px]">Last updated {LAST_UPDATED}.</p>

          <div className="mt-10 space-y-9">{children}</div>
        </article>
      </main>

      <SiteFooter />
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="border-line border-t pt-5 text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="text-muted mt-3 space-y-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  )
}

export function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink text-[14px] font-semibold">{k}</dt>
          <dd className="text-[15px] leading-relaxed">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
