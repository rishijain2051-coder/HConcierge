'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { rupees } from '@/lib/money'
import { teamLabel } from '@/lib/types'
import type { AdminCategory, AdminItem } from '@/lib/admin'
import {
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  updateCategory,
  updateItem,
} from '../actions'
import { Button, Check, Confirm, Err, Field, Modal, Panel, Select, Tag } from '../../ui'

const KINDS = [
  { value: 'amenity', label: 'Ask for something — free housekeeping items' },
  { value: 'fnb', label: 'Room service — the food menu' },
  { value: 'service', label: 'Services — paid, like laundry or a spa booking' },
  { value: 'front_desk', label: 'Front desk — wake-up calls, late checkout' },
]
const KIND_SHORT: Record<string, string> = {
  amenity: 'Ask for',
  fnb: 'Room service',
  service: 'Services',
  front_desk: 'Front desk',
}
type Opt = { value: string; label: string }
const VEG_OPTIONS = [
  { value: '', label: 'Not a food item' },
  { value: 'veg', label: 'Vegetarian' },
  { value: 'nonveg', label: 'Non-vegetarian' },
]

export default function CatalogManager({
  propertyId,
  properties,
  categories,
  teams,
}: {
  propertyId: string
  properties: { id: string; name: string }[]
  categories: AdminCategory[]
  teams: Opt[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [activeId, setActiveId] = useState(categories[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<AdminItem | null>(null)
  const [addingItem, setAddingItem] = useState(false)
  const [editingCategory, setEditingCategory] = useState<AdminCategory | null>(null)
  const [addingCategory, setAddingCategory] = useState(false)
  const [confirming, setConfirming] = useState<{ kind: 'item' | 'category'; id: string; name: string } | null>(null)

  const active = categories.find((c) => c.id === activeId) ?? categories[0]

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

  function itemFrom(form: FormData) {
    const veg = String(form.get('veg') ?? '')
    return {
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? '') || null,
      priceRupees: Number(form.get('price') ?? 0),
      unit: String(form.get('unit') ?? '') || null,
      department: String(form.get('department') ?? 'housekeeping'),
      slaMinutes: Number(form.get('sla') ?? 15),
      veg: veg === '' ? null : veg === 'veg',
      needsTime: form.get('needsTime') === 'on',
      available: form.get('available') === 'on',
    }
  }

  const totalItems = categories.reduce((s, c) => s + c.items.length, 0)

  return (
    <Panel
      title="Directory"
      description="Everything a guest can ask for, what it costs, which team it goes to, and how long it is allowed to take. Editing a price never rewrites an old order — past requests keep the name and price they were placed at."
      action={
        <div className="flex flex-wrap gap-2">
          {properties.length > 1 && (
            <select
              value={propertyId}
              onChange={(e) => router.push(`/staff/admin/catalog?property=${e.target.value}`)}
              className="border-line bg-surface rounded-lg border px-3 py-1.5 text-[12px] font-semibold"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <Button onClick={() => setAddingCategory(true)}>+ Section</Button>
          <Button variant="primary" onClick={() => setAddingItem(true)} disabled={!active}>
            + Item
          </Button>
        </div>
      }
    >
      {error && <div className="mb-3">{<Err>{error}</Err>}</div>}

      <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
        {/* Capped on a phone: ten sections pushed every item below the fold. */}
        <nav className="bg-surface border-line divide-line h-fit max-h-64 divide-y overflow-y-auto rounded-2xl border lg:max-h-none lg:overflow-hidden">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition ${
                c.id === active?.id ? 'bg-paper' : 'hover:bg-paper/60'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">
                  {c.name}
                  {!c.active && <span className="text-faint ml-1.5 text-[11px]">hidden</span>}
                </span>
                <span className="text-faint text-[11px]">{KIND_SHORT[c.kind] ?? c.kind}</span>
              </span>
              <span className="text-faint shrink-0 text-[11px] tabular-nums">{c.items.length}</span>
            </button>
          ))}
          {categories.length === 0 && (
            <p className="text-faint px-3.5 py-8 text-center text-[12px]">No sections yet.</p>
          )}
        </nav>

        <div className="min-w-0">
          {active ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-[17px] font-semibold tracking-tight">{active.name}</h2>
                  <p className="text-faint text-[12px]">
                    Appears under {KIND_SHORT[active.kind]} · {active.items.length} item
                    {active.items.length === 1 ? '' : 's'} · {totalItems} across the whole directory
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button onClick={() => setEditingCategory(active)}>Edit section</Button>
                  <Button
                    variant="danger"
                    onClick={() => setConfirming({ kind: 'category', id: active.id, name: active.name })}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
                {active.items.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
                    <div className="min-w-[12rem] flex-1">
                      <p className="text-[14px] font-medium">
                        {i.name}
                        {i.veg !== null && (
                          <span
                            aria-label={i.veg ? 'Vegetarian' : 'Non-vegetarian'}
                            className={`ml-2 inline-grid h-3 w-3 shrink-0 translate-y-px place-items-center rounded-[2px] border align-middle ${
                              i.veg ? 'border-ok' : 'border-late'
                            }`}
                          >
                            <span className={`h-1 w-1 rounded-full ${i.veg ? 'bg-ok' : 'bg-late'}`} />
                          </span>
                        )}
                      </p>
                      {i.description && <p className="text-faint line-clamp-1 text-[12px]">{i.description}</p>}
                    </div>
                    <div className="flex min-w-[15rem] flex-wrap items-center gap-1.5">
                      <Tag>{i.price_paise > 0 ? rupees(i.price_paise) : 'Complimentary'}</Tag>
                      <Tag>{teamLabel(teams, i.department)}</Tag>
                      <Tag>{i.sla_minutes} min</Tag>
                      {i.needs_time && <Tag tone="warn">Needs a time</Tag>}
                      {!i.available && <Tag tone="late">Unavailable</Tag>}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button onClick={() => setEditingItem(i)}>Edit</Button>
                      <Button
                        variant="danger"
                        onClick={() => setConfirming({ kind: 'item', id: i.id, name: i.name })}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
                {active.items.length === 0 && (
                  <p className="text-faint px-4 py-12 text-center text-sm">
                    Nothing in this section yet. A guest will not see it until it has an item.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-faint py-16 text-center text-sm">Add a section to get started.</p>
          )}
        </div>
      </div>

      {(addingItem || editingItem) && active && (
        <Modal
          wide
          title={editingItem ? `Edit ${editingItem.name}` : `Add to ${active.name}`}
          onClose={() => (setAddingItem(false), setEditingItem(null))}
        >
          <form
            className="space-y-3.5"
            action={(form) => {
              const input = itemFrom(form)
              if (editingItem) run(() => updateItem(editingItem.id, input), () => setEditingItem(null))
              else run(() => createItem(active.id, input), () => setAddingItem(false))
            }}
          >
            <Field label="Name" name="name" defaultValue={editingItem?.name} required autoFocus placeholder="Bath towels" />
            <Field
              label="Description (optional)"
              name="description"
              defaultValue={editingItem?.description ?? ''}
              placeholder="Soap, shampoo, conditioner, body wash"
            />

            <div className="grid gap-3.5 sm:grid-cols-3">
              <Field
                label="Price (₹)"
                name="price"
                type="number"
                min={0}
                step="0.01"
                defaultValue={editingItem ? editingItem.price_paise / 100 : 0}
                hint="0 shows as complimentary. Paise are allowed — 249.50."
              />
              <Field
                label="Target (minutes)"
                name="sla"
                type="number"
                min={1}
                max={1440}
                defaultValue={editingItem?.sla_minutes ?? 15}
                hint="Amber at 60%, escalates past it."
              />
              <Field label="Unit (optional)" name="unit" defaultValue={editingItem?.unit ?? ''} placeholder="per piece" />
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Select
                label="Goes to"
                name="department"
                defaultValue={editingItem?.department ?? 'housekeeping'}
                options={teams}
              />
              <Select
                label="Food marking"
                name="veg"
                defaultValue={editingItem?.veg === null || editingItem === null ? '' : editingItem?.veg ? 'veg' : 'nonveg'}
                options={VEG_OPTIONS}
              />
            </div>

            <div className="border-line rounded-xl border px-3.5 py-2">
              <Check label="Available to order" name="available" defaultChecked={editingItem?.available ?? true} />
              <Check
                label="Guest must pick a time (wake-up calls, spa, airport transfers)"
                name="needsTime"
                defaultChecked={editingItem?.needs_time ?? false}
              />
            </div>

            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : editingItem ? 'Save changes' : 'Add item'}
            </Button>
          </form>
        </Modal>
      )}

      {(addingCategory || editingCategory) && (
        <Modal
          title={editingCategory ? `Edit ${editingCategory.name}` : 'Add a section'}
          onClose={() => (setAddingCategory(false), setEditingCategory(null))}
        >
          <form
            className="space-y-3.5"
            action={(form) => {
              const input = {
                kind: String(form.get('kind') ?? 'amenity'),
                name: String(form.get('name') ?? ''),
                // The guest's category rail stopped rendering these when the
                // emoji came off it. Keep whatever is stored rather than
                // wiping it on the next save.
                icon: editingCategory?.icon ?? null,
              }
              if (editingCategory) {
                run(
                  () => updateCategory(editingCategory.id, { ...input, active: form.get('active') === 'on' }),
                  () => setEditingCategory(null),
                )
              } else {
                run(() => createCategory(propertyId, input), () => setAddingCategory(false))
              }
            }}
          >
            <Field
              label="Section name"
              name="name"
              defaultValue={editingCategory?.name}
              required
              autoFocus
              placeholder="Towels & linen"
            />
            <Select
              label="Where it appears"
              name="kind"
              defaultValue={editingCategory?.kind ?? 'amenity'}
              options={KINDS}
            />
            {editingCategory && (
              <div className="border-line rounded-xl border px-3.5 py-2">
                <Check label="Show this section to guests" name="active" defaultChecked={editingCategory.active} />
              </div>
            )}
            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : editingCategory ? 'Save changes' : 'Add section'}
            </Button>
          </form>
        </Modal>
      )}

      {confirming && (
        <Confirm
          title={`Delete ${confirming.name}?`}
          body={
            confirming.kind === 'item'
              ? 'Guests will no longer see it. Orders that already included it keep the name and price they were placed at, so your history stays correct.'
              : 'The section has to be empty first. Deleting it only removes the grouping, not any history.'
          }
          confirmLabel="Delete"
          onConfirm={() =>
            run(() => (confirming.kind === 'item' ? deleteItem(confirming.id) : deleteCategory(confirming.id)))
          }
          onClose={() => setConfirming(null)}
        />
      )}
    </Panel>
  )
}
