import Link from 'next/link'

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-muted text-[11px] font-semibold tracking-[0.16em] uppercase">RN Hospitality</p>
      <h1 className="mt-3 text-[40px] leading-[1.05] font-semibold tracking-tight">HConcierge</h1>
      <p className="text-muted mt-4 text-[17px] leading-relaxed">
        Everything a guest used to phone reception for — towels, room service, laundry, a wake-up call,
        a question about the pool — handled from their own phone, routed straight to the team that does it.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/staff/login"
          className="bg-ink rounded-full px-5 py-3 text-[15px] font-semibold text-white transition hover:opacity-90"
        >
          Staff sign in
        </Link>
      </div>

      <div className="border-line text-muted mt-12 border-t pt-6 text-sm leading-relaxed">
        <p className="text-ink font-medium">Guests do not come here.</p>
        <p className="mt-1">
          Each room has its own printed QR code that opens straight into that room&rsquo;s page. Print them from
          Rooms once you are signed in.
        </p>
      </div>
    </main>
  )
}
