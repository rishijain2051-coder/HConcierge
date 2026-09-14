'use client'

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-ink rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90"
    >
      Print
    </button>
  )
}
