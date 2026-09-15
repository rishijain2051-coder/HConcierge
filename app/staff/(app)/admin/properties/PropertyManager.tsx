'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { PropertyRow } from '@/lib/admin'
import { createProperty, updateProperty } from '../actions'
import { Button, Err, Field, Modal, Panel, Select } from '../../ui'

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
].map((t) => ({ value: t, label: t }))

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

export default function PropertyManager({ properties }: { properties: PropertyRow[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<PropertyRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')

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
      title="Properties"
      description="Each hotel keeps its own rooms, directory, staff and branding. A new one can start from a copy of an existing directory, which is the difference between onboarding in minutes and an afternoon of typing."
      action={
        <Button
          variant="primary"
          onClick={() => {
            setNameDraft('')
            setAdding(true)
          }}
        >
          + Add a property
        </Button>
      }
    >
      {error && <div className="mb-3">{<Err>{error}</Err>}</div>}

      <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
        {properties.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
            <span
              aria-hidden="true"
              className="h-8 w-8 shrink-0 rounded-lg"
              style={{ backgroundColor: p.brand_color }}
            />
            <div className="min-w-[14rem] flex-1">
              <p className="text-[14px] font-semibold">{p.name}</p>
              <p className="text-faint text-[12px]">
                {p.address ?? 'No address'} · /{p.slug}
              </p>
            </div>
            <p className="text-muted min-w-[13rem] text-[12px] tabular-nums">
              {p.rooms} rooms · {p.staff} staff · {p.items} directory items
            </p>
            <Button onClick={() => setEditing(p)}>Edit</Button>
          </div>
        ))}
        {properties.length === 0 && <p className="text-faint px-4 py-12 text-center text-sm">No properties yet.</p>}
      </div>

      {(adding || editing) && (
        <Modal
          wide
          title={editing ? `Edit ${editing.name}` : 'Add a property'}
          onClose={() => (setAdding(false), setEditing(null))}
        >
          <form
            className="space-y-3.5"
            action={(form) => {
              const input = {
                name: String(form.get('name') ?? ''),
                slug: String(form.get('slug') ?? ''),
                address: String(form.get('address') ?? '') || null,
                phone: String(form.get('phone') ?? '') || null,
                brandColor: String(form.get('brandColor') ?? '#0F766E'),
                timezone: String(form.get('timezone') ?? 'Asia/Kolkata'),
              }
              if (editing) run(() => updateProperty(editing.id, input), () => setEditing(null))
              else {
                const copyFrom = String(form.get('copyFrom') ?? '') || null
                run(() => createProperty(input, copyFrom), () => setAdding(false))
              }
            }}
          >
            <div className="grid gap-3.5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium">Hotel name</span>
                <input
                  name="name"
                  required
                  autoFocus
                  defaultValue={editing?.name}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="RN Grand, Pune"
                  className="border-line bg-surface focus:border-ink placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-[14px] outline-none"
                />
              </label>
              {editing ? (
                <Field label="Address" name="address" defaultValue={editing.address ?? ''} placeholder="Koregaon Park, Pune" />
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">Address in links</span>
                  <input
                    name="slug"
                    required
                    key={slugify(nameDraft)}
                    defaultValue={slugify(nameDraft)}
                    placeholder="rn-grand-pune"
                    className="border-line bg-surface focus:border-ink placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-[14px] outline-none"
                  />
                  <span className="text-faint mt-1 block text-[11px]">
                    Lowercase letters, numbers and dashes. Cannot be changed later.
                  </span>
                </label>
              )}
            </div>

            {!editing && <Field label="Address" name="address" placeholder="Koregaon Park, Pune 411001" />}

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field
                label="Front desk phone"
                name="phone"
                defaultValue={editing?.phone ?? ''}
                placeholder="+91 20 4000 1000"
                hint="Shown to guests who would still rather call."
              />
              <Select
                label="Timezone"
                name="timezone"
                defaultValue={editing?.timezone ?? 'Asia/Kolkata'}
                options={TIMEZONES}
              />
            </div>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Brand colour</span>
              <div className="flex gap-2">
                <input
                  name="brandColor"
                  type="color"
                  defaultValue={editing?.brand_color ?? '#0F766E'}
                  className="border-line h-[42px] w-16 shrink-0 cursor-pointer rounded-xl border bg-transparent p-1"
                />
                <span className="text-faint self-center text-[11px] leading-relaxed">
                  Used on the guest screens and the printed QR cards for this hotel.
                </span>
              </div>
            </label>

            {!editing && properties.length > 0 && (
              <Select
                label="Start the directory from"
                name="copyFrom"
                options={[
                  { value: '', label: 'Empty — I will add everything myself' },
                  ...properties.map((p) => ({ value: p.id, label: `Copy ${p.name} (${p.items} items)` })),
                ]}
                hint="Copies every section, item, price, target time and hotel info page. You can edit it all afterwards."
              />
            )}

            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Create property'}
            </Button>
          </form>
        </Modal>
      )}
    </Panel>
  )
}
