'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { departmentLabel, type AppliesTo, type EscalationRule } from '@/lib/types'
import { deleteEscalationRule, saveEscalationRule, setWarnThreshold } from '../actions'
import { Button, Check, Confirm, Err, Modal, Panel, Select } from '../../ui'

type Candidate = { id: string; name: string; role: string; department: string; phone: string | null }

/** "As soon as it is late" beats "0 minutes past the target". */
function lateness(min: number) {
  if (min === 0) return 'As soon as it is late'
  if (min < 60) return `${min} minutes late`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `${h}h ${rest}m late` : h === 1 ? 'An hour late' : `${h} hours late`
}

/** The list of who a step tells, as something you would say out loud. */
function tells(r: EscalationRule) {
  const names = [
    r.notify_managers && 'the duty managers',
    r.notify_admins && 'the admins',
    ...r.staff.map((s) => (s.phone ? s.name : `${s.name} (no phone)`)),
  ].filter(Boolean) as string[]
  if (names.length === 0) return 'nobody'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export default function EscalationManager({
  propertyId,
  properties,
  rules,
  candidates,
  warnAt,
  teams,
}: {
  propertyId: string
  properties: { id: string; name: string }[]
  rules: EscalationRule[]
  candidates: Candidate[]
  warnAt: number
  teams: { value: string; label: string }[]
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

  const open = adding || editing
  const nobodyHasAPhone = candidates.every((c) => !c.phone)

  return (
    <Panel
      title="When something runs late"
      description="Every request promises a time - ten minutes for towels, forty for a biryani. If it passes that, HConcierge tells someone. Set up who, and how long it waits first."
      action={
        <div className="flex flex-wrap gap-2">
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
            + Tell someone else
          </Button>
        </div>
      }
    >
      {error && <div className="mb-3">{<Err>{error}</Err>}</div>}

      {nobodyHasAPhone && candidates.length > 0 && (
        <div className="bg-warn-soft text-warn mb-4 rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed">
          Nobody here has a phone number, so none of this can actually be delivered. Add one under Staff → Edit →
          Phone.
        </div>
      )}

      <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
        {rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
            <div className="min-w-[18rem] flex-1">
              <p className="text-[15px] leading-snug">
                <span className="font-semibold">{lateness(r.after_minutes)}</span>
                <span className="text-muted">, tell </span>
                <span className="font-medium">{tells(r)}</span>
              </p>
              <p className="text-faint mt-1 text-[12px]">
                {r.department ? departmentLabel(r.department) + ' only' : 'Any team'}
                {r.applies_to === 'unaccepted' && ' · only if nobody has picked it up'}
                {r.applies_to === 'unfinished' && ' · only if it was picked up but not finished'}
                {!r.active && ' · turned off'}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button onClick={() => setEditing(r)}>Edit</Button>
              <Button variant="danger" onClick={() => setConfirming(r)}>
                Remove
              </Button>
            </div>
          </div>
        ))}

        {rules.length === 0 && (
          <p className="text-faint px-4 py-12 text-center text-sm">
            Nobody is told when anything runs late here.
          </p>
        )}
      </div>

      {rules.length > 1 && (
        <p className="text-faint mt-3 text-[12px] leading-relaxed">
          These happen in order, each one once. A request nobody touches for a long time goes straight to the last
          one rather than working through them.
        </p>
      )}

      <div className="bg-surface border-line mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3.5">
        <div>
          <p className="text-[14px] font-semibold">Warn the board early</p>
          <p className="text-muted mt-0.5 max-w-[46ch] text-[12px] leading-relaxed">
            Cards turn amber once this much of a request&rsquo;s promised time is gone, before it is actually late.
          </p>
        </div>
        <form action={(form) => run(() => setWarnThreshold(propertyId, Number(form.get('percent'))))} className="flex items-center gap-2">
          <label>
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
          <span className="text-muted text-[13px]">%</span>
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        </form>
      </div>

      {open && (
        <Modal
          title={editing ? 'Edit this step' : 'Tell someone when a request runs late'}
          onClose={() => (setAdding(false), setEditing(null))}
        >
          <form
            className="space-y-4"
            action={(form) => {
              const input = {
                id: editing?.id ?? null,
                department: String(form.get('department') ?? '') || null,
                afterMinutes: Number(form.get('after')),
                appliesTo: (form.get('unacceptedOnly') === 'on' ? 'unaccepted' : 'any') as AppliesTo,
                notifyManagers: form.get('managers') === 'on',
                notifyAdmins: form.get('admins') === 'on',
                active: form.get('active') === 'on',
                staffIds: form.getAll('staff').map(String),
              }
              run(() => saveEscalationRule(propertyId, input), () => (setAdding(false), setEditing(null)))
            }}
          >
            <div>
              <label htmlFor="after" className="mb-1.5 block text-[13px] font-medium">
                How long after it is late?
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="after"
                  name="after"
                  type="number"
                  min={0}
                  max={1440}
                  defaultValue={editing?.after_minutes ?? 0}
                  autoFocus
                  className="border-line bg-surface focus:border-ink w-24 rounded-xl border px-3.5 py-2.5 text-[14px] tabular-nums outline-none"
                />
                <span className="text-muted text-[14px]">minutes</span>
              </div>
              <p className="text-faint mt-1 text-[11px]">0 tells them the moment the promised time runs out.</p>
            </div>

            <div>
              <p className="mb-1.5 text-[13px] font-medium">Who should we tell?</p>
              <div className="border-line rounded-xl border px-3.5 py-2">
                <Check label="The duty managers here" name="managers" defaultChecked={editing?.notify_managers ?? true} />
                <Check label="The admins" name="admins" defaultChecked={editing?.notify_admins ?? false} />
                {candidates.length > 0 && (
                  <div className="border-line mt-1 max-h-40 overflow-y-auto border-t pt-1">
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
                          {!c.phone && <span className="text-warn"> · no phone</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Select
              label="Which requests?"
              name="department"
              defaultValue={editing?.department ?? ''}
              options={[
                { value: '', label: 'Any team' },
                ...teams.map((d) => ({ value: d.value, label: `${d.label} only` })),
              ]}
            />

            <div className="border-line rounded-xl border px-3.5 py-2">
              <Check
                label="Only if nobody has picked it up yet"
                name="unacceptedOnly"
                defaultChecked={(editing?.applies_to ?? 'unaccepted') === 'unaccepted'}
              />
              <Check label="This step is on" name="active" defaultChecked={editing?.active ?? true} />
            </div>

            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save' : 'Add it'}
            </Button>
          </form>
        </Modal>
      )}

      {confirming && (
        <Confirm
          title="Remove this step?"
          body={`Nobody will be told ${lateness(confirming.after_minutes).toLowerCase()} any more. Requests that already triggered it keep their history.`}
          confirmLabel="Remove"
          onConfirm={() => run(() => deleteEscalationRule(confirming.id))}
          onClose={() => setConfirming(null)}
        />
      )}
    </Panel>
  )
}
