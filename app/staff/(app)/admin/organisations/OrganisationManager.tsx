'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { OrganisationRow } from '@/lib/organisations'
import {
  createOrganisation,
  deleteOrganisation,
  enterOrganisation,
  offboardingSummary,
  suspendOrganisation,
  updateOrganisation,
} from '../actions'
import type { Offboarding } from '@/lib/organisations'
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
  // Off-boarding is a two-stage thing, so the dialog holds both the counts it
  // is about to destroy and what the operator has typed to confirm them.
  const [offboarding, setOffboarding] = useState<{ id: string; summary: Offboarding } | null>(null)
  const [typed, setTyped] = useState('')

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
      description="Each customer is one organisation and owns its own properties, staff and data. Open one to manage its properties, staff, directory and escalation - you work inside a single customer at a time, never across them."
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
              <p className="text-[14px] font-semibold">
                {o.name}
                {o.suspended_at && <span className="text-late ml-2 text-[11px] font-semibold">Suspended</span>}
              </p>
              <p className="text-faint text-[12px]">
                /{o.slug}
                {o.suspended_at && ' · nobody here can sign in and no guest link opens'}
              </p>
            </div>
            <p className="text-muted min-w-[15rem] text-[12px] tabular-nums">
              {o.properties} propert{o.properties === 1 ? 'y' : 'ies'} · {o.rooms} rooms · {o.staff} staff
            </p>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <Button onClick={() => setEditing(o)}>Rename</Button>
              {o.suspended_at ? (
                <Button onClick={() => run(() => suspendOrganisation(o.id, false))} disabled={pending}>
                  Restore
                </Button>
              ) : (
                <Button variant="danger" onClick={() => run(() => suspendOrganisation(o.id, true))} disabled={pending}>
                  Suspend
                </Button>
              )}
              {/* Only offered once suspended. lib/organisations refuses it
                  otherwise too - this just stops the button being a question
                  the operator has to be told the answer to. */}
              {o.suspended_at && (
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const summary = await offboardingSummary(o.id)
                      if (summary) {
                        setTyped('')
                        setOffboarding({ id: o.id, summary })
                      }
                    })
                  }
                >
                  Off-board
                </Button>
              )}
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

      {/* The whole point of this dialog is that "delete this organisation" is
          not a sentence anybody can consent to without knowing whether it means
          an empty test tenant or a hotel with guests in it. So it counts, and
          then it asks for the name in full. */}
      {offboarding && (
        <Modal wide title={`Off-board ${offboarding.summary.name}`} onClose={() => setOffboarding(null)}>
          <p className="text-muted text-[14px] leading-relaxed">
            This deletes the customer and everything of theirs, for good. There is no undo and no export - take
            anything they are owed out first.
          </p>

          <div className="border-line divide-line mt-4 divide-y overflow-hidden rounded-xl border">
            {(
              [
                ['Properties', offboarding.summary.properties],
                ['Rooms', offboarding.summary.rooms],
                ['Staff accounts', offboarding.summary.staff],
                ['Directory items', offboarding.summary.items],
                ['Requests, all of their history', offboarding.summary.requests],
                ['Guest messages', offboarding.summary.messages],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="flex justify-between px-3.5 py-2 text-[13px]">
                <span className="text-muted">{label}</span>
                <span className="font-semibold tabular-nums">{n}</span>
              </div>
            ))}
          </div>

          {offboarding.summary.occupied > 0 && (
            <div className="mt-3">
              <Err>
                {offboarding.summary.occupied} room{offboarding.summary.occupied === 1 ? ' is' : 's are'} still
                occupied. Those guests lose access the moment this completes.
              </Err>
            </div>
          )}

          {offboarding.summary.unsettled_paise > 0 && (
            <div className="mt-3">
              <Err>
                ₹{(offboarding.summary.unsettled_paise / 100).toFixed(2)} is outstanding on their rooms. This will be
                refused until it is settled or voided - deleting now destroys the only record of it.
              </Err>
            </div>
          )}

          <div className="mt-4">
            <Field
              label={`Type “${offboarding.summary.name}” to confirm`}
              name="confirm"
              value={typed}
              onChange={setTyped}
              autoFocus
              placeholder={offboarding.summary.name}
            />
          </div>

          <div className="mt-5 flex gap-2">
            <Button full onClick={() => setOffboarding(null)}>
              Keep it
            </Button>
            <Button
              full
              variant="danger"
              disabled={pending || typed.trim() !== offboarding.summary.name}
              onClick={() =>
                run(
                  () => deleteOrganisation(offboarding.id, typed),
                  () => setOffboarding(null),
                )
              }
            >
              {pending ? 'Deleting…' : 'Delete for good'}
            </Button>
          </div>
        </Modal>
      )}

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
                  placeholder="Lakeview Hotels"
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
              The short name <span className="text-ink font-medium">/{editing.slug}</span> cannot change - other
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
