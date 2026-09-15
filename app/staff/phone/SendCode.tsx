'use client'

import { useState, useTransition } from 'react'
import { requestOwnCode } from './actions'

/**
 * "Send me a code", next to the form that asks for it.
 *
 * Its own component because AuthForm owns one action and this is a second one —
 * and because the throttle message ("try again in 40s") is the whole point of
 * showing a result here rather than silently doing nothing.
 */
export default function SendCode({ phone }: { phone: string }) {
  const [pending, start] = useTransition()
  const [note, setNote] = useState<string | null>(null)

  return (
    <div className="mt-6 text-center">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await requestOwnCode()
            setNote(res.error ?? `Sent to ${phone}. It expires in 10 minutes.`)
          })
        }
        className="hover:text-ink underline disabled:opacity-40"
      >
        {pending ? 'Sending…' : 'Send me a code'}
      </button>
      {note && <p className="text-muted mt-2 text-[13px]">{note}</p>}
    </div>
  )
}
