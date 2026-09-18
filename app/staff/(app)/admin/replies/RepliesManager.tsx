'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { AdminQuickReply } from '@/lib/admin'
import { deleteQuickReply, saveQuickReply } from '../actions'
import { Button, Confirm, Err, Field, Modal, Panel, TextArea } from '../../ui'

/**
 * The desk's canned chat lines, editable at last.
 *
 * Deliberately the same shape as Hotel info next door — a grid of cards, one
 * dialog for both adding and editing — because it is the same job: a list of
 * one property's words. What it does not have is a reorder control. The board
 * lists these by `sort` then label and this screen appends, so the newest sits
 * last; moving one up means deleting and re-adding it. Worth building when
 * somebody has enough of them to care, not before.
 */
export default function RepliesManager({
  propertyId,
  properties,
  replies,
}: {
  propertyId: string
  properties: { id: string; name: string }[]
  replies: AdminQuickReply[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<AdminQuickReply | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<AdminQuickReply | null>(null)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'That did not work.')
      else {
        after?.()
        router.refresh()
      }
    })
  }

  return (
    <Panel
      title="Quick replies"
      description="The lines the desk can drop into a room's chat without typing them. They sit behind “Quick replies” above the reply box on the board, and picking one fills the box so it can still be changed before it is sent. Write them the way this hotel actually speaks."
      action={
        <div className="flex flex-wrap gap-2">
          {properties.length > 1 && (
            <select
              value={propertyId}
              onChange={(e) => router.push(`/staff/admin/replies?property=${e.target.value}`)}
              className="border-line bg-surface rounded-lg border px-3 py-1.5 text-[12px] font-semibold"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" onClick={() => setAdding(true)}>
            + Add a reply
          </Button>
        </div>
      }
    >
      {error && <div className="mb-3">{<Err>{error}</Err>}</div>}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {replies.map((q) => (
          <article key={q.id} className="bg-surface border-line flex flex-col rounded-2xl border p-4">
            <h2 className="mb-2 text-[15px] font-semibold">{q.label}</h2>
            {/* Shown exactly as it will arrive in the room, line breaks and all:
                this card is the only preview anyone gets before a guest reads it. */}
            <p className="text-muted flex-1 text-[13px] leading-relaxed whitespace-pre-line">{q.body}</p>
            <div className="mt-3 flex gap-1.5">
              <Button onClick={() => setEditing(q)}>Edit</Button>
              <Button variant="danger" onClick={() => setConfirming(q)}>
                Delete
              </Button>
            </div>
          </article>
        ))}
        {replies.length === 0 && (
          <p className="text-faint col-span-full py-16 text-center text-sm">
            Nothing yet. Start with the one the desk types most — “someone is on the way to your room now”.
          </p>
        )}
      </div>

      {(adding || editing) && (
        <Modal wide title={editing ? `Edit ${editing.label}` : 'Add a quick reply'} onClose={() => (setAdding(false), setEditing(null))}>
          <form
            className="space-y-3.5"
            action={(form) => {
              const input = {
                id: editing?.id ?? null,
                label: String(form.get('label') ?? ''),
                body: String(form.get('body') ?? ''),
              }
              run(() => saveQuickReply(propertyId, input), () => (setAdding(false), setEditing(null)))
            }}
          >
            <Field
              label="Name"
              name="label"
              defaultValue={editing?.label}
              required
              autoFocus
              placeholder="On the way"
              hint="What the desk sees in the list. Short — it is read at a glance."
            />
            <TextArea
              label="What gets sent"
              name="body"
              defaultValue={editing?.body}
              rows={5}
              hint="Up to 1000 characters, the same as the reply box. Line breaks are kept."
            />
            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Add reply'}
            </Button>
          </form>
        </Modal>
      )}

      {confirming && (
        <Confirm
          title={`Delete “${confirming.label}”?`}
          body="The desk will no longer see it in the list. Messages already sent are not touched."
          confirmLabel="Delete"
          onConfirm={() => run(() => deleteQuickReply(confirming.id))}
          onClose={() => setConfirming(null)}
        />
      )}
    </Panel>
  )
}
