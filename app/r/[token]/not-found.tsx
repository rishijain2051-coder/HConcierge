export default function RoomNotFound() {
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
      {/* No icon, matching its two siblings: the not-checked-in screen in
          page.tsx and Expired() in app/w/[token]. This had the codebase's only
          emoji-as-icon, which also made it the only screen not drawing from
          components/icons.tsx. */}
      <h1 className="text-[22px] font-semibold tracking-tight">This room link is not active</h1>
      <p className="text-muted mt-2 text-sm leading-relaxed">
        The code may have been reissued after a checkout, or the photo you scanned is from a previous stay.
        Scan the card in your room again, or dial the front desk and we will sort it out.
      </p>
    </div>
  )
}
