'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/lib/types'
import { sendGuestMessage } from './actions'

export default function GuestChat({
  token,
  messages,
  onSent,
  embedded = false,
}: {
  token: string
  messages: ChatMessage[]
  onSent: () => void
  /**
   * Inside the concierge panel rather than filling a tab. The panel supplies
   * the header and the scroll container, and the composer sits on the panel's
   * own floor instead of clearing a tab bar that is not there.
   */
  embedded?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    const res = await sendGuestMessage(token, text)
    setBusy(false)
    if (res.ok) {
      setDraft('')
      onSent()
    } else {
      setError(res.error)
    }
  }

  return (
    <div className={embedded ? 'flex flex-col px-4 pt-3' : 'flex min-h-[calc(100svh-13rem)] flex-col px-4 pt-5'}>
      <div className="flex-1">
        {!embedded && (
          <>
            <h1 className="text-[22px] font-semibold tracking-tight">Front desk</h1>
            <p className="text-muted mt-0.5 mb-5 text-sm">
              Ask us anything at all. A real person reads this.
            </p>
          </>
        )}

        {messages.length === 0 ? (
          <div className="border-line rounded-[14px] border border-dashed px-4 py-8 text-center">
            <p className="text-muted text-sm">No messages yet.</p>
            <p className="text-faint mt-1 text-xs">
              Late checkout, a restaurant recommendation, a question about the bill. Start here.
            </p>
          </div>
        ) : (
          <div>
            {/* Grouped. Two replies typed a minute apart by the same person do
                not each need her name above them and the same time below them
                - that is four lines of furniture around two sentences. The
                name opens a run, the clock closes it, and the squared-off
                corner marks the end of the run rather than every bubble. */}
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const next = messages[i + 1]
              const sameAs = (o?: ChatMessage) => o && o.sender === m.sender && o.staff_name === m.staff_name
              const opens = !sameAs(prev)
              const closes =
                !sameAs(next) ||
                new Date(next!.created_at).getTime() - new Date(m.created_at).getTime() > 5 * 60_000
              const mine = m.sender === 'guest'

              return (
                <div
                  key={m.id}
                  className={`flex ${mine ? 'justify-end' : 'justify-start'} ${opens ? 'mt-3 first:mt-0' : 'mt-1'}`}
                >
                  <div className="max-w-[82%]">
                    {opens && !mine && m.staff_name && (
                      <p className="text-faint mb-1 ml-3 text-[11px] font-medium">{m.staff_name}</p>
                    )}
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-[15px] leading-snug break-words whitespace-pre-line ${
                        mine ? 'brand-bg text-white' : 'bg-surface border-line border'
                      } ${closes ? (mine ? 'rounded-br-md' : 'rounded-bl-md') : ''}`}
                    >
                      {m.body}
                    </div>
                    {closes && (
                      <p className={`text-faint mt-1 text-[11px] ${mine ? 'mr-1 text-right' : 'ml-1'}`}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div ref={bottom} />
      </div>

      {error && <p className="text-late mt-3 text-center text-xs">{error}</p>}

      {/* The navigation is fixed to the bottom of the screen, so the composer
          has to stop above it - flush with bottom-0 it was invisible and every
          tap on it hit a nav tab instead. */}
      <form
        onSubmit={send}
        className={`bg-surface sticky flex gap-2 py-3 ${
          embedded ? 'bottom-0' : 'bg-paper bottom-[calc(env(safe-area-inset-bottom)+3.65rem)]'
        }`}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={1000}
          aria-label="Message the front desk"
          placeholder="Type a message…"
          className="border-line bg-surface placeholder:text-faint flex-1 rounded-full border px-4 py-3 text-[15px] outline-none focus:border-[var(--brand)]"
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          className="brand-bg shrink-0 rounded-full px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-30"
        >
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
