'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { teamLabel } from '@/lib/types'
import type { StaffRow } from '@/lib/admin'
import {
  createStaff,
  deleteStaff,
  resetStaffPassword,
  sendPhoneCode,
  setStaffActive,
  unlockStaff,
  updateStaff,
} from './actions'
import { Button, Check, Confirm, Err, Field, Modal, Panel, PasswordOnce, Select, Tag } from '../ui'

type Me = { id: string; role: string; propertyId: string | null }
type Property = { id: string; name: string }

const ROLES = [
  { value: 'staff', label: 'Staff: one department’s board' },
  { value: 'manager', label: 'Manager: the whole property, gets escalations' },
  { value: 'admin', label: 'Admin: every property in this organisation' },
  { value: 'platform', label: 'HConcierge: every organisation' },
]

/**
 * Nobody may mint a role at or above their own. HConcierge reaches this screen
 * only from inside a customer, so it staffs that customer - a new platform
 * account comes from `npm run db:platform`, not from a hotel's staff list.
 */
const ASSIGNABLE: Record<string, string[]> = {
  platform: ['staff', 'manager', 'admin'],
  admin: ['staff', 'manager'],
  manager: ['staff'],
}

type Opt = { value: string; label: string }

export default function StaffManager({
  me,
  staff,
  properties,
  teams,
}: {
  me: Me
  staff: StaffRow[]
  properties: Property[]
  teams: Opt[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<{ username: string; password: string } | null>(null)
  const [confirming, setConfirming] = useState<StaffRow | null>(null)
  const [deleting, setDeleting] = useState<StaffRow | null>(null)
  // Only a department account can cover extra teams - a manager and an admin
  // already see all of them - so the form has to know which role is selected,
  // not only which one it opened with.
  const [role, setRole] = useState<string>('staff')

  // Whoever you are editing keeps their own role as an option, even if you
  // could not grant it. Without this, an admin editing an admin saw a select
  // with no "admin" in it, and saving quietly demoted them to staff.
  // Deleting is not a manager's to do - they can deactivate, which is the
  // reversible half of the same idea. lib/admin says the same thing again.
  const canDelete = me.role === 'admin' || me.role === 'platform'

  const allowed = ASSIGNABLE[me.role] ?? ['staff']
  const roleOptions = ROLES.filter(
    (r) => allowed.includes(r.value) || r.value === editing?.role,
  )

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
        <Button
          variant="primary"
          onClick={() => {
            setRole('staff')
            setAdding(true)
          }}
        >
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
                <Tag>{teamLabel(teams, s.department)}</Tag>
                {s.extra_teams?.map((t) => (
                  <Tag key={t}>{teamLabel(teams, t)}</Tag>
                ))}
                {!s.active && <Tag tone="late">Deactivated</Tag>}
                {locked && <Tag tone="late">Locked</Tag>}
                {!s.last_login_at && s.active && <Tag>Never signed in</Tag>}
                {/* Why one person gets tappable job links and another does not.
                    Without this on the row, an unverified number looks like a
                    broken feature rather than a step nobody has done yet. */}
                {s.phone && (s.phone_verified_at ? <Tag tone="ok">Phone verified</Tag> : <Tag tone="warn">Phone unverified</Tag>)}
              </div>

              <div className="flex shrink-0 flex-wrap gap-1.5">
                <Button
                  onClick={() => {
                    setRole(s.role)
                    setEditing(s)
                  }}
                >
                  Edit
                </Button>
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
                {s.phone && !s.phone_verified_at && (
                  <Button onClick={() => run(() => sendPhoneCode(s.id))} disabled={pending}>
                    Send phone code
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
                {canDelete && (
                  <Button variant="danger" onClick={() => setDeleting(s)} disabled={pending || s.id === me.id}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
          )
        })}

        {staff.length === 0 && <p className="text-faint px-4 py-12 text-center text-sm">Nobody yet.</p>}
      </div>

      <p className="text-faint mt-3 text-[12px] leading-relaxed">
        Deactivating signs someone out immediately - the session is checked against this table on every request, not
        just at login - and keeps their name readable on the requests they handled. Deleting removes the account for
        good: the work stays on record, but their name comes off it.
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
                extraTeams: form.getAll('extraTeams').map(String),
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
            <Select
              label="Role"
              name="role"
              defaultValue={editing?.role ?? 'staff'}
              options={roleOptions}
              onChange={setRole}
            />
            <Select
              label="Team"
              name="department"
              defaultValue={editing?.department ?? teams[0]?.value ?? 'front_desk'}
              options={[...teams, { value: 'all', label: 'All teams' }]}
              // Role-aware because this field means two different things. For a
              // staff account it scopes the board. For anyone above that it
              // scopes nothing - teamsVisibleTo() returns unscoped for every
              // non-staff role - and only decides which new-request alerts they
              // get. An admin moving a duty manager onto one team could
              // reasonably fear they were taking the rest of the property away
              // from them; they are not, and nothing here used to say so.
              hint={
                role === 'staff'
                  ? "This account's board shows this team. “All teams” is for someone who genuinely works all of them."
                  : 'They see every team’s board whatever this says. It only picks which new-request alerts they get - lateness still reaches them through escalation.'
              }
            />

            {/* The head of housekeeping who also runs the laundry used to have
                to choose which half of the job the software knew about, or be
                promoted to manager and handed the whole property. */}
            {role === 'staff' && teams.length > 1 && (
              <div>
                <p className="mb-1.5 text-[13px] font-medium">Also covers</p>
                <div className="border-line rounded-xl border px-3.5 py-2">
                  {teams.map((t) => (
                    <Check
                      key={t.value}
                      label={t.label}
                      name="extraTeams"
                      value={t.value}
                      defaultChecked={editing?.extra_teams?.includes(t.value)}
                    />
                  ))}
                </div>
                <p className="text-faint mt-1 block text-[11px]">
                  Their board shows these teams as well as their own. Ticking their own team changes nothing.
                </p>
              </div>
            )}
            {!me.propertyId && properties.length > 0 && (
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
              hint="Managers and admins with a number here receive the WhatsApp escalations. A number has to be verified before its messages carry one-tap job links - changing it here clears that."
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

      {deleting && (
        <Confirm
          title={`Delete ${deleting.name}?`}
          body={`${deleting.username} is removed for good and cannot be reactivated. The requests they handled and the messages they sent stay on record, but stop carrying their name, and they come off any escalation rule that paged them. Deactivate instead if you want their name kept on their work.`}
          confirmLabel="Delete permanently"
          onConfirm={() => run(() => deleteStaff(deleting.id))}
          onClose={() => setDeleting(null)}
        />
      )}
    </Panel>
  )
}
