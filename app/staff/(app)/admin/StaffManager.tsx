'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { DEPARTMENTS, departmentLabel } from '@/lib/types'
import type { StaffRow } from '@/lib/admin'
import { createStaff, resetStaffPassword, setStaffActive, unlockStaff, updateStaff } from './actions'
import { Button, Confirm, Err, Field, Modal, Panel, PasswordOnce, Select, Tag } from './ui'

type Me = { id: string; role: string; propertyId: string | null }
type Property = { id: string; name: string }

const ROLES = [
  { value: 'staff', label: 'Staff — one department’s board' },
  { value: 'manager', label: 'Manager — the whole property, gets escalations' },
  { value: 'admin', label: 'Admin — every property in this organisation' },
  { value: 'platform', label: 'HConcierge — every organisation' },
]

/** Nobody may mint a role at or above their own. */
const ASSIGNABLE: Record<string, string[]> = {
  platform: ['staff', 'manager', 'admin', 'platform'],
  admin: ['staff', 'manager'],
  manager: ['staff'],
}

const DEPT_OPTIONS = [
  ...DEPARTMENTS.map((d) => ({ value: d.value, label: d.label })),
  { value: 'all', label: 'All departments' },
]

export default function StaffManager({
  me,
  staff,
  properties,
}: {
  me: Me
  staff: StaffRow[]
  properties: Property[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<{ username: string; password: string } | null>(null)
  const [confirming, setConfirming] = useState<StaffRow | null>(null)

  const allowed = ASSIGNABLE[me.role] ?? ['staff']
  const roleOptions = ROLES.filter((r) => allowed.includes(r.value))

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
      title="Staff"
      description="Who can sign in, what they see, and how to get them back in when they are locked out. New accounts and resets both produce a one-time password that is shown once."
      action={
        <Button variant="primary" onClick={() => setAdding(true)}>
          + Add someone
        </Button>
      }
    >
      {error && <div className="mb-3">{<Err>{error}</Err>}</div>}

      <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
        {staff.map((s) => {
          const locked = s.locked_until && new Date(s.locked_until) > new Date()
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-[12rem] flex-1">
                <p className="text-[14px] font-semibold">
                  {s.name}
                  {s.id === me.id && <span className="text-faint ml-2 text-[11px] font-normal">you</span>}
                </p>
                <p className="text-faint text-[12px]">
                  {s.username} ·{' '}
                  {s.role === 'platform'
                    ? 'every organisation'
                    : (s.property_name ?? s.organisation_name ?? 'All properties')}
                </p>
              </div>

              <div className="flex min-w-[13rem] flex-wrap items-center gap-1.5">
                <Tag>
                  {s.role === 'platform'
                    ? 'HConcierge'
                    : s.role === 'admin'
                      ? 'Admin'
                      : s.role === 'manager'
                        ? 'Manager'
                        : 'Staff'}
                </Tag>
                <Tag>{departmentLabel(s.department)}</Tag>
                {!s.active && <Tag tone="late">Deactivated</Tag>}
                {locked && <Tag tone="late">Locked</Tag>}
                {!s.last_login_at && s.active && <Tag>Never signed in</Tag>}
              </div>

              <div className="flex shrink-0 flex-wrap gap-1.5">
                <Button onClick={() => setEditing(s)}>Edit</Button>
                <Button
                  onClick={() =>
                    run(async () => {
                      const res = await resetStaffPassword(s.id)
                      if (res.ok) setShown({ username: s.username, password: res.password })
                      return res
                    })
                  }
                  disabled={pending}
                >
                  Reset password
                </Button>
                {locked && (
                  <Button onClick={() => run(() => unlockStaff(s.id))} disabled={pending}>
                    Unlock
                  </Button>
                )}
                {s.active ? (
                  <Button variant="danger" onClick={() => setConfirming(s)} disabled={pending || s.id === me.id}>
                    Deactivate
                  </Button>
                ) : (
                  <Button onClick={() => run(() => setStaffActive(s.id, true))} disabled={pending}>
                    Reactivate
                  </Button>
                )}
              </div>
            </div>
          )
        })}

        {staff.length === 0 && <p className="text-faint px-4 py-12 text-center text-sm">Nobody yet.</p>}
      </div>

      <p className="text-faint mt-3 text-[12px] leading-relaxed">
        Deactivating signs someone out immediately — the session is checked against this table on every request, not
        just at login. Accounts are never deleted, so their name stays readable on the requests they handled.
      </p>

      {(adding || editing) && (
        <Modal title={editing ? `Edit ${editing.name}` : 'Add someone'} onClose={() => (setAdding(false), setEditing(null))}>
          <form
            className="space-y-3.5"
            action={(form) => {
              const input = {
                name: String(form.get('name') ?? ''),
                role: String(form.get('role') ?? 'staff') as 'staff' | 'manager' | 'admin' | 'platform',
                department: String(form.get('department') ?? 'front_desk') as never,
                propertyId: String(form.get('propertyId') ?? '') || me.propertyId,
                phone: String(form.get('phone') ?? '') || null,
              }
              if (editing) {
                run(() => updateStaff(editing.id, input), () => setEditing(null))
              } else {
                run(
                  async () => {
                    const username = String(form.get('username') ?? '')
                    const res = await createStaff({ ...input, username })
                    if (res.ok) setShown({ username: username.toLowerCase(), password: res.password })
                    return res
                  },
                  () => setAdding(false),
                )
              }
            }}
          >
            <Field label="Full name" name="name" defaultValue={editing?.name} required autoFocus placeholder="Sunita Rao" />
            {!editing && (
              <Field
                label="Username"
                name="username"
                required
                placeholder="pune.housekeeping"
                hint="Lowercase letters, numbers, dot, dash or underscore. This cannot be changed later."
              />
            )}
            <Select label="Role" name="role" defaultValue={editing?.role ?? 'staff'} options={roleOptions} />
            <Select
              label="Team"
              name="department"
              defaultValue={editing?.department ?? 'front_desk'}
              options={DEPT_OPTIONS}
              hint="A staff account only sees this team's requests. Managers and admins see everything."
            />
            {me.role === 'admin' && properties.length > 0 && (
              <Select
                label="Property"
                name="propertyId"
                defaultValue={editing?.property_id ?? properties[0]?.id}
                options={properties.map((p) => ({ value: p.id, label: p.name }))}
                hint="Ignored for admins, who work across every property."
              />
            )}
            <Field
              label="Phone (optional)"
              name="phone"
              defaultValue={editing?.phone ?? ''}
              placeholder="+91 98765 43210"
              hint="Managers and admins with a number here receive the WhatsApp escalations."
            />

            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
            </Button>
          </form>
        </Modal>
      )}

      {shown && (
        <PasswordOnce username={shown.username} password={shown.password} onClose={() => setShown(null)} />
      )}

      {confirming && (
        <Confirm
          title={`Deactivate ${confirming.name}?`}
          body={`${confirming.username} will be signed out immediately and will not be able to sign back in. You can reactivate the account at any time.`}
          confirmLabel="Deactivate"
          onConfirm={() => run(() => setStaffActive(confirming.id, false))}
          onClose={() => setConfirming(null)}
        />
      )}
    </Panel>
  )
}
