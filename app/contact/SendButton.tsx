'use client'

import { useFormStatus } from 'react-dom'

/**
 * Its own component for the reason app/w/[token]/ActButton.tsx is: the action
 * writes a row and then calls a WhatsApp gateway, which on a bad connection is
 * a second or more of a page that looks exactly as it did before the tap. A
 * form that appears to have ignored you gets submitted again, and the second
 * submit is a second lead in the pile and a second message on somebody's
 * phone.
 */
export default function SendButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="bg-ink ease-glide w-full rounded-xl px-4 py-3.5 text-[14px] font-semibold text-white transition duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-55"
    >
      {pending ? 'Sending…' : 'Send it'}
    </button>
  )
}
