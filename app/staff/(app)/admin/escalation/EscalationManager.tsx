'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { APPLIES_TO_LABEL, DEPARTMENTS, departmentLabel, type AppliesTo, type EscalationRule } from '@/lib/types'
import { deleteEscalationRule, saveEscalationRule, setWarnThreshold } from '../actions'
import { Button, Check, Confirm, Err, Field, Modal, Panel, Select, Tag } from '../ui'

type Candidate = { id: string; name: string; role: string; department: string; phone: string | null }

const APPLIES_OPTIONS = (Object.keys(APPLIES_TO_LABEL) as AppliesTo[]).map((v) => ({
  value: v,
  label: APPLIES_TO_LABEL[v],
}))

/** "the moment it misses its target" reads better than "0 minutes late". */
function lateness(min: number) {
  if (min === 0) return 'the moment it misses its target'
  if (min < 60) return `${min} min past the target`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `${h}h ${rest}m past the target` : `${h}h past the target`
}

export default function EscalationManager({
  propertyId,
  properties,
  rules,
  candidates,
  warnAt,
}: {
  propertyId: string
  properties: { id: string; name: string }[]
  rules: EscalationRule[]
  candidates: Candidate[]
  warnAt: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<EscalationRule | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<EscalationRule | null>(null)

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

  const withPhone = candidates.filter((c) => c.phone)
  const nextStep = rules.length ? Math.max(...rules.map((r) => r.step)) + 1 : 1

  return (
    <Panel
      title="Escalation"
      description="Who gets told when a request runs late, and how long HConcierge waits before telling them. Each rung fires once per request; a request that passes two rungs unnoticed jumps straight to the higher one."
      action={
        <div className="flex gap-2">
          {properties.length > 1 && (
            <select
              value={propertyId}
              onChange={(e) => router.push(`/staff/admin/escalation?property=${e.target.value}`)}
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
            + Add a rung
          </Button>
        </div>
      }
    >
      {error && <div className="mb-3">{<Err>{error}</Err>}</div>}

      {withPhone.length === 0 && (
        <div className="bg-warn-soft text-warn mb-4 rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed">
          Nobody at this property has a phone number, so no escalation can actually be delivered. Add one under
          Staff → Edit → Phone.
        </div>
      )}

      <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
        {rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5">
            <span className="bg-paper text-muted grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-semibold tabular-nums">
              {r.step}
            </span>

            <div className="min-w-[16rem] flex-1">
              <p className="text-[14px] leading-snug">
                <span className="font-semibold">{lateness(r.after_minutes)}</span>
                <span className="text-muted">
                  {' '}
                  — {r.department ? departmentLabel(r.department) : 'any team'}, when{' '}
                  {APPLIES_TO_LABEL[r.applies_to].toLowerCase()}
                </span>
              </p>
              <p className="text-faint mt-1 text-[12px]">
                tells{' '}
                {[
                  r.notify_managers && 'the duty managers',
                  r.notify_admins && 'the admins',
                  ...r.staff.map((s) => s.name + (s.phone ? '' : ' (no phone)')),
                ]
                  .filter(Boolean)
                  .join(', ') || 'nobody'}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {!r.active && <Tag tone="late">Off</Tag>}
              <Button onClick={() => setEditing(r)}>Edit</Button>
              <Button variant="danger" onClick={() => setConfirming(r)}>
                Delete
              </Button>
            </div>
          </div>
        ))}

        {rules.length === 0 && (
          <p className="text-faint px-4 py-12 text-center text-sm">
            No rungs yet — nothing will ever escalate at this property.
          </p>
        )}
      </div>

      <div className="bg-surface border-line mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3.5">
        <div>
          <p className="text-[14px] font-semibold">Turn cards amber at</p>
          <p className="text-muted mt-0.5 text-[12px]">
            A share of each request&rsquo;s own target, so the board warns before anything is actually late.
          </p>
        </div>
        <form
          action={(form) =>
            run(() => setWarnThreshold(propertyId, Number(form.get('percent'))))
          }
          className="flex items-end gap-2"
        >
          <label className="block">
            <span className="sr-only">Amber threshold percentage</span>
            <input
              name="percent"
              type="number"
              min={10}
              max={100}
              step={5}
              defaultValue={warnAt}
              className="border-line bg-surface w-20 rounded-xl border px-3 py-2 text-[14px] tabular-nums outline-none"
            />
          </label>
          <span className="text-muted pb-2 text-[13px]">% of target</span>
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        </form>
      </div>

      {(adding || editing) && (
        <Modal
          wide
          title={editing ? `Rung ${editing.step}` : 'Add a rung'}
          onClose={() => (setAdding(false), setEditing(null))}
        >
          <form
            className="space-y-3.5"
            action={(form) => {
              const input = {
                id: editing?.id ?? null,
                department: String(form.get('department') ?? '') || null,
                step: Number(form.get('step')),
                afterMinutes: Number(form.get('after')),
                appliesTo: String(form.get('applies') ?? 'unaccepted') as AppliesTo,
                notifyManagers: form.get('managers') === 'on',
                notifyAdmins: form.get('admins') === 'on',
                active: form.get('active') === 'on',
                staffIds: form.getAll('staff').map(String),
              }
              run(() => saveEscalationRule(propertyId, input), () => (setAdding(false), setEditing(null)))
            }}
          >
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field
                label="Step"
                name="step"
                type="number"
                min={1}
                max={9}
                defaultValue={editing?.step ?? nextStep}
                hint="Rungs fire in order. Higher steps are later and usually wider."
              />
              <Field
                label="Minutes past the target"
                name="after"
                type="number"
                min={0}
                max={1440}
                defaultValue={editing?.after_minutes ?? 0}
                hint="0 fires the moment a request misses its own target."
              />
            </div>

            <Select
              label="Which team"
              name="department"
              defaultValue={editing?.department ?? ''}
              options={[
                { value: '', label: 'Any team' },
                ...DEPARTMENTS.map((d) => ({ value: d.value, label: d.label })),
              ]}
            />

            <Select
              label="Only when"
              name="applies"
              defaultValue={editing?.applies_to ?? 'unaccepted'}
              options={APPLIES_OPTIONS}
              hint="“Nobody has accepted it” catches a request being ignored; “accepted but not finished” catches one being sat on."
            />

            <div className="border-line rounded-xl border px-3.5 py-2">
              <p className="text-muted mb-1 text-[12px] font-semibold">Tell these groups</p>
              <Check label="The duty managers at this property" name="managers" defaultChecked={editing?.notify_managers ?? true} />
              <Check label="The organisation’s admins" name="admins" defaultChecked={editing?.notify_admins ?? false} />
            </div>

            <div className="border-line rounded-xl border px-3.5 py-2">
              <p className="text-muted mb-1 text-[12px] font-semibold">And these people by name</p>
              {candidates.length === 0 ? (
                <p className="text-faint py-2 text-[13px]">Nobody at this property yet.</p>
              ) : (
                <div className="max-h-44 overflow-y-auto">
                  {candidates.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2.5 py-1">
                      <input
                        type="checkbox"
                        name="staff"
                        value={c.id}
                        defaultChecked={editing?.staff.some((s) => s.id === c.id)}
                        className="accent-ink h-4 w-4 rounded"
                      />
                      <span className="text-[14px]">
                        {c.name}
                        <span className="text-faint"> · {departmentLabel(c.department)}</span>
                        {!c.phone && <span className="text-warn text-[12px]"> · no phone</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="border-line rounded-xl border px-3.5 py-2">
              <Check label="This rung is active" name="active" defaultChecked={editing?.active ?? true} />
            </div>

            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save rung' : 'Add rung'}
            </Button>
          </form>
        </Modal>
      )}

      {confirming && (
        <Confirm
          title={`Delete rung ${confirming.step}?`}
          body="Requests that already fired this rung keep their history. Nothing will escalate at this point again."
          confirmLabel="Delete"
          onConfirm={() => run(() => deleteEscalationRule(confirming.id))}
          onClose={() => setConfirming(null)}
        />
      )}
    </Panel>
  )
}
