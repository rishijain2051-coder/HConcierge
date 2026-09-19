'use client'

import { useFormStatus } from 'react-dom'
import { IconCheck } from '@/components/icons'

/**
 * One line of a job, as something you can tick.
 *
 * Client for exactly the reason ./ActButton is: the action re-reads the whole
 * board, so on hotel wifi there is a second between the tap and the line
 * changing, and a corridor handset that looks like it ignored you gets tapped
 * again. Here that costs nothing worse than a tick going back off - which is
 * why this one is safe to make optimistic. `pending` draws the end state
 * immediately and the server confirms it a moment later.
 *
 * The whole row is the target rather than a 20px box: this is read one-handed,
 * often while carrying something, and the tick is meant to be easy to hit and
 * easy to undo.
 */
export default function TickButton({ done, label }: { done: boolean; label: string }) {
  const { pending } = useFormStatus()
  // Mid-tap, show where it is going. The form field already says the same.
  const on = pending ? !done : done

  return (
    <button
      type="submit"
      aria-pressed={on}
      className="ease-glide flex w-full items-start gap-2.5 rounded-lg py-1.5 text-left transition duration-200 active:scale-[0.99]"
    >
      <span
        aria-hidden
        className={`ease-glide mt-px grid h-[19px] w-[19px] shrink-0 place-items-center rounded-[6px] border transition duration-200 ${
          on ? 'bg-ok border-ok text-white' : 'border-line bg-surface text-transparent'
        }`}
      >
        <IconCheck size={13} />
      </span>
      <span className={`text-[14px] leading-snug break-words ${on ? 'text-faint line-through' : 'text-muted'}`}>
        {label}
      </span>
    </button>
  )
}
