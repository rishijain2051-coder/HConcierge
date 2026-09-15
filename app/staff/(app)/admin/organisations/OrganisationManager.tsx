'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { OrganisationRow } from '@/lib/organisations'
import { createOrganisation, enterOrganisation, updateOrganisation } from '../actions'
import { Button, Err, Field, Modal, Panel, PasswordOnce } from '../../ui'

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

export default function OrganisationManager({ organisations }: { organisations: OrganisationRow[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<OrganisationRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<{ username: string; password: string } | null>(null)
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
      title="Organisations"
      description="Each customer is one organisation and owns its own properties, staff and data. Open one to manage its properties, staff, directory and escalation — you work inside a single customer at a time, never across them."
      action={
        <Button
          variant="primary"
          onClick={() => {
            setNameDraft('')
            setAdding(true)
          }}
        >
          + Onboard a customer
        </Button>
      }
    >
      {error && <div className="mb-3">{<Err>{error}</Err>}</div>}

      <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
        {organisations.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
            <div className="min-w-[14rem] flex-1">
              <p className="text-[14px] font-semibold">{o.name}</p>
              <p className="text-faint text-[12px]">/{o.slug}</p>
            </div>
            <p className="text-muted min-w-[15rem] text-[12px] tabular-nums">
              {o.properties} propert{o.properties === 1 ? 'y' : 'ies'} · {o.rooms} rooms · {o.staff} staff
            </p>
            <div className="flex shrink-0 gap-1.5">
              <Button onClick={() => setEditing(o)}>Rename</Button>
              <Button
                variant="primary"
                onClick={() =>
                  run(() => enterOrganisation(o.id), () => router.push('/staff/admin'))
                }
              >
                Open
              </Button>
            </div>
          </div>
        ))}
        {organisations.length === 0 && (
          <p className="text-faint px-4 py-12 text-center text-sm">No customers yet.</p>
        )}
      </div>

      {adding && (
        <Modal wide title="Onboard a customer" onClose={() => setAdding(false)}>
          <form
            className="space-y-3.5"
            action={(form) => {
              const adminUsername = String(form.get('adminUsername') ?? '')
              run(
                async () => {
                  const res = await createOrganisation({
                    name: String(form.get('name') ?? ''),
                    slug: String(form.get('slug') ?? ''),
                    adminName: String(form.get('adminName') ?? ''),
                    adminUsername,
                  })
                  if (res.ok) setShown({ username: adminUsername.toLowerCase(), password: res.password })
                  return res
                },
                () => setAdding(false),
              )
            }}
          >
            <div className="grid gap-3.5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium">Company name</span>
                <input
                  name="name"
                  required
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="RN Hospitality"
                  className="border-line bg-surface focus:border-ink placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-[14px] outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium">Short name</span>
                <input
                  name="slug"
                  required
                  key={slugify(nameDraft)}
                  defaultValue={slugify(nameDraft)}
                  placeholder="rn-hospitality"
                  className="border-line bg-surface focus:border-ink placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-[14px] outline-none"
                />
                <span className="text-faint mt-1 block text-[11px]">Lowercase, numbers and dashes. Permanent.</span>
              </label>
            </div>

            <div className="border-line rounded-xl border p-3.5">
              <p className="mb-3 text-[13px] font-semibold">Their first admin</p>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Full name" name="adminName" required placeholder="Priya Deshmukh" />
                <Field
                  label="Username"
                  name="adminUsername"
                  required
                  placeholder="rn.admin"
                  hint="Permanent."
                />
              </div>
              <p className="text-faint mt-2.5 text-[12px] leading-relaxed">
                This is the only account HConcierge creates for them. Everyone else is theirs to add, from their own
                Staff screen. You will get a one-time password to hand over.
              </p>
            </div>

            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Creating…' : 'Create organisation'}
            </Button>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title={`Rename ${editing.name}`} onClose={() => setEditing(null)}>
          <form
            className="space-y-3.5"
            action={(form) =>
              run(() => updateOrganisation(editing.id, String(form.get('name') ?? '')), () => setEditing(null))
            }
          >
            <Field label="Company name" name="name" defaultValue={editing.name} required autoFocus />
            <p className="text-faint text-[12px]">
              The short name <span className="text-ink font-medium">/{editing.slug}</span> cannot change — other
              things point at it.
            </p>
            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </form>
        </Modal>
      )}

      {shown && <PasswordOnce username={shown.username} password={shown.password} onClose={() => setShown(null)} />}
    </Panel>
  )
}
