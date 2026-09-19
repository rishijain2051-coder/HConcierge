'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { rupees } from '@/lib/money'
import { KIND_LABEL, type Promotion, type PromotionKind } from '@/lib/types'
import { deletePromotion, savePromotion } from '../actions'
import { Button, Check, Confirm, Err, Field, Modal, Panel, Select, Tag, TextArea } from '../../ui'

/**
 * What the hotel is offering, and the one screen that decides it.
 *
 * Same shape as Hotel info and Quick replies next door, because it is the same
 * job: a list of one property's words. What is different is that these have
 * conditions attached, and a condition the desk cannot honour is worse than no
 * offer at all - so the form says plainly, every time, that nothing here
 * discounts a bill by itself. The app tells the desk; the desk honours it.
 */
export default function PromotionsManager({
  propertyId,
  properties,
  promotions,
  teams,
}: {
  propertyId: string
  properties: { id: string; name: string }[]
  promotions: Promotion[]
  teams: { value: string; label: string }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<Promotion | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Promotion | null>(null)
  // Only a discount needs a percentage, so the field appears when one is picked.
  const [kind, setKind] = useState<PromotionKind>('coupon')

  const open = (p: Promotion | null) => {
    setKind(p?.kind ?? 'coupon')
    if (p) setEditing(p)
    else setAdding(true)
  }
  const shut = () => {
    setAdding(false)
    setEditing(null)
  }

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
      title="Promotions"
      description="What the concierge offers a guest under Promotions. Nothing here changes a bill on its own - HConcierge never settles anything. When a guest takes one up it lands on the board as a request with the offer named, and the desk honours it at checkout, exactly as it would a voucher from the room folder."
      action={
        <div className="flex flex-wrap gap-2">
          {properties.length > 1 && (
            <select
              value={propertyId}
              onChange={(e) => router.push(`/staff/admin/promotions?property=${e.target.value}`)}
              className="border-line bg-surface rounded-lg border px-3 py-1.5 text-[12px] font-semibold"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" onClick={() => open(null)}>
            + Add an offer
          </Button>
        </div>
      }
    >
      {error && <div className="mb-3">{<Err>{error}</Err>}</div>}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {promotions.map((p) => (
          <article key={p.id} className="bg-surface border-line flex flex-col rounded-2xl border p-4">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <Tag tone={p.active ? 'ok' : undefined}>
                {p.kind === 'discount' && p.percent_off ? `${p.percent_off}% off` : KIND_LABEL[p.kind]}
              </Tag>
              {!p.active && <Tag>Off</Tag>}
              {p.min_spend_paise > 0 && <Tag tone="warn">over {rupees(p.min_spend_paise)}</Tag>}
            </div>
            <h2 className="mb-1 text-[15px] font-semibold">{p.title}</h2>
            <p className="text-muted flex-1 text-[13px] leading-relaxed">{p.description}</p>
            {p.fine_print && <p className="text-faint mt-1.5 text-[12px]">{p.fine_print}</p>}
            <div className="mt-3 flex gap-1.5">
              <Button onClick={() => open(p)}>Edit</Button>
              <Button variant="danger" onClick={() => setConfirming(p)}>
                Delete
              </Button>
            </div>
          </article>
        ))}
        {promotions.length === 0 && (
          <p className="text-faint col-span-full py-16 text-center text-sm">
            Nothing running. A welcome drink is the one most hotels start with.
          </p>
        )}
      </div>

      {(adding || editing) && (
        <Modal wide title={editing ? `Edit “${editing.title}”` : 'Add an offer'} onClose={shut}>
          <form
            className="space-y-3.5"
            action={(form) => {
              const input = {
                id: editing?.id ?? null,
                title: String(form.get('title') ?? ''),
                description: String(form.get('description') ?? ''),
                kind: String(form.get('kind') ?? 'coupon') as PromotionKind,
                minSpendRupees: Number(form.get('minSpend') ?? 0),
                percentOff: form.get('percentOff') ? Number(form.get('percentOff')) : null,
                department: String(form.get('department') ?? '') || null,
                finePrint: String(form.get('finePrint') ?? '') || null,
                active: form.get('active') === 'on',
              }
              run(() => savePromotion(propertyId, input), shut)
            }}
          >
            <Field
              label="Name"
              name="title"
              defaultValue={editing?.title}
              required
              autoFocus
              placeholder="Welcome drink, on us"
              hint="What the guest reads first. Say what they get, not what it is called internally."
            />
            <TextArea
              label="What the guest gets"
              name="description"
              defaultValue={editing?.description}
              rows={3}
              hint="A sentence or two, in the hotel's own voice."
            />
            <Select
              label="Kind"
              name="kind"
              defaultValue={editing?.kind ?? 'coupon'}
              onChange={(v) => setKind(v as PromotionKind)}
              options={[
                { value: 'coupon', label: 'Complimentary - something free' },
                { value: 'pass', label: 'Pass - access to something' },
                { value: 'discount', label: 'Discount - a percentage off' },
              ]}
            />
            {kind === 'discount' && (
              <Field
                label="Percentage off"
                name="percentOff"
                type="number"
                min={1}
                max={100}
                defaultValue={editing?.percent_off ? String(editing.percent_off) : '15'}
                hint="Shown to the guest as the headline. The desk applies it at settlement."
              />
            )}
            <Field
              label="Only once the room bill passes"
              name="minSpend"
              type="number"
              min={0}
              step="100"
              defaultValue={String(Math.round((editing?.min_spend_paise ?? 0) / 100))}
              hint="In rupees. Leave at 0 for no minimum. The concierge counts the room's unsettled balance and tells the guest how far off they are."
            />
            <Select
              label="Goes to"
              name="department"
              defaultValue={editing?.department ?? ''}
              options={[
                { value: '', label: 'Front desk' },
                ...teams.map((t) => ({ value: t.value, label: t.label })),
              ]}
              hint="Which team gets the request when a guest takes it up."
            />
            <Field
              label="Fine print"
              name="finePrint"
              defaultValue={editing?.fine_print ?? ''}
              placeholder="One per stay, served at the bar."
              hint="One short line. The concierge repeats it back when the guest claims, so make it the thing they need to do next."
            />
            <Check label="Offering this now" name="active" defaultChecked={editing ? editing.active : true} />
            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Add offer'}
            </Button>
          </form>
        </Modal>
      )}

      {confirming && (
        <Confirm
          title={`Delete “${confirming.title}”?`}
          body="Guests stop seeing it straight away, and so does the record of who claimed it. Requests already raised from it are not touched - turn it off instead if you only want to pause it."
          confirmLabel="Delete"
          onConfirm={() => run(() => deletePromotion(confirming.id), () => setConfirming(null))}
          onClose={() => setConfirming(null)}
        />
      )}
    </Panel>
  )
}
