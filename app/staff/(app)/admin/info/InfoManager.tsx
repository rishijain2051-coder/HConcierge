'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { AdminInfoPage } from '@/lib/admin'
import { deleteInfoPage, saveInfoPage } from '../actions'
import { Button, Check, Confirm, Err, Field, Modal, Panel, Tag, TextArea } from '../ui'

export default function InfoManager({
  propertyId,
  properties,
  pages,
}: {
  propertyId: string
  properties: { id: string; name: string }[]
  pages: AdminInfoPage[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<AdminInfoPage | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<AdminInfoPage | null>(null)

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
      title="Hotel info"
      description="The read-only pages under Hotel on the guest's phone. This is where the wifi password, the checkout time and the pool hours live — the questions that generate the most calls and need no request at all."
      action={
        <div className="flex gap-2">
          {properties.length > 1 && (
            <select
              value={propertyId}
              onChange={(e) => router.push(`/staff/admin/info?property=${e.target.value}`)}
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
            + Add a page
          </Button>
        </div>
      }
    >
      {error && <div className="mb-3">{<Err>{error}</Err>}</div>}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {pages.map((p) => (
          <article key={p.id} className="bg-surface border-line flex flex-col rounded-2xl border p-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                {p.icon && <span className="text-lg leading-none">{p.icon}</span>}
                {p.title}
              </h2>
              {!p.active && <Tag tone="late">Hidden</Tag>}
            </div>
            <p className="text-muted line-clamp-4 flex-1 text-[13px] leading-relaxed whitespace-pre-line">{p.body}</p>
            <div className="mt-3 flex gap-1.5">
              <Button onClick={() => setEditing(p)}>Edit</Button>
              <Button variant="danger" onClick={() => setConfirming(p)}>
                Delete
              </Button>
            </div>
          </article>
        ))}
        {pages.length === 0 && (
          <p className="text-faint col-span-full py-16 text-center text-sm">
            No pages yet. Start with the wifi password — it is the single most asked question in any hotel.
          </p>
        )}
      </div>

      {(adding || editing) && (
        <Modal
          wide
          title={editing ? `Edit ${editing.title}` : 'Add a page'}
          onClose={() => (setAdding(false), setEditing(null))}
        >
          <form
            className="space-y-3.5"
            action={(form) => {
              const input = {
                id: editing?.id ?? null,
                slug: String(form.get('slug') ?? ''),
                title: String(form.get('title') ?? ''),
                body: String(form.get('body') ?? ''),
                icon: String(form.get('icon') ?? '') || null,
                active: form.get('active') === 'on',
              }
              run(() => saveInfoPage(propertyId, input), () => (setAdding(false), setEditing(null)))
            }}
          >
            <div className="grid gap-3.5 sm:grid-cols-[1fr_7rem]">
              <Field label="Title" name="title" defaultValue={editing?.title} required autoFocus placeholder="Wi-Fi" />
              <Field label="Icon" name="icon" defaultValue={editing?.icon ?? ''} placeholder="📶" />
            </div>
            <Field
              label="Address in links"
              name="slug"
              defaultValue={editing?.slug ?? ''}
              placeholder="wifi"
              hint="Leave blank and it is generated from the title."
            />
            <TextArea
              label="What the guest reads"
              name="body"
              defaultValue={editing?.body}
              rows={10}
              hint="Plain text. Line breaks are kept exactly as you type them."
            />
            <div className="border-line rounded-xl border px-3.5 py-2">
              <Check label="Show this page to guests" name="active" defaultChecked={editing?.active ?? true} />
            </div>
            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Add page'}
            </Button>
          </form>
        </Modal>
      )}

      {confirming && (
        <Confirm
          title={`Delete ${confirming.title}?`}
          body="Guests will no longer see this page. If you only want to take it down temporarily, edit it and untick “Show this page to guests” instead."
          confirmLabel="Delete"
          onConfirm={() => run(() => deleteInfoPage(confirming.id))}
          onClose={() => setConfirming(null)}
        />
      )}
    </Panel>
  )
}
