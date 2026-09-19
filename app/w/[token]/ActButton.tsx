'use client'

import { useFormStatus } from 'react-dom'

/**
 * The submit button, and the only client component on this page.
 *
 * The action re-reads the whole board, so on hotel wifi there is a second or
 * more between the tap and the list changing - during which the page looked
 * exactly as it did before. That reads as a dead button, and a dead button on a
 * corridor handset gets tapped again: `done` posts the folio charge and
 * NEXT_STATUS has no way back out of it, so the second tap is the expensive
 * one. `useFormStatus` is the whole fix - it disables the button and says what
 * it is doing, in the same frame as the tap.
 *
 * It has to be its own component because `useFormStatus` reads the state of the
 * form *above* it; called in the component that renders the `<form>` it returns
 * null forever. And it stays progressive: before hydration the form is still a
 * plain POST, which is what this page was built to fall back to.
 */
export default function ActButton({
  label,
  busy,
  primary,
}: {
  label: string
  /** Same verb in the continuous - "Accepting…". */
  busy: string
  primary?: boolean
}) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`ease-glide min-h-11 w-full rounded-lg border px-3 py-2.5 text-[14px] font-semibold transition duration-200 active:scale-[0.98] disabled:opacity-55 ${
        primary ? 'bg-ink border-ink text-white hover:opacity-90' : 'border-line text-muted hover:text-ink'
      }`}
    >
      {pending ? busy : label}
    </button>
  )
}
