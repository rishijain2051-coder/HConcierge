'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/lib/types'
import { sendGuestMessage } from './actions'

export default function GuestChat({
  token,
  messages,
  onSent,
}: {
  token: string
  messages: ChatMessage[]
  onSent: () => void
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
    <div className="flex min-h-[calc(100dvh-13rem)] flex-col px-4 pt-5">
      <div className="flex-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Front desk</h1>
        <p className="text-muted mt-0.5 mb-5 text-sm">
          Ask us anything at all. A real person reads this.
        </p>

        {messages.length === 0 ? (
          <div className="border-line rounded-[14px] border border-dashed px-4 py-8 text-center">
            <p className="text-muted text-sm">No messages yet.</p>
            <p className="text-faint mt-1 text-xs">
              Late checkout, a restaurant recommendation, a question about the bill — start here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === 'guest' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[82%]">
                  {m.sender === 'staff' && m.staff_name && (
                    <p className="text-faint mb-1 ml-3 text-[11px] font-medium">{m.staff_name}</p>
                  )}
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 text-[15px] leading-snug break-words whitespace-pre-line ${
                      m.sender === 'guest'
                        ? 'brand-bg rounded-br-md text-white'
                        : 'bg-surface border-line rounded-bl-md border'
                    }`}
                  >
                    {m.body}
                  </div>
                  <p className={`text-faint mt-1 text-[11px] ${m.sender === 'guest' ? 'mr-1 text-right' : 'ml-1'}`}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
        <div ref={bottom} />
      </div>

      {error && <p className="text-late mt-3 text-center text-xs">{error}</p>}

      {/* The navigation is fixed to the bottom of the screen, so the composer
          has to stop above it — flush with bottom-0 it was invisible and every
          tap on it hit a nav tab instead. */}
      <form
        onSubmit={send}
        className="bg-paper sticky bottom-[calc(env(safe-area-inset-bottom)+3.65rem)] flex gap-2 py-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={1000}
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
